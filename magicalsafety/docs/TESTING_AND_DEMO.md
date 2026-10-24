# Testing and demoing Magic Safety School

This file grows with each phase. Sections marked ✅ work today.

## 1. One-time setup

```bash
cd magicalsafety
npm install
```

No `.env` is needed. Everything runs in demo mode (mock/rules). See `.env.example` to add keys later.

## 2. Automated checks ✅

```bash
npm test            # all workspaces
npm run typecheck   # strict TypeScript, all workspaces
```

Expected: engine 69 tests, server 93 tests, all green.

What the engine tests prove:
| Area | Test |
|---|---|
| Winning | A team that splits the work and uses the guard wins "on time" |
| Over-centralization | One player doing everything → `centralized = true`, 0 delegations, 0 helper use |
| Failure | Doing nothing → `help_never_called`; condition goes worsening → critical |
| Rules | Wrong room / missing knowledge / busy / malformed actions emit `action_rejected` |
| One source of truth | Every action `legalActions()` lists passes `checkAction()` |
| Delegation | Guard accepts, travels, completes; humans must accept; impossible delegations refused |
| Bots | Solo human + 🤖 teammates can win; bots stay silent until addressed |
| Determinism | Same seed + inputs → identical event log; replaying the stored inputs reproduces the state |
| Safety | Dosing / CPR steps / diagnoses are blocked; approved coordination wording passes |
| Privacy | `viewFor()` never includes another player's private knowledge; strangers' roles stay hidden until they introduce themselves |

What the Phase 4 tests prove:
| Area | Test |
|---|---|
| Two layers | An organization can't carry world/scenario/social/team settings (strict schema); a session holds only an org id; editing an org never changes existing sessions and creating a session never changes the org |
| Org API | Organizer-only; create/edit/delete; invalid rubrics, out-of-range targets, mismatched ids, and the safety flag are all rejected; the demo org can't be deleted |
| Documents | Added/removed with control characters stripped and size limits; chunked by heading; ranked with explainable matched terms |
| `executeTool` | Unknown tool, bad arguments, tool not on the org's allowlist, wrong requester, cross-org session, usage limit, bad output, timeout, thrown errors: all denied without leaking details; every decision audited with redacted arguments |
| Emphasis | Different rubrics give different emphasized facts, objective scores and surfaced weaknesses; the snapshot keeps old results stable |
| Sources and limits | Rules claims cite the org's own guidance; without `org_docs.search` there are none; the per-session model-call limit stops real model calls |
| Draft | The keyword drafter produces valid objectives; a model's draft is clamped (unsafe dropped, targets pulled into range, directions fixed); daily draft limit |
| Provider choice | Rules without a key or when the org chose mock; contributor mode only when the org AND the server both opt in |
| Setup | Every setting is validated and stored; unavailable worlds/acts are refused; strangers hide roles and show an icebreaker; simulated allows one human; host-assigned roles; input methods reach the player |

What the training-agent tests prove:
| Area | Test |
|---|---|
| Diagnosis | A solo-doer is flagged `over_centralization` + `no_delegation` + `helper_ignored`; a team that split the work is not |
| Evidence | Every claim cites events that exist in the log; made-up ids and uncited claims are dropped |
| Model validation | Malformed JSON → one retry with the errors appended → accepted; twice malformed → rules fallback; timeout → retry → fallback; auth error → no retry |
| Safety | Dosing/CPR/diagnosis text from a model is removed and logged as a policy decision |
| Consistency | A model claiming "no delegation" when the team delegated is overruled by the facts |
| Org sources | Policy-style statements are dropped unless their source id resolves to a provided document; references are wrapped as untrusted data |
| Bounded adaptation | Levers outside the weakness table, or more than one step harder, are clamped; if nothing legal remains → fallback; recommendations are never applied unless an organizer approves |
| The adapted run differs | For every weakness the next config changes, and the engine behaves differently (second incident, subtle collapse, siloed information, distractor first, different starting role) |
| Meta provider | Request path/auth/`json_schema strict` body, usage parsing, 429/401/400/bad JSON/timeout mapping against a local stub (not the real API) |
| Secrets | Bearer tokens, configured secrets and key-like strings are redacted from the agent run log |
| Access | Analysis/replay/shout-out/run-log routes enforce player-token or organizer access; only the host or an organizer can create the next run |

