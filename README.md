# TALE × Magic Institute for Societal Safety

## Purpose

People rarely get to practice a real emergency skill (using a fire extinguisher, helping during an overdose, evacuating a building) before they need it.
This project lets anyone describe the training they want and get a playable 3D simulation built for them in about a minute.

- **TALE** (Training Agents for Learning Experiences) is the front door: a home page and an 11-question wizard where you describe what to train,
  who it's for, the world it happens in and the guardrails it must follow.
- **Magic Institute for Societal Safety** is the engine behind it: a pipeline of AI agents that turns those answers into a secured, evaluated
  training program, then into a fairytale world where you are the hero and practice the real procedure step by step with your hands
  (webcam hand tracking) or the keyboard.
- The story is the wrapper; the skill is the point. Each act teaches one real procedure, and the platform rejects any build that skips,
  reorders or invents a step. At the end you get real-world links and suggestions for groups to bring the skill to your friends and community.

## How to use

```bash
cd magicinstitute
python3 -m venv .venv && .venv/bin/pip install anthropic fastapi "uvicorn[standard]" pydantic pytest httpx
npm install && npm --prefix frontend install && npm --prefix frontend run build
.venv/bin/uvicorn aep.server:app --port 8000
```

Open **http://localhost:8000/** and:

1. Click **+ Create Training Simulation Agent** (or pick a starting point such as Fire safety).
2. Answer the 11 questions and press **Create Training Simulation Agent** on the review screen.
3. Watch the build; when it finishes you are taken straight into your world.
4. Play: arrow keys / WASD to move, allow the webcam to perform the hand gestures (or hold keys 1–6), hold 🎤 **Ask** (or V) to ask a question.
5. At the end, review the skills you practiced, open the real-world links, and optionally press **Find your people**.

**AI keys (optional):** copy `magicinstitute/.env.example` to `magicinstitute/.env` and set `MUSE_API_KEY` or `ANTHROPIC_API_KEY`.
Without a key, built-in offline templates (fire safety) are used, which is enough to try the whole flow.
`SERPAPI_KEY` and the Facebook keys only power **Find your people**. Never commit `.env`.

**Tests:**
```bash
cd magicinstitute
.venv/bin/python -m pytest && node tests/gestures.test.mjs && npm --prefix frontend test
```

More detail on the agents, control plane and social features: [`magicinstitute/README.md`](magicinstitute/README.md).

## Repository layout

| Folder | What it is |
| --- | --- |
| [`magicinstitute/`](magicinstitute/README.md) | **The app.** Agent pipeline and API (`aep/`), 3D player (`web/`), and the TALE home page + wizard (`frontend/`). |
| `enterpriseplatform/` | The original standalone TALE UI prototype, now merged into `magicinstitute/frontend/`. |
| [`magicalsafety/`](magicalsafety/README.md) | Earlier Magic Safety School app (separate npm workspace); its visual detail is the bar the Magic Institute worlds follow. |
