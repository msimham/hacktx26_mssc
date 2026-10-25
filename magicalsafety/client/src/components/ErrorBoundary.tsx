import { Component, type ReactNode } from "react";

/** A crash in one screen shows a plain message and a way out, not a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  override componentDidCatch(err: unknown) { console.error("[ui]", err instanceof Error ? err.message : "error"); }
  override render() {
    if (!this.state.failed) return this.props.children;
    return (
      <main role="alert" className="mx-auto max-w-md space-y-3 p-8 text-center">
        <h1 className="font-display text-2xl text-gold">Something went wrong</h1>
        <p className="text-slate-300">This screen hit a problem. Your game is saved on the server, so you can reload and rejoin.</p>
        <button onClick={() => location.reload()} className="rounded bg-gold px-4 py-2 font-semibold text-night">Reload</button>
        <a href="/" className="ml-3 underline">Home</a>
      </main>
    );
  }
}
