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

Phase 0 (scaffold) done: the home page lists each integration's status.
