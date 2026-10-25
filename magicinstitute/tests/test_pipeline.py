import pytest
from pydantic import ValidationError

from aep.library import skills as curated
from aep.llm import LLM
from aep.pipeline import build_simulation
from aep.schema import SimulationRequest, SimulationSpec, Skill, SkillStep


def req(level, topic="fire safety"):
    return SimulationRequest(topic=topic, audience="college students", world="Sleeping Beauty", social_level=level)


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MUSE_API_KEY", raising=False)
    return LLM()


@pytest.mark.parametrize("level", [1, 2, 3])
def test_levels_are_cumulative_acts(offline, level):
    spec, _ = build_simulation(req(level), offline, save=False)
    assert [a.index for a in spec.acts] == list(range(1, level + 1))
    assert [a.skill.level for a in spec.acts] == list(range(1, level + 1))


def test_every_skill_step_is_taught_once_in_order(offline):
    spec, _ = build_simulation(req(3), offline, save=False)
    for act in spec.acts:
        assert [i.step_id for i in act.interactions] == [s.id for s in act.skill.steps]
        for it, st in zip(act.interactions, act.skill.steps):
            assert (it.gesture, it.target_prop) == (st.gesture, st.prop_kind)
            assert it.learning_point == st.why


def test_extinguisher_covers_full_PASS(offline):
    spec, _ = build_simulation(req(1), offline, save=False)
    ids = [s.id for s in spec.acts[0].skill.steps]
    assert ids == ["assess", "alert", "fetch", "pull", "aim", "squeeze", "sweep", "verify"]
    kinds = {p.kind for p in spec.scenes[0].props}
    assert {"extinguisher", "fire", "alarm", "exit_sign"} <= kinds


def test_fire_resources_include_map(offline):
    spec, _ = build_simulation(req(3), offline, save=False)
    assert any(r.kind == "map" and r.needs_location for r in spec.resources)
    assert "Training aid" in spec.disclaimer


def test_unknown_topic_degrades_to_placeholder_but_valid(offline):
    spec, _ = build_simulation(req(2, "cyber security"), offline, save=False)
    assert len(spec.acts) == 2 and spec.resources


def test_skipping_a_step_is_rejected(offline):
    spec, _ = build_simulation(req(1), offline, save=False)
    data = spec.model_dump(mode="json")
    del data["acts"][0]["interactions"][3]
    with pytest.raises(ValidationError):
        SimulationSpec.model_validate(data)


def test_repeated_gesture_on_same_prop_rejected():
    s = lambda i: SkillStep(id=i, name=i, action="a", why="w", gesture="grab", prop_kind="orb")
    with pytest.raises(ValidationError):
        Skill(id="x", name="x", level=1, goal="g", steps=[s("a"), s("b"), s("c")])


def test_unknown_prop_kind_rejected():
    with pytest.raises(ValidationError):
        SkillStep(id="a", name="a", action="a", why="w", gesture="grab", prop_kind="dragon")


def test_curated_fire_skills_are_valid():
    assert [s.level for s in curated.for_topic("Fire safety")] == [1, 2, 3]
