# Magic Safety School — Implementation Plan

> Audience: the implementing engineer/agent (Sonnet) and the project owner.
> Source of requirements: the "Build an Adaptive AI Social Training Application" brief.
> Status of repo at planning time: empty (README only). Greenfield. Node 22.17, npm 10.9 available.
> **Location: the whole app lives in `magicalsafety/`** (repo: `hacktx26_mssc/`). Another app that integrates with this one may be added later as a sibling folder. All paths in this plan are relative to `magicalsafety/` unless they start with `hacktx26_mssc/`.

Follow the phases **in order**. Each phase ends with a runnable app and passing tests. Do not start a phase until the previous phase's acceptance checks pass. When a decision here turns out to be wrong in practice, prefer the simpler option and note the deviation in `docs/DECISIONS.md`.

---

## 0. Verified external facts (checked 2026-10-24 against official docs)

Use these exact values. Re-verify only if a call fails.

### Meta Model API (`https://api.meta.ai/v1`, `Authorization: Bearer $META_MODEL_API_KEY`)
Docs: https://dev.meta.ai/docs/overview · models: https://dev.meta.ai/docs/models · pricing: https://dev.meta.ai/docs/pricing-rate-limits

| Capability | Model ID | Endpoint | Notes |
|---|---|---|---|
| Reasoning / evaluation / NPC dialogue | `muse-spark-1.3` | `POST /v1/chat/completions` (OpenAI-compatible) | Use the `openai` npm SDK with `baseURL`. Structured output: `response_format: { type: "json_schema", json_schema: { name, schema, strict: true } }`. Tool calling supported. $1.25 / $4.25 per 1M in/out. |
| Cheap mode | `muse-spark-1.3-contributor` | same | $0.10/$0.20 but **content may be used to train Meta models** → never default for org data; expose as an org-level opt-in only. |
| Image generation | `muse-image-1.0` | `POST /v1/images/generations` | Body `{ model, prompt, n, size: "1536x1024", response_format: "b64_json", output_format: "webp" }`. Response `data[].b64_json`. $0.01/image, 150 RPM. |
| Speech-to-text | `muse-voice-transcribe-1.0` | `POST /v1/asr/transcribe` multipart | Parts: `request` (JSON `{"model":"muse-voice-transcribe-1.0","audioEncoding":"WAV","mode":"PUSH_TO_TALK","keywords":[...]}`, `type=application/json`) and `audio` (WAV). **WAV only: mono, 16-bit PCM, 16 kHz or 24 kHz**, ≤10 min, ≤32 MB. Response `{ sessionId, transcript, audioDurationMs, turns[] }`. $0.18/audio-hour. |

Implications:
- Browsers record WebM/Opus via MediaRecorder, which the API rejects. **Capture PCM with Web Audio (AudioWorklet or ScriptProcessor), downsample to 16 kHz mono, and encode WAV in the browser** (~60 lines, no ffmpeg dependency).
- The `keywords` field should be filled with scenario vocabulary (character names, "physician", "guard", room names). This noticeably improves command recognition.
- Realtime WS (`wss://api.meta.ai/v1/asr/realtime`) exists but is **out of scope**; push-to-talk file upload is enough and much simpler.

### Facebook Graph API (realistic scope)
- **Facebook Login (JS SDK) with `public_profile`**: works in Development mode for app admins/testers with no App Review needed. Use it for display name and avatar in the lobby, opt-in only.
- **`user_friends`**: returns only friends who *also* use this app. Live mode requires App Review, so treat it as **dev-mode-only / unverified**.
- **Invites**: game requests and `invitable_friends` are closed to new non-Gaming web apps. Use the **Share Dialog** (`FB.ui({ method: 'share', href })`) to share a session join link. It needs no extra permission beyond an App ID and an allowed domain.
- Never request private messages, groups, location, or friend lists of non-users.

### SerpApi
- `GET https://serpapi.com/search.json?engine=google&q=...&api_key=$SERPAPI_API_KEY&num=5`. Use `organic_results[].{title, link, snippet}`.

---

## 1. Key decisions and tradeoffs

