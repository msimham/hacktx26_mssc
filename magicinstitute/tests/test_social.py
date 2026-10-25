import base64
import hashlib
import hmac
import json
import time

import httpx
import pytest
from fastapi.testclient import TestClient

from aep import server
from aep.social import ladder
from aep.social.facebook import FacebookError, FacebookGraph, FbProfile, Sessions
from aep.social.ladder import Circle, Ranked, build_queries, clean, levels_after, suggest
from aep.social.serp import Hit, Place, SerpClient, SerpError

KEY = "sk-SECRET-serp-key"


class FakeSerp:
    online = True
    def __init__(self, hits=None, places=None): self.hits, self.place_list, self.calls = hits or {}, places or [], []
    def search(self, q, *, location=None, gl="us", hl="en", n=8):
        self.calls.append((q, location)); return self.hits.get("facebook" if "site:facebook.com" in q else "web", [])
    def places(self, q, *, lat=None, lng=None, location=None, n=5): self.calls.append(("MAPS " + q, location)); return self.place_list


FB = [Hit(title="Austin Fire Safety Network", link="https://www.facebook.com/groups/austinfiresafety/", snippet="Public group about fire safety in Austin"),
      Hit(title="A post", link="https://www.facebook.com/someone/posts/123", snippet="fire safety"),
      Hit(title="Dup", link="https://www.facebook.com/groups/austinfiresafety", snippet="dup")]
WEB = [Hit(title="UT Fire Safety Club", link="https://orgs.utexas.edu/firesafety", snippet="student organization for fire safety training"),
       Hit(title="Buy extinguishers sale", link="https://shop.example.com/x", snippet="buy now coupon sale fire safety"),
       Hit(title="no link scheme", link="ftp://x", snippet="")]


# ---- levels + queries ---------------------------------------------------------------------------------------------
def test_next_two_levels():
    assert levels_after(1) == [2, 3] and levels_after(2) == [3] and levels_after(3) == [3]


def test_level2_uses_school_and_org_level3_uses_geography():
    c = Circle(school="UT Austin", organization="Acme", city="Austin, Texas")
    q2 = [q["q"] for q in build_queries("fire safety", "students", c, 2)]
    assert any('"UT Austin"' in q for q in q2) and any("site:facebook.com/groups" in q and "Acme" in q for q in q2)
    q3 = build_queries("fire safety", "students", c, 3)
    assert all("Austin" in q["q"] for q in q3) and all(q.get("location") == "Austin, Texas" for q in q3) and any("CERT" in q["q"] for q in q3)


def test_no_profile_still_searches():
    assert build_queries("fire safety", "college students", Circle(), 2) and build_queries("fire safety", "x", Circle(), 3)


def test_user_text_cannot_inject_search_operators():
    assert "site:" not in clean('x" site:evil.com inurl:admin') and '"' not in clean('he said "hi"')
    qs = build_queries("fire safety", "s", Circle(school='UT" site:evil.com'), 2)
    assert not any("site:evil.com" in q["q"] for q in qs)


# ---- suggest ---------------------------------------------------------------------------------------------------------
def test_suggestions_keep_real_groups_drop_noise_and_dedupe():
    serp = FakeSerp({"facebook": FB, "web": WEB})
    out = suggest("fire safety", "students", Circle(school="UT Austin", city="Austin, Texas"), 1, serp)
    assert [l.level for l in out.levels] == [2, 3] and out.configured
    items = out.levels[0].items; urls = [i.url for i in items]
    assert "https://www.facebook.com/groups/austinfiresafety/" in urls and not any("/posts/" in u for u in urls)
    assert len([u for u in urls if "austinfiresafety" in u]) == 1 and not any(u.startswith("ftp") for u in urls)
    assert items[0].source == "facebook-group" and items[0].kind == "group"
    assert out.sent and any("site:facebook.com/groups" in s for s in out.sent)


def test_places_only_for_topics_with_a_place_and_a_location():
    pl = [Place(title="Station 5", address="1 Main St", rating=4.7, link="https://www.google.com/maps/place/?q=place_id:abc")]
    out = suggest("fire safety", "s", Circle(city="Austin"), 3, FakeSerp({"web": WEB}, pl))
    assert [i.kind for i in out.levels[0].items].count("place") == 1 and out.levels[0].items[-1].title == "Station 5"
    assert not any(i.kind == "place" for i in suggest("cyber security", "s", Circle(city="Austin"), 3, FakeSerp({"web": WEB}, pl)).levels[0].items)
    assert not any(i.kind == "place" for i in suggest("fire safety", "s", Circle(), 3, FakeSerp({"web": WEB}, pl)).levels[0].items)


