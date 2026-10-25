"""Suggests the learner's NEXT social levels: (2) friends / school / workplace, then (3) the geographic community.

Every URL comes straight from SerpAPI results; the LLM may only rank and explain results by index, never invent them. We only link out:
nothing is scraped from groups and nobody is contacted or joined on the learner's behalf.
"""
from __future__ import annotations

import re
from concurrent.futures import ThreadPoolExecutor
from typing import Literal
from urllib.parse import urlparse

from pydantic import BaseModel, Field

from aep.library.resources import KEYWORDS
from aep.llm import LLM
from aep.social.serp import Hit, Place, SerpClient, SerpError

PER_LEVEL = 6
PLACE_HINTS = {"fire": "fire station"}                 # topic family -> the physical place worth knowing
LEVEL_TITLES = {2: "Friends, school & work", 3: "Your community"}
NOISE = re.compile(r"\b(buy|shop|coupon|sale|pricing|login|sign in|obituar)", re.I)


class Circle(BaseModel):
    """What the learner chooses to tell us. Everything is optional."""
    school: str = ""
    organization: str = ""
    city: str = ""
    country: str = "us"
    lat: float | None = None
    lng: float | None = None


class Suggestion(BaseModel):
    level: Literal[2, 3]
    kind: Literal["group", "organization", "place"]
    source: Literal["facebook-group", "web", "maps"]
    title: str
    url: str
    snippet: str = ""
    why: str = ""
    address: str = ""
    rating: float | None = None


class Level(BaseModel):
    level: Literal[2, 3]
    title: str
    subtitle: str
    items: list[Suggestion] = []


class NextSteps(BaseModel):
    configured: bool
    levels: list[Level] = []
    sent: list[str] = []         # exactly what was sent to SerpAPI, shown to the learner
    notes: list[str] = []


def levels_after(reached: int) -> list[int]:
    """Level 1 -> friends/school/work and community; level 2 -> community; level 3 -> keep growing the local community."""
    return {1: [2, 3], 2: [3], 3: [3]}[reached]


def clean(s: str, n: int = 60) -> str:
    """Learner text goes inside quoted search phrases: drop quotes, operators and control characters."""
    return re.sub(r'["\\\n\r\t]|\b(site|inurl|intitle|filetype):', " ", s or "").strip()[:n].strip()


def topic_family(topic: str) -> str | None:
    t = topic.lower()
    return next((k for k, words in KEYWORDS.items() if any(w in t for w in words)), None)


def build_queries(topic: str, audience: str, c: Circle, level: int) -> list[dict]:
    t, a, school, org, city = clean(topic), clean(audience), clean(c.school), clean(c.organization), clean(c.city)
    out: list[dict] = []
    if level == 2:
        for name, noun in ((school, "student organization OR club"), (org, "employee resource OR training group")):
            if name:
                out += [{"q": f'"{name}" {t} {noun}', "kind": "organization"}, {"q": f'site:facebook.com/groups "{name}" {t}', "kind": "group"}]
        if not (school or org):
            out += [{"q": f"{t} {a} student organization OR club", "kind": "organization"}, {"q": f"site:facebook.com/groups {t} {a}", "kind": "group"}]
    else:
        where = city or None
        fam = topic_family(topic)
        out += [{"q": f"{t} community group{' ' + city if city else ' near me'}", "kind": "group", "location": where},
                {"q": f"site:facebook.com/groups {city + ' ' if city else ''}{t}", "kind": "group", "location": where}]
        if fam == "fire":
            out.append({"q": f"CERT community emergency response team{' ' + city if city else ''}", "kind": "organization", "location": where})
        else:
            out.append({"q": f"{t} volunteer program{' ' + city if city else ''}", "kind": "organization", "location": where})
    return out[:4]


def _domain(url: str) -> str:
    return urlparse(url).netloc.lower().removeprefix("www.")


def _is_fb_group(url: str) -> bool:
    p = urlparse(url)
    return p.netloc.lower().endswith("facebook.com") and p.path.lower().startswith("/groups/") and len(p.path.strip("/").split("/")) >= 2


def _score(h: Hit, words: set[str], fb: bool) -> int:
    text = f"{h.title} {h.snippet}".lower()
    return (3 if fb else 0) + sum(1 for w in words if w in text) - (4 if NOISE.search(text) else 0)


class Ranked(BaseModel):
    class Item(BaseModel):
        index: int
        why: str = Field(description="One short sentence on why this suits the learner")
    items: list[Item]


