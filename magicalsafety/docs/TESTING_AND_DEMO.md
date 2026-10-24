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

Expected: engine 26 tests, server 3 tests, all green.

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

## 3. Watch a headless playthrough ✅

```bash
npm run sim
```

Prints the full event log and "Recorded facts" for two scripted runs:
1. **Good run** — roles split the work, the Steward sends the guard for the kit → `success_on_time`, `centralized=false`, `helper_utilization≈0.43`.
2. **Solo run** — one player does everything and ignores the guard → `max_action_share=1`, `centralized=true`, `delegations_issued=0`, `helper_utilization=0`.

Each metric lists `evidenceEventIds` you can find in the log above it.

## 4. Play it in the browser (coming in Phase 2)
## 5. Full demo (coming in Phase 8, see `DEMO_SCRIPT.md`)
