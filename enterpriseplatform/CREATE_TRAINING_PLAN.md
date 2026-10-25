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

## Sonnet prompt

> In `magicalsafety/client` (React 19, Tailwind 4, react-router), build a frontend-only "Create Training" wizard at `/create`, linked from a "+ Create Training" button on `Home.tsx`; there is no backend, so submitting just runs `console.log(state)`. It has 5 steps, each using one reusable `PromptStep` component: a large free-text box with a helpful placeholder, plus suggestion chips that append their text to the box when clicked. The steps and their chips are: (1) What do you want to train? [Team collaboration, Fire safety, Drug response, Onboarding]; (2) Who is it for? [New hires, Managers, Healthcare staff, Students, Sales teams]; (3) Which skills matter most? [Communication, Delegation, Decision making, Help-seeking, Conflict resolution, Adaptability]; (4) How many people will take part? [Solo, 2 people, 3–5 people, 6+ people]; (5) How should people interact? [Voice, Text, Image]. Store every answer as a string in one `useReducer` in `src/routes/CreateTraining.tsx`, keep the step definitions in `src/routes/create/steps.ts`, show "Step N of 5", a progress bar and Back/Continue (enabled once the text box isn't empty) on each step, and end on a review screen with an editable card per answer above a "Create Training" button. Never show AI or technical settings, match the existing Tailwind style, and make it work on mobile.
