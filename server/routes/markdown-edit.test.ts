import { convertArrayToReadableStream, MockLanguageModelV4 } from "ai/test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createLanguageModel } from "@/lib/ai/providers";
import { POST } from "./markdown-edit";

vi.mock("@/lib/ai/providers", () => ({ createLanguageModel: vi.fn() }));

const body = {
    model: { provider: "openai", modelId: "test-model" },
    credentials: { apiKey: "private-key-under-test" },
    operation: "custom",
    instruction: "Keep [[Link]]",
    document: { kind: "note", title: "Notes title" },
    markdown: "Before\nTarget\nAfter",
    target: { from: 7, to: 13 },
    original: "Target",
};

function request(change = {}, signal?: AbortSignal) {
    return new Request("http://localhost/api/markdown/edit", {
        method: "POST",
        body: JSON.stringify({ ...body, ...change }),
        signal,
    });
}

function mockStream(fail = false) {
    const model = new MockLanguageModelV4({
        doStream: {
            stream: convertArrayToReadableStream([
                { type: "stream-start", warnings: [] },
                { type: "text-start", id: "text" },
                { type: "text-delta", id: "text", delta: "Updated " },
                ...(fail
                    ? [{ type: "error" as const, error: new Error(body.credentials.apiKey) }]
                    : []),
                { type: "text-delta", id: "text", delta: "Markdown" },
                { type: "text-end", id: "text" },
                {
                    type: "finish",
                    finishReason: { unified: "stop", raw: "stop" },
                    usage: {
                        inputTokens: { total: 3, noCache: 3, cacheRead: 0, cacheWrite: 0 },
                        outputTokens: { total: 2, text: 2, reasoning: 0 },
                    },
                },
            ]),
        },
    });
    vi.mocked(createLanguageModel).mockResolvedValue(model);
    return model;
}

beforeEach(() => vi.resetAllMocks());

describe("Markdown edit route", () => {
    it.each([
        { original: "Wrong" },
        { target: { from: 13, to: 7 } },
        { partial: true, target: { from: 0, to: 1 } },
        { operation: "custom", instruction: " " },
        { operation: "refine" },
        { operation: "continue" },
    ])("rejects invalid requests before provider setup (%j)", async (change) => {
        expect((await POST(request(change))).status).toBe(400);
        expect(createLanguageModel).not.toHaveBeenCalled();
    });

    it("returns plain text and passes target, instructions and cancellation to the model without tools", async () => {
        const model = mockStream();
        const response = await POST(request({ operation: "refine", previous: "Previous draft" }));
        expect(response.headers.get("content-type")).toMatch(/^text\/plain/);
        expect(await response.text()).toBe("Updated Markdown");
        const [call] = model.doStreamCalls;
        expect(call.prompt).toEqual(
            expect.arrayContaining([
                expect.objectContaining({
                    role: "system",
                    content: expect.stringContaining("complete replacement"),
                }),
                expect.objectContaining({
                    role: "user",
                    content: [
                        expect.objectContaining({
                            text: expect.stringMatching(
                                /Keep \[\[Link\]\][\s\S]*Previous draft[\s\S]*<BETTER_VAULT_TARGET>Target<\/BETTER_VAULT_TARGET>/,
                            ),
                        }),
                    ],
                }),
            ]),
        );
        expect(call.tools).toBeUndefined();
        expect(call.abortSignal).toBeInstanceOf(AbortSignal);
    });

    it("redacts provider setup errors", async () => {
        vi.mocked(createLanguageModel).mockRejectedValue(
            new Error(`Invalid ${body.credentials.apiKey}`),
        );
        const response = await POST(request());
        expect(response.status).toBe(400);
        expect(await response.json()).toEqual({ error: "Invalid [key]" });
    });

    it("fails the stream opaquely after a provider error", async () => {
        mockStream(true);
        const response = await POST(request());
        await expect(response.text()).rejects.toThrow("Markdown generation failed.");
    });

    it("forwards client abortion to the provider", async () => {
        const abort = new AbortController();
        const model = new MockLanguageModelV4({
            doStream: async ({ abortSignal }) => ({
                stream: new ReadableStream({
                    start(controller) {
                        abortSignal?.addEventListener("abort", () => controller.close(), {
                            once: true,
                        });
                        controller.enqueue({ type: "stream-start", warnings: [] });
                        controller.enqueue({ type: "text-start", id: "text" });
                        controller.enqueue({ type: "text-delta", id: "text", delta: "Started" });
                    },
                }),
            }),
        });
        vi.mocked(createLanguageModel).mockResolvedValue(model);
        const response = await POST(request({}, abort.signal));
        const reader = response.body!.getReader();
        expect(new TextDecoder().decode((await reader.read()).value)).toBe("Started");
        abort.abort();
        await expect(reader.read()).rejects.toThrow();
        expect(model.doStreamCalls[0].abortSignal?.aborted).toBe(true);
    });
});
