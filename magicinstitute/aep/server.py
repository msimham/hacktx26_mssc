from __future__ import annotations

import os
from pathlib import Path

from typing import Literal
from urllib.parse import parse_qs

from fastapi import BackgroundTasks, FastAPI, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel
from fastapi.staticfiles import StaticFiles

from aep.control import orchestrator
from aep.control.security import RULE_TEXT, PolicyDenied, PolicyEngine
from aep.control.standardize import TrainingAnswers
from aep.library import assets
from aep.llm import LLM
from aep.pipeline import build_simulation
from aep.schema import PROP_KINDS, SimulationRequest
from aep.social import ladder
from aep.social.facebook import FacebookError, FacebookGraph, Sessions
from aep.social.serp import SerpClient
from aep import voice

ROOT = Path(__file__).resolve().parent.parent
app = FastAPI(title="Magic Institute for Societal Safety")
llm = LLM()
serp, fb, sessions = SerpClient(), FacebookGraph(), Sessions()
COOKIE = "aep_fb"
programs = orchestrator.Store()


@app.get("/api/health")
def health():
    return {"ok": True, "llm": llm.provider or "offline (set MUSE_API_KEY or ANTHROPIC_API_KEY)", "prop_kinds": PROP_KINDS}


@app.post("/api/simulations")
def create(req: SimulationRequest):
    try:
        spec, trace = build_simulation(req, llm)
    except RuntimeError as e:
        raise HTTPException(502, str(e))
    return {"spec": spec, "trace": trace}


# ---- platform API: the frontend's only door. Control plane (standardize, secure, plan, evaluate) -> orchestrator -> agent runtime ------
def _view(p: orchestrator.Program) -> dict:
    """What the browser may see: progress always; the spec and simulation only once ready. Raw answers are not echoed back."""
    out = {"id": p.id, "status": p.status, "phases": [x.model_dump() for x in p.phases], "error": p.error}
    if p.status == "ready":
        out |= {"spec": p.spec.model_dump(mode="json"), "simulation": p.simulation}
    return out


@app.post("/api/training-programs", status_code=202)
def create_program(body: dict, tasks: BackgroundTasks):
    try:
        answers = TrainingAnswers.model_validate(body.get("answers", {}))
        p = programs.add(answers)
    except orchestrator.TooBusy:
        raise HTTPException(429, "The platform is building other trainings right now. Try again in a minute.")
    except ValueError as e:
        raise HTTPException(422, f"Every question needs an answer: {e}")
    tasks.add_task(orchestrator.run, p, llm, programs)
    return _view(p)


@app.get("/api/training-programs/{pid}")
def get_program(pid: str):
    p = programs.get(pid)
    if not p:
        raise HTTPException(404, "no such training")
    return _view(p)


def _policy(pid: str):
    p = programs.get(pid) if pid else None
    return p, (p.spec.policy if p and p.spec else None)


@app.get("/api/assets")
def list_assets():
    """Reusable asset library: approved recipes (used by later builds) and candidates awaiting approval."""
    return {"library": {k: r.model_dump(mode="json") for k, r in assets.library().items()},
            "candidates": {k: d["recipe"] for k, d in assets.candidates().items()}}


@app.post("/api/assets/{kind}/approve")
def approve_asset(kind: str):
    if not assets.approve(kind):
        raise HTTPException(404, "no such candidate")
    return {"approved": kind}


@app.delete("/api/assets/{kind}")
def remove_asset(kind: str):
    if not assets.remove(kind):
        raise HTTPException(404, "no such asset")
    return {"removed": kind}


# ---- social ladder: SerpAPI discovery + user-consented Facebook profile signals -------------------------------------------------------
class NextStepsRequest(BaseModel):
    topic: str
    audience: str = ""
    social_level: Literal[1, 2, 3]                      # the level the learner just completed
    circle: ladder.Circle = ladder.Circle()
    use_facebook: bool = False
    program_id: str = ""            # when given, this training's policy gates the web search
    approved: bool = False          # the learner pressed Find your people after reading what would be sent


def _fb_session(request: Request):
    return sessions.get(request.cookies.get(COOKIE))


@app.get("/api/facebook/status")
def fb_status(request: Request):
    sess = _fb_session(request)
    base = {"configured": fb.enabled, "connected": bool(sess)}
    if sess:      # never the Facebook id or the token
        p = sess["profile"]; base |= {"name": p.name, "location": p.location, "hometown": p.hometown, "friends_using_app": p.friends_using_app, "granted": p.granted}
    return base


