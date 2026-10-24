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

Expected: engine 29 tests, server 17 tests, all green.

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

## 4. Play it in the browser ✅

```bash
npm run dev          # server http://localhost:3001, client http://localhost:5173
```

Open **http://localhost:5173**.

**Solo with simulated teammates (about 2 minutes)**
1. *Create a session*: passcode `change-me` (or your `ORGANIZER_PASSCODE`), team size 3, "Players choose" roles, leave 🤖 on. Click **Create session**.
2. In the waiting room pick **Cinderella**, click **Start the exercise**. The two other roles are 🤖.
3. Wait for the alarm: the Duchess collapses 10-25 s in (the feed says so and a red "Duchess" chip appears).
4. In the chat box, type: `The Duchess collapsed! Coachman, get the physician. Steward, move the guests back.` and press Send.
5. Click **Stay with the Duchess** (or press its number key).
6. Watch the 🤖 Steward share where help is, the 🤖 Coachman call for help and fetch the kit, and the Team goals tick off. Help arrives about 45 s after it is called.
7. Click **View results** when the dialog appears.

**Two real players (two tabs, or two devices on the same Wi-Fi)**
1. Tab A creates the session (team size 3, "Players choose") and picks **Cinderella**.
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

**Where data goes:** `server/data/` (gitignored): one `.meta.json` and one `.log.jsonl` (hash-chained inputs) per session. Delete the folder to reset.
## 5. Full demo (coming in Phase 8, see `DEMO_SCRIPT.md`)
