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

## Phase 4 (Experience Builder, Session Setup)

- **`executeTool` was built now (org_docs.search only) instead of Phase 7.** The plan puts tool allowlists and limits in the org config, and the training agent now searches org documents; running that outside the pipeline would break the rule. Phase 6 adds the external tools to the same registry. Usage counters are in memory (per process; day counters roll over by UTC date).
- **One organizer passcode for the whole server** (`ORGANIZER_PASSCODE`), not one per organization. The plan allows "env or config"; a per-org passcode adds nothing at single-process hackathon scale. Every `/api/orgs` route and session creation requires it.
- **`limits.maxBuilderDraftsPerDay` added** (default 10) so the Builder's model calls are bounded like every other model call. Everything else in the plan's limits list is unchanged.
- **Rubric items carry a `direction`** (`at_most`, `at_least`, `is_true`, `is_false`) next to `target`; the plan listed only `target`. Targets are stored in the metric's own unit (ms, ratio 0..1, count). `INDICATOR_INFO` (engine) says which directions and ranges make sense per indicator; the server validator and the Builder UI both use it. Added two metrics for rubrics: `succeeded`, and `introduced_ratio` (strangers only).
- **The organization schema is strict and has no world, scenario, social or team fields**, and a session holds only an `orgId`. Tests assert neither layer can edit the other.
- **Org emphasis only reorders.** The rubric changes which weaknesses are surfaced first (via competency weights) and which facts lead the Results page; it never adds or removes a weakness. Results also show each objective's rubric items as met / not met / not measured.
- **Analysis snapshots the organization** (name, purpose, objectives, rubric results, cited sources). Editing the org later does not rewrite past results. The stored analysis shape changed, so analyses from Phase 3 are regenerated on next view.
- **"Learn more" sources** come from `org_docs.search` through `executeTool` (one query per top weakness). If the organization's allowlist excludes the tool, the agent has no sources and the denial is audited. Retrieval is explainable keyword scoring (BM25-lite) and shows matched terms.
- **Org documents are `.md`/`.txt` only** (read in the browser, 40,000 characters max, control characters stripped). PDF is out of scope as the plan says.
- **Model choice is per organization**; contributor mode needs the organization to opt in AND the server (`META_ALLOW_CONTRIBUTOR=true`). The Builder shows a training-data warning, and the server reports a warning when the two disagree.
- **Per-session model-call limit** counts only real model calls (rules calls are free) and is checked before each call; hitting it falls back to rules and records a `model_call_limit` policy decision.
- **Retention is now per organization** (`safety.retentionDays`); the server default `RETENTION_DAYS` covers sessions whose organization no longer exists. `storeTranscripts` is stored but unused until voice exists.
- **`resourceScarcity` is defined as "no NPC helpers at all"** (the Guard and any extra helpers are absent), so the team can only rely on each other. The plan listed the field without defining it.
- **Social environments:**
  - `strangers`: others' roles are hidden in the lobby as well as in the game, an icebreaker is shown, and introductions are scored (`introduced_ratio`, a team claim). Choosing a role that someone took still reveals that it is taken.
  - `simulated`: exactly one human can join; creation requires simulated teammates.
  - `assigned_team` / role assignment `organizer`: the host assigns roles in the lobby.
  - `friends`: no behavior difference yet; the Facebook invite arrives in Phase 6.
- **Input methods** are client-side affordances (hotkeys, scene clicks, typed chat can be switched off). The server does not distinguish how an action was entered. Voice is shown but disabled until Phase 6.
- **Session creation API changed** from the flat Phase 2 body to a structured one (`team`, `difficulty`, `rules`, ...) so every `SessionConfig` field can be set. Campus and the Evacuation act are rejected with a clear message until Phase 5.
- **Draft with Muse Spark** reuses the same validate/retry/fallback runner as the training agent. The organizer's description is passed as untrusted data, drafts are clamped to what the schema allows (unsafe objectives dropped, targets pulled into range, impossible directions corrected), and the no-key fallback is a keyword drafter labeled "rules".

## Phase 5 (campus world, Act 2 Evacuation)

