from __future__ import annotations

import time
from dataclasses import dataclass, field
from typing import Any

from aep.llm import LLM
from aep.schema import SimulationRequest


@dataclass
class Context:
    """Shared state for one pipeline run. Agents read upstream artifacts and write their own."""
    request: SimulationRequest
    llm: LLM
    artifacts: dict[str, Any] = field(default_factory=dict)
    trace: list[dict] = field(default_factory=list)


class Agent:
    name = "agent"

    def run(self, ctx: Context) -> None:
        t0 = time.time()
        mode = "llm" if ctx.llm.online else "offline"
        self.execute(ctx)
        ctx.trace.append({"agent": self.name, "mode": mode, "seconds": round(time.time() - t0, 3)})

    def execute(self, ctx: Context) -> None:
        raise NotImplementedError
