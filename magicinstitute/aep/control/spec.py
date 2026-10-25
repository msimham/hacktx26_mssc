"""The AgentSpec: the one contract between every control-plane stage and the runtime. Stages add their section; none talk to each other."""
from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field

from aep.control.security import Policy
from aep.control.standardize import Standardized

# The runtime workers. They are workers inside the platform, not the platform.
AGENTS = [
    ("Director", "Turns the training goal into a brief and learning objectives."),
    ("ResourceScout", "Finds real-world resources to point learners to."),
    ("SkillDesigner", "Designs the ordered skills the simulation teaches."),
    ("Storyteller", "Writes the second-person scenario narrative and prompts."),
    ("WorldBuilder", "Lays out the 3D environment, props and characters."),
    ("Validator", "Checks the scenario against the contract and sends failures back for a rebuild."),
]
WORKFLOW = ["Director", "ResourceScout", "SkillDesigner", "Storyteller", "WorldBuilder", "Validator"]


class AgentRole(BaseModel):
    name: str
    responsibility: str


class Workflow(BaseModel):
    type: Literal["conditional"] = "conditional"
    steps: list[str]
    retry: str = "Validator FAIL sends feedback to Storyteller and WorldBuilder for a rebuild, up to max_rounds."


class KnowledgeSource(BaseModel):
    name: str
    # Declared by the organization; nothing is ingested yet. The runtime does not read these until a connector exists.
    status: Literal["declared"] = "declared"


class ResourcePlan(BaseModel):
    model_strategy: dict[str, str]
    max_rounds: int = Field(ge=1, le=3)
    optimization: Literal["quality", "balanced", "speed"]
    notes: list[str] = Field(default_factory=list)


class EvalCriterion(BaseModel):
    name: str
    measure: str


class EvalCheck(BaseModel):
    id: str
    passed: bool
    detail: str = ""


class Evaluation(BaseModel):
    criteria: list[EvalCriterion]
    checks: list[EvalCheck] = Field(default_factory=list)

    @property
    def passed(self) -> bool:
        return bool(self.checks) and all(c.passed for c in self.checks)


class AgentSpec(BaseModel):
    purpose: str
    intent: Standardized
    agents: list[AgentRole]
    workflow: Workflow
    knowledge: list[KnowledgeSource]
    policy: Policy
    resources: ResourcePlan
    evaluation: Evaluation
    outputs: list[str] = ["scenario", "evaluation", "adaptation"]