What the server tests prove (real sockets, fake clock):
| Area | Test |
|---|---|
| Access | Creating a session needs the organizer passcode; bad settings/extra fields are rejected |
| Lobby | Join by code, first joiner is host, size limit, unique roles, names sanitized, only the host can start |
| Multiplayer | Two humans + a 🤖 win a full game over sockets; the other player's secret never appears in your payload; a player can't act as someone else |
| Reconnect | Rejoin by token after closing the socket; newcomers refused after start |
| Storage | Round-trip through disk, atomic writes, owner-only file permissions, corrupt metadata skipped, retention sweep, path-like ids refused |
| Integrity | Edited line / deleted line / reordered lines / truncated finished log are all detected |
| Recovery | A restarted server resumes a running session from its log; a tampered log is refused |
| Results | Rebuilt by replaying the verified log; 404 without a valid player token |

## 3. Watch a headless playthrough ✅

```bash
npm run sim
```

Prints the full event log and "Recorded facts" for two scripted runs:
1. **Good run** — roles split the work, the Steward sends the guard for the kit → `success_on_time`, `centralized=false`, `helper_utilization≈0.43`.
2. **Solo run** — one player does everything and ignores the guard → `max_action_share=1`, `centralized=true`, `delegations_issued=0`, `helper_utilization=0`.

Each metric lists `evidenceEventIds` you can find in the log above it.

## 4. Build and set up a session ✅

```bash
npm run dev      # then open http://localhost:5173
```

**Experience Builder** (`/builder`, organizer passcode `change-me`):
1. The demo organization "Riverside University: Emergency Response" is already there. Change **Share the work** weight or target and **Save**.
2. Click **Draft with Muse Spark** after writing a sentence under "What do you want people to practice?". With no key the proposal is tagged `RULES`. Click **Use this draft**, tweak it, **Save**.
3. Under **Documents** paste a short guide using `# headings`, or upload a `.md`/`.txt`. Try the search box ("who to call"): you see which section matched and the matched words.
4. Under **AI, tools and limits** switch the model to the "contributor" model: a training-data warning appears. Untick **Search this organization's documents** and later results lose their "Learn more" links.

**Session Setup** (`/setup`):
1. Pick the organization (it shows how many objectives it has: the same training agent, whatever the world).
2. Pick **Strangers**: roles are hidden in the lobby, an icebreaker appears, and introducing yourself in the game is scored. Pick **Mostly simulated**: only one human can join. Pick **Assigned team**: the host sets everyone's role in the lobby.
3. Turn off **Mouse** and **Typed chat** to see a keyboard-only game. Try **Subtle** emergencies, **Siloed** information, **No helpers**.
4. **Create session** → you land in the lobby with a join code.

**See objectives change the results:** play one quick game (or do nothing for ~2.5 minutes), open Results, and note the **goals** panel and the ★ on the emphasized facts. Edit the organization in the Builder (move weight to a different measure), play again, and compare. The first session's results keep the old snapshot.

## 5. Play it in the browser ✅

```bash
npm run dev          # server http://localhost:3001, client http://localhost:5173
```

Open **http://localhost:5173**.

**Solo with simulated teammates (about 2 minutes)**
1. *Create a session*: open **Session Setup** (passcode `change-me`, or your `ORGANIZER_PASSCODE`), keep the defaults but set Roles to "Players choose". Click **Create session**. (Or use **Quick start** on the home page and let roles be random.)
2. In the waiting room pick **Cinderella**, click **Start the exercise**. The two other roles are 🤖.
3. Wait for the alarm: the Duchess collapses 10-25 s in (the feed says so and a red "Duchess" chip appears).
4. In the chat box, type: `The Duchess collapsed! Coachman, get the physician. Steward, move the guests back.` and press Send.
5. Click **Stay with the Duchess** (or press its number key).
6. Watch the 🤖 Steward share where help is, the 🤖 Coachman call for help and fetch the kit, and the Team goals tick off. Help arrives about 45 s after it is called.
7. Click **View results** when the dialog appears.

