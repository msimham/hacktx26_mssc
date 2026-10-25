"""Persistent library of reusable procedural assets.

candidates/  assets an agent designed that passed the quality gate; waiting for a human to say they look good
library/     approved assets: they become real prop kinds the agents may use in any later scenario
"""
from __future__ import annotations

import json
import time
from pathlib import Path

from aep import schema
from aep.library.visual_standard import recipe_problems
from aep.schema import PROP_KINDS, AssetRecipe

ROOT = Path(__file__).resolve().parent.parent.parent / "asset_library"
LIB, CAND = ROOT / "library", ROOT / "candidates"


def _read(path: Path) -> dict:
    return json.loads(path.read_text())


def _all(folder: Path) -> dict[str, dict]:
    out = {}
    if folder.exists():
        for f in sorted(folder.glob("*.json")):
            try:
                d = _read(f)
                AssetRecipe.model_validate(d["recipe"])
                out[f.stem] = d
            except Exception:   # a corrupt file must never take the platform down
                continue
    return out


def library() -> dict[str, AssetRecipe]:
    return {k: AssetRecipe.model_validate(d["recipe"]) for k, d in _all(LIB).items()}


def candidates() -> dict[str, dict]:
    return _all(CAND)


def register() -> None:
    """Make approved library kinds valid prop kinds for the schema and agents."""
    schema.EXTRA_KINDS.clear()
    schema.EXTRA_KINDS.update(library().keys())


def save_candidate(recipe: AssetRecipe, source: str) -> tuple[bool, list[str]]:
    """Store a new asset for review if it clears the quality gate. Never overwrites an existing kind."""
    if recipe.kind in PROP_KINDS or recipe.kind in library() or (CAND / f"{recipe.kind}.json").exists():
        return False, ["kind already exists"]
    problems = recipe_problems(recipe)
    if problems:
        return False, problems
    CAND.mkdir(parents=True, exist_ok=True)
    (CAND / f"{recipe.kind}.json").write_text(json.dumps(
        {"recipe": recipe.model_dump(mode="json"), "meta": {"source": source, "created": int(time.time()), "status": "candidate"}}, indent=1))
    return True, []


def approve(kind: str) -> bool:
    src = CAND / f"{kind}.json"
    if not src.exists():
        return False
    LIB.mkdir(parents=True, exist_ok=True)
    d = _read(src)
    d["meta"]["status"] = "approved"
    d["meta"]["approved"] = int(time.time())
    (LIB / f"{kind}.json").write_text(json.dumps(d, indent=1))
    src.unlink()
    register()
    return True


def remove(kind: str) -> bool:
    hit = False
    for folder in (CAND, LIB):
        f = folder / f"{kind}.json"
        if f.exists():
            f.unlink(); hit = True
    register()
    return hit


def describe_for_prompt() -> str:
    """Approved assets the agents should reuse before inventing new ones."""
    lib = library()
    return "; ".join(f"{k} ({r.name})" for k, r in lib.items()) or "none yet"


register()
