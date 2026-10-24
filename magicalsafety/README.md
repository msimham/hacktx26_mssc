# Magic Safety School

Adaptive, multiplayer AI social-training app. Teams cooperate through a fairytale (or campus) emergency; a training agent observes, evaluates, diagnoses, and adapts the next run.

Full spec: [docs/IMPLEMENTATION_PLAN.md](docs/IMPLEMENTATION_PLAN.md). Deviations: [docs/DECISIONS.md](docs/DECISIONS.md).

## Quick start (demo mode, no keys needed)

```bash
cd magicalsafety
npm install
npm run dev        # server :3001, client http://localhost:5173
npm test           # unit tests
```

With no `.env`, every integration runs as a labeled mock/rules fallback. Copy `.env.example` to `.env` to add keys.

## Status

- Phases 0-3 done: scaffold, engine, multiplayer + world UI + storage, training agent + adaptive replay.
- Playable now: create a session on the home page and play the castle medical-emergency scenario with friends and/or 🤖 simulated teammates. Results separate recorded facts from an evidence-cited interpretation (rules in demo mode, Muse Spark if a key is set), and the Adaptive Replay screen sets up a harder, targeted next run.
- Test and demo walkthrough: [docs/TESTING_AND_DEMO.md](docs/TESTING_AND_DEMO.md).
