# Create Training wizard: implementation plan

Frontend-only, first-layer UI for organizations creating a training. No backend, APIs or AI settings. Every answer is free text that an agent interprets later.

## Flow

```
+ Create Training → Goal → World → People → Experience → Knowledge → Capabilities → Guardrails → Success → Review → [Create Training]
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

Questions are grouped into 8 categories. A segmented build-progress ring (one segment per category) sits beside the question and fills as answers come in, so the organization sees every consideration being covered. Clicking a segment or its label jumps to that category. The ring reads "Every answer shapes your agent", then "Your agent is taking shape", then "Your agent is production-ready ✨". A footnote says security, monitoring and infrastructure are handled by the platform.

| # | Category | Question | Suggestion chips |
|---|---|---|---|
| 1 | Goal | What situation do you want to train for? | Team collaboration · Fire safety · Drug response · Onboarding |
| 2 | Goal | Which skills matter most? | Communication · Delegation · Decision making · Help-seeking · Conflict resolution · Adaptability |
| 3 | World | What world do you want your training to be in? | Fairytale · Real world · Marvel Universe · Harry Potter |
| 4 | People | Who is it for? | New hires · Managers · Healthcare staff · Students · Sales teams |
| 5 | People | How many people will take part? | Solo · 2 people · 3–5 people · 6+ people |
| 6 | Experience | How should people interact? | Voice · Text · Motion |
| 7 | Knowledge | What should your agent know? | Our policies · Training objectives · Industry guidelines · Past sessions |
| 8 | Capabilities | What should the AI be able to use or do? | Search the web · Use your knowledge base · Read the simulation · Create scenarios · Evaluate participants · Adapt difficulty |
| 9 | Guardrails | What should your agent never do? | Share private scores · Go off topic · Give medical or legal advice · Ignore real emergencies |
| 10 | Guardrails | What should the AI need permission to do? | Change the scenario · Share results · Message participants · Use outside sources |
| 11 | Success | How will you know it worked? | Clearer communication · Faster decisions · Everyone speaks up · Better each round |
| Review | | Here's what you're creating | One editable card per answer, labeled by category; Create stays disabled until every question is answered |

Cost, model and latency choices are platform-managed and never asked.

## Rules

- Continue is enabled once the text box isn't empty.
- Each step shows "Step N of 11" and a progress bar.
- No AI or technical settings (models, agents, prompts, tools) appear anywhere.
- Submitting only runs `console.log(state)`.

## Files

A standalone Vite + React + TypeScript + Tailwind 4 app in `enterpriseplatform/app/`. Nothing under `magicalsafety/` is read, imported or changed.

- `enterpriseplatform/app/src/App.tsx`: routes for `/` and `/create`.
- `enterpriseplatform/app/src/routes/Home.tsx`: landing page with a "+ Create Training" button.
- `enterpriseplatform/app/src/routes/CreateTraining.tsx`: wizard state in one `useReducer`, all answers as strings.
- `enterpriseplatform/app/src/routes/create/PromptStep.tsx`: reusable text box plus chips.
- `enterpriseplatform/app/src/routes/create/steps.ts`: questions, placeholders and chips.
- `enterpriseplatform/app/src/routes/create/categories.ts`: the 8 categories and per-category progress.
- `enterpriseplatform/app/src/routes/create/BuildRing.tsx`: the segmented progress ring.
- `enterpriseplatform/app/src/routes/create/Review.tsx`, `WizardShell.tsx`.

The build prompt for Sonnet is in `SONNET_PROMPT.md`.
