import { useReducer, useState } from "react";
import { PromptStep } from "./create/PromptStep";
import { Review } from "./create/Review";
import { buttonGhost, buttonPrimary, WizardShell } from "./create/WizardShell";
import { submitTraining } from "./create/api";
import { initialState, isFilled, reducer } from "./create/state";
import { STEPS } from "./create/steps";

export function CreateTraining() {
  const [state, dispatch] = useReducer(reducer, undefined, initialState);
  const [created, setCreated] = useState(false);
  const { answers, index } = state;
  const step = STEPS[index];

  if (created) {
    return (
      <WizardShell label="Done" progress={null} footer={null}>
        <h1 role="status" className="text-2xl font-semibold tracking-tight sm:text-3xl">
          Your training is being created
        </h1>
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
        progress={{ value: STEPS.length, max: STEPS.length }}
        footer={
          <>
            {back}
            <button
              type="button"
              className={buttonPrimary}
              onClick={async () => {
                await submitTraining(answers);
                setCreated(true);
              }}
            >
              Create Training
            </button>
          </>
        }
      >
        <Review answers={answers} onEdit={(i) => dispatch({ type: "goto", index: i })} />
      </WizardShell>
    );
  }

  return (
    <WizardShell
      label={`Step ${index + 1} of ${STEPS.length}`}
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
        value={answers[step.id]}
        onChange={(value) => dispatch({ type: "answer", id: step.id, value })}
        onChip={(text) => dispatch({ type: "append", id: step.id, text })}
      />
    </WizardShell>
  );
}