| Decision | Choice | Alternatives considered | Why / tradeoff accepted |
|---|---|---|---|
| Stack | TypeScript everywhere. npm workspaces: `packages/engine` (pure), `server` (Express + Socket.IO), `client` (Vite + React) | Next.js | Next.js on serverless hosting can't hold Socket.IO connections. A single long-lived Node process gives server-authoritative multiplayer with no extra infra. Cost: two dev processes (combine with `concurrently`). |
| World rendering | **Illustrated point-and-click rooms**: background image per room, % positioned hotspots, player tokens, minimap of a room graph. Built in React/CSS. | Phaser/Pixi tile map with free movement | Free movement adds physics, collision and art work that teach nothing about the training goals. Rooms plus hotspots map 1:1 onto validated actions, make voice/keyboard/mouse equivalence trivial, and suit Muse Image backgrounds. Cost: less "game feel". Recover some of it with animation, sound, and a ticking clock. |
| Multiplayer | Server-authoritative Socket.IO rooms. Clients send `ActionRequest`s and the server validates them and broadcasts state. Empty roles are filled by **clearly labeled simulated teammates** ("🤖 Simulated"). | Peer-to-peer; local-only | Real multiplayer across browser tabs or devices on the same LAN is cheap with Socket.IO and is the core of "human connection". Bots make the game playable solo for judges. No reconnection or state-sync beyond "rejoin by player token" (see Phase 2). |
| Game logic | Deterministic reducer `(state, action, now) → { state, events[] }` in `packages/engine`. No model calls in the engine. | LLM-driven game master | The brief requires deterministic safety rules. A pure reducer is unit-testable and replayable. The LLM only produces *configs* and *text*, which are validated. |
| Persistence | In-memory store plus JSON snapshot to `server/data/*.json` (gitignored) behind a small `Store` interface | SQLite, Postgres | Single process, hackathon scale. `node:sqlite` is still experimental and native `better-sqlite3` builds can break. Replaceable later behind the interface. |
| Validation | `zod` schemas in `packages/engine/src/schemas`, shared by client and server. Use `zod-to-json-schema` to generate Muse `response_format` schemas from the same source. | Hand-written JSON Schema | One source of truth for types, runtime validation, and LLM structured output. |
| LLM provider | `ModelProvider` interface with `MetaMuseProvider` (OpenAI SDK, baseURL api.meta.ai) and `MockProvider` (deterministic). Selected per org config and key availability. | Multi-provider gateway | The brief forbids building a gateway. One real provider plus a mock is the minimum that keeps the app running without keys. |
| Evaluation | **Two-layer**: deterministic metrics (facts) → Muse Spark interpretation, constrained to cite event IDs → validator drops uncited claims. Deterministic rule-based interpretation is the fallback. | LLM-only scoring | Keeps the facts vs. interpretation split auditable and makes the fallback demo just as coherent. |
| Adaptation | LLM picks values inside a **bounded `AdaptationPlan` schema** (enums and ranges). An engine compiler turns the plan into a concrete `ScenarioConfig`. Social-scope changes become *recommendations* that need organizer approval. | LLM writes scenario JSON freely | Keeps generated scenarios always playable and safe, and the model can't grant itself access. Cost: less creative variety, which is acceptable. |
| Org docs / RAG | Paste or upload `.md`/`.txt` → chunk by heading → keyword/BM25-lite retrieval in memory | Embeddings + vector DB | Org docs are small. Keyword retrieval is explainable (shows matched terms) and has no infra. PDF is out of scope (TODO stretch). |
| Images | Pre-generate world art with a script (`npm run gen:assets`), cache by prompt hash in `server/assets-cache/`, serve statically. Ship **hand-made SVG/gradient fallbacks** in the repo. One runtime generation per session for a "team moment" recap illustration (async, with a placeholder). | Generate everything at runtime | Avoids latency and cost during play and keeps the demo deterministic. Runtime recap shows personalized Muse Image use where latency is tolerable. |
| Voice | Push-to-talk → browser WAV → server proxy → Muse Voice Transcribe → `CommandParser`. Fallback chain: browser Web Speech API (labeled "browser STT") → text box. | Realtime streaming | Push-to-talk is reliable, cheap, and fits a turn-based command model. |
| Auth | No accounts. Organizer passcode per org (env or config) for builder/setup screens. Players join with a 6-char join code and get a random player token. Optional FB Login for display name only. | Real IAM/RBAC | Explicitly out of scope. Still enforce org/session boundaries in every API handler. |

| Second scenario | **Evacuation as Act 2**, a continuation that unlocks only when Act 1 (medical emergency) succeeds, in the same session with the same team, positions and roles | Separate standalone scenario in Setup | It reads as one story ("help arrives… then the alarm sounds") and still proves the engine runs a different scenario. It also allows a cross-act comparison ("delegation went from 0 to 3 between acts"). Cost: the engine needs act sequencing, and evaluation needs per-act metrics. Mitigated by keeping acts as independent compiled scenarios that only share players and positions. |

**Cut order if time runs short** (cut from the top first): FB `user_friends` → runtime recap image → Web Speech fallback → SerpApi in feedback (keep it in the builder) → Act 2 in the castle world (keep it in campus) → voice entirely. **Never cut**: playable Cinderella scenario, campus world skin, event log, evaluation, adapted replay, results evidence, mock fallbacks.

---

## 2. Repository layout (target)

**Self-contained app folder.** `magicalsafety/` has its own `package.json` (npm workspaces root for *this app*), lockfile, `.env`, `.gitignore`, and docs. All `npm` commands run from `magicalsafety/`.
- **Do not** add a `package.json` at `hacktx26_mssc/` now.
- When the second app arrives, a repo-level workspace can list `magicalsafety/*` without restructuring.
- Tradeoff: two install roots until then. This was accepted to avoid guessing the future app's needs.
- Integration seam: the future app should talk to this one through its **HTTP/Socket API** and, if code sharing is needed, by importing `@magicalsafety/engine` (pure, no I/O).
- Name packages `@magicalsafety/engine`, `@magicalsafety/server`, `@magicalsafety/client` so names don't collide later.
- Don't build anything else for the hypothetical app.
- The repo-root `hacktx26_mssc/README.md` gets a short section that points to `magicalsafety/README.md`.

