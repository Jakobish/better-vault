import { generateId } from "ai";
import {
  chatProviderIds,
  isCustomProviderId,
  providerIds,
  providerInfo,
  providers,
  type BuiltInProviderId,
  type CustomProviderId,
  type Effort,
  type ModelRef,
  type ProviderCredentials,
  type ProviderId,
} from "@/lib/ai/catalog";
import { customProviderBaseURL } from "@/lib/ai/custom-provider";
import { useStoreQuery } from "./live";
import { store } from "./store";

export interface ProviderSettings {
  enabled: boolean;
  apiKey: string;
  baseURL: string;
  /** The provider's models, as last fetched. Empty until fetched. */
  models: string[];
  /** Overrides the provider's default context size (characters of source text). */
  contextChars: number | null;
  /**
   * OpenAI only: the ChatGPT account signed in on the local server, whose
   * plan then pays for text. Only who it is; the tokens stay on the server.
   */
  chatgpt: ChatGPTAccountLabel | null;
  /** How much its models think before answering, in chat and in the Studio. */
  effort: Effort;
  /** Each model's context window in tokens, where the provider's list said. */
  contextTokens: Record<string, number>;
}

export interface ChatGPTAccountLabel {
  email: string;
  name: string;
}

export interface CustomProviderSettings extends ProviderSettings {
  name: string;
}

export interface AppSettings {
  providers: Record<BuiltInProviderId, ProviderSettings>;
  customProviders: Partial<Record<CustomProviderId, CustomProviderSettings>>;
  /** The model chosen in the prompt bar. */
  model: ModelRef | null;
  /** Models starred in the model picker, as `provider:modelId`. */
  favoriteModels: string[];
}

const SETTINGS_KEY = "app";

function defaultProviderSettings(baseURL = ""): ProviderSettings {
  return {
    enabled: false,
    apiKey: "",
    baseURL,
    models: [],
    contextChars: null,
    chatgpt: null,
    effort: "provider-default",
    contextTokens: {},
  };
}

export function defaultSettings(): AppSettings {
  const entries = providerIds.map((id) => [
    id,
    defaultProviderSettings(providers[id].defaultBaseURL),
  ]);
  return {
    providers: Object.fromEntries(entries) as Record<BuiltInProviderId, ProviderSettings>,
    customProviders: {},
    model: null,
    favoriteModels: [],
  };
}

/** Fills in anything missing, so settings saved by an older version still work. */
function withDefaults(saved: Partial<AppSettings> | undefined): AppSettings {
  const base = defaultSettings();
  if (!saved) return base;
  for (const id of providerIds) {
    base.providers[id] = { ...base.providers[id], ...saved.providers?.[id] };
  }
  base.customProviders = saved.customProviders ?? {};
  base.model = saved.model ?? null;
  base.favoriteModels = saved.favoriteModels ?? [];
  return base;
}

export async function getSettings(): Promise<AppSettings> {
  const value = await store().getSetting(SETTINGS_KEY);
  return withDefaults(value as Partial<AppSettings> | undefined);
}

let pendingSettingsWrite = Promise.resolve();

/** Applies a change after other writes from this window have settled. */
export function updateSettings(change: (settings: AppSettings) => void): Promise<void> {
  const write = pendingSettingsWrite.then(async () => {
    const settings = await getSettings();
    change(settings);
    await store().putSetting(SETTINGS_KEY, settings);
  });
  pendingSettingsWrite = write.catch(() => {});
  return write;
}

export async function updateProvider(id: ProviderId, patch: Partial<CustomProviderSettings>) {
  await updateSettings((settings) => {
    if (isCustomProviderId(id)) {
      const current = settings.customProviders[id];
      if (current) settings.customProviders[id] = { ...current, ...patch };
      return;
    }
    settings.providers[id] = { ...settings.providers[id], ...patch };
  });
}

export async function addCustomProvider({
  name,
  baseURL,
  apiKey,
}: Pick<CustomProviderSettings, "name" | "baseURL" | "apiKey">): Promise<CustomProviderId> {
  const id: CustomProviderId = `custom-${generateId()}`;
  await updateSettings((settings) => {
    settings.customProviders[id] = {
      ...defaultProviderSettings(baseURL),
      name,
      enabled: true,
      apiKey,
    };
  });
  return id;
}

export async function removeCustomProvider(id: CustomProviderId): Promise<void> {
  await updateSettings((settings) => {
    delete settings.customProviders[id];
    if (settings.model?.provider === id) settings.model = null;
    settings.favoriteModels = settings.favoriteModels.filter((key) => !key.startsWith(`${id}:`));
  });
}

/** Restores provider defaults and model preferences, keeping connected accounts. */
export async function resetProviderSettings(): Promise<void> {
  const defaults = defaultSettings();
  await updateSettings((settings) => {
    defaults.providers.bettervault = settings.providers.bettervault;
    defaults.providers.openai.chatgpt = settings.providers.openai.chatgpt;
    settings.providers = defaults.providers;
    settings.customProviders = defaults.customProviders;
    settings.model = defaults.model;
    settings.favoriteModels = defaults.favoriteModels;
  });
}

/** The saved settings, live. `undefined` while loading. */
export function useSettings(): AppSettings | undefined {
  return useStoreQuery(getSettings, [], ["settings"]);
}

export function savedProvider(settings: AppSettings, id: ProviderId): ProviderSettings | undefined {
  return isCustomProviderId(id) ? settings.customProviders[id] : settings.providers[id];
}

