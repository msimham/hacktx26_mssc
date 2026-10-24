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
