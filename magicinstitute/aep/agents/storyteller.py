from __future__ import annotations

from pydantic import BaseModel, Field

from aep.agents.base import Agent, Context
from aep.library import skills as curated
from aep.schema import Act, Interaction


class StepScript(BaseModel):
    step_id: str
    prompt: str          # plain second person: a short question, then what you should do ("Where do you aim? At the base. Point low.")
    success_text: str    # one short confirmation that names the right action ("Correct. You aimed at the base.")
    fail_hint: str       # one short second-person tip ("Face the extinguisher and close your hand.")
    prop_label: str      # short in-world name for the prop used, e.g. "Enchanted extinguisher"


class ActScript(BaseModel):
    title: str
    narrative: str       # 1-3 plain second-person sentences setting the scene, ending with 'What would you do?'
    steps: list[StepScript] = Field(min_length=1)


class Story(BaseModel):
    acts: list[ActScript]


class Storyteller(Agent):
    """Wraps each skill in a short scenario narrated to the learner in the second person. The STEPS are fixed by the skill;
    this agent only writes the words around them. Interactions are assembled in code from the skill, so no step can
    be dropped, reordered or invented."""
    name = "storyteller"

    def execute(self, ctx: Context) -> None:
        r, skills, brief = ctx.request, ctx.artifacts["skills"], ctx.artifacts["brief"]
        if ctx.llm.online:
            story = ctx.llm.structured(
                f"You write the scenario text of a Disney-style fantasy VR training sim. THE LEARNER PLAYS {brief.player_character} and is addressed in the SECOND PERSON "
                "('You are...', 'What would you do?', 'You should...'). Be plain, direct and short: no puns, no baby talk, no filler, no first person. "
                "Each act teaches one real skill whose steps are fixed. For EVERY step of the act's skill, in order, write one StepScript with the same step_id: "
                "a prompt that asks a short question and then says what you should do (faithful to the step's action and motion), a one-line confirmation, "
                "a one-line tip, and a prop_label. The narrative sets the scene in 1-3 sentences and ends with 'What would you do?'. Keep the real procedure "
                "intact and accurate; fantasy is only the setting. Example prompt: \"Where do you aim? At the base of the fire. Point the nozzle low.\"",
                f"Brief: {brief.model_dump_json()}\nWorld: {r.world}\nAudience: {r.audience}\n"
                f"Skills (one act each, in order): {[s.model_dump(mode='json') for s in skills]}\n"
                f"{ctx.artifacts.get('validation_feedback', '')}", Story, max_tokens=14000)
            scripts = story.acts
        else:
            scripts = [self._offline(s, r.world, brief.player_character) for s in skills]
        acts = []
        for i, (skill, sc) in enumerate(zip(skills, scripts), 1):
            by_id = {x.step_id: x for x in sc.steps}
            its = []
            for step in skill.steps:
                x = by_id.get(step.id) or StepScript(step_id=step.id, prompt=step.line or step.action,
                                                      success_text=f"Correct: that is how you {step.name[0].lower() + step.name[1:]}.", fail_hint=step.action,
                                                      prop_label=step.prop_kind.replace("_", " ").title())
                its.append(Interaction(id=f"a{i}_{step.id}", prompt=x.prompt, gesture=step.gesture, target_prop=step.prop_kind,
                                       success_text=x.success_text, fail_hint=x.fail_hint, learning_point=step.why,
                                       step_id=step.id, step_name=step.name))
            ctx.artifacts.setdefault("prop_labels", {}).setdefault(i, {}).update(
                {st.prop_kind: by_id[st.id].prop_label for st in skill.steps if st.id in by_id})
            acts.append(Act(index=i, social_level=skill.level, title=sc.title, scene_id=f"act{i}", skill=skill,
                            narrative=sc.narrative, interactions=its))
        ctx.artifacts["acts"] = acts

    @staticmethod
    def _offline(skill, world: str, who: str) -> ActScript:
        hook = curated.FIRE_HOOKS.get(skill.id, f"You are {{who}}. In {world}, you set out to learn how to {skill.goal[0].lower() + skill.goal[1:]} What would you do?").format(who=who)
        return ActScript(title=skill.name, narrative=hook,
                         steps=[StepScript(step_id=s.id, prompt=s.line or s.action,
                                           success_text=f"Correct: that is how you {s.name[0].lower() + s.name[1:]}.", fail_hint=s.action,
                                           prop_label=_LABELS.get(s.prop_kind, s.prop_kind.replace("_", " ").title())) for s in skill.steps])


_LABELS = {"extinguisher": "Royal extinguisher", "fire": "Dragon fire", "alarm": "Wall alarm", "exit_sign": "Exit", "blanket": "Fire blanket",
           "npc": "Your friend", "phone": "Candlestick phone", "map_table": "Castle floor plan", "door": "Door", "stairs": "Stairs",
           "assembly_point": "Meeting spot"}

