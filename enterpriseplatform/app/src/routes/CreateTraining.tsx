import { useReducer, useState } from "react";
import { Link, useLocation } from "react-router-dom";
import { accentAt } from "./create/accents";
import { BuildRing } from "./create/BuildRing";
import { categoryIndex, categoryProgress } from "./create/categories";
import { Confetti } from "./create/Confetti";
import { PromptStep } from "./create/PromptStep";
import { Review } from "./create/Review";
import { buttonGhost, buttonPrimary, WizardShell } from "./create/WizardShell";
import { submitTraining } from "./create/api";
import { initialState, isFilled, reducer } from "./create/state";
import { STEPS, type Answers } from "./create/steps";

export function CreateTraining() {
  const seed = useLocation().state as Partial<Answers> | null;
  const [state, dispatch] = useReducer(reducer, seed ?? {}, initialState);
  const [created, setCreated] = useState(false);
  const { answers, index } = state;
  const step = STEPS[index];
  const accent = accentAt(step ? categoryIndex(step.category) : 0);
  const progress = categoryProgress(answers);
  const allAnswered = progress.every((p) => p.done === 1);
  const goto = (i: number) => dispatch({ type: "goto", index: i });
  const ring = (current?: number) => <BuildRing progress={progress} current={current} onSelect={goto} />;

  if (created) {
    return (
      <WizardShell label="Done" progress={null} footer={null}>
        <Confetti />
        <div aria-hidden className="mb-3 text-6xl">🚀</div>
        <h1 role="status" className="font-display text-3xl font-extrabold tracking-tight sm:text-4xl">
          Your training simulation agent is being created
        </h1>
        <p className="mt-3 text-slate-600">Nice work. That took about a minute.</p>
        <Link to="/" className={`${buttonPrimary} mt-8 inline-block`}>Back home</Link>
      </WizardShell>
    );
  }

  const back = (
    <button type="button" className={buttonGhost} disabled={index === 0} onClick={() => dispatch({ type: "back" })}>
      Back
    </button>
  );

  if (!step) {
    return (
      <WizardShell
        label="Review"
        aside={ring()}
        progress={{ value: STEPS.length, max: STEPS.length }}
        footer={
          <>
            {back}
            <button
              type="button"
              className={buttonPrimary}
              disabled={!allAnswered}
              onClick={async () => {
                await submitTraining(answers);
                setCreated(true);
              }}
            >
              Create Training Simulation Agent
            </button>
          </>
        }
      >
        <Review answers={answers} onEdit={goto} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      label={`Step ${index + 1} of ${STEPS.length}`}
      accent={accent}
      aside={ring(categoryIndex(step.category))}
      progress={{ value: index + 1, max: STEPS.length }}
      footer={
        <>
          {back}
          <button
            type="button"
            className={buttonPrimary}
            disabled={!isFilled(answers[step.id])}
            onClick={() => dispatch({ type: "next" })}
          >
            Continue
          </button>
        </>
      }
    >
      <PromptStep
        key={step.id}
        step={step}
        accent={accent}
        value={answers[step.id]}
        onChange={(value) => dispatch({ type: "answer", id: step.id, value })}
        onChip={(text) => dispatch({ type: "append", id: step.id, text })}
      />
    </WizardShell>
  );
}
