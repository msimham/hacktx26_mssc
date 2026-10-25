"""Deterministic scene layout (used with and without an LLM) so required props always land in natural, reachable spots."""
from __future__ import annotations

import math

from aep.library import visual_standard as vs
from aep.schema import Environment, Palette, Prop, Scene, Vec3

SET_PALETTES = {
    "castle": Palette(),
    "ballroom": Palette(stone="#8a7fc2", trim="#e3b968", carpet="#583ba0", accent="#af9de9", marble="#cdb6e6"),
    "lodge": Palette(stone="#8a6a4a", trim="#c9a15a", carpet="#7a2f2f", accent="#f5d9a0", marble="#b79a76"),
    "modern": Palette(stone="#bdbdb3", trim="#cfd6dc", carpet="#3d4a66", accent="#cfe3ff", marble="#e4e2dc"),
}
SET_ENV = {
    "castle": Environment(sky="#44316b", fog="#8f6baf", ground="#5b3f8c", light="#d1bbff", ambient="a moonlit, glittering castle"),
    "ballroom": Environment(sky="#3a2b6b", fog="#8a74b8", ground="#5b3f8c", light="#e0c8ff", ambient="a ballroom of candlelight and music"),
    "lodge": Environment(sky="#2d2438", fog="#7a6070", ground="#4b3a2e", light="#ffd9a8", ambient="a warm timber lodge"),
    "modern": Environment(sky="#4a5878", fog="#9aa7c0", ground="#6b6f7a", light="#e9f2ff", ambient="a bright modern hall"),
}
COLORS = {"extinguisher": "#e5233f", "fire": "#ff6a2b", "blanket": "#c8372d", "alarm": "#a82520", "exit_sign": "#225b3b", "assembly_point": "#2dc653",
          "npc": "#7251a4", "map_table": "#b08968", "stairs": "#a9a0b8", "door": "#3d2c23", "phone": "#d4b86c", "orb": "#b388ff"}
NPC_VARIANTS = ["child", "woman", "man"]
EXTRA_DECOR = [("rose", -2.0, -2.5), ("lantern", 5.4, 2.6), ("table", 3.8, -3.4), ("chest", 4.5, -4.8), ("crown", 0.0, -3.2), ("book", -3.0, -4.0)]
FREE_GRID = [(x, z) for z in (-6.5, -4.5, -2.5, -0.5, 1.5, 3.5) for x in (-5.0, -2.5, 0.0, 2.5, 5.0)]


def _free(pos_x: float, pos_z: float, props: list[Prop]) -> bool:
    return all(math.hypot(pos_x - p.position.x, pos_z - p.position.z) >= vs.MIN_GAP or abs(p.position.x) > 6.5 for p in props)


def build_scene(scene_id: str, name: str, index: int, required: dict[str, str], *, set_: str = "castle", palette: Palette | None = None,
                env: Environment | None = None, scenery: list[dict] | None = None, attendant: str = "Royal attendant") -> Scene:
    props: list[Prop] = []
    npc_n = 0

    def put(id, kind, label, x, y, z, rot=0.0, scale=1.0, color=None, variant=""):
        props.append(Prop(id=id, kind=kind, label=label, position=Vec3(x=round(x, 2), y=y, z=round(z, 2)), rotation_y=rot, scale=scale,
                          color=color or COLORS.get(kind, "#ffd166"), variant=variant))

    def find_slot():
        for x, z in FREE_GRID:
            if _free(x, z, props):
                return x, z
        return 0.0, -4.0

    for kind, label in required.items():
        x, y, z, rot = vs.SLOTS.get(kind) or (*find_slot()[:1], 0, find_slot()[1], 0)
        if kind == "npc":
            put(kind, kind, label, x, y, z, rot, variant=NPC_VARIANTS[(index - 1) % 3]); npc_n += 1
        else:
            put(kind, kind, label, x, y, z, rot)
    # reference-scene dressing: sconces, banners, sofa, an attendant
    for i, (kind, x, z, rot) in enumerate(vs.DEFAULT_DRESSING):
        if not any(p.kind == kind and math.hypot(p.position.x - x, p.position.z - z) < 1.5 for p in props) and _free(x, z, props) or kind == "torch":
            put(f"deco_{kind}{i}", kind, "", x, 2.2 if kind == "torch" else 0, z, rot)
    if npc_n == 0:
        put("deco_npc", "npc", attendant, 3.2, 0, 3.0, -0.6, variant="child")
    for i, item in enumerate(scenery or []):
        x, z = vs.nudge_into_hall(float(item.get("x", 0)), float(item.get("z", -4)))
        if _free(x, z, props):
            put(f"scenery{i}", item["kind"], item.get("label", ""), x, float(item.get("y", 0)), z, float(item.get("rotation_y", 0)),
                float(item.get("scale", 1)), item.get("color") or None)
    for i, (kind, x, z) in enumerate(EXTRA_DECOR):   # top up so no scene is bare
        if len(props) >= vs.MIN_SCENE_PROPS + 2:
            break
        if not any(p.kind == kind for p in props) and _free(x, z, props):
            put(f"deco_{kind}", kind, "", x, 1.0 if kind in ("crown", "book") else 0, z)
    pal = palette or SET_PALETTES[set_]
    return Scene(id=scene_id, name=name, set=set_, palette=pal, environment=env or SET_ENV[set_], props=props, spawn=Vec3(x=0, z=3.5))