@app.get("/api/facebook/login")
def fb_login():
    if not fb.enabled:
        raise HTTPException(503, "Facebook login is not configured (set FACEBOOK_APP_ID and FACEBOOK_APP_SECRET)")
    return RedirectResponse(fb.login_url(sessions.new_state()))


@app.get("/api/facebook/callback")
def fb_callback(request: Request, code: str | None = None, state: str | None = None, error: str | None = None):
    if error or not code:
        return RedirectResponse("/play.html?fb=denied")
    if not sessions.consume_state(state):
        raise HTTPException(400, "Invalid or expired login state")
    try:
        token = fb.exchange_code(code)
        profile = fb.profile(token)
    except FacebookError as e:
        raise HTTPException(502, str(e))
    resp = RedirectResponse("/play.html?fb=connected")
    resp.set_cookie(COOKIE, sessions.create(token, profile), httponly=True, samesite="lax", max_age=3600, secure=request.url.scheme == "https")
    return resp


@app.post("/api/facebook/disconnect")
def fb_disconnect(request: Request):
    gone = sessions.drop(request.cookies.get(COOKIE))
    if gone and fb.enabled:
        fb.revoke(gone["token"])
    return {"connected": False}


async def _signed(request: Request) -> dict:
    form = parse_qs((await request.body()).decode())
    try:
        return fb.parse_signed_request(form.get("signed_request", [""])[0])
    except FacebookError as e:
        raise HTTPException(400, str(e))


@app.post("/api/facebook/deauthorize")
async def fb_deauthorize(request: Request):
    sessions.drop_user(str((await _signed(request)).get("user_id", "")))
    return {"ok": True}


@app.post("/api/facebook/data-deletion")
async def fb_data_deletion(request: Request):
    uid = str((await _signed(request)).get("user_id", "")); sessions.drop_user(uid)
    code = f"del-{uid[-6:]}-{int(__import__('time').time())}"
    return {"url": f"{request.base_url}api/facebook/deletion-status?code={code}", "confirmation_code": code}


@app.get("/api/facebook/deletion-status")
def fb_deletion_status(code: str):
    return {"confirmation_code": code, "status": "deleted", "detail": "This app keeps Facebook data only in memory for the session; it has been removed."}


@app.post("/api/next-steps")
def next_steps(req: NextStepsRequest, request: Request):
    prog, policy = _policy(req.program_id)
    if prog and policy:
        try:
            PolicyEngine.enforce(policy, "web_search", approved=req.approved, audit=prog.audit)
        except PolicyDenied as e:
            raise HTTPException(403, str(e))
        finally:
            programs.save(prog)
    circle = req.circle.model_copy()
    used_fb = None
    sess = _fb_session(request) if req.use_facebook else None
    if sess:
        p = sess["profile"]
        if not circle.city:
            circle.city = p.location or p.hometown
        used_fb = {"name": p.name, "location_used": bool(p.location or p.hometown)}
    out = ladder.suggest(req.topic, req.audience, circle, req.social_level, serp, llm)
    return {**out.model_dump(mode="json"), "facebook": used_fb}




@app.get("/api/voice/status")
def voice_status():
    return {"transcribe": bool(os.environ.get("MUSE_API_KEY")), "answers": llm.online}


@app.post("/api/transcribe")
async def transcribe(request: Request):
    key = os.environ.get("MUSE_API_KEY")
    if not key:
        raise HTTPException(503, "Voice needs MUSE_API_KEY. You can type your question instead.")
    body = await request.body()
    try:
        return {"text": voice.transcribe(body, key)}
    except voice.VoiceError as e:
        raise HTTPException(422, str(e))


class AskRequest(BaseModel):
    question: str
    context: voice.AskContext = voice.AskContext()
    program_id: str = ""


@app.post("/api/ask")
def ask(req: AskRequest):
    q = req.question.strip()
    if not q:
        raise HTTPException(422, "Ask a question first.")
    try:
        _, policy = _policy(req.program_id)
        return {"answer": voice.answer(q, req.context, llm, rules=[RULE_TEXT[r] for r in policy.rules if r in RULE_TEXT] if policy else [])}
    except RuntimeError:
        raise HTTPException(502, "The guide could not answer right now. Try again.")


# static mounts last so they never shadow the API routes
app.mount("/vendor/three", StaticFiles(directory=ROOT / "node_modules" / "three"), name="three")
app.mount("/", StaticFiles(directory=ROOT / "web", html=True), name="web")
