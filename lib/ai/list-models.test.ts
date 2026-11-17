import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels } from "./list-models";

describe("listModels", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("uses the configured OpenAI API base URL", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [{ id: "gpt-custom" }] }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      listModels("openai", {
        apiKey: "test-key",
        baseURL: "https://8.8.8.8/v1/",
      }),
    ).resolves.toEqual({ models: ["gpt-custom"], contextTokens: {} });

    expect(fetch).toHaveBeenCalledWith(
      "https://8.8.8.8/v1/models",
      expect.objectContaining({ headers: { authorization: "Bearer test-key" } }),
    );
  });

  it("blocks private OpenAI endpoints on a server", async () => {
    vi.stubEnv("BETTER_VAULT_ALLOW_PRIVATE_URLS", "false");
    const fetch = vi.fn();
    vi.stubGlobal("fetch", fetch);

    await expect(
      listModels("openai", {
        apiKey: "test-key",
        baseURL: "http://127.0.0.1:3000/v1",
      }),
    ).rejects.toThrow("private network");
    expect(fetch).not.toHaveBeenCalled();
  });
});
