# TALE × Magic Institute for Societal Safety

## Purpose

People rarely get to practice a real emergency skill (using a fire extinguisher, helping during an overdose, evacuating a building) before they need it.
This project lets anyone describe the training they want and get a playable 3D simulation built for them in about a minute.
It has three parts: **TALE** (the front door), **Magic Institute for Societal Safety** (the engine that builds the worlds) and
**Magic Safety School** (the earlier multiplayer app that set the bar for the worlds).

## TALE

**TALE** (Training Agents for Learning Experiences) is the front door. It is a home page and an 11-question wizard where you describe:

- **What to train:** the situation you want to train for (e.g. a kitchen fire) and which skills matter most.
- **The world:** the setting your training happens in (e.g. a fairytale castle).
- **Who it's for:** the audience, how many people take part, and how they should interact.
- **Your agent:** what it should know, what it may use or do, what it must never do, and what needs your permission first.
- **Success:** how you'll know the training worked.

When you press **Create Training Simulation Agent**, TALE sends your answers to Magic Institute, shows the build progress in 7 phases,
and takes you straight into the finished world. The source is in `magicinstitute/frontend/`. The original standalone prototype is in `enterpriseplatform/`.

## Magic Institute for Societal Safety

**Magic Institute** is the engine behind TALE. A pipeline of AI agents turns your answers into a secured, evaluated training program,
then into a fairytale world where you are the hero and practice the real procedure step by step with your hands (webcam hand tracking) or the keyboard.

- **The control plane** standardizes your answers, applies security rules (every tool is denied unless your answers grant it), and plans how the training is evaluated.
- **The agents** (Director → ResourceScout → SkillDesigner → Storyteller → WorldBuilder → Validator) research, design the skill, write the story and build the world.
  The Validator rejects any build that skips, reorders or invents a step and sends it back for a rebuild.
- **The story is the wrapper; the skill is the point.** Each act teaches one real procedure (e.g. the PASS method for a fire extinguisher).
- **While you play,** hold 🎤 **Ask** to ask a question about the current step.
- **At the end,** you see the skills you practiced, real-world links (e.g. the nearest fire stations), and **Find your people** suggests groups
  to bring the skill to your friends and community.

## Magic Safety School

**Magic Safety School** (`magicalsafety/`) is the earlier app this project grew from: an adaptive, multiplayer training game where a team practices
staying calm and working together through a fairytale (Cinderella's Palace) or campus (Riverside Student Union) emergency.

- **Scenarios:** a medical emergency, then an evacuation with a smoke-blocked exit, a locked second exit, a guest who needs two people to help, and a headcount.
- **Multiplayer:** teammates join over WebSockets, each with private role knowledge; simulated teammates are always marked 🤖.
- **A training agent loop:** Observe → Evaluate → Diagnose → Adapt → Replay. The agent measures what happened, explains it with evidence from recorded events,
  and changes the next run to practice what the team was weakest at.
- **Two layers:** an organization sets what to teach and measure (`/builder`); a session sets what this run looks like (`/setup`).

Its visual detail is the standard the Magic Institute worlds follow. It is a coordination exercise, not certified first-aid training.
To run it: `cd magicalsafety && npm install && npm run dev`, then open http://localhost:5173 (works without any keys). More in [`magicalsafety/README.md`](magicalsafety/README.md).

## How to use (TALE + Magic Institute)

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
