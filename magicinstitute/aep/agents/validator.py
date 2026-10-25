from __future__ import annotations

import re

from pydantic import ValidationError

from aep.agents.base import Agent, Context
from aep.library import resources
from aep.library import visual_standard as vs
from aep.schema import SimulationSpec, known_prop_kinds

FIRST_PERSON = re.compile(r"\b(i|i'll|i’ll|i'm|i’m|i've|my|me|myself)\b", re.I)
SECOND_PERSON = re.compile(r"\byou(r|rs|rself)?\b|\byou're\b", re.I)


def voice_problems(acts) -> list[str]:
    """The learner is addressed as 'you': plain second-person narration, never first person."""
    out = []
    for a in acts:
        if not SECOND_PERSON.search(a.narrative):
            out.append(f"act {a.index} narrative must address the learner as 'you': {a.narrative[:60]!r}")
        for label, t in [("narrative", a.narrative)] + [(f"{i.step_id} prompt", i.prompt) for i in a.interactions]:
            if FIRST_PERSON.search(t):
                out.append(f"act {a.index} {label} must be second person ('you'), not first person: {t[:60]!r}")
    return out


class Validator(Agent):
    """Assembles the spec and enforces the contract and the visual/voice standards. Failures become feedback for another build round."""
    name = "validator"

    def execute(self, ctx: Context) -> None:
        a, r = ctx.artifacts, ctx.request
        problems: list[str] = []
        acts = a["acts"]
        if len(acts) != r.social_level:
            problems.append(f"need exactly {r.social_level} acts, got {len(acts)}")
        for act, skill in zip(acts, a.get("skills", [])):
            if [i.step_id for i in act.interactions] != [st.id for st in skill.steps]:
                problems.append(f"act {act.index} does not cover skill {skill.id} steps in order")
        if ctx.llm.online:   # offline templates are authored in second person already; LLM text is linted
            problems += voice_problems(acts)
        recipes = a.get("new_recipes", {})
        known = known_prop_kinds() | set(recipes)
        for act, scene in zip(acts, a["scenes"]):
            for p in scene.props:
                if p.kind not in known:
                    p.kind = "orb"  # safe degrade; player can always render an orb
            problems += vs.scene_problems(scene, [i.target_prop for i in act.interactions])
        spec = None
        if not problems:
            try:
                b = a["brief"]
                from aep.library import assets
                lib = assets.library()
                used = {p.kind for s in a["scenes"] for p in s.props}
                inline = [rec for k, rec in {**lib, **recipes}.items() if k in used]
                spec = SimulationSpec(title=b.title, tagline=b.tagline, player_character=b.player_character, intro=b.intro, request=r,
                                      learning_objectives=b.learning_objectives, scenes=a["scenes"], acts=acts, recipes=inline,
                                      resources=resources.for_topic(r.topic, a.get("queries")))
            except ValidationError as e:
                problems.append("; ".join(err["msg"] for err in e.errors()))
        a["problems"] = problems
        a["spec"] = spec
        a["validation_feedback"] = ("Previous attempt failed validation: " + " | ".join(problems)) if problems else ""