```
hacktx26_mssc/
├─ README.md                    # repo overview → links to magicalsafety/README.md
└─ magicalsafety/
├─ package.json                 # workspaces, scripts: dev, build, test, gen:assets, demo:seed
├─ .env.example                 # placeholders only
├─ .gitignore                   # .env, node_modules, server/data, server/assets-cache
├─ README.md                    # what it is, quick start (demo mode), link to SETUP.md
├─ docs/
│  ├─ IMPLEMENTATION_PLAN.md    # this file
│  ├─ SETUP.md                  # user setup checklist (credentials, permissions, files)
│  ├─ INTEGRATIONS.md           # live / mocked / partial / unverified status table
│  ├─ DEMO_SCRIPT.md            # 5-minute judged demo walkthrough
│  └─ DECISIONS.md              # deviations from this plan
├─ packages/engine/             # PURE TS. No I/O, no network, no Date.now() (time is injected)
│  └─ src/
│     ├─ schemas/               # zod: org, session, world, scenario, events, actions, assessment, adaptation
│     ├─ content/
│     │  ├─ worlds/castle.ts    # rooms, hotspots, art prompts, NPC skins, vocabulary
│     │  ├─ worlds/campus.ts
│     │  ├─ scenarios/medicalEmergency.ts   # world-agnostic: slots, roles, tasks, timeline
│     │  ├─ scenarios/evacuation.ts         # stretch (Phase 5b)
│     │  └─ safety/emergencyProtocol.ts     # authored, deterministic safety content + real-world mapping
│     ├─ engine/
│     │  ├─ compile.ts          # (World, Scenario, SessionConfig, AdaptationPlan?) → RuntimeScenario
│     │  ├─ reducer.ts          # applyAction, tick
│     │  ├─ legalActions.ts     # actions available to a player right now
│     │  └─ bots.ts             # simulated teammate policy (deterministic)
│     ├─ eval/
│     │  ├─ metrics.ts          # deterministic metrics from event log
│     │  ├─ ruleInterpreter.ts  # fallback diagnosis without LLM
│     │  └─ adaptationRules.ts  # fallback weakness → AdaptationPlan
│     └─ index.ts
├─ server/
│  └─ src/
│     ├─ index.ts               # Express + Socket.IO, serves client build in prod
│     ├─ config/env.ts          # reads env, computes integration availability, never logs secrets
│     ├─ store/                 # Store interface + JsonFileStore
│     ├─ realtime/sessionHub.ts # socket handlers, tick loop, bot driver
│     ├─ agent/
│     │  ├─ providers/          # ModelProvider, MetaMuseProvider, MockProvider
│     │  ├─ trainingAgent.ts    # observe/evaluate/diagnose/adapt orchestration
│     │  ├─ prompts/            # prompt templates (plain TS template strings)
│     │  ├─ commandParser.ts    # text → legal action (rules first, LLM fallback)
│     │  └─ npcDialogue.ts      # constrained in-character NPC replies
│     ├─ tools/
│     │  ├─ registry.ts         # tool definitions + zod arg schemas
│     │  ├─ policy.ts           # allowlist, usage limits, org boundary checks
│     │  ├─ executeTool.ts      # request → policy → execute → validate → audit
│     │  ├─ serpapi.ts
│     │  ├─ museImage.ts
│     │  ├─ museTranscribe.ts
│     │  └─ orgDocs.ts          # chunk + keyword retrieval
│     ├─ inspector/runLog.ts    # AgentRun records, cost estimates, redaction
│     ├─ social/facebook.ts     # token debug/verify, mock social data
│     └─ routes/                # REST: orgs, sessions, assessments, tools, voice, inspector, integrations
└─ client/
   └─ src/
      ├─ routes/                # Builder, Setup, Lobby, World, Results, Replay, Inspector
      ├─ components/            # SceneView, Minimap, ActionBar, ChatPanel, RoleCard, Timer, MockBadge, EvidenceList
      ├─ input/                 # mouse/keyboard/voice/text adapters → ActionRequest
      ├─ audio/wavRecorder.ts
      ├─ social/fbSdk.ts
      └─ api.ts, socket.ts
```

Dependencies: `zod`, `zod-to-json-schema`, `express`, `socket.io`, `socket.io-client`, `openai`, `react`, `react-router-dom`, `vite`, `@vitejs/plugin-react`, `tailwindcss`, `nanoid`, `dotenv`, `vitest`, `tsx`, `concurrently`, `multer` (voice upload, memory storage, 5 MB cap). No others without noting it in DECISIONS.md.

---

## 3. Domain model (the three layers, kept separate)

All in `packages/engine/src/schemas`. Sketches below; Sonnet fills in the zod definitions.

### A. Organization layer — `OrgConfig` (what to teach and evaluate)
```ts
OrgConfig {
  id, name, audience: string,
  trainingPurpose: string,
  objectives: LearningObjective[]          // { id, title, description, competency: Competency }
  rubric: RubricItem[]                     // { objectiveId, indicator: MetricKey, target, weight }
  documents: OrgDocument[]                 // { id, title, text, source: "uploaded" | "approved_web" , url? }
  model: { provider: "meta" | "mock", modelId: "muse-spark-1.3" | "muse-spark-1.3-contributor", allowContributorMode: boolean }
  tools: { allowed: ToolName[] }           // "serpapi.search" | "muse.image" | "muse.transcribe" | "org_docs.search" | "fb.profile"
  limits: { maxModelCallsPerSession, maxImagesPerSession, maxSearchesPerDay, maxVoiceSecondsPerSession }
  safety: { requireAuthoredSafetyContent: true /* fixed true */, retentionDays: number, storeTranscripts: boolean }
}
Competency = "recognition" | "communication" | "delegation" | "help_seeking" | "coordination" | "prioritization"
```
**Not here:** world, scenario, social environment, team size.

### B. Game/session layer — `SessionConfig` (what this run looks like)
```ts
SessionConfig {
  id, orgId, joinCode,
  worldId: "castle" | "campus",
  acts: ScenarioId[]   // default ["medical_emergency", "evacuation"]; ["medical_emergency"] = single act
                       // act N+1 starts only when act N's success conditions are met (never on failure)
  socialEnvironment: "friends" | "classmates" | "coworkers" | "assigned_team" | "strangers" | "simulated",
  team: { size: 2..4, roleAssignment: "random" | "chosen" | "organizer", fillWithBots: boolean },
  inputMethods: ("text" | "voice" | "mouse" | "keyboard")[],
  difficulty: Difficulty,
  rules: { act1DurationSec: 150..360, act2DurationSec: 90..240, allowCrossRoomChat: boolean }
  adaptation?: { fromSessionId, planId }   // set when this is an adapted replay
}
Difficulty { timePressure: "low"|"moderate"|"high", ambiguity: "clear"|"subtle", simultaneousIncidents: 1|2,
             extraHelpers: 0..2, infoDistribution: "concentrated"|"split"|"siloed", resourceScarcity: boolean }
```
How `socialEnvironment` changes gameplay (concrete, not cosmetic):
- `strangers`: other players' roles and knowledge are hidden until someone uses **Introduce** (a free action). The lobby shows an icebreaker prompt. Evaluated as part of communication.
- `friends`: show FB names/avatars if consented. Lobby offers the Share Dialog invite.
- `classmates`/`coworkers`/`assigned_team`: roles visible. Organizer may pre-assign roles.
- `simulated`: one human, everyone else bots. UI permanently shows the "🤖 Simulated teammates" banner.

