"""The contract between the platform and any simulation front end.

The request is what the user picks; the SimulationSpec is what the agent
pipeline emits and what the VR player renders. Nothing else crosses the boundary.
"""
from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator


class Gesture(str, Enum):
    """Hand vocabulary. Static poses are held ~0.6s; dynamic ones are completed by a purposeful motion."""
    # static poses
    GRAB = "grab"              # closed fist, held briefly
    SQUEEZE = "squeeze"        # closed fist, held firmly ~1.2s
    POINT = "point"            # index finger out
    OPEN_PALM = "open_palm"    # all fingers spread
    THUMBS_UP = "thumbs_up"
    PEACE = "peace"            # index + middle in a V ("two of something")
    PHONE = "phone"            # thumb + pinky out ("call")
    PINCH = "pinch"            # thumb + index together
    # dynamic motions
    PULL = "pull"              # pinch or fist, then pull DOWN
    PUSH = "push"              # open palm pushed toward the screen
    LIFT = "lift"              # fist raised UP
    SWEEP = "sweep"            # closed fist swept side to side
    WAVE = "wave"              # open palm swung side to side
    SWIPE = "swipe"            # open palm flicked quickly one way
    TRACE = "trace"            # index finger drawn across (e.g. a route)
    CIRCLE = "circle"          # index finger drawing a circle


DYNAMIC_GESTURES = {Gesture.PULL, Gesture.PUSH, Gesture.LIFT, Gesture.SWEEP, Gesture.WAVE, Gesture.SWIPE, Gesture.TRACE, Gesture.CIRCLE}


# Prop kinds the player knows how to build from primitives. The LLM may only use these.
PROP_KINDS = [
    "extinguisher", "blanket", "fire", "smoke", "door", "stairs", "map_table", "torch", "tree", "banner", "tower",
    "wall", "bed", "rose", "gate", "path", "exit_sign", "assembly_point", "alarm", "npc", "orb",
    "phone", "sofa", "chest", "crown", "lantern", "book", "table",
]
EXTRA_KINDS: set[str] = set()   # kinds contributed by approved library assets (see aep.library.assets)


def known_prop_kinds() -> set[str]:
    return set(PROP_KINDS) | EXTRA_KINDS


SETS = ["castle", "ballroom", "lodge", "modern"]


class SimulationRequest(BaseModel):
    topic: str = Field(min_length=2, examples=["fire safety"])
    audience: str = Field(min_length=2, examples=["college students"])
    world: str = Field(min_length=2, examples=["Sleeping Beauty"])
    social_level: Literal[1, 2, 3] = Field(
        description="1 = self, 2 = friends/team, 3 = larger community. Cumulative: level N plays acts 1..N."
    )
    country: str = "US"


class Vec3(BaseModel):
    x: float = 0
    y: float = 0
    z: float = 0


class Prop(BaseModel):
    id: str
    kind: str
    label: str = ""
    position: Vec3 = Field(default_factory=Vec3)
    color: str = "#ffd166"
    scale: float = 1.0
    rotation_y: float = 0       # radians about the vertical axis (wall-mounted props face into the room)
    variant: str = ""           # npc only: "child" | "woman" | "man" (which rigged character model)


class Palette(BaseModel):
    """Theme colours the hall set is tinted with. Defaults are the reference storybook look."""
    stone: str = "#8362ad"
    trim: str = "#dfa954"
    carpet: str = "#8f235f"
    accent: str = "#9ab7ed"      # stained glass
    marble: str = "#d7afd6"


class Environment(BaseModel):
    sky: str = "#2b1b4d"
    fog: str = "#3a2a66"
    ground: str = "#4b3a7a"
    light: str = "#ffe8b0"
    ambient: str = "a moonlit, glittering castle"


class Scene(BaseModel):
    id: str
    name: str
    set: Literal["castle", "ballroom", "lodge", "modern"] = "castle"
    palette: Palette = Field(default_factory=Palette)
    environment: Environment = Field(default_factory=Environment)
    props: list[Prop] = Field(default_factory=list)
    spawn: Vec3 = Field(default_factory=Vec3)


class SkillStep(BaseModel):
    id: str
    name: str                  # short label, e.g. "Pull the pin"
    action: str                # imperative instruction, e.g. "Pull the pin out of the handle."
    why: str                   # the real-world reason / takeaway, stated plainly
    gesture: Gesture
    prop_kind: str             # kind of prop the gesture is performed at (one prop per kind per scene)
    line: str = ""             # plain second-person prompt for this step: "what would you do?" then what you should do


    @model_validator(mode="after")
    def _kind_known(self):
        if self.prop_kind not in known_prop_kinds():
            raise ValueError(f"step {self.id}: unknown prop_kind {self.prop_kind}")
        return self


class Skill(BaseModel):
    """An ordered real-world procedure. The scenario exists to teach exactly this."""
    id: str
    name: str
    level: Literal[1, 2, 3]    # social level it is taught at: 1 self, 2 friends/team, 3 community
    goal: str
    steps: list[SkillStep] = Field(min_length=3, max_length=9)
    source_url: str = ""

    @model_validator(mode="after")
    def _steps_ok(self):
        for a, b in zip(self.steps, self.steps[1:]):
            if (a.gesture, a.prop_kind) == (b.gesture, b.prop_kind):
                raise ValueError(f"steps {a.id} and {b.id} repeat the same gesture on the same prop")
        if len({s.id for s in self.steps}) != len(self.steps):
            raise ValueError("duplicate step ids")
        return self


