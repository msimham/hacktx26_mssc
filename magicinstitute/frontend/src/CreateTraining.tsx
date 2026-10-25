import { useReducer, useState } from "react";
import { useLocation } from "react-router-dom";
import { accentAt } from "./create/accents";
import { BuildProgress } from "./create/BuildProgress";
import { BuildRing } from "./create/BuildRing";
import { categoryIndex, categoryProgress } from "./create/categories";
import { Confetti } from "./create/Confetti";
import { PromptStep } from "./create/PromptStep";
import { Review } from "./create/Review";
import { buttonGhost, buttonPrimary, WizardShell } from "./create/WizardShell";
import { createProgram, type Program } from "./create/api";
import { initialState, isFilled, reducer } from "./create/state";
import { STEPS, type Answers } from "./create/steps";

export function CreateTraining() {
  const seed = useLocation().state as Partial<Answers> | null;
  const [state, dispatch] = useReducer(reducer, seed ?? {}, initialState);
  const [program, setProgram] = useState<Program | null>(null);
  const [submitError, setSubmitError] = useState("");
  const { answers, index } = state;
  const step = STEPS[index];
  const accent = accentAt(step ? categoryIndex(step.category) : 0);
  const progress = categoryProgress(answers);
  const allAnswered = progress.every((p) => p.done === 1);
  const goto = (i: number) => dispatch({ type: "goto", index: i });
  const ring = (current?: number) => <BuildRing progress={progress} current={current} onSelect={goto} />;

  if (program) {
    return (
      <WizardShell label="Building" progress={null} footer={null}>
        {program.status === "ready" && <Confetti />}
        <BuildProgress initial={program} onRetry={() => setProgram(null)} />
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
                setSubmitError("");
                try {
                  setProgram(await createProgram(answers));
                } catch (e) {
                  setSubmitError(e instanceof Error ? e.message : "Could not reach the platform.");
                }
              }}
            >
              Create Training Simulation Agent
            </button>
          </>
        }
      >
        <Review answers={answers} onEdit={goto} />
        {submitError && <p role="alert" className="mt-4 text-sm text-rose-700">{submitError}</p>}
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