**Two real players (two tabs, or two devices on the same Wi-Fi)**
1. Tab A creates the session in Session Setup (team size 3, "Players choose") and picks **Cinderella**.
2. Tab B (use a private window or another browser so it has its own identity) opens `http://localhost:5173`, enters the join code, a name, and picks **Royal Steward**.
3. Tab A clicks **Start**. Each tab sees only its own "What only you know" card. In Tab B the Steward's card says where the physician is; Tab A's does not.
4. Talk through the chat: the *Cinderella* player says what happened, the *Steward* says where help is. The 🤖 Coachman does the rest, or ask it explicitly.
5. To see delegation: as the Steward click **Ask Palace Guard → Move the guests back**.

**Things to try**
- Click **Look at the Duchess** and other 🔍 hotspots; hover action buttons for the real-world equivalent.
- Press `1`-`9` to trigger numbered actions (not while typing).
- Do nothing for ~2 minutes: the exercise ends with "Help was never called".
- Close the tab mid-game and reopen the same URL: you rejoin as the same player.
- On another device: use `http://<your-LAN-IP>:5173` (microphone isn't used yet).
- Stop the server (Ctrl+C) mid-game and run `npm run dev` again: the session resumes from its verified log.

### Results and adaptive replay ✅

After a session ends, click **View results** (about 2.5 minutes if you do nothing, or about 1.5 minutes if you win).

1. **What happened**: a timeline of key moments. Click any grey/gold `ev_###` chip anywhere on the page to jump to the matching moment.
2. **Recorded facts** (grey bar): measured values with their evidence. Nothing here is opinion.
3. **Interpretation** (blue bar): tagged **"Generated by rules (no AI)"** with a `RULES` badge when no key is configured, or **"Generated by muse-spark-1.3"** when one is. Check that every statement has evidence chips, and that each person has an individual card.
4. **In the real world**: the real-world equivalent of each action your team used.
5. **Say thanks**: pick a teammate and a preset reason (one per player).
6. Click **Plan the next run** → **Adaptive replay**: the weaknesses found, a before→after table of what changes (each row says which weakness caused it), the evidence behind the plan, and an **Organizer approval needed** card if a suggestion would change who plays.
7. The **host** clicks **Play adapted scenario**. Everyone else's page updates within 3 s with a **Join the adapted session** button. Names are pre-filled.

**Quick ways to see each path**
- *Do-nothing run*: nothing happens → "Help was never called", focus on getting help and noticing.
- *Solo hero run*: play alone with 🤖s but do every action yourself and never use "Ask someone" → "Sharing the work" / "Asking for help from others" / "Using available helpers"; the replay adds a second incident or an extra helper.
- *Good run*: win using the Guard ("Ask Palace Guard → Bring the first-aid chest") → few or no weaknesses → the plan is a "challenge mode" step (more time pressure, subtler emergency) and an organizer suggestion to try strangers mode.
- *Approving a suggestion*: on the replay page type the organizer passcode, tick the suggestion, then Play adapted scenario.

**Turning on the real model (optional)**
1. Put `META_MODEL_API_KEY=...` in `magicalsafety/.env` and restart `npm run dev`. The home page shows Muse Spark as **Configured**.
2. Finish a game and open Results. The interpretation should say **Generated by muse-spark-1.3**, and the home page status flips to **Live**. If the model misbehaves, the page silently falls back to rules and says "Generated by rules"; the integration shows **degraded**.
3. See what the agent did (organizer only): `curl -H "x-organizer-passcode: change-me" http://localhost:3001/api/sessions/<sessionId>/runs`. You get inputs (redacted, truncated), validated outputs, validation errors, fallback flags, token usage and cost.
4. If it works, tell the implementer so INTEGRATIONS.md can record the date and model id. It has never been run against the real API.

**Where data goes:** `server/data/` (gitignored): per session a `.meta.json`, a `.log.jsonl` (hash-chained inputs), and once analysed an `.analysis.json`, `.runs.json` and `.shoutouts.json`. Delete the folder to reset.
## 6. Full demo (coming in Phase 8, see `DEMO_SCRIPT.md`)
