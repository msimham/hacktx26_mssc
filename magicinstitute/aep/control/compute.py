"""Resource planner: the user never picks models or infrastructure. Values here are derived from the intent; only the knobs the runtime
honors are marked as enforced in `notes`."""
from __future__ import annotations

from aep.control.spec import AGENTS, ResourcePlan
from aep.control.standardize import Standardized

# Tiers are advisory until the LLM wrapper routes per agent (it uses one model per provider today).
TIERS = {"Director": "reasoning_model", "ResourceScout": "fast_model", "SkillDesigner": "fast_model",
         "Storyteller": "quality_model", "WorldBuilder": "fast_model", "Validator": "reasoning_model"}


def plan(std: Standardized) -> ResourcePlan:
    """More people means a longer, richer simulation, so favor quality and allow the full rebuild budget; a solo run favors speed."""
    big = std.social_level == 3
    return ResourcePlan(
        model_strategy={name: TIERS[name] for name, _ in AGENTS},
        max_rounds=3,
        optimization="quality" if big else "balanced",
        notes=["max_rounds is enforced by the runtime.", "model_strategy is advisory: the runtime currently uses one model per provider."])
