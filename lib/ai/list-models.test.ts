import { afterEach, describe, expect, it, vi } from "vitest";
import { listModels } from "./list-models";

describe("listModels", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses the configured OpenAI API base URL", async () => {
    const fetch = vi.fn(async () => Response.json({ data: [{ id: "gpt-custom" }] }));
    vi.stubGlobal("fetch", fetch);

    await expect(
      listModels("openai", {
        apiKey: "test-key",
        baseURL: "https://proxy.example/v1/",
      }),
    ).resolves.toEqual({ models: ["gpt-custom"], contextTokens: {} });

    expect(fetch).toHaveBeenCalledWith(
      "https://proxy.example/v1/models",
      expect.objectContaining({ headers: { authorization: "Bearer test-key" } }),
    );
  });
});
