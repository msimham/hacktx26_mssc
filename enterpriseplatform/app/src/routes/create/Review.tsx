import { accentAt } from "./accents";
import { STEPS, type Answers } from "./steps";

interface Props {
  answers: Answers;
  onEdit: (index: number) => void;
}

export function Review({ answers, onEdit }: Props) {
  return (
    <section className="animate-pop">
      <div aria-hidden className="mb-3 text-5xl">🎉</div>
      <h1 className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">Here&rsquo;s what you&rsquo;re creating</h1>
      <ul className="mt-6 space-y-3">
        {STEPS.map((step, i) => {
          const accent = accentAt(i);
          return (
            <li key={step.id} className={`rounded-2xl border border-l-8 border-slate-200 bg-white p-4 shadow-sm ${accent.card}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className={`text-sm font-semibold ${accent.text}`}>{step.emoji} {step.question}</h2>
                  <p className="mt-1 whitespace-pre-wrap break-words">{answers[step.id]}</p>
                </div>
                <button
                  type="button"
                  onClick={() => onEdit(i)}
                  aria-label={`Edit: ${step.question}`}
                  className="shrink-0 rounded-full px-3 py-1 text-sm font-medium text-violet-700 hover:bg-violet-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600"
                >
                  Edit
                </button>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
