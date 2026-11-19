import { describe, expect, it } from "vitest";
import { bestLocalModel, paramsB } from "@/lib/model-pick";

describe("model pick", () => {
  it("reads parameter counts from Ollama tags", () => {
    expect(paramsB("llama3.1:8b")).toBe(8);
    expect(paramsB("qwen2.5-coder:1.5b")).toBe(1.5);
    expect(paramsB("phi4-mini")).toBeNull();
  });

  it("gives background jobs the strongest model a laptop runs comfortably", () => {
    expect(bestLocalModel(["llama3.2:3b", "qwen3:4b", "llama3.1:8b"], "plan")).toBe("llama3.1:8b");
    expect(bestLocalModel(["llama3.2:3b", "llama3.3:70b"], "copy")).toBe("llama3.2:3b");
  });

  it("prefers a coder model for code and a general one for words", () => {
    const pulled = ["llama3.1:8b", "qwen2.5-coder:7b", "nomic-embed-text:latest"];
    expect(bestLocalModel(pulled, "build")).toBe("qwen2.5-coder:7b");
    expect(bestLocalModel(pulled, "copy")).toBe("llama3.1:8b");
  });
});