export function providerName(settings: AppSettings | undefined, id: ProviderId): string {
  return isCustomProviderId(id)
    ? (settings?.customProviders[id]?.name ?? providerInfo(id).name)
    : providers[id].name;
}

export function customProviderIds(settings: AppSettings): CustomProviderId[] {
  return Object.keys(settings.customProviders).filter(isCustomProviderId);
}

/**
 * A provider can be used once it is enabled and has a key (cloud) or an
 * address (local). OpenAI can use a ChatGPT sign-in instead of a key.
 */
export function isProviderReady(settings: AppSettings, id: ProviderId): boolean {
  const saved = savedProvider(settings, id);
  if (!saved?.enabled) return false;
  if (isCustomProviderId(id))
    return !!customProviderBaseURL(saved.baseURL) && saved.models.length > 0;
  if (usesChatGPT(settings, id)) return true;
  return providers[id].needsKey ? saved.apiKey.trim() !== "" : saved.baseURL.trim() !== "";
}

/** Text requests to OpenAI go through the signed-in ChatGPT plan rather than the key. */
export function usesChatGPT(settings: AppSettings, id: ProviderId): boolean {
  return id === "openai" && settings.providers.openai.chatgpt !== null;
}

/** The credentials for text requests (chat, Studio). */
export function credentialsFor(settings: AppSettings, id: ProviderId): ProviderCredentials {
  if (isCustomProviderId(id)) {
    const saved = settings.customProviders[id];
    return { baseURL: saved?.baseURL, apiKey: saved?.apiKey.trim() || undefined };
  }
  const saved = settings.providers[id];
  if (usesChatGPT(settings, id)) return { chatgpt: true };
  if (!providers[id].needsKey)
    return { baseURL: saved.baseURL.trim() || providers[id].defaultBaseURL };
  if (id === "openai")
    return {
      apiKey: saved.apiKey.trim(),
      baseURL: saved.baseURL.trim() || providers[id].defaultBaseURL,
    };
  // OpenCode's address picks the plan (Zen or Go); the server only accepts those two.
  if (id === "opencode")
    return { apiKey: saved.apiKey.trim(), baseURL: saved.baseURL || providers[id].defaultBaseURL };
  return { apiKey: saved.apiKey.trim() };
}

/** Pictures always need an API key: a ChatGPT plan cannot generate images here. */
function canDrawPictures(settings: AppSettings, id: BuiltInProviderId): boolean {
  const saved = settings.providers[id];
  return saved.enabled && saved.apiKey.trim() !== "" && providers[id].imageModels.length > 0;
}

/** The credentials for an image model: its API key. */
export function imageCredentialsFrom(
  settings: AppSettings,
  id: ProviderId,
): ProviderCredentials | null {
  if (isCustomProviderId(id) || !canDrawPictures(settings, id)) return null;
  return {
    apiKey: settings.providers[id].apiKey.trim(),
    ...(id === "openai"
      ? { baseURL: settings.providers[id].baseURL.trim() || providers[id].defaultBaseURL }
      : {}),
  };
}

/** The credentials for a speech model: its provider's API key, when it is on. */
export function speechCredentialsFrom(
  settings: AppSettings,
  id: ProviderId,
): ProviderCredentials | null {
  if (isCustomProviderId(id)) return null;
  const saved = settings.providers[id];
  return providers[id].kind === "audio" && saved.enabled && saved.apiKey.trim()
    ? { apiKey: saved.apiKey.trim() }
    : null;
}

/** The effort for text requests to this provider; `provider-default` when it has no levels. */
export function effortFor(settings: AppSettings, id: ProviderId): Effort {
  if (isCustomProviderId(id)) return "provider-default";
  const effort = settings.providers[id].effort;
  return providers[id].efforts.includes(effort) ? effort : "provider-default";
}

/**
 * How many tokens a model reads at once: the provider's figure when its list
 * gave one, else the catalog's estimate (for local models, from the context
 * size the user set).
 */
export function contextTokensFor(settings: AppSettings, ref: ModelRef): number {
  const listed = savedProvider(settings, ref.provider)?.contextTokens[ref.modelId];
  if (listed) return listed;
  const info = providerInfo(ref.provider);
  if (info.local || isCustomProviderId(ref.provider))
    return Math.round(contextCharsFor(settings, ref.provider) / 4);
  return info.contextTokens;
}

export function contextCharsFor(settings: AppSettings, id: ProviderId): number {
  return savedProvider(settings, id)?.contextChars ?? providerInfo(id).contextChars;
}

/** Every model the user can pick: the fetched list, or the suggestions until then. */
export function availableModels(settings: AppSettings): ModelRef[] {
  return [...chatProviderIds, ...customProviderIds(settings)]
    .filter((id) => isProviderReady(settings, id))
    .flatMap((id) => {
      const saved = savedProvider(settings, id)?.models;
      const list = saved?.length ? saved : providerInfo(id).suggestedModels;
      return list.map((modelId) => ({ provider: id, modelId }));
    });
}

/** Every image model the user can pick: those of providers with a key that draw pictures. */
export function availableImageModels(settings: AppSettings): ModelRef[] {
  return providerIds
    .filter((id) => canDrawPictures(settings, id))
    .flatMap((id) => providers[id].imageModels.map((modelId) => ({ provider: id, modelId })));
}

/** The chosen model if it is still available, else the first one that is. */
export function activeModel(settings: AppSettings): ModelRef | null {
  const models = availableModels(settings);
  const chosen = settings.model;
  if (
    chosen &&
    models.some((m) => m.provider === chosen.provider && m.modelId === chosen.modelId)
  ) {
    return chosen;
  }
  return models[0] ?? null;
}
