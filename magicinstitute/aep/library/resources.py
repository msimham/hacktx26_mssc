"""Curated real-world follow-ups. Curated + search URLs only: the LLM never invents links."""
from __future__ import annotations

from urllib.parse import quote_plus

from aep.schema import Resource

MAP_FIRE_STATION = "https://www.google.com/maps/search/fire+station/@{lat},{lng},14z"

CATALOG: dict[str, list[Resource]] = {
    "fire": [
        Resource(title="Find your nearest fire station", url=MAP_FIRE_STATION, kind="map",
                 note="Opens a map centered on you.", needs_location=True),
        Resource(title="Ready.gov: Home fires", url="https://www.ready.gov/home-fires", kind="guide",
                 note="Escape planning and prevention basics."),
        Resource(title="NFPA: Home fire safety", url="https://www.nfpa.org/education-and-research/home-fire-safety",
                 kind="guide", note="Smoke alarms, escape plans, cooking safety."),
        Resource(title="How fire blankets work", url="https://www.google.com/search?q=" + quote_plus("how to use a fire safety blanket"),
                 kind="search", note="Search results for fire blanket use."),
        Resource(title="Fire extinguisher PASS technique", url="https://www.google.com/search?q=" + quote_plus("fire extinguisher PASS technique"),
                 kind="search"),
    ],
}

KEYWORDS = {"fire": ["fire", "burn", "smoke", "evacuat"]}


def for_topic(topic: str, extra_queries: list[str] | None = None) -> list[Resource]:
    t = topic.lower()
    out: list[Resource] = []
    for key, words in KEYWORDS.items():
        if any(w in t for w in words):
            out += CATALOG[key]
    for q in extra_queries or []:
        out.append(Resource(title=f"Search: {q}", url="https://www.google.com/search?q=" + quote_plus(q), kind="search"))
    if not out:
        out.append(Resource(title=f"Learn more: {topic}", url="https://www.google.com/search?q=" + quote_plus(topic + " guide"),
                            kind="search", note="No curated resources for this topic yet."))
    return out
