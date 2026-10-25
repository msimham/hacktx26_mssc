import { useId } from "react";
import type { Step } from "./steps";

interface Props {
  step: Step;
  value: string;
  onChange: (value: string) => void;
  onChip: (text: string) => void;
}

export function PromptStep({ step, value, onChange, onChip }: Props) {
  const id = useId();
  return (
    <section>
      <label htmlFor={id} className="block text-2xl font-semibold tracking-tight sm:text-3xl">
        {step.question}
      </label>
      <textarea
        id={id}
        autoFocus
        rows={4}
        value={value}
        placeholder={step.placeholder}
        onChange={(e) => onChange(e.target.value)}
        className="mt-5 w-full resize-y rounded-xl border border-slate-300 bg-white p-4 text-base shadow-sm placeholder:text-slate-400 focus:border-indigo-600 focus:outline-none focus:ring-2 focus:ring-indigo-600/30"
      />
      <p className="mt-4 text-sm text-slate-500">Suggestions</p>
      <ul className="mt-2 flex flex-wrap gap-2">
        {step.chips.map((chip) => (
          <li key={chip}>
            <button
              type="button"
              onClick={() => onChip(chip)}
              className="rounded-full border border-slate-300 bg-white px-3.5 py-1.5 text-sm hover:border-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
            >
              + {chip}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
