"""SerpAPI client: Google web search and Google Maps. Results are cached (SerpAPI bills per search) and the API key is never
included in errors, logs or responses."""
from __future__ import annotations

import hashlib
import json
import os
import time
from pathlib import Path

import httpx
from pydantic import BaseModel

BASE = "https://serpapi.com/search"
CACHE = Path(__file__).resolve().parent.parent.parent / "runs" / "serp_cache"
TTL = int(os.environ.get("SERP_CACHE_SECONDS", 86400))


class SerpError(RuntimeError):
    pass


class Hit(BaseModel):
    title: str
    link: str
    snippet: str = ""
    displayed_link: str = ""


class Place(BaseModel):
    title: str
    address: str = ""
    rating: float | None = None
    reviews: int | None = None
    phone: str = ""
    lat: float | None = None
    lng: float | None = None
    link: str = ""


class SerpClient:
    def __init__(self, key: str | None = None, cache: Path | None = CACHE):
        self._key = key if key is not None else os.environ.get("SERPAPI_KEY")
        self.cache = cache

    @property
    def online(self) -> bool:
        return bool(self._key)

    def _get(self, params: dict) -> dict:
        if not self._key:
            raise SerpError("SERPAPI_KEY is not set")
        ident = hashlib.sha1(json.dumps(params, sort_keys=True).encode()).hexdigest()   # the key is not part of the cache identity
        f = self.cache / f"{ident}.json" if self.cache else None
        if f and f.exists() and time.time() - f.stat().st_mtime < TTL:
            return json.loads(f.read_text())
        try:
            r = httpx.get(BASE, params={**params, "output": "json", "api_key": self._key}, timeout=25)
        except httpx.HTTPError as e:     # httpx errors embed the URL (and so the key): report only the type
            raise SerpError(f"SerpAPI request failed ({type(e).__name__})") from None
        if r.status_code >= 400:
            raise SerpError(f"SerpAPI returned {r.status_code}")
        data = r.json()
        if data.get("error"):
            raise SerpError(f"SerpAPI: {str(data['error'])[:120]}")
        if f:
            f.parent.mkdir(parents=True, exist_ok=True); f.write_text(json.dumps(data))
        return data

    def search(self, q: str, *, location: str | None = None, gl: str = "us", hl: str = "en", n: int = 8) -> list[Hit]:
        params = {"engine": "google", "q": q, "gl": gl, "hl": hl, **({"location": location} if location else {})}
        out = []
        for r in self._get(params).get("organic_results", [])[:n]:
            if r.get("link") and r.get("title"):
                out.append(Hit(title=r["title"], link=r["link"], snippet=r.get("snippet", ""), displayed_link=r.get("displayed_link", "")))
        return out

    def places(self, q: str, *, lat: float | None = None, lng: float | None = None, location: str | None = None, n: int = 5) -> list[Place]:
        params = {"engine": "google_maps", "type": "search", "q": q}
        if lat is not None and lng is not None:
            params["ll"] = f"@{lat:.5f},{lng:.5f},14z"
        elif location:
            params["location"] = location
        else:
            return []
        out = []
        for r in self._get(params).get("local_results", [])[:n]:
            gps = r.get("gps_coordinates") or {}
            pid = r.get("place_id", "")
            out.append(Place(title=r.get("title", ""), address=r.get("address", ""), rating=r.get("rating"), reviews=r.get("reviews"), phone=r.get("phone", ""),
                             lat=gps.get("latitude"), lng=gps.get("longitude"),
                             link=(f"https://www.google.com/maps/place/?q=place_id:{pid}" if pid else (f"https://www.google.com/maps/search/?api=1&query={gps['latitude']},{gps['longitude']}" if gps else ""))))
        return [p for p in out if p.title]
