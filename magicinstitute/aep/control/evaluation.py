"""Evaluation: criteria derived from what the organization said success looks like, plus deterministic checks run on every built simulation."""
from __future__ import annotations

from aep.agents.validator import voice_problems
from aep.control.security import Policy
from aep.control.spec import EvalCheck, EvalCriterion, Evaluation
from aep.control.standardize import Standardized
from aep.schema import SimulationSpec


def plan(std: Standardized) -> Evaluation:
    crit = [EvalCriterion(name=s, measure="Judged by the training agent from each play-through's recorded events.") for s in std.success]
    crit.append(EvalCriterion(name="Every taught step is performed in order", measure="Interactions cover the skill steps exactly."))
    return Evaluation(criteria=crit)


def check_build(ev: Evaluation, spec: SimulationSpec, std: Standardized, policy: Policy) -> Evaluation:
    voice = voice_problems(spec.acts)
    checks = [
        EvalCheck(id="contract_valid", passed=True, detail="SimulationSpec validated."),
        EvalCheck(id="levels_match", passed=len(spec.acts) == std.social_level, detail=f"{len(spec.acts)} acts for level {std.social_level}."),
        EvalCheck(id="steps_covered", passed=all([i.step_id for i in a.interactions] == [s.id for s in a.skill.steps] for a in spec.acts)),
        EvalCheck(id="second_person", passed=not voice, detail="; ".join(voice[:2])),
        EvalCheck(id="guardrails_enforced", passed=set(std.never) <= set(policy.rules), detail="Every 'never' rule is in the enforced policy."),
        EvalCheck(id="tools_deny_by_default", passed=all(v == "deny" for t, v in policy.tools.items()
                                                       if t not in std.capabilities and t not in std.needs_permission and t not in ("create_scenarios", "read_simulation"))),
    ]
    return ev.model_copy(update={"checks": checks})