class Interaction(BaseModel):
    id: str
    prompt: str                 # what the guide character says
    gesture: Gesture
    target_prop: str            # Prop.id the gesture must be performed at
    success_text: str
    fail_hint: str
    learning_point: str         # the real-world takeaway, stated plainly
    step_id: str = ""           # SkillStep this interaction teaches
    step_name: str = ""


class Act(BaseModel):
    index: int
    social_level: Literal[1, 2, 3]
    title: str
    narrative: str
    scene_id: str
    skill: Skill
    interactions: list[Interaction]


MATERIAL_PRESETS = ["stone", "marble", "trim", "metal", "wood", "plaster", "carpet", "dark", "glass", "cloth", "glow", "skin", "leaf"]
SHAPES = ["box", "rounded_box", "cylinder", "cone", "sphere", "capsule", "torus", "plane", "lathe"]
MOTIONS = ["none", "bob", "spin", "flicker", "sway", "pulse"]
COMPLETIONS = ["pulse", "open", "lift", "swing", "unfold", "glow", "bounce", "spin"]


class PartMaterial(BaseModel):
    preset: Literal["stone", "marble", "trim", "metal", "wood", "plaster", "carpet", "dark", "glass", "cloth", "glow", "skin", "leaf"] = "trim"
    color: str = ""              # optional hex override of the preset colour
    glow: float = Field(default=0, ge=0, le=3)   # emissive intensity
    opacity: float = Field(default=1, ge=0.05, le=1)


class Part(BaseModel):
    shape: Literal["box", "rounded_box", "cylinder", "cone", "sphere", "capsule", "torus", "plane", "lathe"]
    args: list[float] = Field(default_factory=list, max_length=6)   # box/rounded_box [w,h,d(,r)]; cylinder [rTop,rBottom,h]; cone [r,h]; sphere [r]; capsule [r,len]; torus [R,tube]; plane [w,h]
    profile: list[list[float]] = Field(default_factory=list, max_length=24)   # lathe: [[radius, y], ...]
    position: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    rotation: list[float] = Field(default_factory=lambda: [0, 0, 0], min_length=3, max_length=3)
    scale: list[float] = Field(default_factory=lambda: [1, 1, 1], min_length=3, max_length=3)
    material: PartMaterial = Field(default_factory=PartMaterial)


class RecipeLight(BaseModel):
    color: str = "#ffb347"
    intensity: float = Field(default=2, ge=0, le=20)
    distance: float = Field(default=6, ge=1, le=15)
    position: list[float] = Field(default_factory=lambda: [0, 1, 0], min_length=3, max_length=3)


class AssetRecipe(BaseModel):
    """A reusable procedural 3D asset. Built from primitives so the player can render it; saved to the library once approved."""
    kind: str = Field(pattern=r"^[a-z][a-z0-9_]{2,30}$")
    name: str
    parts: list[Part] = Field(min_length=1, max_length=60)
    lights: list[RecipeLight] = Field(default_factory=list, max_length=3)
    motion: Literal["none", "bob", "spin", "flicker", "sway", "pulse"] = "none"
    on_complete: Literal["pulse", "open", "lift", "swing", "unfold", "glow", "bounce", "spin"] = "pulse"
    tags: list[str] = Field(default_factory=list, max_length=8)


class Resource(BaseModel):
    title: str
    url: str
    kind: Literal["guide", "map", "video", "search"]
    note: str = ""
    needs_location: bool = False   # player substitutes {lat},{lng} from geolocation


class SimulationSpec(BaseModel):
    title: str
    tagline: str
    player_character: str = "the heroine"      # the learner IS this character, addressed in the second person ("You are ...")
    intro: str = ""
    recipes: list[AssetRecipe] = Field(default_factory=list)   # library/custom assets the scenes use
    request: SimulationRequest
    learning_objectives: list[str]
    disclaimer: str = ("Training aid only. Procedures follow commonly taught guidance but have not been certified; "
                       "confirm with your local authority or a qualified instructor before relying on them.")
    scenes: list[Scene]
    acts: list[Act]
    resources: list[Resource]

    @model_validator(mode="after")
    def _refs_resolve(self):
        scenes = {s.id: s for s in self.scenes}
        for act in self.acts:
            if act.scene_id not in scenes:
                raise ValueError(f"act {act.index}: unknown scene {act.scene_id}")
            props = {p.id for p in scenes[act.scene_id].props}
            want = [st.id for st in act.skill.steps]
            got = [it.step_id for it in act.interactions]
            if want != got:
                raise ValueError(f"act {act.index}: interactions must cover skill steps {want} in order, got {got}")
            for it in act.interactions:
                if it.target_prop not in props:
                    raise ValueError(f"interaction {it.id}: target {it.target_prop} not in scene {act.scene_id}")
        return self
