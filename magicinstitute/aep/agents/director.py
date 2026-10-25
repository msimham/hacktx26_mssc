from __future__ import annotations

from pydantic import BaseModel

from aep.agents.base import Agent, Context

PRINCESS = {"sleeping beauty": "Sleeping Beauty", "cinderella": "Cinderella", "snow white": "Snow White", "rapunzel": "Rapunzel",
            "belle": "Belle", "frozen": "Elsa", "ariel": "Ariel", "moana": "Moana", "mulan": "Mulan", "tangled": "Rapunzel"}


class Brief(BaseModel):
    title: str
    tagline: str
    player_character: str            # the heroine the learner plays, e.g. "Sleeping Beauty". The learner is addressed as 'you'.
    intro: str                       # second person, plain, 1-2 sentences: 'You are <heroine>. ...'
    learning_objectives: list[str]   # 3-5, concrete and behavioral
    tone_notes: str                  # how to keep it magical and age-appropriate for the audience


class Director(Agent):
    """Turns raw user choices into a creative + pedagogical brief the other agents share."""
    name = "director"

    def execute(self, ctx: Context) -> None:
        r = ctx.request
        if not ctx.llm.online:
            who = next((v for k, v in PRINCESS.items() if k in r.world.lower()), f"the hero of {r.world}")
            ctx.artifacts["brief"] = Brief(
                title=f"{r.world}: {r.topic.title()} Quest", tagline=f"A fairytale lesson in {r.topic}.", player_character=who,
                intro=f"You are {who}. In this story you will learn {r.topic}, so you know exactly what to do when it matters.",
                learning_objectives=[f"Recognize {r.topic} risks", "Act correctly alone, with friends, and with a community"],
                tone_notes="Whimsical, warm, never frightening.")
            return
        ctx.artifacts["brief"] = ctx.llm.structured(
            "You are the creative director and instructional designer for an enchanted, Disney-style VR training "
            "experience. THE LEARNER IS THE MAIN CHARACTER: pick the heroine of the chosen world (e.g. Sleeping Beauty for "
            "'Sleeping Beauty') as player_character and address the learner in the SECOND PERSON: intro starts 'You are <heroine>.' "
            "Plain and direct: no puns, no baby talk, no filler. "
            "Be factually accurate about the training topic; keep the tone magical and never graphic.",
            f"Topic: {r.topic}\nAudience: {r.audience}\nWorld: {r.world}\nSocial level reached: {r.social_level} "
            f"(1=self, 2=friends/team, 3=community).", Brief)
