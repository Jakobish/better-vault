import { describe, expect, it } from "vitest";
import { chatSystemPrompt } from "./prompts";

describe("chatSystemPrompt", () => {
  it("includes notebook instructions without replacing source-grounding rules", () => {
    const prompt = chatSystemPrompt("sources", [], {
      chatInstructions: "Write a concise answer with a short conclusion.",
    });

    expect(prompt).toContain("Write a concise answer with a short conclusion.");
    expect(prompt).toContain("Answer using ONLY the numbered passages");
  });

  it("omits empty notebook instructions", () => {
    const prompt = chatSystemPrompt("sources", [], { chatInstructions: "  \n " });

    expect(prompt).not.toContain("<notebook-instructions>");
  });
});
