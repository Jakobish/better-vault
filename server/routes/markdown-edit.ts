import { streamText } from "ai";
import { describeError } from "@/lib/ai/errors";
import { createLanguageModel } from "@/lib/ai/providers";
import { markdownEditPrompt } from "@/lib/markdown/ai/prompt";
import { markdownEditRequest } from "@/lib/markdown/ai/request";

export async function POST(request: Request) {
  const parsed = markdownEditRequest.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Invalid request." }, { status: 400 });
  const body = parsed.data;
  try {
    const model = await createLanguageModel(body.model, body.credentials, body.effort);
    let failed = false;
    const result = streamText({
      model,
      ...markdownEditPrompt(body),
      abortSignal: request.signal,
      onError: () => { failed = true; },
    });
    const response = result.toTextStreamResponse({ headers: { "Cache-Control": "no-store" } });
    // The text projection omits error parts. Reject an incomplete response so
    // the client never mistakes partial text for a reviewable proposal.
    const stream = response.body?.pipeThrough(new TransformStream({
      async flush() {
        const reason = await result.finishReason.catch(() => "error");
        if (failed || request.signal.aborted || reason !== "stop")
          throw new Error("Markdown generation failed.");
      },
    }));
    return new Response(stream, response);
  } catch (error) {
    return Response.json({ error: describeError(error, body.credentials.apiKey) }, { status: 400 });
  }
}