def test_not_configured_returns_a_note_not_an_error():
    out = suggest("fire safety", "s", Circle(), 1, SerpClient(key=""))
    assert not out.configured and out.notes and not out.levels


def test_llm_can_only_choose_by_index_and_cannot_invent_links():
    class L:
        online = True
        def structured(self, system, user, model, **kw):
            return Ranked(items=[Ranked.Item(index=1, why="Closest to my school"), Ranked.Item(index=99, why="invented"), Ranked.Item(index=1, why="again")])
    out = suggest("fire safety", "s", Circle(school="UT Austin"), 2, FakeSerp({"facebook": FB, "web": WEB}), L())
    items = out.levels[0].items
    assert len(items) == 1 and items[0].why == "Closest to my school"
    assert all(i.url in {h.link for h in FB + WEB} for i in items)


def test_search_failure_degrades_with_a_note():
    class Bad(FakeSerp):
        def search(self, *a, **k): raise SerpError("SerpAPI returned 429")
    out = suggest("fire safety", "s", Circle(city="Austin"), 2, Bad())
    assert out.configured and "SerpAPI returned 429" in out.notes and out.levels[0].items == []


# ---- SerpAPI client ----------------------------------------------------------------------------------------------------
class Resp:
    def __init__(self, data, code=200): self._d, self.status_code = data, code
    def json(self): return self._d


def test_serp_params_parse_and_cache(tmp_path, monkeypatch):
    seen = []
    monkeypatch.setattr(httpx, "get", lambda url, params, timeout: (seen.append((url, params)), Resp({"organic_results": [{"title": "T", "link": "https://a.example/x", "snippet": "S"}, {"title": "", "link": "x"}]}))[1])
    c = SerpClient(key=KEY, cache=tmp_path)
    hits = c.search("fire safety club", location="Austin, Texas")
    assert [h.title for h in hits] == ["T"] and seen[0][0] == "https://serpapi.com/search"
    p = seen[0][1]; assert p["engine"] == "google" and p["q"] == "fire safety club" and p["location"] == "Austin, Texas" and p["api_key"] == KEY
    c.search("fire safety club", location="Austin, Texas"); assert len(seen) == 1                # cached: no second billed search
    assert KEY not in "".join(f.read_text() for f in tmp_path.glob("*.json"))                    # key is never written to the cache


def test_serp_maps_params_and_parse(tmp_path, monkeypatch):
    seen = []
    data = {"local_results": [{"title": "Station 5", "address": "1 Main", "rating": 4.6, "place_id": "ChIJ1", "gps_coordinates": {"latitude": 30.2, "longitude": -97.7}}]}
    monkeypatch.setattr(httpx, "get", lambda url, params, timeout: (seen.append(params), Resp(data))[1])
    ps = SerpClient(key=KEY, cache=tmp_path).places("fire station", lat=30.27, lng=-97.74)
    assert seen[0]["engine"] == "google_maps" and seen[0]["type"] == "search" and seen[0]["ll"] == "@30.27000,-97.74000,14z"
    assert ps[0].link.endswith("place_id:ChIJ1") and ps[0].lat == 30.2
    assert SerpClient(key=KEY, cache=tmp_path).places("fire station") == []                       # no location: no search


def test_serp_errors_never_leak_the_key(tmp_path, monkeypatch):
    def boom(url, params, timeout): raise httpx.ConnectError(f"cannot reach {url}?api_key={params['api_key']}")
    monkeypatch.setattr(httpx, "get", boom)
    with pytest.raises(SerpError) as e: SerpClient(key=KEY, cache=tmp_path).search("x")
    assert KEY not in str(e.value)
    monkeypatch.setattr(httpx, "get", lambda *a, **k: Resp({}, 401))
    with pytest.raises(SerpError) as e: SerpClient(key=KEY, cache=None).search("y")
    assert "401" in str(e.value) and KEY not in str(e.value)


# ---- Facebook ---------------------------------------------------------------------------------------------------------
@pytest.fixture
def fbg(): return FacebookGraph(app_id="APPID", app_secret="APPSECRET", redirect_uri="http://localhost:8000/api/facebook/callback")


def test_login_url_has_state_scope_and_redirect(fbg):
    from urllib.parse import parse_qs, urlparse
    u = urlparse(fbg.login_url("STATE123")); q = parse_qs(u.query)
    assert u.netloc == "www.facebook.com" and u.path.endswith("/dialog/oauth") and q["state"] == ["STATE123"] and q["client_id"] == ["APPID"]
    assert "public_profile" in q["scope"][0] and q["redirect_uri"] == ["http://localhost:8000/api/facebook/callback"]


