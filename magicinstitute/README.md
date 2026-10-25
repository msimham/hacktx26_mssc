# Magic Institute for Societal Safety (built on the Agentic Enterprise Platform, AEP)

Reusable agent infrastructure that turns four user choices (topic, audience, world, social level 1-3)
into a playable, gesture-controlled fantasy VR training simulation.

```
request ─► Director ─► ResourceScout ─► SkillDesigner ─► [ Storyteller ─► WorldBuilder ─► Validator ]×≤3 ─► SimulationSpec (JSON) ─► web player
```

- `aep/schema.py`: the contract. `SimulationRequest` in, `SimulationSpec` out. Nothing else crosses to the sim.
- **Skill-first:** each act teaches one `Skill`, an ordered list of steps (gesture + prop each). Interactions are built in code
  from the steps, so the story can't skip, reorder or invent one; the schema and Validator reject any spec that does.
  Fire safety has curated skills (extinguisher PASS, fire blanket rescue, evacuation); other topics are designed by the LLM.
- `aep/agents/`: one file per agent. The Validator enforces the contract and feeds failures back for a rebuild.
- `aep/library/`: offline templates (fire safety, fully worked) and the curated resource catalog.
- **Visual standard:** the worlds are rendered to the detail bar of the Magical School of Safety pack: see [docs/VISUAL_STANDARD.md](docs/VISUAL_STANDARD.md). The agents design a set + palette + scenery; the player renders the hall, props, rigged characters and effects. Approved custom assets are saved in `asset_library/` and reused (`/assets.html`).
- **You are the heroine:** the story addresses you in the second person ("You are Sleeping Beauty. What would you do?"), plain and direct. Gestures include motion gestures (pull, push, lift, sweep, swipe, trace, circle) alongside static poses.
- **TALE home page + create wizard + control plane:** `/` is the TALE home page and `/create` its wizard (React, source in `frontend/`, built into `web/create`). The wizard asks 11 plain-language questions and POSTs them to `POST /api/training-programs`. `aep/control/` then standardizes the answers into an `AgentSpec` (Standardization agent), applies security (SecurityAgent recommends from a closed rule list; `PolicyEngine` enforces, deny by default), derives a resource plan, plans evaluation, and the orchestrator runs the pipeline above. The wizard polls `GET /api/training-programs/{id}` for the 7 build phases, then sends the learner straight into the built world at `/play.html?program=<id>`. See "Create wizard" below.
- `web/play.html`: the player (opens the built training directly, 3D player, end screen); it asks no questions of its own, and with no `?program=` it redirects to the TALE home page. The optional school / work / city fields for Find my people are on the end screen. three.js player. Arrow keys move; MediaPipe webcam hand tracking recognizes grab / point / open palm / pinch / wave / thumbs-up.
  Keys 1-6 simulate gestures as a fallback.
- Social levels are cumulative: level N plays acts 1..N (1 self, 2 friends/team, 3 community).
- End screen: recap plus real-world links. The fire station map uses browser geolocation.

## Run
```
python -m venv .venv && .venv/bin/pip install -e . && npm install      # npm: three.js, served locally from node_modules
# put MUSE_API_KEY=... (or ANTHROPIC_API_KEY) in .env (gitignored); with neither, offline templates are used
# AEP_PROVIDER=muse|anthropic, AEP_MUSE_MODEL=muse-spark-1.3, AEP_MUSE_REASONING=low
npm --prefix frontend install && npm --prefix frontend run build    # builds the wizard into web/create (gitignored)
.venv/bin/uvicorn aep.server:app --port 8000    # open http://localhost:8000/
.venv/bin/python -m pytest && node tests/gestures.test.mjs && npm --prefix frontend test
# wizard dev server with hot reload: npm --prefix frontend run dev  (http://localhost:5174, proxies /api to :8000)
```

## Find my people (social ladder)
At the end of a play-through, **Find my people** suggests real groups, clubs and places for the learner's *next* social levels:
level 1 -> (2) friends, school and work, then (3) the local community; level 2 -> community; level 3 -> keep growing the community.

