import math

import pytest
from fastapi.testclient import TestClient

from aep import schema
from aep.agents.validator import FIRST_PERSON, SECOND_PERSON, voice_problems
from aep.library import assets, offline
from aep.library import skills as curated
from aep.library import visual_standard as vs
from aep.llm import LLM
from aep.pipeline import build_simulation
from aep.schema import AssetRecipe, Gesture, SimulationRequest, SkillStep


def voice_problems_text(t):
    return [] if not FIRST_PERSON.search(t) else [t]


@pytest.fixture
def offline_llm(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MUSE_API_KEY", raising=False)
    return LLM()


def sim(level=3, world="Sleeping Beauty", topic="fire safety", llm=None):
    spec, _ = build_simulation(SimulationRequest(topic=topic, audience="college students", world=world, social_level=level), llm, save=False)
    return spec


# ---- the learner plays the heroine and is addressed as "you" ------------------------------------------------------
def test_learner_is_the_heroine_and_addressed_as_you(offline_llm):
    spec = sim(llm=offline_llm)
    assert spec.player_character == "Sleeping Beauty" and spec.intro.startswith("You are Sleeping Beauty")
    assert voice_problems(spec.acts) == []
    assert all(a.narrative.rstrip().endswith("What would you do?") for a in spec.acts)


def test_every_curated_step_line_is_plain_second_person():
    for skill in curated.for_topic("fire"):
        for st in skill.steps:
            assert st.line and voice_problems_text(st.line) == [], st.id
            assert len(st.line) < 130 and "?" in st.line or st.id in ("open",), st.id      # a short question, then what to do


def test_first_person_is_flagged(offline_llm):
    spec = sim(1, llm=offline_llm)
    spec.acts[0].interactions[0].prompt = "I'll point at the exit."
    assert voice_problems(spec.acts)
    spec = sim(1, llm=offline_llm); spec.acts[0].narrative = "A fire starts in the castle."
    assert voice_problems(spec.acts)             # narrative must address the learner


# ---- gestures mirror the real motion ---------------------------------------------------------------------------
def test_motion_steps_use_motion_gestures():
    by = {s.id: {st.id: st.gesture for st in s.steps} for s in curated.for_topic("fire")}
    assert by["extinguisher"]["pull"] == Gesture.PULL and by["extinguisher"]["alert"] == Gesture.PULL
    assert by["extinguisher"]["sweep"] == Gesture.SWEEP and by["extinguisher"]["squeeze"] == Gesture.SQUEEZE
    assert by["blanket"]["pull_tapes"] == Gesture.PULL and by["blanket"]["shield"] == Gesture.PUSH and by["blanket"]["wrap"] == Gesture.CIRCLE
    assert by["evacuate"]["plan"] == Gesture.TRACE and by["evacuate"]["open"] == Gesture.PUSH and by["evacuate"]["twoways"] == Gesture.PEACE
    used = {st.gesture for s in curated.for_topic("fire") for st in s.steps}
    assert len(used) >= 10 and used & schema.DYNAMIC_GESTURES


# ---- visual standard: scenes ------------------------------------------------------------------------------------
def test_scenes_meet_the_detail_bar_and_do_not_collide(offline_llm):
    spec = sim(llm=offline_llm)
    for sc in spec.scenes:
        assert len(sc.props) >= vs.MIN_SCENE_PROPS
        solid = [p for p in sc.props if p.position.y < 0.9 and abs(p.position.x) < 6.5]
        for i, a in enumerate(solid):
            for b in solid[i + 1:]:
                assert math.hypot(a.position.x - b.position.x, a.position.z - b.position.z) >= 0.9, (sc.id, a.id, b.id)
        assert vs.scene_problems(sc, [i.target_prop for a in spec.acts if a.scene_id == sc.id for i in a.interactions]) == []


def test_wall_mounted_props_face_into_the_room():
    for kind, (x, y, z, rot) in vs.SLOTS.items():
        if y > 1 or kind == "door":
            assert math.sin(rot) * -x >= -1e-6 and (abs(x) < 6 or abs(rot) > 0.1), kind


def test_set_follows_the_world():
    assert [vs.choose_set(w) for w in ("Sleeping Beauty", "Cinderella", "campus", "snow cabin")] == ["castle", "ballroom", "modern", "lodge"]


def test_fire_scene_gets_fire_and_extinguisher_in_reach(offline_llm):
    sc = sim(1, llm=offline_llm).scenes[0]
    kinds = {p.id: p for p in sc.props}
    assert kinds["fire"].position.z < -5 and abs(kinds["extinguisher"].position.x) < 4


# ---- visual standard: assets ------------------------------------------------------------------------------------
def thin():
    return AssetRecipe(kind="plain_box", name="Plain box", parts=[{"shape": "box", "args": [1, 1, 1]}])


def test_seed_assets_clear_the_bar():
    for kind, rec in assets.library().items():
        assert vs.recipe_problems(rec) == [], kind


def test_thin_asset_is_rejected():
    probs = vs.recipe_problems(thin())
    assert any("parts" in p for p in probs) and any("material" in p for p in probs)


@pytest.fixture
def lib(tmp_path, monkeypatch):
    monkeypatch.setattr(assets, "LIB", tmp_path / "library")
    monkeypatch.setattr(assets, "CAND", tmp_path / "candidates")
    assets.register()
    yield assets
    monkeypatch.undo(); assets.register()


def good_recipe(kind="test_goblet"):
    parts = [{"shape": "cylinder", "args": [0.1, 0.05, 0.2], "position": [0, 0.3, 0], "material": {"preset": "metal"}},
             {"shape": "sphere", "args": [0.08], "position": [0, 0.5, 0], "material": {"preset": "glass", "opacity": 0.5}},
             {"shape": "torus", "args": [0.1, 0.01], "position": [0, 0.4, 0], "material": {"preset": "trim"}},
             {"shape": "lathe", "profile": [[0.05, 0], [0.1, 0.1], [0.06, 0.2]], "material": {"preset": "wood"}}]
    parts += [{"shape": "box", "args": [0.1, 0.02, 0.1], "position": [0.2 * i, 0.05, 0], "material": {"preset": "stone"}} for i in range(5)]
    return AssetRecipe(kind=kind, name="Test goblet", parts=parts)


def test_good_asset_is_saved_then_approved_then_reusable(lib):
    rec = good_recipe(); ok, why = lib.save_candidate(rec, "unit test"); assert ok, why
    assert "test_goblet" in lib.candidates() and "test_goblet" not in lib.library()
    assert "test_goblet" not in schema.known_prop_kinds()           # not usable until a human approves it
    assert lib.approve("test_goblet")
    assert "test_goblet" in lib.library() and "test_goblet" in schema.known_prop_kinds()
    SkillStep(id="a", name="a", action="a", why="w", gesture="grab", prop_kind="test_goblet")   # now a valid skill prop kind
    assert lib.remove("test_goblet") and "test_goblet" not in schema.known_prop_kinds()


def test_save_refuses_thin_builtin_and_duplicate(lib):
    assert not lib.save_candidate(thin(), "t")[0]
    b = good_recipe("fire"); assert not lib.save_candidate(b, "t")[0]            # built-in kind
    assert lib.save_candidate(good_recipe("dup_cup"), "t")[0] and not lib.save_candidate(good_recipe("dup_cup"), "t")[0]


def test_asset_api(lib):
    from aep.server import app
    c = TestClient(app); lib.save_candidate(good_recipe("api_cup"), "t")
    body = c.get("/api/assets").json(); assert "api_cup" in body["candidates"]
    assert c.post("/api/assets/api_cup/approve").status_code == 200 and "api_cup" in c.get("/api/assets").json()["library"]
    assert c.delete("/api/assets/api_cup").status_code == 200 and c.post("/api/assets/nope/approve").status_code == 404


def test_library_asset_flows_into_the_spec(lib):
    lib.save_candidate(good_recipe("spec_cup"), "t"); lib.approve("spec_cup")
    sc = offline.build_scene("a", "n", 1, {"extinguisher": "E"}, scenery=[{"kind": "spec_cup", "x": -2, "z": -4}])
    assert any(p.kind == "spec_cup" for p in sc.props)