### C. Adaptive runtime — events, assessment, plan
```ts
GameEvent { id: "ev_###", t: msSinceStart, sessionId, act: 1|2, actorId, actorKind: "human"|"bot"|"npc"|"system",
            type: EventType, payload, roomId }
EventType = "act_started" | "act_completed" | "act_locked" | "incident_started" | "incident_noticed" | "moved" | "inspected" | "said" | "introduced"
          | "delegated" | "delegation_accepted" | "delegation_completed" | "help_requested" | "help_arrived"
          | "resource_fetched" | "resource_used" | "task_completed" | "task_failed" | "condition_changed"
          | "action_rejected" | "session_ended"

Assessment {
  sessionId, generatedBy: "muse-spark-1.3" | "rules",
  facts: MetricResult[]                    // deterministic, per act + cross-act deltas — always shown as "Recorded"
  actsReached: 1 | 2, actOutcomes: { act, outcome }[]
  team: { strengths: Claim[], improvements: Claim[] }
  individuals: { playerId, strengths: Claim[], improvements: Claim[] }[]
  primaryWeaknesses: WeaknessCode[]        // 1..3
}
Claim { text, competency, evidenceEventIds: string[] (min 1), sourceIds?: string[] /* org doc chunks or approved web */ }
WeaknessCode = "slow_recognition" | "over_centralization" | "no_delegation" | "late_help_seeking"
             | "info_not_shared" | "poor_prioritization" | "helper_ignored" | "uncoordinated_resources"

AdaptationPlan {
  basedOn: WeaknessCode[], rationale: string, evidenceEventIds: string[],
  targetAct: 1 | 2,                        // act 2 targetable only if the team reached it
  changes: Partial<Difficulty> & { rotateRoles?: boolean, discovererRole?: RoleId,
                                   exitBlockedAtSec?: 20..90, needsAssistanceCount?: 1..2 },
  recommendations: { kind: "social_scope" | "team_size", text }[]   // NEVER auto-applied
}
```

---

## 4. Flagship scenario: Cinderella's Ball Emergency (content spec)

Scenarios are **world-agnostic** and reference location *slots*. Worlds bind slots to rooms and give skins (names, art, NPC names). This is the reuse mechanism.

### Slots → castle rooms
| Slot | Castle room | Campus room (Phase 5) |
|---|---|---|
| `incident_site` | Grand Ballroom | Student Union Atrium |
| `authority_post` | Throne Dais | RA Front Desk |
| `outside_access` | Palace Courtyard & Gate | Building Entrance / Parking Loop |
| `resource_store` | Steward's Cabinet (first-aid chest) | Hallway AED Cabinet |
| `side_hall` | Grand Staircase | Stairwell |

### Roles (2–4 players; with 2 players, a bot or the human takes the uncovered duties)
| Role (castle skin) | Starts in | Private knowledge (role card) | Unique capabilities |
|---|---|---|---|
| **Cinderella** (Discoverer) | Ballroom | Sees the Duchess collapse. Sees she isn't responding normally. | `check_responsiveness`, `stay_with_person` |
| **Royal Steward** (Authority) | Throne Dais | Knows the physician is at the gatehouse. Commands the guards. | `command_guard`, `clear_area`, `ring_bell` (= alert everyone) |
| **Coachman** (Runner) | Courtyard | Has the key to the Steward's Cabinet. Knows the fastest route. | `open_cabinet`, `fetch_physician` (= call emergency services) |
| **Lady-in-Waiting** (4th, optional) | Staircase | Knows the Duchess's companion and what she ate/did (context only, non-medical) | `calm_crowd`, `guide_responders` |
| NPC **Palace Guard** (helper) | Ballroom edge | — | Accepts delegation: fetch item, clear area, guide responders. **Ignoring him is a measurable signal.** |
| NPC **Duchess's companion** | Ballroom | Fact sheet only | Talks via `npcDialogue` (Muse Spark, constrained) |

Distributed info makes cooperation necessary: only the Discoverer knows what happened, only the Authority knows where help is, and only the Runner can reach the resources and the outside. Nobody can win alone without delegating to the Guard or a teammate within the time limit.

### Deterministic safety content (`content/safety/emergencyProtocol.ts`)
- Authored and fixed. **The model never generates safety steps.** Each fantasy action has a `realWorld` string shown in a "Real-world equivalent" tooltip and on the Results screen, e.g. `fetch_physician` → "Call emergency services (911 in the US) or your campus emergency number". `open_cabinet` + bring kit → "Send someone specific to get the AED/first-aid kit". `clear_area` → "Make space and keep bystanders back". `stay_with_person` → "Stay with the person and keep watching them until help arrives". `guide_responders` → "Send someone to meet responders and guide them in".
- Keep it general. **No CPR technique, medication, or diagnosis content.** Show a persistent footer: "This is a coordination exercise, not certified first-aid training. Follow your organization's certified training."
- `npcDialogue` and every LLM text output pass `safetyFilter.ts`, which blocks or replaces any text containing dosing, procedures, or diagnoses (regex list plus a short allowlist of approved phrases). Blocked output is logged as a policy event.

### Timeline and win/lose (all numbers come from `Difficulty`)
- `t=0..15s`: ambient ball. Incident starts at a seeded time between 10–25 s (deterministic per session seed).
- Condition track: `stable → worsening → critical` at thresholds, e.g. moderate: help must be requested by 60 s and responders must arrive by 150 s. `stay_with_person` slows the decline. `clear_area` is required before responders can reach the person, and a `guide_responders` action shortens their arrival time.
- **Team success** requires: incident noticed, help requested, kit brought to the site, area cleared, someone stayed with the person, and responders arrived before `critical + grace`. Partial outcomes are graded: "Help arrived in time", "Help arrived late", "Help never called".
- Shared consequences: one team outcome. Individual contributions are only shown in Results.
- Second incident (when `simultaneousIncidents: 2`): a candelabra falls on the Grand Staircase and guests start to crowd. It needs `calm_crowd` or a delegated `clear_area` at `side_hall`, which creates a real competing demand.

### Actions (all inputs map to these)
`move(roomId)`, `inspect(targetId)`, `say(text, to: "room"|"team"|playerId)`, `introduce()`, `delegate(targetId, taskId)`, `accept_delegation(id)`, `perform(capabilityId, targetId?)`, `request_help(channel)`, `fetch(itemId)`, `use(itemId, targetId)`.
`legalActions(state, playerId)` drives the action bar, keyboard hotkeys (1–9), voice parsing (enum given to LLM), and server validation. **One function, used everywhere.**

### Act 2: Evacuation (continuation, `content/scenarios/evacuation.ts`)

Act 2 starts **only** when Act 1 ends in success. It's a separate world-agnostic scenario file compiled with the same world.

