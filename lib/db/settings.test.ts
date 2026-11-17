import { describe, expect, it } from "vitest";
import { credentialsFor, defaultSettings, imageCredentialsFrom } from "./settings";

describe("OpenAI provider settings", () => {
  it("uses the configured base URL for text and image requests", () => {
    const settings = defaultSettings();
    settings.providers.openai.enabled = true;
    settings.providers.openai.apiKey = "test-key";
    settings.providers.openai.baseURL = "https://proxy.example/v1";

    expect(credentialsFor(settings, "openai")).toEqual({
      apiKey: "test-key",
      baseURL: "https://proxy.example/v1",
    });
    expect(imageCredentialsFrom(settings, "openai")).toEqual({
      apiKey: "test-key",
      baseURL: "https://proxy.example/v1",
    });
  });
});
