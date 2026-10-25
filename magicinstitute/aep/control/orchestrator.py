"""Orchestrator: decides what runs when. Control-plane stages build the AgentSpec in order, then the runtime pipeline executes it.
Each stage is one phase the UI can show; a failure marks that phase and stops."""
from __future__ import annotations

import json
import re
import threading
import time
import uuid
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

from aep import pipeline
from aep.control import compute, evaluation, security
from aep.control.spec import AGENTS, WORKFLOW, AgentRole, AgentSpec, KnowledgeSource, Workflow
from aep.control.standardize import Standardized, TrainingAnswers, standardize
from aep.llm import LLM
from aep.schema import SimulationRequest

PROGRAMS = pipeline.RUNS / "programs"
ID_RE = re.compile(r"^[a-f0-9]{12}$")
MAX_BUILDING = 3

PHASES = [("understand", "Understanding your training goals"), ("design", "Designing agent responsibilities"),
          ("knowledge", "Registering your knowledge sources"), ("security", "Applying security policies"),
          ("resources", "Selecting models & resources"), ("evaluation", "Creating evaluation tests"), ("workflow", "Building agent workflow")]


class Phase(BaseModel):
    id: str
    label: str
    status: Literal["pending", "running", "done", "failed"] = "pending"


class Program(BaseModel):
    id: str
    status: Literal["building", "ready", "failed"] = "building"
    phases: list[Phase]
    error: str = ""
    created: float = Field(default_factory=time.time)
    answers: TrainingAnswers
    standardized_by: str = ""
    spec: AgentSpec | None = None
    simulation: dict | None = None      # {"spec": SimulationSpec, "trace": [...]}: what the player renders
    audit: list[dict] = Field(default_factory=list)


class TooBusy(Exception):
    pass


class Store:
    """In-memory with a JSON copy on disk, so a finished program survives a server restart."""

    def __init__(self, root: Path = PROGRAMS):
        self.root, self._items, self._lock = root, {}, threading.Lock()

    def add(self, answers: TrainingAnswers) -> Program:
        with self._lock:
            if sum(p.status == "building" for p in self._items.values()) >= MAX_BUILDING:
                raise TooBusy
            p = Program(id=uuid.uuid4().hex[:12], answers=answers, phases=[Phase(id=i, label=l) for i, l in PHASES])
            self._items[p.id] = p
        return p

    def get(self, pid: str) -> Program | None:
        if not ID_RE.match(pid):
            return None
        if pid in self._items:
            return self._items[pid]
        f = self.root / f"{pid}.json"
        if f.exists():
            self._items[pid] = Program.model_validate_json(f.read_text())
            return self._items[pid]
        return None

    def save(self, p: Program) -> None:
        self.root.mkdir(parents=True, exist_ok=True)
        (self.root / f"{p.id}.json").write_text(p.model_dump_json(indent=2))


def _knowledge(std: Standardized) -> list[KnowledgeSource]:
    return [KnowledgeSource(name=n) for n in std.knowledge]


def run(program: Program, llm: LLM, store: Store) -> None:
    """Executes the phases in order. Never raises: failures are recorded on the program for the UI."""
    ph = {p.id: p for p in program.phases}
    ctx: dict = {}

    def step(pid: str, fn: Callable[[], None]) -> None:
        ph[pid].status = "running"; store.save(program)
        fn()
        ph[pid].status = "done"; store.save(program)

    def understand():
        ctx["std"], program.standardized_by = standardize(program.answers, llm)

    def design():
        ctx["roles"] = [AgentRole(name=n, responsibility=r) for n, r in AGENTS]

    def knowledge():
        ctx["knowledge"] = _knowledge(ctx["std"])

    def secure():
        ctx["policy"] = security.PolicyEngine().build(ctx["std"], security.SecurityAgent().review(ctx["std"], llm))

    def resources():
        ctx["resources"] = compute.plan(ctx["std"])

    def evals():
        ctx["eval"] = evaluation.plan(ctx["std"])

    def workflow():
        std = ctx["std"]
        req = SimulationRequest(topic=std.topic, audience=std.audience, world=std.world, social_level=std.social_level)
        sim, trace = pipeline.build_simulation(req, llm, max_rounds=ctx["resources"].max_rounds)
        program.spec = AgentSpec(
            purpose=f"Adaptive {std.topic} training for {std.audience}", intent=std, agents=ctx["roles"], workflow=Workflow(steps=WORKFLOW),
            knowledge=ctx["knowledge"], policy=ctx["policy"], resources=ctx["resources"],
            evaluation=evaluation.check_build(ctx["eval"], sim, std, ctx["policy"]))
        program.simulation = {"spec": sim.model_dump(mode="json"), "trace": trace}

    current = ""
    try:
        for pid, fn in [("understand", understand), ("design", design), ("knowledge", knowledge), ("security", secure),
                        ("resources", resources), ("evaluation", evals), ("workflow", workflow)]:
            current = pid
            step(pid, fn)
        program.status = "ready"
    except Exception as e:                      # noqa: BLE001: surface any failure to the UI instead of dying in a worker thread
        ph[current].status = "failed"
        program.status, program.error = "failed", str(e)[:400]
    store.save(program)
