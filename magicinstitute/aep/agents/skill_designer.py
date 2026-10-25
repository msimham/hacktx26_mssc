from __future__ import annotations

from pydantic import BaseModel, Field

from aep.agents.base import Agent, Context
from aep.library import gestures as gz
from aep.library import skills as curated
from aep.library import assets
from aep.library.visual_standard import KIND_NOTES
from aep.schema import Gesture, Skill, SkillStep, known_prop_kinds


class SkillSet(BaseModel):
    skills: list[Skill] = Field(min_length=3, max_length=3)


class SkillDesigner(Agent):
    """Decides WHAT is taught: three ordered real-world skills (self, friends/team, community).
    Uses a curated skill when we have one for the topic; otherwise designs one with the LLM."""
    name = "skill_designer"

    def execute(self, ctx: Context) -> None:
        r = ctx.request
        found = curated.for_topic(r.topic)
        if found:
            ctx.artifacts["skills"], ctx.artifacts["skill_source"] = found, "curated"
        elif ctx.llm.online:
            brief = ctx.artifacts["brief"]
            out = ctx.llm.structured(
                "You are an instructional designer. Design three real-world skills for this topic, taught in a VR sim by hand "
                "gestures. Each skill is an ordered procedure of 4-8 steps that is ACCURATE and matches standard, widely taught "
                "practice for the topic (cite a source_url only if you are certain it exists, else leave it empty). Skill 1 is done "
                "alone (level 1), skill 2 helps a friend or teammate (level 2), skill 3 involves a larger community (level 3). Every "
                f"step has a gesture from {[g.value for g in Gesture]} ({'; '.join(f'{k}: {v}' for k, v in gz.HOWTO.items())}) and a "
                f"prop_kind from {sorted(known_prop_kinds())} naming the object the gesture is done at. {gz.GUIDANCE} "
                "Any PERSON being helped is always prop_kind 'npc' (never a chest or orb); calling for help is 'phone'; alarms and call points are 'alarm'. "
                f"What each kind looks like: {KIND_NOTES}. Step ids are snake_case. Consecutive steps must not repeat the same gesture on the same prop_kind. Pick prop kinds that fit "
                "(alarm, door, npc, map_table, phone, orb are flexible stand-ins). 'why' states the real-world reason plainly, no fantasy. "
                "line is ONE plain second-person prompt in the form '<question>? <what you should do>.' e.g. \"Where do you aim? At the base of the fire. Point the nozzle low.\" "
                "No fluff, no jokes, no first person.",
                f"Topic: {r.topic}\nAudience: {r.audience}\nPlayer character: {brief.player_character}", SkillSet, max_tokens=12000)
            for i, sk in enumerate(out.skills, 1):
                sk.level = i
            ctx.artifacts["skills"], ctx.artifacts["skill_source"] = out.skills, "llm"
        else:
            def st(id, name, action, g, k, line):
                return SkillStep(id=id, name=name, action=action, why="placeholder", gesture=g, prop_kind=k, line=line)
            ctx.artifacts["skills"] = [
                Skill(id=f"skill{i}", level=i, name=n, goal=f"(Placeholder: set an API key for real {r.topic} content.)", steps=[
                    st("one", "Step one", "Grab the glowing orb.", "grab", "orb", "What do you do first? Take the glowing orb. Grab it."),
                    st("two", "Step two", "Point at the guide.", "point", "npc", "Who helps you? Your guide. Point at them."),
                    st("three", "Step three", "Sweep your hand across the path.", "sweep", "path", "How do you clear the way? Sweep your hand across the path.")])
                for i, n in enumerate(["On your own", "With friends", "As a community"], 1)]
            ctx.artifacts["skill_source"] = "placeholder"
        ctx.artifacts["skills"] = ctx.artifacts["skills"][: r.social_level]
