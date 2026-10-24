import type { Completion, CompletionRequest, ModelProvider } from "./agent/providers/types";

export type Script = (req: CompletionRequest<unknown>, n: number) => Completion | Error;

/** A scripted stand-in for a real model, for tests. */
export class Scripted implements ModelProvider {
  id = "meta" as const;
  label = "muse-spark-1.3";
  calls: CompletionRequest<unknown>[] = [];
  constructor(private script: Script) {}
  async complete<T>(req: CompletionRequest<T>): Promise<Completion> {
    this.calls.push(req as CompletionRequest<unknown>);
    const r = this.script(req as CompletionRequest<unknown>, this.calls.length);
    if (r instanceof Error) throw r;
    return r;
  }
  of(step: string) { return this.calls.filter((c) => c.step === step); }
}