* **SerpAPI** (`SERPAPI_KEY`) does the discovery: Google web search (including `site:facebook.com/groups` to surface *public* Facebook groups),
  and Google Maps for places (e.g. the nearest fire stations for fire safety). Results are cached 24 h, the key never appears in errors or responses.
* **Facebook Login + Graph API** (`FACEBOOK_APP_ID`, `FACEBOOK_APP_SECRET`) is optional and used only for *user-consented profile signals*:
  name, location, hometown and how many friends also use this app. **The Graph API can no longer list or search groups**: Meta deprecated the
  Groups API in v19 and removed it, so group discovery cannot come from Facebook itself.
* The learner's own optional school / workplace / city fields cover what Facebook no longer shares.
* The LLM may only rank results by index and explain them; every URL comes from search results, never from the model. We only link out: nothing is
  scraped, posted or joined. The page shows exactly what will be sent before anything is searched, and what was searched afterwards.
* Facebook tokens live in server memory for an hour (HttpOnly session cookie, never sent to the browser), calls carry `appsecret_proof`, the OAuth
  `state` is one-time, **Disconnect** revokes the grant, and signed deauthorize / data-deletion callbacks are implemented
  (`/api/facebook/deauthorize`, `/api/facebook/data-deletion`). Register `FB_REDIRECT_URI` as a Valid OAuth Redirect URI in the Meta app
  (https is required outside localhost). `user_location`, `user_hometown` and `user_friends` need App Review, or developer/tester roles in development mode.
* Copy `.env.example` to `.env` for the keys. `.env` is gitignored: never commit it.

## Reusing the platform for another simulation family
Write new agents (or swap prompts/props/gestures), keep the `Context` + `Validator` pattern, and define a new spec model.

## Known gaps
- Skills are not certified. The spec carries a disclaimer shown at the end; have a subject-matter expert review curated skills, and treat LLM-designed skills (e.g. CPR) as drafts.
- Muse Spark path verified end to end (~50s for 3 acts). The Anthropic path is implemented but not run live.
- Player has not been exercised in a real browser/webcam; gesture thresholds need tuning on real hands.
- Resource URLs in `aep/library/resources.py` are curated by hand and should be link-checked before launch.
- Not yet true headset VR (WebXR); this is a desktop 3D first-person view with webcam hands.

## Ask a question while you play

The 🎤 **Ask** button (bottom-right) is push-to-talk: hold it (or hold **V**), speak, release. The browser records mono 16 kHz WAV and
posts it to `/api/transcribe`, which relays it to **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`, `POST /v1/asr/transcribe`,
`PUSH_TO_TALK`) so the API key never reaches the browser. `/api/ask` then has Muse Spark answer in at most three plain second-person
sentences, given the current act, skill, step and lesson point. Answers are shown as text, never spoken. With no mic or no key you can type
the question instead; offline, the answer is the step's lesson point.

## Create wizard and control plane

```
TALE / -> /create (11 answers) -> POST /api/training-programs -> Standardize -> AgentSpec -> Security/Policy -> Resources -> Evaluation -> Orchestrator -> pipeline -> /play.html?program=<id>
```

- `aep/control/standardize.py`: free text to a closed-vocabulary intent (LLM when online, keyword rules offline or if the LLM output fails validation).
- `aep/control/security.py`: the model may only recommend rules from a fixed list. `PolicyEngine` builds the policy (every tool denied unless the answers grant it; web search, messaging and sharing always need an approval) and enforces it with an audit log. Today it gates `/api/next-steps` (web search) and injects the "never" rules into `/api/ask`.
- `aep/control/compute.py`: model tiers and rebuild budget are derived, never asked. `max_rounds` is enforced; the per-agent model tiers are advisory (one model per provider today).
- `aep/control/evaluation.py`: criteria from the "how will you know it worked" answer, plus deterministic checks run on every built simulation.
- Programs are stored as JSON in `runs/programs/`. At most 3 build at once.
- Not yet real: knowledge sources are recorded (`status: declared`) but never read by the agents; there is no per-user auth on the API.
