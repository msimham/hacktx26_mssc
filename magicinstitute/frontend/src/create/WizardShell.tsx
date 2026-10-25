import type { ReactNode } from "react";
import type { Accent } from "./accents";
import { ACCENTS } from "./accents";

interface Props {
  label: string;
  progress: { value: number; max: number } | null;
  accent?: Accent;
  aside?: ReactNode;
  children: ReactNode;
  footer: ReactNode;
}

export function WizardShell({ label, progress, accent = ACCENTS[0]!, aside, children, footer }: Props) {
  return (
    <div className="relative min-h-screen overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 size-72 rounded-full bg-fuchsia-200/50 blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-24 -left-24 size-72 rounded-full bg-amber-200/50 blur-3xl" />
      <div className={`relative mx-auto flex min-h-screen flex-col px-4 py-6 sm:py-10 ${aside ? "max-w-5xl" : "max-w-2xl"}`}>
        <header className="mb-8">
          <div className="mb-3 flex items-center justify-between text-sm">
            <a href="/" className="font-display font-extrabold tracking-tight">Magic Institute for Societal Safety ✨</a>
            <span className={`rounded-full px-3 py-1 font-medium ${accent.badge}`}>{label}</span>
          </div>
          {progress && (
            <div
              role="progressbar"
              aria-label="Progress"
              aria-valuemin={0}
              aria-valuemax={progress.max}
              aria-valuenow={progress.value}
              className="h-2 overflow-hidden rounded-full bg-white shadow-inner ring-1 ring-slate-200"
            >
              <div
                className={`h-full rounded-full bg-gradient-to-r transition-all duration-500 ${accent.bar}`}
                style={{ width: `${(progress.value / progress.max) * 100}%` }}
              />
            </div>
          )}
        </header>
        <div className={aside ? "grid flex-1 gap-8 lg:grid-cols-[1fr_17rem]" : "flex-1"}>
          <div className="flex flex-col">
            <main className="flex-1">{children}</main>
            <footer className="mt-8 flex items-center justify-between gap-3">{footer}</footer>
          </div>
          {aside && <aside className="order-first lg:order-none">{aside}</aside>}
        </div>
      </div>
    </div>
  );
}

export const buttonPrimary =
  "rounded-2xl bg-gradient-to-r from-violet-600 via-fuchsia-500 to-rose-500 px-5 py-2.5 font-semibold text-white shadow-lg shadow-fuchsia-500/25 transition hover:-translate-y-0.5 hover:shadow-xl disabled:translate-y-0 disabled:cursor-not-allowed disabled:from-slate-300 disabled:via-slate-300 disabled:to-slate-300 disabled:shadow-none focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 focus-visible:ring-offset-2";
export const buttonGhost =
  "rounded-2xl px-4 py-2.5 font-medium text-slate-600 hover:bg-white focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 disabled:invisible";
