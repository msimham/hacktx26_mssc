import type { ReactNode } from "react";
import { Link } from "react-router-dom";

interface Props {
  label: string;
  progress: { value: number; max: number } | null;
  children: ReactNode;
  footer: ReactNode;
}

export function WizardShell({ label, progress, children, footer }: Props) {
  return (
    <div className="mx-auto flex min-h-screen max-w-2xl flex-col px-4 py-6 sm:py-10">
      <header className="mb-8">
        <div className="mb-3 flex items-center justify-between text-sm">
          <Link to="/" className="font-semibold tracking-tight">Training Studio</Link>
          <span className="text-slate-500">{label}</span>
        </div>
        {progress && (
          <div
            role="progressbar"
            aria-label="Progress"
            aria-valuemin={0}
            aria-valuemax={progress.max}
            aria-valuenow={progress.value}
            className="h-1.5 overflow-hidden rounded-full bg-slate-200"
          >
            <div
              className="h-full bg-indigo-600 transition-all"
              style={{ width: `${(progress.value / progress.max) * 100}%` }}
            />
          </div>
        )}
      </header>
      <main className="flex-1">{children}</main>
      <footer className="mt-8 flex items-center justify-between gap-3">{footer}</footer>
    </div>
  );
}

export const buttonPrimary =
  "rounded-lg bg-indigo-600 px-5 py-2.5 font-medium text-white shadow-sm hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600 focus-visible:ring-offset-2";
export const buttonGhost =
  "rounded-lg px-4 py-2.5 font-medium text-slate-600 hover:bg-slate-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600";
