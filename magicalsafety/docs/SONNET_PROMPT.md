You are implementing **Magic Safety School**, an adaptive, multiplayer AI social-training app for a hackathon. The full spec is in `magicalsafety/docs/IMPLEMENTATION_PLAN.md`. Read all of it before writing any code. It is the source of truth, and it already records the decisions, the tradeoffs, and the external API facts that were verified against the official docs.

## Where to work
- Repo root: `hacktx26_mssc/`. **All app code goes inside `magicalsafety/`**, which is a self-contained npm workspaces root. Run every `npm` command from there.
- The only change allowed outside `magicalsafety/` is a short pointer section in `hacktx26_mssc/README.md`.

## How to work
1. Implement the phases in order (Phase 0 → Phase 8). Before you finish a phase:
   - Its ✅ acceptance checks pass.
   - `npm test` is green.
   - `npm run dev` still starts with **no `.env` file**, because demo mode must always work.
2. After each phase, commit with a message like `Phase N: <summary>`, and give a short status report:
   - What works.
   - What is mocked.
   - What the user must supply.
   - Any deviation from the plan. Record the deviation and its reason in `magicalsafety/docs/DECISIONS.md`.
3. Don't skip ahead. If you're running out of time or context, use the cut order in Section 1 of the plan. Never cut the core loop:
   - Playable Act 1
   - Campus world skin
   - Event log
   - Evaluation
   - Adapted replay
   - Evidence-based results
   - Mock fallbacks
4. Prefer the simplest implementation that meets the plan. Don't add dependencies beyond the list in Section 2 without recording why in DECISIONS.md. Don't build enterprise or platform infrastructure; the plan lists what's out of scope.

## Non-negotiable rules
- **Game logic is deterministic** and lives in `packages/engine`:
  - It's a pure reducer with an injected clock and a seeded RNG.
  - It never calls a model.
  - `legalActions()` is the single source of truth for the UI, hotkeys, voice parsing, and server validation.
- **Safety content is authored, never model-generated.**
  - The model must not produce medical or evacuation instructions.
  - Run every LLM text output through the safety filter.
- **Every model output is validated**: zod parse, then evidence event IDs must exist, then source IDs must exist. Retry once, then fall back to the deterministic rules. Use a 20 s timeout.
- **Adaptation stays within the bounded `AdaptationPlan` levers.**
  - Recommendations about social scope or team size are never auto-applied.
  - Act 2 starts only after Act 1 succeeds.
- **External tools only run through `executeTool`**: registry → argument validation → policy check (allowlist, limits, org/session boundary) → execute → validate → audit.
- **Secrets stay on the server.**
  - Never log keys or tokens, and never return them to the client.
  - Never commit `.env`.
- **Be honest about integrations.**
  - Anything mocked shows `MockBadge`, and simulated teammates always show 🤖.
  - Only mark an integration "Live" in `docs/INTEGRATIONS.md` after a real request succeeded. Record the date and model ID.
  - Never fabricate credentials.
- **Mark user setup in the code.**
  - Put a `TODO(USER): …` comment at every location listed in Section 11 of the plan.
  - Use `TODO(VERIFY): …` wherever an API detail isn't covered by Section 0. If you can, check the cited doc URL first.
- **Use only the API details in Section 0.**
  - Meta Model API: OpenAI SDK with `baseURL=https://api.meta.ai/v1`, `muse-spark-1.3` with `json_schema` structured output, `muse-image-1.0` via `/v1/images/generations`, `muse-voice-transcribe-1.0` via multipart `/v1/asr/transcribe` with WAV mono 16-bit at 16 kHz.
  - Facebook: Login with `public_profile` plus the Share Dialog only. `user_friends` is dev-mode only.
  - SerpApi: Google engine.
  - Don't invent other fields.

## Code style
- TypeScript strict mode.
- Small modules that match the layout in Section 2.
- Name things in the domain's language: act, slot, role, legal action, assessment, adaptation plan.
- Comment only what isn't obvious, plus the `TODO(USER)` and `TODO(VERIFY)` markers.

## Definition of done
- `DEMO_SCRIPT.md` (Section 10) runs end-to-end twice: once with no keys (everything labeled mock or rules), once with keys.
- `SETUP.md`, `INTEGRATIONS.md`, and `README.md` accurately describe what works, what's mocked, and every step the user must complete.

Start now with Phase 0.
