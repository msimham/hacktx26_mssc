import { useId } from "react";
import type { Accent } from "./accents";
import type { Step } from "./steps";

interface Props {
  step: Step;
  accent: Accent;
  value: string;
  onChange: (value: string) => void;
  onChip: (text: string) => void;
}

export function PromptStep({ step, accent, value, onChange, onChip }: Props) {
  const id = useId();
  return (
    <section className="animate-pop">
      <div aria-hidden className="mb-3 text-5xl">{step.emoji}</div>
      <label htmlFor={id} className="block font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
        {step.question}
      </label>
      <textarea
        id={id}
        autoFocus
        rows={4}
        value={value}
        placeholder={step.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className={`mt-5 w-full resize-y rounded-2xl border-2 border-slate-200 bg-white p-4 text-base shadow-sm placeholder:text-slate-400 focus:outline-none focus:ring-4 ${accent.field}`}
      />
      <p className={`mt-4 text-sm font-semibold ${accent.text}`}>Need a spark? Tap to add</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {step.chips.map((chip) => (
          <li key={chip}>
            <button
              type="button"
              onClick={() => onChip(chip)}
              className={`rounded-full border px-3.5 py-1.5 text-sm font-medium transition hover:-translate-y-0.5 active:scale-95 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 ${accent.chip}`}
            >
              + {chip}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
