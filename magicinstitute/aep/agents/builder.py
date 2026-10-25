from __future__ import annotations

import json
from concurrent.futures import ThreadPoolExecutor

from pydantic import BaseModel, Field

from aep.agents.base import Agent, Context
from aep.library import assets, offline
from aep.library import visual_standard as vs
from aep.schema import SETS, AssetRecipe, Environment, Palette, Scene, known_prop_kinds


class SceneryItem(BaseModel):
    kind: str
    label: str = ""
    x: float
    z: float
    y: float = 0
    rotation_y: float = 0
    scale: float = 1
    color: str = ""


class AssetRequest(BaseModel):
    kind: str = Field(pattern=r"^[a-z][a-z0-9_]{2,30}$")      # snake_case id of the new prop kind
    name: str
    description: str                                          # what it is and why this story needs it


class SceneDesign(BaseModel):
    """What the LLM decides for a scene. Required props are placed deterministically; the player renders the hall."""
    set: str = "castle"                                        # one of castle | ballroom | lodge | modern
    palette: Palette = Field(default_factory=Palette)
    sky: str = "#44316b"
    fog: str = "#8f6baf"
    light: str = "#d1bbff"
    mood: str = "a moonlit, glittering castle"
    attendant: str = "Royal attendant"                         # label for the background character
    scenery: list[SceneryItem] = Field(default_factory=list, max_length=8)
    custom_asset_requests: list[AssetRequest] = Field(default_factory=list, max_length=2)   # only when no built-in/library kind fits


class WorldBuilder(Agent):
    """Dresses each act's hall: picks the set and palette, places required props deterministically, adds scenery, and may
    design new custom assets, which are quality-gated and saved for the human to approve into the reusable library."""
    name = "world_builder"

    def execute(self, ctx: Context) -> None:
        r, acts = ctx.request, ctx.artifacts["acts"]
        labels = ctx.artifacts.get("prop_labels", {})

        def required(act):
            return {i.target_prop: labels.get(act.index, {}).get(i.target_prop, i.target_prop.replace("_", " ").title()) for i in act.interactions}

        recipes: dict[str, AssetRecipe] = {}
        if ctx.llm.online:
            with ThreadPoolExecutor(max_workers=len(acts)) as pool:
                designs = list(pool.map(lambda a: self._design(ctx, a, required(a)), acts))
        else:
            designs = [SceneDesign(set=vs.choose_set(r.world)) for _ in acts]
        scenes = []
        for act, d in zip(acts, designs):
            for req in d.custom_asset_requests:               # each gets its own design step; only assets that clear the bar survive
                if req.kind in known_prop_kinds() or req.kind in recipes or not ctx.llm.online:
                    continue
                rec = self._make_asset(ctx, req)
                if rec:
                    recipes[rec.kind] = rec
            known = known_prop_kinds() | set(recipes)
            scenery = [s.model_dump() for s in d.scenery if s.kind in known]
            chosen = vs.choose_set(r.world)   # a world that clearly implies a set (ballroom, lodge, modern) wins over the LLM's default castle
            set_ = chosen if chosen != "castle" else (d.set if d.set in SETS else "castle")
            env = (offline.SET_ENV[set_].model_copy(update={"sky": d.sky, "fog": d.fog, "light": d.light, "ambient": d.mood})
                   if ctx.llm.online else offline.SET_ENV[set_])
            scenes.append(offline.build_scene(act.scene_id, f"{r.world}: {act.title}", act.index, required(act), set_=set_,
                                              palette=d.palette if ctx.llm.online else None, env=env, scenery=scenery, attendant=d.attendant))
        ctx.artifacts["scenes"] = scenes
        ctx.artifacts["new_recipes"] = recipes

    @staticmethod
    def _make_asset(ctx: Context, req: AssetRequest, attempts: int = 3) -> AssetRecipe | None:
        """Design one custom asset to the visual standard: a worked exemplar sets the bar, and every failure of the quality gate
        is fed back until it passes (or we give up and the scene simply goes without it)."""
        ex = next(iter(assets.library().values()), None)
        exemplar = f" EXEMPLAR that meets the bar (match this level of detail, not this subject): {ex.model_dump_json()}" if ex else ""
        system = (vs.STANDARD_PROMPT.replace("{kinds}", ", ".join(sorted(known_prop_kinds()))) + " Design exactly ONE asset as an AssetRecipe with the requested kind. "
                  "Build it from many small parts: base/feet, body, trim bands, ornament, fittings, glow accents. Use varied shapes and materials. "
                  "Origin at the base; positions in metres; give every non-lathe part its args." + exemplar)
        prompt, feedback = f"World: {ctx.request.world}\nAsset: {req.model_dump_json()}", ""
        for _ in range(attempts):
            try:
                rec = ctx.llm.structured(system, prompt + feedback, AssetRecipe, max_tokens=16000, effort="medium")
            except RuntimeError:
                continue
            rec.kind = req.kind
            problems = vs.recipe_problems(rec)
            if not problems:
                return rec
            feedback = "\nYour previous attempt failed the quality gate: " + "; ".join(problems) + ". Return the full improved recipe."
        return None

    @staticmethod
    def _design(ctx: Context, act, req: dict[str, str]) -> SceneDesign:
        known = sorted(known_prop_kinds())
        system = vs.STANDARD_PROMPT.replace("{kinds}", ", ".join(known)) + (
            f" Approved library assets you should reuse before inventing new ones: {assets.describe_for_prompt()}. "
            "Scenery items use only known kinds (built-in or library). Set 'attendant' to a fitting name for the background character. "
            "Return the design for ONE scene.")
        prompt = (f"World: {ctx.request.world}\nPlayer character: {ctx.artifacts['brief'].player_character}\nScene: "
                  + json.dumps({"act": act.title, "narrative": act.narrative, "required_props": list(req)})
                  + f"\n{ctx.artifacts.get('validation_feedback', '')}")
        return ctx.llm.structured(system, prompt, SceneDesign, max_tokens=14000)