def test_graph_calls_carry_appsecret_proof_and_parse_profile(fbg, monkeypatch):
    calls = []
    def req(method, url, params, timeout):
        calls.append((method, url.split("/")[-1], params))
        path = url.split("/", 4)[-1]
        data = {"me": {"id": "42", "name": "Ada", "location": {"name": "Austin, Texas"}, "hometown": {"name": "Dallas, Texas"}},
                "me/permissions": {"data": [{"permission": "public_profile", "status": "granted"}, {"permission": "user_friends", "status": "granted"}, {"permission": "user_location", "status": "declined"}]},
                "me/friends": {"data": [], "summary": {"total_count": 3}}}[path]
        return type("R", (), {"status_code": 200, "content": b"x", "json": lambda self: data})()
    monkeypatch.setattr(httpx, "request", req)
    p = fbg.profile("TOKEN")
    assert p.name == "Ada" and p.location == "Austin, Texas" and p.friends_using_app == 3 and p.granted == ["public_profile", "user_friends"]
    proof = hmac.new(b"APPSECRET", b"TOKEN", hashlib.sha256).hexdigest()
    assert all(c[2]["appsecret_proof"] == proof for c in calls)


def test_graph_error_is_reported_without_the_token(fbg, monkeypatch):
    monkeypatch.setattr(httpx, "request", lambda *a, **k: type("R", (), {"status_code": 400, "content": b"x", "json": lambda s: {"error": {"message": "Invalid OAuth access token"}}})())
    with pytest.raises(FacebookError) as e: fbg.profile("TOKEN-SECRET")
    assert "TOKEN-SECRET" not in str(e.value)


def b64(b): return base64.urlsafe_b64encode(b).decode().rstrip("=")


def signed(payload: dict, secret="APPSECRET"):
    p = b64(json.dumps(payload).encode()); return b64(hmac.new(secret.encode(), p.encode(), hashlib.sha256).digest()) + "." + p


def test_signed_request_verification(fbg):
    assert fbg.parse_signed_request(signed({"user_id": "42"}))["user_id"] == "42"
    with pytest.raises(FacebookError): fbg.parse_signed_request(signed({"user_id": "42"}, secret="WRONG"))
    with pytest.raises(FacebookError): fbg.parse_signed_request("garbage")


def test_state_is_one_time_and_sessions_expire(monkeypatch):
    s = Sessions(); st = s.new_state()
    assert s.consume_state(st) and not s.consume_state(st) and not s.consume_state("nope") and not s.consume_state(None)
    sid = s.create("tok", FbProfile(id="1", name="A")); assert s.get(sid)
    monkeypatch.setattr(time, "time", lambda t=time.time(): t + 4000); assert s.get(sid) is None


# ---- API ----------------------------------------------------------------------------------------------------------------
@pytest.fixture
def client(monkeypatch):
    monkeypatch.setattr(server, "serp", FakeSerp({"facebook": FB, "web": WEB}))
    monkeypatch.setattr(server, "llm", type("L", (), {"online": False})())
    monkeypatch.setattr(server, "fb", FacebookGraph(app_id="APPID", app_secret="APPSECRET"))
    monkeypatch.setattr(server, "sessions", Sessions())
    return TestClient(server.app, follow_redirects=False)


def test_next_steps_endpoint(client):
    r = client.post("/api/next-steps", json={"topic": "fire safety", "audience": "students", "social_level": 1, "circle": {"school": "UT Austin", "city": "Austin, Texas"}})
    body = r.json(); assert r.status_code == 200 and [l["level"] for l in body["levels"]] == [2, 3] and body["sent"] and body["facebook"] is None
    assert client.post("/api/next-steps", json={"topic": "x", "social_level": 9}).status_code == 422


