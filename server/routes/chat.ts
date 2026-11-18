import {
  convertToModelMessages,
  createUIMessageStreamResponse,
  stepCountIs,
  streamText,
  toUIMessageStream,
  type LanguageModelUsage,
} from "ai";
import { z } from "zod";
import { isCustomProviderId, providerInfo } from "@/lib/ai/catalog";
import { describeError } from "@/lib/ai/errors";
import { chatSystemPrompt } from "@/lib/ai/prompts";
import { createLanguageModel, createWebSearchTools } from "@/lib/ai/providers";
import { createVisualTools } from "../visual-tools";
import { credentialsSchema, effortSchema, modelRefSchema } from "@/lib/ai/request";
import type { ChatMessage, ChatMessageMetadata, TokenUsage } from "@/lib/chat/types";
import { toPassageRefs, stripCitations, type Passage } from "@/lib/grounding/passages";

const passageSchema = z.object({
  n: z.number().int().positive(),
  chunkId: z.string(),
  sourceId: z.string(),
  title: z.string(),
  kind: z.enum(["text", "markdown", "pdf", "url"]),
  text: z.string(),
});

const bodySchema = z.object({
  messages: z
    .array(z.looseObject({ id: z.string(), role: z.enum(["system", "user", "assistant"]) }))
    .min(1),
  mode: z.enum(["sources", "web"]),
  model: modelRefSchema,
  credentials: credentialsSchema,
  effort: effortSchema,
  passages: z.array(passageSchema).max(2000),
  chatInstructions: z.string().max(10_000).optional(),
  /** Skills the user attached to the chat (SKILL.md files from the vault). */
  skills: z
    .array(
      z.object({
        name: z.string().max(80),
        description: z.string().max(2000),
        body: z.string().max(40_000),
      }),
    )
    .max(8)
    .default([]),
  /** Whether the model may answer with visuals (generative UI). */
  visuals: z.boolean().default(true),
});

/** Earlier answers cite passages by numbers that no longer exist; drop them. */
function withoutOldCitations(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message, at) =>
    message.role !== "assistant" || at === messages.length - 1
      ? message
      : {
          ...message,
          parts: message.parts.map((part) =>
            part.type === "text" ? { ...part, text: stripCitations(part.text) } : part,
          ),
        },
  );
}

/** Responses APIs with `store: false` can't resolve reasoning item ids from earlier turns. */
function withoutUnstoredReasoningIds(messages: ChatMessage[]): ChatMessage[] {
  return messages.map((message) => ({
    ...message,
    parts: message.parts.map((part) => {
      if (part.type !== "reasoning") return part;
      const metadata = part.providerMetadata?.openai;
      if (!metadata || !("itemId" in metadata)) return part;
      const openai = { ...metadata };
      delete openai.itemId;
      return {
        ...part,
        providerMetadata: { ...part.providerMetadata, openai },
      };
    }),
  }));
}

function textLength(message: ChatMessage): number {
  return message.parts.reduce((sum, part) => sum + (part.type === "text" ? part.text.length : 0), 0);
}

/** The provider's count, without the parts that are unknown. */
function tokenUsage(usage: LanguageModelUsage): TokenUsage {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    reasoningTokens: usage.outputTokenDetails.reasoningTokens,
    cachedInputTokens: usage.inputTokenDetails.cacheReadTokens,
  };
}

export async function POST(request: Request) {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const { mode, model, credentials, effort } = parsed.data;
  const messages = parsed.data.messages as unknown as ChatMessage[];
  const passages = parsed.data.passages as Passage[];

  const info = providerInfo(model.provider);
  if (mode === "web" && !info.webSearch) {
    return Response.json({ error: `${info.name} has no built-in web search.` }, { status: 400 });
  }

  let languageModel;
  try {
    languageModel = await createLanguageModel(model, credentials, effort);
  } catch (error) {
    return Response.json({ error: describeError(error, credentials.apiKey) }, { status: 400 });
  }

  // Local and custom models may only support plain chat messages.
  const visuals = parsed.data.visuals && !info.local && !isCustomProviderId(model.provider);
  const searchTools = mode === "web" ? createWebSearchTools(model, credentials) : undefined;
  const tools = visuals ? { ...searchTools, ...createVisualTools() } : searchTools;
  const options = {
    skills: parsed.data.skills,
    visuals,
    chatInstructions: parsed.data.chatInstructions,
  };
  const system = chatSystemPrompt(mode, passages, options);
  const instructions = chatSystemPrompt(mode, [], options).length;
  const conversation = withoutOldCitations(messages);
  // A custom OpenAI-compatible endpoint may also run with storage disabled.
  const modelMessages =
    model.provider === "openai" ? withoutUnstoredReasoningIds(conversation) : conversation;
  const result = streamText({
    model: languageModel,
    system,
    messages: await convertToModelMessages(modelMessages, {
      ignoreIncompleteToolCalls: true,
    }),
    tools,
    stopWhen: stepCountIs(5),
    abortSignal: request.signal,
  });

  const metadata: ChatMessageMetadata = {
    createdAt: Date.now(),
    mode,
    model,
    passages: toPassageRefs(passages),
    prompt: {
      instructions,
      sources: Math.max(0, system.length - instructions),
      conversation: messages.reduce((sum, message) => sum + textLength(message), 0),
    },
  };

  return createUIMessageStreamResponse({
    stream: toUIMessageStream({
      stream: result.stream,
      tools,
      originalMessages: messages,
      sendSources: true,
      messageMetadata: ({ part }): ChatMessageMetadata | undefined => {
        if (part.type === "start") return metadata;
        if (part.type === "finish") return { usage: tokenUsage(part.totalUsage) };
        return undefined;
      },
      onError: (error) => describeError(error, credentials.apiKey),
    }),
  });
}