**Transition**
- When Act 1 succeeds, the responders take over care of the person (a short narrated beat of about 5 s, emitting `act_completed`).
- Then the alarm goes off: "Smoke is pouring from the Palace Kitchens; the warning bells ring" (castle) or "The fire alarm sounds; smoke from the chemistry wing" (campus). This emits `act_started`.
- Players **keep their current rooms and roles**, so where people ended up in Act 1 matters.
- The person from Act 1 leaves with the responders and is not part of Act 2. This keeps the state carry-over trivial.

**If Act 1 fails**
- The session ends and emits `act_locked`.
- Results show "Act 2 locked: resolve the emergency to continue."
- The adapted replay targets Act 1, and Act 2 unlocks once a replay succeeds.

**New slots**
| Slot | Castle | Campus |
|---|---|---|
| `hazard_origin` | Palace Kitchens | Chemistry Lab Wing |
| `exit_primary` | Grand Staircase (becomes smoke-blocked at `exitBlockedAtSec`) | Main Stairwell |
| `exit_secondary` | Servants' Passage | East Stairwell |
| `assembly_point` | Palace Gardens | Front Lawn |

Existing rooms are reused as rooms that must be swept.

**Same role IDs, new capabilities** (scenarios define capabilities per role ID, so identity carries over):
| Role | Act 2 private knowledge | Act 2 capabilities |
|---|---|---|
| Discoverer (Cinderella) | Sees smoke, and later sees the main exit become blocked | `sweep_room`, `warn_room` |
| Authority (Steward) | Holds the guest list, i.e. the headcount roster | `take_headcount`, `report_to_responders` |
| Runner (Coachman) | Knows the secondary exit | `open_secondary_exit`, `sweep_room` |
| Liaison (Lady-in-Waiting) | Knows a guest with limited mobility is upstairs | `assist_person` (needs 2 people, or 1 person plus the Guard) |
| NPC Guard (+ extra helpers via `extraHelpers`) | — | Delegable: `sweep_room`, `assist_person` |

**Success**
- Every room was swept.
- The person needing assistance reached the assembly point, **or** their location was reported to responders. Both are valid real-world choices and are scored as such.
- A headcount was reported at the assembly point.
- No one used the blocked exit after it was announced.
- All of this happens within `act2DurationSec`.

**Authored safety mapping** (same rules as Act 1: fixed content, never model-generated):
- "Use the nearest safe exit; don't use elevators"
- "Don't go back inside"
- "Help others if you safely can, or tell responders exactly where someone is"
- "Go to the assembly point and get counted"

**Why Act 2 works as a training continuation**
- It tests the same competencies under a different structure. The main lever is that sweeping rooms is impossible alone in the time limit.
- That makes over-centralization visible a second time, which gives an in-session before/after comparison (Section 5).

### Simulated teammates (`engine/bots.ts`)
- Deterministic and **reactive by default**. They act only when (a) delegated to, (b) addressed by role name in chat ("coachman, get the physician"), or (c) after an idle timeout (e.g. 25 s) for their role's core duty, so the humans stay the protagonists.
- Bot chat lines come from a canned set per role. Optional Muse Spark flavor rewording is allowed for bot lines but not for decisions.
- Every bot message and token carries the 🤖 badge.

---

## 5. Training agent loop: OBSERVE → EVALUATE → DIAGNOSE → ADAPT → REPLAY

`server/src/agent/trainingAgent.ts` orchestrates the steps. Each step writes an `AgentRun` record (Section 7).

1. **OBSERVE**: the event log comes from the reducer. Chat `say` events also get a deterministic intent tag (`shares_info`, `asks_for_help`, `delegates`, `acknowledges`, `other`) from a keyword and role-name tagger. Optional async Muse Spark tagging may refine tags **for evaluation only** and is stored separately as `aiTags`. It never changes the game state.
2. **EVALUATE** (deterministic, `eval/metrics.ts`):
   - `time_to_notice_ms`, `time_to_help_request_ms`, `time_to_resource_ms`, `outcome`
   - `action_share_by_player` (critical actions per player / total) → over-centralization if one player has more than 60% with team size ≥ 2
   - `delegations_issued`, `delegations_completed`, `helper_utilization` (Guard tasks / Guard available-time)
   - `info_shared`: did each private fact reach at least one other player (via a `say` tagged `shares_info` that mentions fact keywords, or via `introduce`)?
   - `priority_order_ok`: was help requested before non-critical actions?
   - `rejected_actions` count (confusion signal)
   - Act 2 additions: `rooms_swept_by_player`, `time_to_headcount_ms`, `blocked_exit_used`, `assisted_person_outcome`
   - Cross-act deltas (only if Act 2 was reached): `delegation_delta`, `centralization_delta`, `info_shared_delta`. Show these as **observed change between acts**, never as a claim of learning.
   Metrics are computed **per act** (filter events by `act`), and each metric records the `evidenceEventIds` it derived from.
