"""The visual detail bar, derived from the Magical School of Safety asset pack, as code.

Every generated scene and asset is held to this. See docs/VISUAL_STANDARD.md for the human-readable version.
The player renders the hall set (architecture, lighting, effects) itself; agents decide *what goes in it*.
"""
from __future__ import annotations

import math

from aep.schema import MATERIAL_PRESETS, SHAPES, AssetRecipe, Prop, Scene, Vec3, known_prop_kinds

# ---- scene bar -------------------------------------------------------------------------------------------------
MIN_SCENE_PROPS = 12          # required props + decoration + scenery
MIN_SCENERY = 4               # agent-chosen decorative props beyond the required and default dressing
HALL_X, HALL_Z = (-6.2, 6.2), (-8.8, 6.0)     # usable floor inside the hall (player clamps to -6.7..6.7 / -8.8..6.6)
MIN_GAP = 1.1                 # metres between prop centres, so nothing interpenetrates or hides a target

# ---- asset bar (procedural recipes) ----------------------------------------------------------------------------
ASSET_MIN_PARTS = 8
ASSET_MIN_MATERIALS = 3
ASSET_MIN_SHAPES = 3
ASSET_HEIGHT = (0.25, 4.0)

# Where required built-in props go: (x, y, z, rotation_y). Wall-mounted items sit flush to a wall and face into the room.
SLOTS: dict[str, tuple[float, float, float, float]] = {
    "fire": (0, 0, -7.0, 0), "extinguisher": (3.0, 0, -2.0, 0), "alarm": (-6.95, 1.5, -2.9, math.pi / 2),
    "blanket": (6.95, 1.3, -2.9, -math.pi / 2), "door": (0, 0, 6.95, math.pi), "exit_sign": (0, 4.4, 6.85, math.pi),
    "map_table": (-4.2, 0, -3.2, 0), "stairs": (2.9, 0, -5.6, -math.pi / 2), "assembly_point": (-3.0, 0, 4.8, 0),
    "phone": (4.6, 0, 1.2, 0), "npc": (-2.6, 0, -0.8, 0.5), "smoke": (0, 0, -6.0, 0), "bed": (-4.6, 0, -6.0, 0),
    "sofa": (-4.2, 0, -5.4, 0), "chest": (4.5, 0, -4.8, 0), "table": (3.8, 0, -3.4, 0), "book": (-4.2, 1.0, -3.2, 0),
    "crown": (0, 1.0, -3.0, 0), "lantern": (2.5, 0, 1.0, 0), "orb": (2.2, 0, -3.5, 0), "rose": (-2.0, 0, -2.5, 0),
    "torch": (-5.5, 0, -4, 0), "banner": (-6.4, 0, -6, 0), "tree": (5.8, 0, -7.5, 0), "gate": (0, 0, 5.8, 0),
    "path": (0, 0, -1, 0), "tower": (0, 0, -9, 0), "wall": (0, 0, -9, 0),
}

# Dressing every scene gets so no room is bare (reference scene: sofas, fireplace, torches, tapestry, chandelier...).
DEFAULT_DRESSING = [("sofa", -4.2, -5.4, 0.0), ("torch", -6.85, -5.0, math.pi / 2), ("torch", 6.85, -5.0, -math.pi / 2),
                    ("torch", -6.85, 1.0, math.pi / 2), ("torch", 6.85, 1.0, -math.pi / 2), ("banner", -3.2, -9.55, 0.0)]

KIND_NOTES = {
    "extinguisher": "red clearcoat cylinder with brass gauge, hose, handle and crown label", "blanket": "red wall pouch with pull tapes",
    "fire": "shader flames, ember bed, flickering light and smoke", "smoke": "layered translucent plumes", "door": "framed panelled door that swings open",
    "stairs": "stone staircase with rail and balusters", "map_table": "table with a parchment floor plan", "torch": "wall sconce with flame",
    "tree": "layered foliage", "banner": "hanging cloth banner with crown emblem", "tower": "turret", "wall": "stone wall segment",
    "bed": "four-poster bed with canopy", "rose": "rose under a glass dome", "gate": "iron gate", "path": "stone path", "exit_sign": "green EXIT plaque",
    "assembly_point": "flag, ring and sign for the meeting place", "alarm": "red wall pull-station with handle", "npc": "rigged character",
    "orb": "glass orb with inner glow", "phone": "candlestick telephone on a pedestal", "sofa": "royal velvet sofa", "chest": "iron-banded chest",
    "crown": "gold crown on a cushion", "lantern": "glowing lantern on a stand", "book": "open spell book on a stand", "table": "side table with goblets",
}

SET_FOR = (("castle", ("castle", "palace", "kingdom", "royal", "sleeping", "beauty", "frozen", "tangled", "disney", "fairy", "dragon")),
           ("ballroom", ("ball", "cinderella", "gala", "dance", "party", "prom")),
           ("lodge", ("cabin", "lodge", "woods", "forest", "snow", "camping", "cottage", "winter")),
           ("modern", ("campus", "school", "office", "dorm", "city", "lab", "modern", "hospital")))


