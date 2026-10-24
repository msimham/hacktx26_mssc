# Decisions and deviations from IMPLEMENTATION_PLAN.md

Each entry: what changed, and why.

## Phase 0

- **zod 4 instead of zod 3 + `zod-to-json-schema`.** `npm audit` flags zod < 4.6.6 (memory exhaustion, GHSA-mrhx-c7xc-m3w5). Zod 4 ships `z.toJSONSchema`, so `zod-to-json-schema` is dropped. Same "one schema source" goal, one fewer dependency.
- **Tailwind v4 via `@tailwindcss/vite`.** Plan lists `tailwindcss` only; v4 needs no PostCSS config and the Vite plugin is the supported path.
- **Extra tooling deps (not runtime):** `typescript`, `@types/*` (type-checking is required by "strict mode"), `supertest` + `@types/supertest` (HTTP assertions in server tests; required to test `/api/integrations` without leaking secrets).
- **Vite 8 / Vitest 5 / Express 5 / React 19** are the current majors on npm at build time (2026-10-24); nothing in the plan pins older ones.
- **Engine is consumed as TypeScript source** (`main: src/index.ts`): `tsx` (server), Vite (client) and Vitest all compile it, so there is no engine build step.
- **Integration state in Phase 0 is `mock` | `configured`, never `live`.** "Live" requires a real successful request (plan Section 12); that check lands in Phase 6.

## Phase 1 (engine)

- **Capabilities are gated by location, knowledge and items, not by role.** The plan lists role-exclusive capabilities, but that would make "one player does everything" impossible, and the plan requires that path to be measurable. Instead: every op has a location, required facts and a duration. Roles supply the starting knowledge (Authority knows where help is, Runner holds the cabinet key, Discoverer sees the collapse) and an `affinity` used for bot duties and UI hints. A lone player *can* do everything, but only by collecting facts from teammates and spending the time, which is what delegation is supposed to save.
- **Event-driven simulation, no fixed tick.** `tick`/`applyAction` jump between exact times (step completion, thresholds, ETA, delegation acceptance), so the event log is identical no matter how often the server ticks. `replay(init, inputs)` rebuilds a session exactly.
- **Information transfer is mechanical.** Typing or saying a fact keyword while knowing that fact tells the listeners (`fact_shared` event), and a `share_fact` action does the same from a button. Added `fact_shared` to the event types; no other event types were added.
- **`cabinet_key` is a fact, not an item.** Handing over items was not in the action list; "telling" the key holder's secret models lending it and keeps the action set at the plan's list plus `share_fact`.
- **Autonomous actors (NPC helpers and bot players) skip the location requirement** and instead pay travel time (3 s per room) before the step. Delegated tasks are queued steps; NPC helpers carry a master key (skip the `f_cabinet_key` requirement for `open_cabinet`).
- **Delegating hands over the facts the task needs** (from the delegator, if they have them). Delegation is refused if neither party can do the task.
- **Bots delegate nothing and act only when addressed, told something new, idle 25 s, or already mid-duty.** So delegation metrics (human-only) cannot be inflated by bots.
- **Additional difficulty behaviors defined here:** `ambiguity: subtle` means the collapse is only noticed by `check_responsiveness` or inspecting the Duchess; `simultaneousIncidents: 2` fires a loud crash 8 s after the main incident that all players learn about, and responders cannot arrive until the crowd is resolved; `infoDistribution: concentrated` tells everyone where help is.
- **Extra deps: none.** `Driver`/`scenarios` test helpers are exported from `@magicalsafety/engine/testing` so the server tests can reuse them.

## Storage design (implemented in Phase 2, recorded now)

Sessions are persisted as **(config, seed, ordered input log)**, not as derived state. Because the reducer is pure and deterministic, state is rebuilt by `replay()`.
- **Accurate:** replay is the source of truth; a stored session can be re-verified at any time.
- **Efficient:** the log is tiny (inputs only); a snapshot is never needed at this scale.
- **Secure:** every record is zod-validated on load; writes are atomic (temp file + rename); the log carries a SHA-256 hash chain so tampering or truncation is detected; no secrets, tokens or audio are ever written; a retention sweep deletes old sessions.

## Phase 2 (multiplayer, world UI, storage)

