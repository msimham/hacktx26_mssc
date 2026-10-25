# Create Training wizard: implementation plan

Frontend-only, first-layer UI for organizations creating a training. No backend, APIs or AI settings. Every answer is free text that an agent interprets later.

## Flow

```
+ Create Training → 1 Train → 2 Audience → 3 Skills → 4 People → 5 Interaction → Review → [Create Training]
```

## Pattern (every step)

A large free-text box with a placeholder. Suggestion chips below it append their text to the box when clicked, and the user can keep editing. Answers are stored as strings.

```
┌─────────────────────────────────────────────┐
│ LOGO                          Step 2 of 5   │
│ ▓▓▓▓▓▓░░░░░░░░░░                            │
│ Who is this training for?                   │
│ ┌─────────────────────────────────────────┐ │
│ │ New managers on our ER night shift…     │ │
│ └─────────────────────────────────────────┘ │
│ Suggestions:                                │
│ (+ New hires) (+ Managers) (+ Healthcare)   │
│ (+ Students) (+ Sales teams)                │
│                                             │
│ [← Back]                     [Continue →]   │
└─────────────────────────────────────────────┘
```

## Steps

| Step | Question | Suggestion chips |
|---|---|---|
| 1 | What do you want to train? | Team collaboration · Fire safety · Drug response · Onboarding |
| 2 | Who is it for? | New hires · Managers · Healthcare staff · Students · Sales teams |
| 3 | Which skills matter most? | Communication · Delegation · Decision making · Help-seeking · Conflict resolution · Adaptability |
| 4 | How many people will take part? | Solo · 2 people · 3–5 people · 6+ people |
| 5 | How should people interact? | Voice · Text · Image |
| Review | Here's what you're creating | 5 editable answer cards, then a **Create Training** button |

## Rules

- Continue is enabled once the text box isn't empty.
- Each step shows "Step N of 5" and a progress bar.
- No AI or technical settings (models, agents, prompts, tools) appear anywhere.
- Submitting only runs `console.log(state)`.

## Files

- `magicalsafety/client/src/routes/CreateTraining.tsx`: wizard state in one `useReducer`, all answers as strings.
- `magicalsafety/client/src/routes/create/PromptStep.tsx`: reusable text box plus chips.
- `magicalsafety/client/src/routes/create/steps.ts`: questions, placeholders and chips.
- `magicalsafety/client/src/routes/create/Review.tsx`, `WizardShell.tsx`.
- `magicalsafety/client/src/App.tsx`: register `/create`.
- `magicalsafety/client/src/routes/Home.tsx`: add a "+ Create Training" button.

The build prompt for Sonnet is in `SONNET_PROMPT.md`.