def choose_set(world: str) -> str:
    w = world.lower()
    for name, words in (SET_FOR[1], SET_FOR[3], SET_FOR[2], SET_FOR[0]):  # specific sets before the generic castle
        if any(x in w for x in words):
            return name
    return "castle"


STANDARD_PROMPT = (
    "VISUAL STANDARD (non-negotiable). The player already renders a richly detailed hall for every scene: reflective marble floor, "
    "normal-mapped stone walls, columns with capitals, arched stained-glass windows, chandelier, torches, fireplace, carpet, god-rays "
    "of sparkle, ACES lighting and shadows. Required props are placed for you in detailed models. You choose the SET (castle, ballroom, "
    "lodge, modern), a harmonious PALETTE (stone, trim, carpet, accent, marble hex colours), the mood, 4-8 SCENERY props that tell this "
    f"world's story, and at most 2 CUSTOM assets only when no built-in kind fits. Built-in kinds: {{kinds}}. Scenery must sit inside "
    f"x in {HALL_X}, z in {HALL_Z}, at least {MIN_GAP}m from each other. A custom asset must be a genuinely detailed model: "
    f"{ASSET_MIN_PARTS}+ parts, {ASSET_MIN_SHAPES}+ shape types, {ASSET_MIN_MATERIALS}+ material presets, bevels/trim/ornament, real proportions "
    f"({ASSET_HEIGHT[0]}-{ASSET_HEIGHT[1]} m tall, origin at its base). Shapes: {SHAPES}. Material presets: {MATERIAL_PRESETS}."
)


def recipe_problems(r: AssetRecipe) -> list[str]:
    """Quality gate for custom assets. Returns reasons it is below the bar (empty = passes)."""
    out = []
    if len(r.parts) < ASSET_MIN_PARTS: out.append(f"{r.kind}: needs {ASSET_MIN_PARTS}+ parts, has {len(r.parts)}")
    if len({p.material.preset for p in r.parts}) < ASSET_MIN_MATERIALS: out.append(f"{r.kind}: needs {ASSET_MIN_MATERIALS}+ material presets")
    if len({p.shape for p in r.parts}) < ASSET_MIN_SHAPES: out.append(f"{r.kind}: needs {ASSET_MIN_SHAPES}+ shape types")
    ys = [p.position[1] + _half_height(p) * p.scale[1] for p in r.parts] + [p.position[1] - _half_height(p) * p.scale[1] for p in r.parts]
    height = max(ys) - min(0, min(ys)) if ys else 0
    if not ASSET_HEIGHT[0] <= height <= ASSET_HEIGHT[1]: out.append(f"{r.kind}: height {height:.2f}m outside {ASSET_HEIGHT}")
    for p in r.parts:
        if p.shape == "lathe" and len(p.profile) < 3: out.append(f"{r.kind}: lathe needs a profile of 3+ points")
        if p.shape != "lathe" and not p.args: out.append(f"{r.kind}: {p.shape} part has no args")
        if any(not math.isfinite(v) for v in p.position + p.rotation + p.scale + p.args): out.append(f"{r.kind}: non-finite number")
    return out


def _half_height(p) -> float:
    a = p.args
    if p.shape in ("box", "rounded_box", "plane"): return (a[1] if len(a) > 1 else 0) / 2
    if p.shape == "cylinder": return (a[2] if len(a) > 2 else 0) / 2
    if p.shape == "cone": return (a[1] if len(a) > 1 else 0) / 2
    if p.shape == "sphere": return a[0] if a else 0
    if p.shape == "capsule": return (a[1] / 2 + a[0]) if len(a) > 1 else 0
    if p.shape == "torus": return (a[0] + a[1]) if len(a) > 1 else 0
    if p.shape == "lathe": return (max((q[1] for q in p.profile), default=0) - min((q[1] for q in p.profile), default=0)) / 2
    return 0


def scene_problems(scene: Scene, required: list[str]) -> list[str]:
    out = []
    kinds = known_prop_kinds()
    ids = {p.id: p for p in scene.props}
    for k in required:
        if k not in ids or ids[k].kind != k: out.append(f"{scene.id}: required prop '{k}' missing")
    if len(scene.props) < MIN_SCENE_PROPS: out.append(f"{scene.id}: only {len(scene.props)} props, need {MIN_SCENE_PROPS}+")
    for p in scene.props:
        if p.kind not in kinds: out.append(f"{scene.id}: unknown prop kind '{p.kind}'")
    return out


def nudge_into_hall(x: float, z: float) -> tuple[float, float]:
    return min(max(x, HALL_X[0]), HALL_X[1]), min(max(z, HALL_Z[0]), HALL_Z[1])


def far_enough(pos: Vec3, others: list[Prop]) -> bool:
    return all(math.hypot(pos.x - o.position.x, pos.z - o.position.z) >= MIN_GAP or o.position.y > 0.8 and abs(o.position.x) > 6 for o in others)
