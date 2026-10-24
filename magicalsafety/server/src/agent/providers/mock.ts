import type { Completion, CompletionRequest, ModelProvider } from "./types";

/** No model, no network. Returns the deterministic rules answer so the same pipeline runs end to end. */
export class MockProvider implements ModelProvider {
  id = "mock" as const;
  label = "rules";
  async complete<T>(req: CompletionRequest<T>): Promise<Completion> {
    return { data: structuredClone(req.deterministic()), model: "rules", usage: null };
  }
}