- **`JsonFileStore` has a memory-only mode** (omit `dir`) instead of a separate `MemoryStore`. Same code path, so tests exercise the real logic. The `Store` interface is still the seam for replacing it.
- **Only inputs that matter are logged.** Every action (including rejected ones, so replayed metrics match) and every tick *that produced events* is appended. Ticks with no events are redundant because the engine is event-driven. Bot actions are logged as actions, so replay never re-runs the bot policy.
- **Chat text is part of the stored record.** Replay and evidence need it (typing a fact keyword transfers knowledge). Audio is never stored. The org-level `storeTranscripts` flag (Phase 4) will govern voice transcripts only. The retention sweep deletes whole sessions.
- **Tail truncation of a *running* session is not detectable** (a valid prefix of a hash chain is a valid chain). The log head is recorded in the session metadata when the session ends, after which any truncation or edit is detected.
- **A server restart counts as elapsed game time**; resumed sessions fast-forward to "now". Fine for a demo; no pause/resume.
- **Role choice (`roleAssignment: "chosen"`) shipped in Phase 2** instead of Phase 4, so multiplayer tests can be deterministic.
- **Session creation uses a placeholder org id (`org_riverside`)** until the org layer lands in Phase 4. Creation requires the organizer passcode; joining needs only the join code; results need a player token (stored only as a SHA-256 hash server-side) or the passcode, and return the same 404 for "missing" and "forbidden".
- **Bug fixed during this phase:** simulated teammates' chat lines had an empty audience and were never shown. Now delivered to the whole team and marked 🤖.
- **Not verified in a real browser by the implementer.** The client typechecks and builds, and the live `npm run dev` stack (Vite proxy + websocket + disk store) was smoke-tested with a scripted socket client, but nobody has clicked through the UI yet. See docs/TESTING_AND_DEMO.md for the manual check.

## Phase 3 (training agent, adaptive replay)

- **Weaknesses may be empty (0..3, plan said 1..3).** A strong run has none, and the plan itself defines "challenge mode" for that case.
- **Strict-schema-friendly shapes.** Meta's `strict: true` requires every key in `required` and `additionalProperties: false` (docs: dev.meta.ai/docs/structured-output). So `Claim.sourceIds` is always present (maybe empty) instead of optional, and `PlanChanges` uses `null` for "unchanged" instead of omitted keys. Min/max keywords are undocumented under strict mode, so they are stripped from the schema we send and enforced by zod after parsing (a constraint can never cause an HTTP 400).
- **The model only writes the interpretation.** Facts, outcomes, hashes and ids are computed. `AssessmentInterpretation` is the whole model-facing surface.
- **One predicate per weakness, shared by detection and the consistency check.** A model can only name a weakness the recorded facts support (stricter than "not contradicted").
- **Lever additions.** The plan's lever table is implemented as written, plus `distractorFirst` (the plan describes "distractor timed before the main incident" without a name), and the role levers live in `SessionConfig.adaptation` (`rotateRoles`, `discovererRole`, `distractorFirst`). `rotateRoles` forces random role assignment for the next run; `discovererRole` swaps starting rooms with the Discoverer.
- **"Siloed" information is defined as:** the facts a task needs only ride along with a request when asker and assignee are in the same room (so you must meet in person or tell people first). Without this, siloed would have made helpers unusable.
- **MockProvider returns the rules answer through the same validation pipeline**, labeled `rules`. The "Generated by rules (no AI)" path therefore exercises the real code.
- **Retry policy:** one retry after a validation failure (with the errors appended) or a retryable transport error (429/500/503, parse failure, our own 20 s timeout). Auth errors, other 4xx and unreachable hosts fall back immediately. Meta's docs advise against blind retries on a server-side 504; ours is a client-side abort, so we retry once as the plan says.
- **Privacy of prompts:** people are sent as ids + role names, never real names. With a key configured, event data (including chat lines truncated to 200 chars) is sent to Meta. Contributor mode (training on content) is never selected by default.
- **Analysis is cached and bound to the verified log hash**, so reloading the page never re-calls the model and a different log produces a different analysis.
- **Replay creates a new session with a new join code** rather than reusing the old code: the old session is finished and its tokens are bound to it. Players are taken to the new lobby with their previous display name pre-filled (`?autojoin=1`). Roles are re-picked (or reshuffled if `rotateRoles`).
- **Shout-outs are a separate stored document, not engine events**, because the engine log is closed once a session ends. Preset reasons only (no free text), one per player.
- **"Live" is earned:** `agent/health.ts` marks Muse Spark `live` only after a real request succeeds in this process, and `degraded` after a failure. Nothing has been verified against the real API (no key available), so docs/INTEGRATIONS.md says so.
- **A bug the stub-server test caught:** the OpenAI SDK's timeout/abort errors have `name === "Error"`, so timeouts were misclassified as "unavailable". Now matched by SDK error class.
- **Deferred as planned:** recap illustration (Phase 6), org objectives/rubric weighting (Phase 4), Act 2 levers (Phase 5), Inspector UI (Phase 7; the run log is already recorded and readable by the organizer).