3. **DIAGNOSE**: `MetaMuseProvider.complete()` takes the org objectives and rubric, the metrics, a compacted event log (≤ 200 events, chat truncated to 200 chars each), relevant org-doc chunks (`orgDocs.search` with the weakness keywords), and the list of allowed `WeaknessCode`s. It returns `Assessment` JSON via `json_schema` structured output.
   - **Validator**: zod parse. Every `evidenceEventIds` entry must exist in the log, and claims with none are dropped. `sourceIds` must exist among the provided chunks. `primaryWeaknesses` must be consistent with the metrics (e.g. it can't claim `no_delegation` when `delegations_issued ≥ 2`; this rule lives in `ruleInterpreter.consistencyCheck`). Retry once with the validation errors appended, then fall back to `ruleInterpreter`.
   - Timeout is 20 s with `AbortController`.
4. **ADAPT**: the same pattern produces an `AdaptationPlan`. Allowed changes per weakness (enforced in code, the LLM picks within these):
   | Weakness | Permitted levers |
   |---|---|
   | over_centralization / no_delegation / helper_ignored | `simultaneousIncidents: 2`, `extraHelpers +1`, `infoDistribution: split→siloed`, `rotateRoles` |
   | late_help_seeking / slow_recognition | `ambiguity: subtle`, `timePressure +1`, `discovererRole` change |
   | info_not_shared | `infoDistribution: siloed`, `allowCrossRoomChat: false` (must physically meet or ring bell) |
   | poor_prioritization | `simultaneousIncidents: 2` with the distractor timed before the main incident |
   | (no weaknesses) | raise `timePressure` and `ambiguity` one step ("challenge mode") |
   | (Act 2 specific) blocked_exit_used / slow headcount | `exitBlockedAtSec` earlier, `needsAssistanceCount: 2`, `infoDistribution: siloed` |
   Targeting: if Act 1 failed, `targetAct = 1` and only Act 1 levers apply. If Act 1 succeeded, the plan may tune either act. The replay always restarts from Act 1, because the continuation is earned again each run.
   `compile.ts` applies the plan → new `SessionConfig` with `adaptation.fromSessionId`. **The adapted run must differ observably** (asserted by a test). Social-scope ideas go into `recommendations` and appear as an "Organizer approval needed" card. They are applied only if the organizer clicks approve, which creates a new session config. Even then, no participant is added without joining via code.
5. **REPLAY**: the Adaptive Replay screen shows a before→after diff table of the config, each change linked to the weakness and to the clickable evidence events that triggered it, and a "Play adapted scenario" button that creates the new session with the same team (same join code room).

Fallback guarantee: with no keys, `MockProvider` + `ruleInterpreter` + `adaptationRules` produce a full assessment and plan labeled "Generated by rules (no AI)".

---

## 6. Integrations: where each one adds real value

| Integration | User-facing use | Fallback | Status label |
|---|---|---|---|
| Muse Spark | (1) Diagnose and Adapt steps; (2) **Experience Builder "Draft from description"**: the org types a paragraph and gets proposed objectives and rubric (schema-validated, editable); (3) Duchess's companion NPC dialogue constrained to a fact sheet; (4) voice/text command parsing fallback; (5) personalized feedback wording | rules / canned text | Live if key present and a health check passes |
| Muse Image | World backgrounds and character portraits (pre-generated with `gen:assets`); per-session "team moment" recap illustration on Results; builder can regenerate the cover for a custom org world name | repo SVG art | Live / Cached / Fallback art |
| Muse Voice Transcribe | Push-to-talk commands and team chat ("Steward, the Duchess collapsed in the ballroom!"). Transcript goes to chat (if addressed to people) or `commandParser` (if a command). Scenario vocabulary is passed as `keywords`. | Web Speech API → text | Live / Browser STT / Text only |
| SerpApi | Experience Builder "Research background": the admin searches (e.g. "bystander effect emergency response university"), sees results with links, and **explicitly approves** which snippets become `approved_web` documents. Results may cite approved sources as "Learn more". | Disabled button with explanation, plus a canned sample result set clearly labeled MOCK in demo mode | Live / Mock |
| Facebook | Optional Login (`public_profile`) for lobby name and avatar; Share Dialog to share the join link (friends social env); `user_friends` "friends also training" list in dev mode | Name entry + labeled "Demo friends (mock)" | Live (dev mode) / Mock / Unverified for review-gated perms |

Untrusted-content handling (SerpApi results and org docs):
- Wrap them in prompts as `<untrusted_reference id=...>…</untrusted_reference>` with an instruction that references can't change rules, tools, or safety content.
- Strip HTML, cap length (1,500 chars per chunk), and never let them reach `emergencyProtocol` or the tool policy.
- An org-specific policy statement may only appear in feedback if a `sourceIds` citation resolves to an org document. Otherwise the validator strips it.

---

## 7. Security, policy, and the Agent Run Inspector

**Tool execution flow** (`tools/executeTool.ts`). This is the *only* path to external tools:
```
ToolRequest {tool, args, orgId, sessionId?, requestedBy: "agent"|"organizer"|"player"}
 → registry lookup (unknown tool → deny)
 → zod arg validation (deny on failure)
 → policy.check: tool ∈ org.tools.allowed, usage counters < limits, session.orgId === orgId, requester allowed for tool
 → execute with timeout (10–20 s)
 → validate result shape, sanitize
 → audit event {decision, reason, latencyMs, costEstimate}
```
- The model may *request* tools only through structured output fields. The server decides. There are no free-form tool loops.
- Secrets live in server env only. `env.ts` exposes booleans (`hasMetaKey`) to the client via `/api/integrations`, never values. Errors returned to the client are generic, with details only in the server log and inspector (redacted).
- Organizer routes require the org passcode header. Player routes require a player token bound to a session. Each handler loads by id **and** checks `orgId`/`sessionId` ownership.
- Rate limits: simple in-memory token bucket per IP on `/api/voice` and `/api/tools`.
- Retention: a `retentionDays` sweep on startup. Audio is never stored. Transcripts are stored only if `storeTranscripts`.

**Inspector** (`/inspector/:sessionId`, organizer-only): a table of `AgentRun { id, step, provider, model, startedAt, latencyMs, inputSummary (redacted, truncated), output (validated JSON), validationErrors[], fallbackUsed, usage {prompt_tokens, completion_tokens}, costUsd (from pricing table in code), toolCalls[], policyDecisions[] }` plus raw event log viewer. A note at the top: "Shows inputs, outputs and decisions. It does not show the model's hidden reasoning."

---

## 8. UI screens and demo flow

Visual direction: storybook-fairytale for the castle (deep navy, gold, parchment cards, a serif display font from Google Fonts), clean modern for campus. Training/admin screens share one neutral design system with Tailwind tokens. Each world provides a theme object.

1. **Experience Builder** `/builder`: org name and audience, purpose textarea plus "Draft with Muse Spark", objectives/rubric editor, documents (paste/upload .md/.txt), Research (SerpApi) with approve buttons, model choice (standard vs contributor with a training-data warning), tool allowlist checkboxes, limits, retention. A preset "Riverside University — Emergency Response" org is seeded.
2. **Session Setup** `/setup`: cards for World, Scenario, and Social environment, team size, role assignment, input methods, a difficulty sliders panel, duration. Creates a join code and QR code (qr library optional). Shows the "same training agent" org badge to make the layer separation visible.
3. **Lobby** `/play/:code`: name or FB login, role reveal (or hidden roles in `strangers`), ready check, Share Dialog button, bot fill indicator.
4. **Interactive World** `/play/:code/game`: SceneView (room art, hotspots, tokens), Minimap, private Role Card ("What only you know"), Action Bar from `legalActions` with hotkeys, Team Chat with push-to-talk mic, objective/condition tracker, timer, toasts for events. Mock and bot badges are visible.
5. **Training Results** `/results/:sessionId`: outcome banner, timeline of key events (clickable evidence), a **"Recorded facts"** panel (metrics) separated visually from **"AI interpretation"** (claims with evidence chips and source chips, plus a "Generated by muse-spark-1.3" or "Generated by rules" tag), individual cards, team shout-out step (each player gives one teammate a thank-you, logged as a positive social event), recap illustration, real-world equivalents panel.
6. **Adaptive Replay** `/replay/:sessionId`: weaknesses → levers → config diff, evidence links, organizer-approval recommendations, "Play adapted scenario".
7. **Agent Run Inspector** `/inspector/:sessionId`.

Global: `MockBadge` component on anything served by a mock. A `/status` popover lists each integration's live/mock/fallback state.

---

## 9. Phased build plan with acceptance checks

### Phase 0: Scaffold (small)
- Everything is created inside `magicalsafety/`. Workspaces, TS configs (strict), Vite+React+Tailwind client, Express+Socket.IO server, vitest in engine and server, `npm run dev` runs both, `.gitignore`, `.env.example`, `env.ts` with availability flags, `/api/health`, `/api/integrations`.
- ✅ `cd magicalsafety && npm install && npm run dev` serves a page that shows integration status (all "mock" with no `.env`). `npm test` passes.

### Phase 1: Engine and flagship scenario (pure, heavily tested)
- Schemas, castle world, medical_emergency scenario, safety protocol, `compile`, `reducer`, `legalActions`, `bots`, `metrics`. Seeded RNG and injected clock.
- Tests: happy path wins; "one player does everything, ignores the guard" path produces `over_centralization` + `helper_ignored` metrics; illegal actions (wrong room, wrong role) are rejected with `action_rejected` events; the bot accepts a delegation and completes it; the timeline is deterministic for a given seed.
- ✅ A headless script `npm run sim -w packages/engine` plays two scripted runs and prints the event log and metrics.

### Phase 2: Multiplayer and World UI (the first vertical slice)
- `sessionHub`: create/join via code, player tokens, server tick (1 Hz plus on-action), broadcast **per-player views** (private role info only to its owner), bot driver, rejoin by token on reload.
- Client: Lobby and Interactive World with mouse and keyboard input, text chat, fallback SVG art.
- Minimal Results page that shows only the metrics.
- ✅ Two browser tabs can play the Cinderella scenario to a win and to a loss. Solo play with bots works. Private info never appears in the other tab's socket payload (test with a socket client in vitest).

### Phase 3: Training agent and adaptive replay
- `ModelProvider`, `MockProvider`, `MetaMuseProvider` (`openai` SDK, `baseURL`, `json_schema`, 20 s timeout, 1 retry), `trainingAgent`, `ruleInterpreter`, `adaptationRules`, validators, `AgentRun` logging.
- Results screen (facts vs interpretation), Adaptive Replay screen, "Play adapted scenario".
- Tests: malformed LLM JSON → retry → fallback; an uncited claim is dropped; a hallucinated event id is dropped; the adapted config differs from the original for each weakness; recommendations are never auto-applied; the provider timeout triggers the fallback.
- ✅ Full loop works in demo mode (no keys) and, if a key is present, with Muse Spark (manually verified, then noted in INTEGRATIONS.md).

### Phase 4: Experience Builder and Session Setup
- Org CRUD, passcode, seeded org, objectives/rubric editor, docs paste/upload and `orgDocs` retrieval, model and tool settings, limits. Session Setup with every `SessionConfig` field. Social-environment effects (`strangers` hidden roles + Introduce, `simulated` banner).
- "Draft with Muse Spark" for objectives (validated, with a mock version).
- ✅ Changing org objectives changes which metrics are emphasized in Results (rubric weights). Changing the social environment changes lobby and gameplay behavior. Neither layer edits the other.

### Phase 5: Reuse (both parts required, in order)
- 5a: **Campus world** binding the same `medical_emergency` scenario (RA Desk, Atrium, AED cabinet, campus security instead of the physician). Same org, same agent, with no engine changes beyond content files.
- 5b: **Act 2 Evacuation** as a continuation (Section 4).
  - Engine: `compile` returns `RuntimeAct[]`, and state gains `currentAct`.
  - The reducer handles `act_completed` → transition beat → `act_started`, carrying over player positions and roles. If Act 1 failed, it emits `act_locked`.
  - Per-act metrics plus cross-act deltas.
  - UI: act title card, alarm effect, the new Act 2 role-card section, and Results tabs for "Act 1 / Act 2 / Change between acts".
  - Bind the evacuation slots in campus first, then castle (castle Act 2 is cuttable).
  - The Session Setup "Acts" control offers "Emergency only" or "Emergency → Evacuation". A dev-only `?startAct=2` lets you test Act 2 without winning Act 1.
- Tests:
  - `compile(campus, medical_emergency)` and `compile(campus, [medical_emergency, evacuation])` both succeed.
  - Act 2 never starts after an Act 1 failure.
  - Positions carry over.
  - Cross-act deltas are computed only when both acts exist.
- ✅ A playable session runs Act 1 → Act 2 end-to-end in campus (and castle if not cut), and the assessment and adaptation work unchanged across both worlds.

### Phase 6: Meta, SerpApi, and Facebook integrations
- `museImage.ts` + `scripts/gen-assets.ts` (castle and campus rooms, 6–8 character portraits, prompt hash cache, `--force`) + runtime recap image (async, limit-checked).
- Voice: `wavRecorder.ts` (16 kHz mono PCM16 WAV, max 20 s), `/api/voice/transcribe` (multer memory, 5 MB cap, policy check, forwards multipart with `keywords` from world vocabulary), `commandParser` (rules → LLM picking from the `legalActions` enum → "Did you mean…?" chips). Web Speech fallback.
- NPC dialogue for the companion (fact sheet, safety filter, 1 call per player message, 8 s timeout, canned fallback).
- SerpApi tool + builder Research UI + approve-to-doc.
- FB: `fbSdk.ts` loading the JS SDK only if `VITE_FB_APP_ID` is set. Login with `public_profile`; the server verifies the token via `GET https://graph.facebook.com/debug_token?input_token=...&access_token={app-id}|{app-secret}` before trusting a name. Share Dialog. Dev-mode `user_friends` behind a toggle. Mock social list labeled MOCK.
- ✅ Each integration shows the correct live/mock label. Killing the network mid-game doesn't break play (fallbacks kick in and are labeled). Results in INTEGRATIONS.md are updated honestly.

### Phase 7: Security, inspector, tests, docs
- `executeTool` pipeline everywhere, policy tests (disallowed tool denied, over-limit denied, cross-org access denied), safety filter tests, inspector UI, redaction test (no `Bearer`/key strings in run logs), retention sweep.
- Write `SETUP.md`, `INTEGRATIONS.md`, `DEMO_SCRIPT.md`, README quick start.
- ✅ `npm test` is green. `grep -r "sk-\|Bearer " server/data` finds nothing.

### Phase 8: Polish and the demo rehearsal
- Animations (room transitions, condition pulse), sound cues (bell, music loop with mute), responsive layout down to 1024 px for game screens and phone-width lobby/join, empty and error states, loading skeletons, keyboard focus states.
- `npm run demo:seed` creates the seeded org, a prepared first session, and cached art.
- Rehearse `DEMO_SCRIPT.md` twice: once with no keys, once with keys.

---

## 10. Demo script (target, ~6 min)

1. Builder: show the seeded university org, click "Draft with Muse Spark", run one SerpApi research query and approve one source (≈45 s).
2. Setup: Castle × Medical Emergency × Classmates, 3 players. Open two tabs (or two laptops) plus one bot (≈20 s).
3. Play run 1, Act 1: the Cinderella player tries to do everything and ignores the Guard. The team succeeds, but late. Use one voice command (≈75 s).
3b. Act 2 unlocks: the alarm sounds. Sweeping alone runs out of time, which shows the same pattern under a new structure. Set `act2DurationSec` to 90 for the demo (≈60 s).
4. Results: Act 1 / Act 2 tabs, recorded facts vs AI interpretation, the "change between acts" panel, click an evidence chip to jump to the event, real-world equivalents (≈45 s).
5. Adaptive Replay: "over-centralization + helper ignored → second incident on the staircase, extra helper, siloed info, moderate time pressure", with evidence links. Play the start of run 2 (≈60 s).
6. Reuse: switch the same org to the Campus world and show it boots unchanged. Show the Inspector briefly (≈30 s).

---

## 11. User-required setup (this goes into `docs/SETUP.md` and as `TODO(USER)` comments)

Place a `TODO(USER): …` comment at each listed file location, worded exactly as below. Paths are relative to `magicalsafety/`, and the `.env` file goes in `magicalsafety/.env`.

| # | What you must do | Env var / file | Code location (TODO marker) |
|---|---|---|---|
| 1 | Create a Meta Model API key at the Meta developer console (developer.meta.com / dev.meta.ai). Public preview; may be US-only. Add billing or credits. | `META_MODEL_API_KEY` | `server/src/config/env.ts`, `server/src/agent/providers/metaMuse.ts` |
| 2 | (Optional) Decide whether contributor mode is acceptable (content may be used to train Meta models). Default is off. | `META_ALLOW_CONTRIBUTOR=false` | `server/src/agent/providers/metaMuse.ts` |
| 3 | Run `npm run gen:assets` once after adding the key to generate world art (~30 images ≈ $0.30). | — | `scripts/gen-assets.ts` |
| 4 | Create a SerpApi account and key. | `SERPAPI_API_KEY` | `server/src/tools/serpapi.ts` |
| 5 | Create a Meta (Facebook) app of type Consumer/"Authenticate and request data from users with Facebook Login". Add the Facebook Login product and add `http://localhost:5173` and your demo domain to App Domains and Valid OAuth Redirect URIs. Keep the app in Development mode and add demo accounts as Testers. | `VITE_FB_APP_ID`, `FB_APP_SECRET` | `client/src/social/fbSdk.ts`, `server/src/social/facebook.ts` |
| 6 | (Optional, not needed for demo) Submit App Review for `user_friends` to go Live. | — | `server/src/social/facebook.ts` |
| 7 | Set an organizer passcode. | `ORGANIZER_PASSCODE` | `server/src/config/env.ts` |
| 8 | (Optional) Replace authored safety copy with your org's reviewed emergency guidance. | — | `packages/engine/src/content/safety/emergencyProtocol.ts` |
| 9 | (Optional) Use HTTPS (e.g. a tunnel) for microphone access on non-localhost devices. Browsers block the mic on plain HTTP. | — | `client/src/audio/wavRecorder.ts` |

`.env.example`:
```
# Server-side only. Never commit .env.
META_MODEL_API_KEY=
META_MODEL_BASE_URL=https://api.meta.ai/v1
META_REASONING_MODEL=muse-spark-1.3
META_IMAGE_MODEL=muse-image-1.0
META_TRANSCRIBE_MODEL=muse-voice-transcribe-1.0
META_ALLOW_CONTRIBUTOR=false
SERPAPI_API_KEY=
FB_APP_SECRET=
ORGANIZER_PASSCODE=change-me
PORT=3001
# Client (public — app id is not secret)
VITE_FB_APP_ID=
```

---

## 12. Honesty rules for the implementer

- Never mark an integration "Live" in INTEGRATIONS.md unless a real request succeeded during development. Record the date and model ID.
- Any UI element backed by a mock shows `MockBadge`. Bots always show 🤖.
- Do not invent endpoint fields beyond Section 0. If something is unclear, open the cited doc page, and if still unclear, leave a `TODO(VERIFY)` and keep the fallback path.
- Do not commit `.env`, generated `server/data`, or API responses containing tokens.
- Keep all app files inside `magicalsafety/`. The only change allowed outside it is the pointer section in `hacktx26_mssc/README.md`.
