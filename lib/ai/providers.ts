import { createAnthropic } from "@ai-sdk/anthropic";
import { BACKEND_URL, BETTER_VAULT_MODEL } from "@/lib/account/config";
import { createDeepSeek } from "@ai-sdk/deepseek";
import { createElevenLabs } from "@ai-sdk/elevenlabs";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createOpenAICompatible } from "@ai-sdk/openai-compatible";
import {
  wrapLanguageModel,
  type ImageModel,
  type LanguageModel,
  type SpeechModel,
  type ToolSet,
} from "ai";
import { chatGPTLanguageModel } from "@/lib/chatgpt/model";
import {
  isCustomProviderId,
  providerInfo,
  providers,
  type Effort,
  type ModelRef,
  type ProviderCredentials,
} from "./catalog";
import { customProviderBaseURL } from "./custom-provider";
import { createOpenCodeModel } from "./opencode";
import {
  chatGPTAllowed,
  fetchCustomProviderEndpoint,
  fetchProviderEndpoint,
  localProvidersAllowed,
  parseBaseURL,
} from "./server-config";

function openAIProvider(credentials: ProviderCredentials) {
  return createOpenAI({
    apiKey: credentials.apiKey,
    baseURL: parseBaseURL(
      credentials.baseURL,
      providers.openai.defaultBaseURL ?? "https://api.openai.com/v1",
    ).toString(),
    fetch: fetchProviderEndpoint,
  });
}

/**
 * Builds the model for one request from the credentials sent with it.
 * Nothing is cached, so a key never outlives the request.
 */
export async function createLanguageModel(
  ref: ModelRef,
  credentials: ProviderCredentials,
  effort: Effort = "provider-default",
): Promise<LanguageModel> {
  const model = await baseLanguageModel(ref, credentials);
  if (effort === "provider-default" || !providerInfo(ref.provider).efforts.includes(effort))
    return model;
  // Every call made with this model (chat, Studio) thinks at the chosen effort.
  return wrapLanguageModel({
    model: model as Parameters<typeof wrapLanguageModel>[0]["model"],
    middleware: { transformParams: async ({ params }) => ({ ...params, reasoning: effort }) },
  });
}

async function baseLanguageModel(
  ref: ModelRef,
  credentials: ProviderCredentials,
): Promise<LanguageModel> {
  if (isCustomProviderId(ref.provider)) {
    const baseURL = customProviderBaseURL(credentials.baseURL ?? "");
    if (!baseURL) throw new Error("Enter a valid HTTP or HTTPS API base URL in Settings.");
    const model = createOpenAICompatible({
      name: ref.provider,
      baseURL,
      apiKey: credentials.apiKey,
      fetch: fetchCustomProviderEndpoint,
    }).chatModel(ref.modelId);
    return wrapLanguageModel({
      model,
      middleware: {
        transformParams: async ({ params }) => {
          const format = params.responseFormat;
          if (format?.type !== "json" || !format.schema) return params;
          // Some compatible servers support JSON mode without the JSON schema extension.
          const schema = `Return only JSON that matches this schema:\n${JSON.stringify(format.schema)}`;
          const [first, ...rest] = params.prompt;
          return {
            ...params,
            responseFormat: { type: "json" },
            prompt:
              first?.role === "system"
                ? [{ ...first, content: `${first.content}\n\n${schema}` }, ...rest]
                : [{ role: "system", content: schema }, ...params.prompt],
          };
        },
      },
    });
  }
  const info = providers[ref.provider];
  if (info.kind !== "chat") throw new Error(`${info.name} makes audio only; choose another model.`);
  if (ref.provider === "openai" && credentials.chatgpt) {
    if (!chatGPTAllowed()) throw new Error("Sign in with ChatGPT is unavailable on this server.");
    return chatGPTLanguageModel(ref.modelId);
  }
  if (info.needsKey && !credentials.apiKey)
    throw new Error(`Add an API key for ${info.name} in Settings.`);
  if (info.local && !localProvidersAllowed())
    throw new Error("Local providers are turned off on this server.");

  switch (ref.provider) {
    case "openai":
      return openAIProvider(credentials)(ref.modelId);
    case "anthropic":
      return createAnthropic({ apiKey: credentials.apiKey })(ref.modelId);
    case "bettervault":
      // The backend speaks Anthropic's API, meters it and runs only Haiku.
      return createAnthropic({ apiKey: credentials.apiKey, baseURL: `${BACKEND_URL}/v1/ai` })(
        BETTER_VAULT_MODEL,
      );
    case "google":
      return createGoogleGenerativeAI({ apiKey: credentials.apiKey })(ref.modelId);
    case "deepseek":
      return createDeepSeek({ apiKey: credentials.apiKey })(ref.modelId);
    case "opencode":
      return createOpenCodeModel(ref.modelId, credentials.apiKey ?? "", credentials.baseURL);
    case "ollama":
    case "lmstudio": {
      const base = parseBaseURL(credentials.baseURL, info.defaultBaseURL ?? "");
      return createOpenAICompatible({
        name: ref.provider,
        baseURL: new URL("/v1", base).toString(),
        supportsStructuredOutputs: true,
      })(ref.modelId);
    }
    case "elevenlabs":
      throw new Error(`${info.name} makes audio only.`);
  }
}

/** Builds an image model for one request. Only OpenAI and Google draw pictures. */
export function createImageModel(ref: ModelRef, credentials: ProviderCredentials): ImageModel {
  const info = providerInfo(ref.provider);
  if (info.imageModels.length === 0) throw new Error(`${info.name} has no image models.`);
  if (!credentials.apiKey) throw new Error(`Add an API key for ${info.name} in Settings.`);
  switch (ref.provider) {
    case "openai":
      return openAIProvider(credentials).image(ref.modelId);
    case "google":
      return createGoogleGenerativeAI({ apiKey: credentials.apiKey }).image(ref.modelId);
    default:
      throw new Error(`${info.name} has no image models.`);
  }
}

/** Builds a speech model for one request. Only ElevenLabs speaks. */
export function createSpeechModel(ref: ModelRef, credentials: ProviderCredentials): SpeechModel {
  const info = providerInfo(ref.provider);
  if (info.kind !== "audio") throw new Error(`${info.name} does not make speech.`);
  if (!credentials.apiKey) throw new Error(`Add an API key for ${info.name} in Settings.`);
  return createElevenLabs({ apiKey: credentials.apiKey }).speech(ref.modelId);
}

/**
 * The provider's own web search tool, or nothing when it has none.
 * better-vault uses no third-party search service.
 */
export function createWebSearchTools(
  ref: ModelRef,
  credentials: ProviderCredentials,
): ToolSet | undefined {
  switch (ref.provider) {
    case "openai":
      return { web_search: openAIProvider(credentials).tools.webSearch({}) };
    case "anthropic":
    case "bettervault":
      return {
        web_search: createAnthropic({ apiKey: credentials.apiKey }).tools.webSearch_20260318({
          maxUses: 5,
        }),
      };
    case "google":
      return {
        google_search: createGoogleGenerativeAI({ apiKey: credentials.apiKey }).tools.googleSearch(
          {},
        ),
      };
    default:
      return undefined;
  }
}
