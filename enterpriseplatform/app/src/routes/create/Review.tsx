import { STEPS, type Answers } from "./steps";

interface Props {
  answers: Answers;
  onEdit: (index: number) => void;
}

export function Review({ answers, onEdit }: Props) {
  return (
    <section>
      <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Here&rsquo;s what you&rsquo;re creating</h1>
      <ul className="mt-6 space-y-3">
        {STEPS.map((step, i) => (
          <li key={step.id} className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="text-sm font-medium text-slate-500">{step.question}</h2>
                <p className="mt-1 whitespace-pre-wrap break-words">{answers[step.id]}</p>
              </div>
              <button
                type="button"
                onClick={() => onEdit(i)}
                aria-label={`Edit: ${step.question}`}
                className="shrink-0 text-sm font-medium text-indigo-700 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-600"
              >
                Edit
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