def test_facebook_flow_end_to_end_without_leaking_secrets(client, monkeypatch):
    assert client.get("/api/facebook/status").json() == {"configured": True, "connected": False}
    loc = client.get("/api/facebook/login"); assert loc.status_code in (302, 307) and "facebook.com" in loc.headers["location"]
    state = server.sessions.new_state()
    monkeypatch.setattr(server.fb, "exchange_code", lambda code: "ACCESS-TOKEN-XYZ")
    monkeypatch.setattr(server.fb, "profile", lambda t: FbProfile(id="777", name="Ada Lovelace", location="Austin, Texas", granted=["public_profile", "user_location"]))
    assert client.get("/api/facebook/callback", params={"code": "c", "state": "forged"}).status_code == 400            # CSRF: unknown state
    ok = client.get("/api/facebook/callback", params={"code": "c", "state": state}); assert ok.status_code in (302, 307)
    assert "httponly" in ok.headers["set-cookie"].lower() and "ACCESS-TOKEN-XYZ" not in ok.headers["set-cookie"]
    st = client.get("/api/facebook/status"); txt = st.text
    assert st.json()["connected"] and st.json()["name"] == "Ada Lovelace" and "ACCESS-TOKEN-XYZ" not in txt and "777" not in txt
    # connected location personalises the community search, only if the learner opted in
    on = client.post("/api/next-steps", json={"topic": "fire safety", "social_level": 3, "use_facebook": True}).json()
    off = client.post("/api/next-steps", json={"topic": "fire safety", "social_level": 3, "use_facebook": False}).json()
    assert any("Austin" in s for s in on["sent"]) and on["facebook"]["location_used"] and not any("Austin" in s for s in off["sent"]) and off["facebook"] is None
    revoked = []; monkeypatch.setattr(server.fb, "revoke", lambda t: revoked.append(t))
    assert client.post("/api/facebook/disconnect").json() == {"connected": False} and revoked == ["ACCESS-TOKEN-XYZ"]
    assert not client.get("/api/facebook/status").json()["connected"]


def test_deauthorize_and_data_deletion_require_a_valid_signature(client):
    sid = server.sessions.create("t", FbProfile(id="777", name="A"))
    bad = client.post("/api/facebook/deauthorize", content=b"signed_request=garbage"); assert bad.status_code == 400 and server.sessions.get(sid)
    good = client.post("/api/facebook/data-deletion", content=("signed_request=" + signed({"user_id": "777"})).encode())
    assert good.status_code == 200 and good.json()["confirmation_code"].startswith("del-") and server.sessions.get(sid) is None
    assert client.get("/api/facebook/deletion-status", params={"code": good.json()["confirmation_code"]}).json()["status"] == "deleted"


def test_login_unconfigured_is_503(monkeypatch):
    monkeypatch.setattr(server, "fb", FacebookGraph(app_id="", app_secret=""))
    assert TestClient(server.app, follow_redirects=False).get("/api/facebook/login").status_code == 503


# ---- ask a question by voice ------------------------------------------------------------------------------------
def _wav(n=2000):
    import struct
    return b"RIFF" + struct.pack("<I", 36 + n) + b"WAVEfmt " + struct.pack("<IHHIIHH", 16, 1, 1, 16000, 32000, 2, 16) + b"data" + struct.pack("<I", n) + b"\0" * n


def test_transcribe_relays_wav_and_never_leaks_key(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    from aep import server
    seen = {}

    def fake_post(url, headers=None, files=None, timeout=None):
        seen.update(url=url, auth=headers["Authorization"], settings=files["request"][1])
        return httpx.Response(200, json={"transcript": " Why aim low? ", "turns": []})
    monkeypatch.setenv("MUSE_API_KEY", "sk-secret-123"); monkeypatch.setattr(httpx, "post", fake_post)
    c = TestClient(server.app)
    r = c.post("/api/transcribe", content=_wav(), headers={"Content-Type": "audio/wav"})
    assert r.json() == {"text": "Why aim low?"} and "sk-secret-123" not in r.text
    assert seen["url"].endswith("/asr/transcribe") and '"audioEncoding": "WAV"' in seen["settings"] and '"PUSH_TO_TALK"' in seen["settings"]
    assert c.post("/api/transcribe", content=b"not audio" * 200).status_code == 422       # not a WAV
    assert c.post("/api/transcribe", content=b"x").status_code == 422                     # empty recording


def test_transcribe_error_hides_upstream_detail(monkeypatch):
    import httpx
    from fastapi.testclient import TestClient
    from aep import server
    monkeypatch.setenv("MUSE_API_KEY", "sk-secret-123")
    monkeypatch.setattr(httpx, "post", lambda *a, **k: httpx.Response(401, text="bad key sk-secret-123"))
    r = TestClient(server.app).post("/api/transcribe", content=_wav())
    assert r.status_code == 422 and "sk-secret-123" not in r.text


def test_ask_offline_falls_back_to_lesson_point(monkeypatch):
    from fastapi.testclient import TestClient
    from aep import server
    from aep.llm import LLM
    monkeypatch.setattr(server, "llm", LLM("offline"))
    r = TestClient(server.app).post("/api/ask", json={"question": "why?", "context": {"learning_point": "Aim at the base."}})
    assert r.json()["answer"] == "Aim at the base."
    assert TestClient(server.app).post("/api/ask", json={"question": "  "}).status_code == 422