def suggest(topic: str, audience: str, circle: Circle, reached: int, serp: SerpClient, llm: LLM | None = None) -> NextSteps:
    if not serp.online:
        return NextSteps(configured=False, notes=["Set SERPAPI_KEY in .env to find groups and places."])
    plan = {lv: build_queries(topic, audience, circle, lv) for lv in levels_after(reached)}
    sent, notes, raw = [], [], {}
    jobs = [(lv, q) for lv, qs in plan.items() for q in qs]

    def run(job):
        lv, q = job
        try:
            return lv, q, serp.search(q["q"], location=q.get("location"), gl=(circle.country or "us").lower()[:2]), None
        except SerpError as e:
            return lv, q, [], str(e)
    with ThreadPoolExecutor(max_workers=4) as pool:
        for lv, q, hits, err in pool.map(run, jobs):
            sent.append(q["q"] + (f"  [location: {q['location']}]" if q.get("location") else ""))
            if err and err not in notes: notes.append(err)
            for h in hits: raw.setdefault(lv, []).append((q["kind"], h))

    levels = []
    words = {w for s in (topic, circle.school, circle.organization, circle.city) for w in re.findall(r"[a-z]{4,}", s.lower())}
    for lv in plan:
        seen, cands = set(), []
        for kind, h in raw.get(lv, []):
            key = h.link.split("#")[0].rstrip("/").lower()
            if key in seen or not h.link.startswith("http"):
                continue
            fb = _is_fb_group(h.link)
            if "facebook.com" in _domain(h.link) and not fb:
                continue                                                    # keep only real group pages from Facebook, not posts/profiles
            seen.add(key); cands.append((fb, "group" if fb or "meetup.com" in _domain(h.link) else kind, h))
        cands.sort(key=lambda c: -_score(c[2], words, c[0]))
        picked = _rank(cands[:14], topic, circle, lv, llm)
        items = [Suggestion(level=lv, kind=kind, source="facebook-group" if fb else "web", title=h.title, url=h.link, snippet=h.snippet, why=why)
                 for (fb, kind, h), why in picked[:PER_LEVEL]]
        if lv == 3:
            items += _places(topic, circle, serp, notes, sent)
        who = circle.school or circle.organization
        levels.append(Level(level=lv, title=LEVEL_TITLES[lv], items=items,
                            subtitle=(f"Bring {topic} to {who}" if lv == 2 and who else f"Bring {topic} to the people around me" if lv == 2 else f"Near {circle.city}" if circle.city else "Near me")))
    return NextSteps(configured=True, levels=levels, sent=sent, notes=notes)


def _why(fb: bool, kind: str, topic: str, circle: Circle, lv: int) -> str:
    where = (circle.school or circle.organization) if lv == 2 else circle.city
    base = "Public Facebook group" if fb else "Organization" if kind == "organization" else "Community"
    return f"{base} about {topic}" + (f" connected to {where}" if where else "")


def _rank(cands, topic, circle, lv, llm):
    plain = [(c, _why(c[0], c[1], topic, circle, lv)) for c in cands]
    if not cands or not llm or not llm.online:
        return plain
    listing = [{"index": i, "title": h.title, "snippet": h.snippet[:160], "site": _domain(h.link)} for i, (_, _, h) in enumerate(cands)]
    try:
        out = llm.structured(
            "You help a learner who just practiced a real-world skill find people to practice and share it with. From the numbered web results, "
            f"pick up to {PER_LEVEL} that are real communities, clubs, groups or programs they could join or attend, "
            f"{'at their school, workplace or friend circle' if lv == 2 else 'in their local community'}. Skip news, ads, shops, single posts and anything off-topic. "
            "Reference results ONLY by their index; write one short, plain reason each.",
            f"Skill: {topic}\nLevel: {lv}\nSchool: {circle.school or '-'}\nOrganization: {circle.organization or '-'}\nCity: {circle.city or '-'}\nResults: {listing}",
            Ranked, max_tokens=3000)
    except RuntimeError:
        return plain
    picked, used = [], set()
    for it in out.items:
        if 0 <= it.index < len(cands) and it.index not in used:       # an index the model made up is dropped, never turned into a link
            used.add(it.index); picked.append((cands[it.index], it.why.strip()[:160] or plain[it.index][1]))
    return picked or plain


def _places(topic, circle, serp, notes, sent) -> list[Suggestion]:
    fam = topic_family(topic)
    q = PLACE_HINTS.get(fam or "")
    if not q or not ((circle.lat is not None and circle.lng is not None) or circle.city):
        return []
    try:
        ps = serp.places(q, lat=circle.lat, lng=circle.lng, location=circle.city or None, n=3)
    except SerpError as e:
        if str(e) not in notes: notes.append(str(e))
        return []
    sent.append(f"{q} [Google Maps near {'your device location' if circle.lat is not None else circle.city}]")
    return [Suggestion(level=3, kind="place", source="maps", title=p.title, url=p.link, address=p.address, rating=p.rating,
                       snippet=p.phone, why=f"Nearest {q}: worth knowing before I ever need it") for p in ps if p.link]