- **Worlds are skins, scenarios are logic.** To make the campus a content-only change, castle-specific wording moved out of the engine: fact text (and extra spoken keywords) now come from `world.facts`, the collapsed person's target id is the generic `victim`, narration and objective labels come from `world.labels`. A test asserts every slot of every scenario is bound in every world, and that the same scripts win the emergency in both.
- **Rooms can play several slots** (`Room.slots`). A staircase is both the "side hall" of Act 1 and the "primary exit" of Act 2; the Upper floor and exits are new slots (`upper_floor`, `hazard_origin`, `exit_primary`, `exit_secondary`, `assembly_point`). `upper_floor` is an addition to the plan's slot table: the guest who can't manage stairs needs a place to be. Each world gained rooms for them (castle: Upper Gallery, Servants' Passage, Palace Kitchens, Palace Gardens; campus: Second-Floor Lounge, East Stairwell, Chemistry Lab Wing, Front Lawn).
- **Scenario logic sits behind a `ScenarioHandler`** (init, setup, time-driven settle, step rules, effects, view). The reducer, legality checks, bots and views are generic and dispatch to it, so the evacuation is one content file plus one handler.
- **Act sequencing.** Act 1 success emits `act_completed` (with `continues: true`), starts a 5 s beat where only talking is allowed, then `act_started` for the alarm. Players keep rooms and roles; knowledge, carried items and open requests belong to the previous act; NPC helpers return to their usual posts. Failure emits `act_locked` and ends the session; Act 2 is never started. Every event is stamped with its act when emitted (the old flush-time stamping would have mislabeled events across a transition).
- **Evacuation mechanics (the plan left these open):**
  - Rooms to check = every room except the smoke source and the assembly point; the main exit stops counting once it is smoke-filled. Checking a room takes 8 s, so one person cannot do all of them in time.
  - The smoke source cannot be entered. The second exit is locked until someone who knows the way out unlocks it (from the next room over, so you don't have to walk into it).
  - The main exit becomes smoke-filled at `exitBlockedAtSec` (default 50, lever 20..90). Only the Discoverer (and anyone standing in it) learns, so it has to be shared. Walking into it afterwards ends the evacuation immediately (`blocked_exit_used`). Players who know see "(smoke: unsafe)" on that move.
  - Helping a guest takes two people in the room (a teammate or a helper); the guest then follows the person helping. A guest counts as looked after if they reach the assembly point **or** their location was reported to responders (possible once responders arrive at 30 s). `needsAssistanceCount` (1..2) adds a second guest.
  - A headcount counts only if everyone (humans and 🤖) is at the assembly point.
  - Knowledge held by a role nobody plays is announced to everyone, instead of being lost.
- **`?startAct=2` is implemented as `acts: ["evacuation"]`** (the evacuation as the only act). It is offered only in dev builds of the Setup screen, and the server refuses it when `NODE_ENV=production`.
- **Settings added to the session:** `act2: { exitBlockedAtSec, needsAssistanceCount }` (defaults for older stored sessions). Both are adaptation levers, usable only if the session includes the evacuation **and** it was reached (Act 1 succeeded), so an Act 1 failure only ever adjusts Act 1.
- **Metrics per act, plus observed change.** Evacuation facts: `time_to_headcount_ms`, `rooms_swept_ratio`, `rooms_swept_by_player`, `blocked_exit_used`, `assisted_person_outcome` (1 reached, 0.5 reported, 0 not accounted for), `ran_out_of_time`. Cross-act deltas (delegations, centralization, information shared) exist only when both acts were played and are labeled "Observed change between acts". Three evacuation indicators are available to an organization's rubric; the demo organization scores two of them. Rubric measures use Act 1's value for shared keys and the evacuation's value for evacuation-only keys.
- **Weaknesses are merged across acts** (the eight codes are unchanged): walking into the blocked exit counts as `info_not_shared`; running out of time counts as `uncoordinated_resources`. Details from the evacuation are prefixed "In the evacuation".
- **Bug fixed:** simulated teammates ignored a request that arrived in the same millisecond as their last action (`<=` should have been `<`), so they only acted after the 25 s idle timeout.
- **Known limits:** autonomous actors (🤖 and helpers) don't walk routes, they travel the shortest path with a time cost and ignore the blocked-exit rule (they can't be sent into it: the check refuses). Only human players can trigger `blocked_exit_used`. Castle and campus Act 2 both exist (the plan allowed cutting the castle).

## Phase 6 (integrations)

- **No real external call has been made.** Per the project owner's instruction, every integration is implemented, tested against injected stub `fetch` / local stub servers, and left as a `TODO(USER)` for them to switch on. `gen:assets` was only ever run with `--dry-run`. `docs/INTEGRATIONS.md` therefore marks everything "Implemented, unverified".
- **Docs consulted** (read-only page fetches, before the no-API instruction): Meta image generation, speech-to-text, structured output and error handling; SerpApi's search page. Facebook's pages did not load, so its response shapes stay `TODO(VERIFY)`.
- **Every external call goes through `executeTool`** (registry → args → policy → execute → validate → audit): `muse.image`, `muse.transcribe`, `serpapi.search`, `fb.profile`. Tools gained per-session limits (images), a custom audit summary so audio and tokens are never logged, and secrets are redacted from audit text.
- **Voice**: browsers can't produce WAV with MediaRecorder, so the client captures raw samples (AudioWorklet from an in-memory blob, ScriptProcessor fallback), downsamples to 16 kHz mono and writes the WAV. The server re-validates the format before forwarding (a test proves the two agree), caps recordings at 20 s and 5 MB, counts seconds against `maxVoiceSecondsPerSession`, and never stores audio. Fallback chain: Muse Voice → the browser's own recognition, labeled "(not Muse)" → typing. A transcript is only a suggestion: the player confirms before anything happens.
- **Commands**: rules first (deterministic, in the engine, no model); if unsure, "Did you mean…?" chips; if still nothing and a model is available, the model picks from the player's own legal actions only (enum-constrained schema, one attempt, 8 s). The chosen action goes back through the normal socket path, so `checkAction` validates it again.
- **Companion NPC**: players can speak to the companion in person (same room only). Her reply is generated outside the engine, so it is stored as its own log input (`npc_say`) and replay stays exact. It uses a fact sheet, one model call per message, 8 s timeout, no retry, the safety filter, and an authored fallback; lines are labeled "(AI-written)" or "(scripted)". Capped at 30 replies per session.
- **Art**: pre-generated rooms (both worlds) and 14 portraits (32 images, about $0.32), cached by prompt hash. The hand-made SVG scene always renders underneath and the generated image covers it only if it loads. The Status list shows Live / Cached / Fallback for art.
- **Recap illustration** is made on request, from a fixed authored prompt per world (tone follows the outcome, no names or chat), counted against `maxImagesPerSession`, and shown with a `PLACEHOLDER` badge when unavailable.
- **Research**: results are untrusted text (markup stripped, links limited to http(s)). Nothing is saved without an explicit organizer approval; approved items become `approved_web` documents with their URL, shown as "Learn more" links. Without a key, three clearly-fake sample results are returned and saved as "[Sample] …" with no URL.
- **Facebook**: the browser's claimed name is never trusted; the server verifies the token with `debug_token` (token must be valid and belong to this app), then reads only `public_profile` fields. Avatars must come from Facebook's own hosts. The verified name is used only if the player clicks "Use my Facebook name". No token or Facebook id is stored. `user_friends` needs `FB_ENABLE_FRIENDS=true` plus an explicit checkbox and is labeled unverified. Mock friends are clearly fake and only shown when Facebook isn't configured.
- **The demo organization now allows all five tools**, so adding a key "just works". An allowed tool without a key does nothing and shows its fallback.
- **Bug found by a test:** a Facebook display name like `Ana <b>Lee</b>` became `Ana bLee/b` (brackets removed but not the tag). Tags are now stripped first.
- **`demo:seed` is a placeholder** until Phase 8.

## Phase 7 (security, inspector, tests, docs)

### Bugs the new tests found (all fixed)
- **Socket.IO and Express both answered every `/socket.io/` request** (since Phase 2). Express was attached to the HTTP server *after* Socket.IO, so for polling requests Express sent a 404 while Socket.IO tried to answer, which could throw `ERR_HTTP_HEADERS_SENT` and crash the process. WebSocket connections hid it. Now the HTTP server gets its handler before Socket.IO attaches, and a regression test plays a full exchange over the polling transport and asserts no uncaught exception.
- **Run-log redaction only covered the prompt.** An upstream error echoing a key would have been written into `validationErrors`. The whole record is now redacted (`redactDeep`), and a disk scan test proves no configured key, token or `Bearer` string reaches any stored file.
- **The safety filter's dosing rule only understood digits** ("Two tablets should do it" got through). It now understands number words. The filter has 15 blocked and 7 allowed phrases under test, plus the case of an approved phrase sitting next to a forbidden one.
- **Oversized or malformed request bodies returned 500.** They now return 413 and 400.
- **A flaky test helper** waited a fixed 40 ms for client views to catch up; it now waits until they reflect the server.

### Hardening
- **Passcode lockout:** after 10 wrong organizer passcodes from one address within a minute, that address is refused (429) even with the right one. A missing header is "not an organizer", not a failed guess. Limits are in memory, per IP, and reset on restart. Behind a reverse proxy every user would share the proxy's address unless Express `trust proxy` is configured; documented in SETUP.md's hosting note.
- **Socket origins:** no CORS headers are sent; a browser page may connect only from the same site, this machine, the local network (for phone/laptop demos), or `PUBLIC_ORIGIN`. Requests with no Origin (non-browser clients) are allowed; every action is token-authorised anyway.
- **Headers:** `nosniff`, `Referrer-Policy: no-referrer`, `Permissions-Policy` (microphone for this page only), and on the built client a Content-Security-Policy (`default-src 'self'`, no objects, no framing; Facebook sources only when Facebook is configured). `style-src` needs `'unsafe-inline'` because React sets inline styles. The headers are tested; the policy has **not been verified in a real browser**, so a blocked resource there is the first thing to check if the production build looks wrong.
- **Unknown `/api/*` paths answer in JSON**, never an HTML page.
- **Cross-session isolation matrix:** every player-facing route is tested with another session's token and with no token (always 404), and with the right token (works).
- **`npm run check:secrets`** scans stored sessions, logs and the art cache for key-shaped strings and for the real secret values from your `.env`, scans tracked source files for those real values, and fails if a `.env` file is tracked. It backs the plan's "`grep -r "sk-\|Bearer " server/data` finds nothing" check.

### Inspector
- **`/inspector/:sessionId`** (organizer passcode): agent runs (redacted input, validated output, errors, corrections, policy decisions, tokens, cost, fallback), every tool decision for the session, the event log with filters, the verified-record status, and the estimated spend. It states plainly that it shows decisions, not a model's hidden reasoning. Event payloads include chat text, so it is organizer-only.
- **Tool audit is persisted per session** (so the Inspector survives a restart). Organization-level tool calls with no session (Builder search, research) stay in a 500-entry in-memory ring, readable at `/api/orgs/:id/audit`.
- **Model calls are not "tools".** The plan routes external *tools* through `executeTool`; model providers are governed by per-organization call budgets, schema/evidence validation, the safety filter, and the run log, and are shown in the Inspector.

### Docs
- `docs/SETUP.md` (your checklist, where each `TODO(USER)` is, how to confirm each step), `docs/DEMO_SCRIPT.md`, a rewritten README, and an updated TESTING_AND_DEMO.md.
- **The demo script is checked by a test** (`demo.test.ts` plays it with the engine). Writing that test showed my first draft of the script was wrong: the Coachman holds the cabinet key, and simulated teammates take over duties once told about the collapse. The script now matches what happens.

## Phase 8 (polish and rehearsal)

- **Done:**
  - `npm run demo:seed`: the demo organization and a ready lobby with code `DEMO01`; no network.
  - Error boundary with a way out; a "Connection lost, reconnecting" banner (the client already rejoins by token).
  - Sound: short synthesized cues (alarm, critical, help arrives, win/lose) and a slow synthesized **ambient pad** that is calm normally and tense during the alarm or a critical condition. No audio files are shipped. One 🔊/🔇 button controls both, is remembered, and audio can never break the game (the helpers are no-ops without Web Audio or storage).
  - A short fade-and-settle animation when you walk into a room; loading skeletons on every data-loading screen; empty states for the feed and server check; hotspot labels shrink and truncate on narrow screens. All animation respects reduced-motion, and game screens stack below 1024 px.
  - **Rehearsal by machine:** `server/src/rehearsal.test.ts` plays `docs/DEMO_SCRIPT.md` through the real server with two socket clients and a simulated teammate: draft objectives and research (labeled rules/mock), create the session, win Act 1 as a centralizing Cinderella, the beat and the alarm, run out of time in Act 2, results with evidence, the adapted session created by the host, both players joining it, and the Inspector verifying the record. `demo.test.ts` checks the same story at engine level.
- **Still yours to do** (cannot be done without a person and a browser): the two human rehearsals in `docs/DEMO_SCRIPT.md` (no keys, then with keys), and a visual check at phone and 1024 px widths. The UI has not been click-tested by its author, and the sounds have never been heard: tune the volumes (`cues.ts`) if they are too loud or quiet.

## Passcode switch and the crash screen

- **`DISABLE_ORGANIZER_AUTH=true`** (local demos only, ignored in production) removes the passcode from the organizer screens: organizations, creating sessions, run logs and the Inspector. It deliberately does not touch player data: results, analysis, replay approvals and recap images still need a player token or the real passcode, so turning the passcode off never lets one session read another's results (tested).
- **The crash screen now shows what broke** (the error message and the page). Rendering every game state with real data, and the real first lobby and game payloads from a live server, did not reproduce a crash, so a render-time bug in those screens is unlikely. The remaining suspects are effects that only run in a real browser; the message will say which.

## Hand gestures and agent-chosen research (added after Phase 8)

- **Gestures run on the device.** `client/src/vision/` reads one hand with MediaPipe Hand Landmarker (new dependency `@mediapipe/tasks-vision@0.10.21`, client only). Video never leaves the tab, nothing is stored, and the camera has a visible "Camera on" badge and an off button. The input method `gesture` is off unless the host ticks it in Setup.
- **A gesture is only a shortcut for a legal action.** 1 to 4 fingers or a swipe highlights an option; a held open palm (0.8 s) confirms; a held fist cancels. Confirm needs a highlight, can't repeat without the hand changing, and the highlight clears when the hand leaves the frame. Typed-text actions are excluded. The server still validates the action with `checkAction`.
- **Permissions-Policy is now `camera=(self)`** (was `camera=()`), and the CSP adds `'wasm-unsafe-eval'` to `script-src` because the tracker is WebAssembly. Tracker files are self-hosted from `/vision` (no CDN).
- **Not verified:** nothing here has run against a real camera or the real model. Gesture thresholds are tested on synthetic landmarks only and will need tuning on real hands.
- **Agent-chosen research** (`POST /api/orgs/:id/research/auto`): the model only decides `{needed, query, why}`. The query is cleaned, safety-filtered, and falls back to the organizer's own words. The search runs through `executeTool` as `requestedBy: "agent"` (allowlist, daily limit, audit). Results are suggestions; saving one still needs the organizer's approval. No key means labeled sample results.
- **Self-improvement was deferred** at the owner's request.

## Simpler game screen with a story guide

- **The scene is the main thing.** The game screen is now the scene, a story guide, and the action buttons. Role card, team goals, map and chat moved into a "Team & chat" slide-out with an unread badge. In the action list, Move, Look and Ask-a-teammate are folded into a "More" section (the scene hotspots and number keys still do the same things).
- **The guide** (Gus the mouse in the castle, Professor Hoot the owl on campus) tells the story once, then gives one nudge at a time. All guide text is authored by hand (`client/src/guide/guides.ts`), never model-generated. It points at the team's next unfinished goal and the player's own role, **not at the exact button**, so working out the right move stays part of what is assessed.
- **Reading aloud** uses the browser's speech synthesis. The verified Meta API facts include speech-to-text (Muse Voice Transcribe, the microphone) but no text-to-speech model, so no Muse TTS is called (`TODO(VERIFY)` in `guide/speak.ts`). The microphone button sits in the guide bar.
- **Camera box** is a small corner overlay on the scene.

## Hints, and a short results page

- **Hints cost points.** A new `hint` action is always allowed while the game runs. It records a `hint_used` event (so it is in the replay and the verified log) and highlights the next step the simulated teammates' own rules would take for this player's role, only if that step is still legal. The "Hint" button is in the guide bar. A new metric `hints_used` is available to organizer rubrics too. The results page takes **5 points off the overall score per hint** and says so.
- **Results are summarized by skill.** The top of the results page shows the six skills that were measured, each as strong / getting there / needs practice with one "Try:" line (the interpretation's own advice when it has some, otherwise a short authored tip). The play-by-play, measurements, goals and per-person cards are still there, folded into "Full details". Skills nothing was measured for are left out.
