"""Orchestrates the agents. Reusable: swap the agent list for a different simulation family."""
from __future__ import annotations

import json
import time
import uuid
from pathlib import Path

from aep.agents.base import Context
from aep.library import assets
from aep.agents.builder import WorldBuilder
from aep.agents.director import Director
from aep.agents.guide import ResourceScout
from aep.agents.skill_designer import SkillDesigner
from aep.agents.storyteller import Storyteller
from aep.agents.validator import Validator
from aep.llm import LLM
from aep.schema import SimulationRequest, SimulationSpec

RUNS = Path(__file__).resolve().parent.parent / "runs"
MAX_ROUNDS = 3


def build_simulation(request: SimulationRequest, llm: LLM | None = None, *, save: bool = True, max_rounds: int = MAX_ROUNDS) -> tuple[SimulationSpec, list[dict]]:
    ctx = Context(request=request, llm=llm or LLM())
    Director().run(ctx)
    ResourceScout().run(ctx)
    SkillDesigner().run(ctx)
    for round_ in range(1, max_rounds + 1):
        Storyteller().run(ctx)
        WorldBuilder().run(ctx)
        Validator().run(ctx)
        ctx.trace.append({"round": round_, "problems": ctx.artifacts["problems"]})
        if ctx.artifacts["spec"]:
            break
    spec = ctx.artifacts["spec"]
    if spec is None:
        raise RuntimeError(f"could not build a valid simulation: {ctx.artifacts['problems']}")
    saved = []
    for kind, recipe in ctx.artifacts.get("new_recipes", {}).items():
        ok, _ = assets.save_candidate(recipe, source=f"{spec.title} ({request.world})") if save else (False, [])
        if ok:
            saved.append(kind)
    ctx.trace.append({"new_assets": saved})
    if save:
        RUNS.mkdir(exist_ok=True)
        run_id = f"{int(time.time())}-{uuid.uuid4().hex[:6]}"
        (RUNS / f"{run_id}.json").write_text(json.dumps({"spec": spec.model_dump(mode="json"), "trace": ctx.trace}, indent=2))
    return spec, ctx.trace
