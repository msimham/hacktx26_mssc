# Magic Safety School

An adaptive, multiplayer training app. A team practices staying calm and working together through a fairytale (or campus) emergency. A training agent observes what happened, measures it, explains it with evidence, and then changes the next run to practice what the team was weakest at.

> A coordination exercise, not certified first-aid training. All safety wording is authored and fixed; no AI writes it.

## Quick start (demo mode, no keys)

```bash
cd magicalsafety
npm install
npm run dev        # server :3001, client http://localhost:5173
npm test           # unit + integration tests (none contacts a real service)
```

Open <http://localhost:5173>. With no `.env` every integration is a clearly labeled mock or rules fallback, and the whole app works. Use the **Status** button (top right) at any time to see what is real.

## What is in it

- **Two layers, kept separate.** An *organization* says what to teach and measure (objectives, a weighted rubric, its own documents, AI and tool limits): `/builder`. A *session* says what this run looks like (world, scenario, who is on the team, difficulty, input methods): `/setup`.
- **Worlds:** Cinderella's Palace and the Riverside Student Union. The same scenarios run in both, with only the setting and wording changing.
- **Scenarios:** a medical emergency, then (if the team succeeds) an evacuation with a smoke-blocked exit, a locked second exit, a guest who needs two people to help, and a headcount.
- **Multiplayer** over WebSockets with private role knowledge, simulated teammates (always marked 🤖), voice, and a companion character.
- **The training agent loop:** Observe → Evaluate (deterministic facts) → Diagnose (rules, or Muse Spark constrained to cite recorded events) → Adapt (bounded levers) → Replay.
- **Trust:** every claim cites events; every model output is validated or replaced by rules; external tools only run through one policy-checked pipeline; secrets stay on the server; an organizer Inspector shows the agent's inputs, outputs and tool decisions.

## Scripts

| Command | What it does |
|---|---|
| `npm run dev` | Server and client together |
| `npm test` / `npm run typecheck` | All workspaces |
| `npm run sim -w @magicalsafety/engine` | Headless playthroughs with the full event log and metrics |
| `npm run gen:assets -- --dry-run` | Preview the art that would be generated, and the cost (no request) |
| `npm run check:secrets` | Fails if a key or token is stored on disk or committed |
| `npm run build && npm start` | One process serving the built app |

## Docs

- [docs/SETUP.md](docs/SETUP.md): the steps **you** need to do to switch each real service on.
- [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md): what is live, mocked or unverified (nothing is "Live" yet).
- [docs/TESTING_AND_DEMO.md](docs/TESTING_AND_DEMO.md): how to test and try every feature.
- [docs/DEMO_SCRIPT.md](docs/DEMO_SCRIPT.md): the six-minute walkthrough.
- [docs/DECISIONS.md](docs/DECISIONS.md): every deviation from the plan, and why.
- [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md): the plan this was built from.

## Layout

```
packages/engine/   pure game logic (no I/O, no model calls): reducer, rules, metrics, adaptation
server/            Express + Socket.IO, storage, training agent, tool pipeline, integrations
client/            React + Vite + Tailwind
scripts/           gen-assets, check-secrets
docs/              setup, integrations, testing/demo, decisions
```

## Honest status

Everything is implemented and tested against stubs. **No real external API call has been made**: Meta (Spark, Image, Voice), SerpApi and Facebook each need your key or app (see `docs/SETUP.md`), and the Facebook response shapes are marked `TODO(VERIFY)`. The built client's security headers are tested but have not been checked in a real browser, and the UI has not been click-tested by its author.
