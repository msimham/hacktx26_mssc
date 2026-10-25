import pytest
from fastapi.testclient import TestClient

from aep import server
from aep.control import compute, evaluation, orchestrator, security
from aep.control.standardize import TrainingAnswers, social_level, standardize_offline
from aep.llm import LLM

ANSWERS = dict(train="Fire safety", skills="Communication, Delegation", world="Sleeping Beauty", audience="Healthcare staff",
               headcount="3–5 people", interaction="Voice, Motion", knowledge="Our policies, Training objectives",
               capabilities="Search the web, Create scenarios, Evaluate participants", guardrails="Share private scores, Give medical or legal advice",
               permission="Change the scenario, Use outside sources", success="Clearer communication, Faster decisions")


@pytest.fixture
def offline(monkeypatch):
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    monkeypatch.delenv("MUSE_API_KEY", raising=False)
    return LLM()


def test_standardize_offline_maps_free_text_to_closed_vocabularies():
    s = standardize_offline(TrainingAnswers(**ANSWERS))
    assert (s.topic, s.world, s.social_level) == ("Fire safety", "Sleeping Beauty", 2)
    assert s.interaction == ["voice", "motion"]
    assert set(s.capabilities) == {"web_search", "create_scenarios", "evaluate_participants"}
    assert set(s.never) == {"no_share_private_scores", "no_medical_legal_advice"}
    assert set(s.needs_permission) == {"change_scenario", "web_search"}


@pytest.mark.parametrize("text,level", [("Solo", 1), ("2 people", 2), ("3–5 people", 2), ("6+ people", 3), ("A team of 4", 2), ("our whole department", 3)])
def test_social_level_from_headcount(text, level):
    assert social_level(text) == level


def test_policy_denies_by_default_and_gates_egress(offline):
    std = standardize_offline(TrainingAnswers(**ANSWERS))
    p = security.PolicyEngine().build(std, security.SecurityAgent().review(std, offline))
    assert p.tools["message_participants"] == "deny" and p.tools["share_results"] == "deny"
    assert p.tools["create_scenarios"] == "allow"
    assert p.tools["web_search"] == "ask" and p.tools["change_scenario"] == "ask"
    assert "medical_record" in p.deny_data and "audit_logging" in p.require


def test_egress_tool_needs_approval_even_when_listed_as_capability():
    std = standardize_offline(TrainingAnswers(**{**ANSWERS, "permission": "Nothing"}))
    p = security.PolicyEngine().build(std, [])
    audit: list[dict] = []
    with pytest.raises(security.PolicyDenied):
        security.PolicyEngine.enforce(p, "web_search", approved=False, audit=audit)
    security.PolicyEngine.enforce(p, "web_search", approved=True, audit=audit)
    with pytest.raises(security.PolicyDenied):
        security.PolicyEngine.enforce(p, "share_results", approved=True, audit=audit)   # denied tools stay denied even when "approved"
    assert [a["verdict"] for a in audit] == ["ask", "allow", "deny"]


def test_llm_cannot_add_rules_outside_the_closed_list():
    with pytest.raises(ValueError):
        security.Risk(item="x", why="y", rule="delete_everything")


def test_resource_plan_is_derived_not_asked():
    std = standardize_offline(TrainingAnswers(**{**ANSWERS, "headcount": "6+ people"}))
    r = compute.plan(std)
    assert r.optimization == "quality" and r.max_rounds == 3 and r.model_strategy["Storyteller"] == "quality_model"


def test_orchestrator_builds_a_ready_program(offline, tmp_path):
    store = orchestrator.Store(tmp_path)
    prog = store.add(TrainingAnswers(**ANSWERS))
    orchestrator.run(prog, offline, store)
    assert prog.status == "ready", prog.error
    assert [p.status for p in prog.phases] == ["done"] * len(orchestrator.PHASES)
    assert len(prog.simulation["spec"]["acts"]) == 2
    assert prog.spec.evaluation.passed, [c for c in prog.spec.evaluation.checks if not c.passed]
    again = orchestrator.Store(tmp_path).get(prog.id)          # survives a restart
    assert again and again.status == "ready"


def test_a_failing_phase_is_reported_not_raised(offline, tmp_path, monkeypatch):
    monkeypatch.setattr(orchestrator.pipeline, "build_simulation", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom")))
    store = orchestrator.Store(tmp_path)
    prog = store.add(TrainingAnswers(**ANSWERS))
    orchestrator.run(prog, offline, store)
    assert prog.status == "failed" and prog.error == "boom"
    assert prog.phases[-1].status == "failed" and prog.phases[0].status == "done"


def test_store_rejects_path_traversal_and_caps_concurrent_builds(tmp_path):
    store = orchestrator.Store(tmp_path)
    assert store.get("../../etc/passwd") is None and store.get("nope") is None
    for _ in range(orchestrator.MAX_BUILDING):
        store.add(TrainingAnswers(**ANSWERS))
    with pytest.raises(orchestrator.TooBusy):
        store.add(TrainingAnswers(**ANSWERS))


@pytest.fixture
def client(offline, tmp_path, monkeypatch):
    monkeypatch.setattr(server, "llm", offline)
    monkeypatch.setattr(server, "programs", orchestrator.Store(tmp_path))
    return TestClient(server.app)


def test_api_end_to_end_and_policy_gate(client):
    r = client.post("/api/training-programs", json={"answers": ANSWERS})
    assert r.status_code == 202
    pid = r.json()["id"]
    got = client.get(f"/api/training-programs/{pid}").json()          # TestClient runs the background task before returning
    assert got["status"] == "ready" and "answers" not in got
    assert got["spec"]["policy"]["tools"]["web_search"] == "ask"
    body = {"topic": "fire safety", "social_level": 1, "program_id": pid}
    assert client.post("/api/next-steps", json=body).status_code == 403             # not approved
    assert client.post("/api/next-steps", json={**body, "approved": True}).status_code == 200


def test_api_rejects_incomplete_answers_and_unknown_programs(client):
    assert client.post("/api/training-programs", json={"answers": {**ANSWERS, "success": ""}}).status_code == 422
    assert client.get("/api/training-programs/000000000000").status_code == 404
