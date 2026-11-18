import { listChatGPTModels } from "@/lib/chatgpt/model";
import {
  isCustomProviderId,
  providers,
  type ProviderCredentials,
  type ProviderId,
} from "./catalog";
import { customProviderBaseURL } from "./custom-provider";
import { listOpenCodeModels } from "./opencode";
import {
  chatGPTAllowed,
  fetchCustomProviderEndpoint,
  fetchProviderEndpoint,
  localProvidersAllowed,
  parseBaseURL,
} from "./server-config";

const TIMEOUT = 10_000;

async function getJson<T>(
  url: string,
  headers: Record<string, string> = {},
  fetcher: typeof fetch = fetch,
): Promise<T> {
  let response: Response;
  try {
    response = await fetcher(url, {
      headers,
      signal: AbortSignal.timeout(TIMEOUT),
      cache: "no-store",
    });
  } catch (error) {
    if (error instanceof Error && error.name === "TimeoutError") throw error;
    if (fetcher !== fetch) throw error;
    throw new Error(`Could not reach ${new URL(url).origin}. Is the server running?`);
  }
  if (!response.ok) {
    let reason = response.statusText;
    try {
      const body = (await response.json()) as { error?: { message?: string } | string };
      reason = typeof body.error === "string" ? body.error : (body.error?.message ?? reason);
    } catch {
      // Not JSON; the status text will do.
    }
    throw new Error(`${response.status} ${reason}`.trim());
  }
  return (await response.json()) as T;
}

// Models that do not chat (audio, images, embeddings, …).
const NOT_CHAT =
  /(audio|realtime|transcribe|tts|image|embed|moderation|whisper|dall-e|computer-use|robotics|native-audio|live|veo|imagen|aqa)/i;

const byNewest = (a: string, b: string) => b.localeCompare(a, "en", { numeric: true });

export interface ModelList {
  models: string[];
  /** Each model's context window in tokens, where the provider says. */
  contextTokens: Record<string, number>;
}

/** Lists the chat models a provider offers to these credentials, with their context windows. */
export async function listModels(
  provider: ProviderId,
  credentials: ProviderCredentials,
): Promise<ModelList> {
  const contextTokens: Record<string, number> = {};
  const models = await listModelIds(provider, credentials, contextTokens);
  return { models, contextTokens };
}

async function listModelIds(
  provider: ProviderId,
  credentials: ProviderCredentials,
  contextTokens: Record<string, number>,
): Promise<string[]> {
  if (isCustomProviderId(provider)) {
    const base = customProviderBaseURL(credentials.baseURL ?? "");
    if (!base) throw new Error("Enter a valid HTTP or HTTPS API base URL in Settings.");
    const body = await getJson<{ data: { id: string }[] }>(
      `${base}/models`,
      credentials.apiKey ? { authorization: `Bearer ${credentials.apiKey}` } : {},
      fetchCustomProviderEndpoint,
    );
    if (!Array.isArray(body?.data)) throw new Error("The server returned an invalid model list.");
    return [
      ...new Set(
        body.data.flatMap((model) =>
          typeof model?.id === "string" && model.id.trim() && model.id.length <= 200
            ? [model.id]
            : [],
        ),
      ),
    ].sort(byNewest);
  }
  const info = providers[provider];
  if (provider === "openai" && credentials.chatgpt) {
    if (!chatGPTAllowed()) throw new Error("Sign in with ChatGPT is unavailable on this server.");
    return listChatGPTModels();
  }
  if (info.needsKey && !credentials.apiKey) throw new Error("An API key is needed.");
  if (info.local && !localProvidersAllowed())
    throw new Error("Local providers are turned off on this server.");

  switch (provider) {
    case "openai": {
      const base = parseBaseURL(
        credentials.baseURL,
        info.defaultBaseURL ?? "https://api.openai.com/v1",
      );
      base.pathname = `${base.pathname.replace(/\/+$/, "")}/`;
      base.search = "";
      base.hash = "";
      const body = await getJson<{ data: { id: string }[] }>(
        new URL("models", base).toString(),
        { authorization: `Bearer ${credentials.apiKey}` },
        fetchProviderEndpoint,
      );
      return body.data
        .map((model) => model.id)
        .filter(
          (id) =>
            /^(gpt-|o\d|chatgpt-)/.test(id) && !NOT_CHAT.test(id) && !/search|instruct/.test(id),
        )
        .sort(byNewest);
    }
    case "anthropic": {
      const body = await getJson<{ data: { id: string; max_input_tokens?: number }[] }>(
        "https://api.anthropic.com/v1/models?limit=100",
        {
          "x-api-key": credentials.apiKey ?? "",
          "anthropic-version": "2023-06-01",
        },
      );
      for (const model of body.data)
        if (model.max_input_tokens) contextTokens[model.id] = model.max_input_tokens;
      return body.data.map((model) => model.id);
    }
    case "google": {
      const body = await getJson<{
        models?: {
          name: string;
          supportedGenerationMethods?: string[];
          inputTokenLimit?: number;
        }[];
      }>("https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000", {
        "x-goog-api-key": credentials.apiKey ?? "",
      });
      for (const model of body.models ?? [])
        if (model.inputTokenLimit)
          contextTokens[model.name.replace(/^models\//, "")] = model.inputTokenLimit;
      return (body.models ?? [])
        .filter((model) => model.supportedGenerationMethods?.includes("generateContent"))
        .map((model) => model.name.replace(/^models\//, ""))
        .filter((id) => id.startsWith("gemini") && !NOT_CHAT.test(id))
        .sort(byNewest);
    }
    case "deepseek": {
      const body = await getJson<{ data: { id: string }[] }>("https://api.deepseek.com/models", {
        authorization: `Bearer ${credentials.apiKey}`,
      });
      return body.data.map((model) => model.id).sort(byNewest);
    }
    case "opencode":
      return listOpenCodeModels(credentials.baseURL);
    case "bettervault":
      return [...info.suggestedModels];
    case "elevenlabs": {
      // Its speech models; the voices are listed by /api/voices.
      return [...info.suggestedModels];
    }
    case "ollama": {
      const base = parseBaseURL(credentials.baseURL, info.defaultBaseURL ?? "");
      const body = await getJson<{ models: { name: string }[] }>(
        new URL("/api/tags", base).toString(),
      );
      return body.models.map((model) => model.name).filter((id) => !NOT_CHAT.test(id));
    }
    case "lmstudio": {
      const base = parseBaseURL(credentials.baseURL, info.defaultBaseURL ?? "");
      const body = await getJson<{ data: { id: string }[] }>(
        new URL("/v1/models", base).toString(),
      );
      return body.data.map((model) => model.id).filter((id) => !NOT_CHAT.test(id));
    }
  }
}
