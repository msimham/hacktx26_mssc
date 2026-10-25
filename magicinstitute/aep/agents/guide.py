from __future__ import annotations

from pydantic import BaseModel

from aep.agents.base import Agent, Context


class Queries(BaseModel):
    queries: list[str]


class ResourceScout(Agent):
    """Suggests extra search queries for real-world follow-up. Links come from the curated catalog + search URLs only."""
    name = "resource_scout"

    def execute(self, ctx: Context) -> None:
        r = ctx.request
        if not ctx.llm.online:
            return
        q = ctx.llm.structured(
            "Suggest 2 short web search queries that help a learner take real-world action after this training.",
            f"Topic: {r.topic}\nAudience: {r.audience}\nCountry: {r.country}", Queries, max_tokens=2000)
        ctx.artifacts["queries"] = q.queries[:2]
