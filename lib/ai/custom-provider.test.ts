import { generateText, Output } from "ai";
import { afterEach, expect, it, vi } from "vitest";
import { z } from "zod";
import { POST as listModels } from "@/server/routes/models";
import { createLanguageModel } from "./providers";
import { fetchCustomProviderEndpoint, setDesktopRuntime } from "./server-config";

const provider = "custom-test123456789012";
const baseURL = "https://8.8.8.8/proxy/v1";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  setDesktopRuntime(false);
});

function modelsRequest(apiKey?: string) {
  return new Request("https://example.com/api/models", {
    method: "POST",
    body: JSON.stringify({ provider, credentials: { baseURL: `${baseURL}/`, apiKey } }),
  });
}

it("loads compatible model IDs without requiring a key or changing the API path", async () => {
  const fetch = vi.fn(async () =>
    Response.json({ data: [{ id: "vendor/model:latest" }, { id: "vendor/model:latest" }] }),
  );
  vi.stubGlobal("fetch", fetch);

  const response = await listModels(modelsRequest());
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ models: ["vendor/model:latest"], contextTokens: {} });
  expect(fetch).toHaveBeenCalledWith(`${baseURL}/models`, expect.objectContaining({ headers: {} }));
});

it("redacts a custom secret from errors returned by a model list endpoint", async () => {
  const key = "test-token";
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({ error: `Bad key ${key}` }, { status: 401 })),
  );
  const response = await listModels(modelsRequest(key));
  expect(response.status).toBe(502);
  expect(await response.json()).toEqual({ error: "401 Bad key [key]" });
});

it("uses Chat Completions and includes schema instructions for JSON-mode Studio tools", async () => {
  const fetch = vi.fn(async (input: URL, init: RequestInit) => {
    expect(String(input)).toBe(`${baseURL}/chat/completions`);
    expect(new Headers(init.headers).get("authorization")).toBe("Bearer test-token");
    expect(JSON.parse(String(init.body))).toMatchObject({
      model: "vendor/model:latest",
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: expect.stringContaining('"properties":{"answer"') },
        { role: "user", content: "Answer the question" },
      ],
    });
    return Response.json({
      choices: [
        {
          index: 0,
          message: { role: "assistant", content: '{"answer":"hello"}' },
          finish_reason: "stop",
        },
      ],
    });
  });
  vi.stubGlobal("fetch", fetch);

  const model = await createLanguageModel(
    { provider, modelId: "vendor/model:latest" },
    { baseURL, apiKey: "test-token" },
  );
  const result = await generateText({
    model,
    system: "You answer questions.",
    prompt: "Answer the question",
    output: Output.object({ schema: z.object({ answer: z.string() }) }),
  });
  expect(result.output).toEqual({ answer: "hello" });
});

it("uses private compatible endpoints on desktop and on opted-in web servers", async () => {
  vi.stubEnv("BETTER_VAULT_ALLOW_PRIVATE_URLS", "false");
  const fetch = vi.fn(async () => Response.json({}));
  vi.stubGlobal("fetch", fetch);
  const endpoint = "http://127.0.0.1:3000/api/v1/models";

  await expect(fetchCustomProviderEndpoint(endpoint)).rejects.toThrow("private network");
  expect(fetch).not.toHaveBeenCalled();
  setDesktopRuntime(true);
  await expect(fetchCustomProviderEndpoint(endpoint)).resolves.toBeInstanceOf(Response);
  setDesktopRuntime(false);
  vi.stubEnv("BETTER_VAULT_ALLOW_PRIVATE_URLS", "true");
  await expect(fetchCustomProviderEndpoint(endpoint)).resolves.toBeInstanceOf(Response);
});
