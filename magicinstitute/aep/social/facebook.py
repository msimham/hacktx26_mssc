"""Facebook Login + Graph API for USER-CONSENTED profile signals only (name, location, hometown, how many friends use this app).

The Groups API no longer exists (deprecated in Graph API v19), so groups are discovered via SerpAPI instead.
Tokens live only in server memory for an hour, are never sent to the browser, and disconnect revokes them at Facebook.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time

import httpx
from pydantic import BaseModel

VERSION = os.environ.get("FB_GRAPH_VERSION", "v26.0")
GRAPH, DIALOG = f"https://graph.facebook.com/{VERSION}", f"https://www.facebook.com/{VERSION}/dialog/oauth"
# location/hometown/friends need your app to have access (App Review, or developer/tester roles while in development mode)
SCOPES = os.environ.get("FB_SCOPES", "public_profile,user_location,user_hometown,user_friends")
SESSION_TTL, STATE_TTL = 3600, 600


class FacebookError(RuntimeError):
    pass


class FbProfile(BaseModel):
    id: str
    name: str = ""
    location: str = ""
    hometown: str = ""
    friends_using_app: int | None = None
    granted: list[str] = []


class FacebookGraph:
    def __init__(self, app_id: str | None = None, app_secret: str | None = None, redirect_uri: str | None = None):
        self.app_id = app_id if app_id is not None else os.environ.get("FACEBOOK_APP_ID")
        self.secret = app_secret if app_secret is not None else os.environ.get("FACEBOOK_APP_SECRET")
        self.redirect_uri = redirect_uri or os.environ.get("FB_REDIRECT_URI", "http://localhost:8000/api/facebook/callback")

    @property
    def enabled(self) -> bool:
        return bool(self.app_id and self.secret)

    def login_url(self, state: str) -> str:
        from urllib.parse import urlencode
        return f"{DIALOG}?" + urlencode({"client_id": self.app_id, "redirect_uri": self.redirect_uri, "state": state, "scope": SCOPES, "response_type": "code"})

    def _proof(self, token: str) -> str:    # appsecret_proof: proves server-side calls come from the app that owns the secret
        return hmac.new(self.secret.encode(), token.encode(), hashlib.sha256).hexdigest()

    def _call(self, method: str, path: str, token: str | None = None, **params) -> dict:
        if token:
            params |= {"access_token": token, "appsecret_proof": self._proof(token)}
        try:
            r = httpx.request(method, f"{GRAPH}/{path}", params=params, timeout=20)
        except httpx.HTTPError as e:
            raise FacebookError(f"Facebook request failed ({type(e).__name__})") from None
        data = r.json() if r.content else {}
        if r.status_code >= 400 or "error" in data:
            raise FacebookError(str((data.get("error") or {}).get("message", f"Facebook returned {r.status_code}"))[:160])
        return data

    def exchange_code(self, code: str) -> str:
        d = self._call("GET", "oauth/access_token", client_id=self.app_id, redirect_uri=self.redirect_uri, client_secret=self.secret, code=code)
        return d["access_token"]

    def profile(self, token: str) -> FbProfile:
        me = self._call("GET", "me", token, fields="id,name,location,hometown")
        granted = [p["permission"] for p in self._call("GET", "me/permissions", token).get("data", []) if p.get("status") == "granted"]
        friends = None
        if "user_friends" in granted:     # only friends who also use this app are visible to it
            try:
                friends = self._call("GET", "me/friends", token, limit=0).get("summary", {}).get("total_count")
            except FacebookError:
                pass
        return FbProfile(id=me["id"], name=me.get("name", ""), location=(me.get("location") or {}).get("name", ""),
                         hometown=(me.get("hometown") or {}).get("name", ""), friends_using_app=friends, granted=granted)

    def revoke(self, token: str) -> None:
        try:
            self._call("DELETE", "me/permissions", token)
        except FacebookError:
            pass

    def parse_signed_request(self, signed: str) -> dict:
        """Verify the signed_request Facebook sends to the deauthorize / data-deletion callbacks."""
        try:
            sig, payload = signed.split(".", 1)
            pad = lambda s: s + "=" * (-len(s) % 4)
            expected = hmac.new(self.secret.encode(), payload.encode(), hashlib.sha256).digest()
            if not hmac.compare_digest(base64.urlsafe_b64decode(pad(sig)), expected):
                raise FacebookError("bad signature")
            return json.loads(base64.urlsafe_b64decode(pad(payload)))
        except (ValueError, KeyError, json.JSONDecodeError):
            raise FacebookError("malformed signed_request") from None


class Sessions:
    """In-memory only: nothing about a Facebook user is written to disk."""
    def __init__(self):
        self.states: dict[str, float] = {}
        self.sessions: dict[str, dict] = {}

    def new_state(self) -> str:
        now = time.time(); self.states = {k: v for k, v in self.states.items() if v > now}
        s = secrets.token_urlsafe(24); self.states[s] = now + STATE_TTL; return s

    def consume_state(self, s: str | None) -> bool:     # one-time, protects the OAuth redirect against CSRF
        return bool(s) and self.states.pop(s, 0) > time.time()

    def create(self, token: str, profile: FbProfile) -> str:
        now = time.time(); self.sessions = {k: v for k, v in self.sessions.items() if v["exp"] > now}
        sid = secrets.token_urlsafe(24); self.sessions[sid] = {"token": token, "profile": profile, "exp": now + SESSION_TTL}; return sid

    def get(self, sid: str | None) -> dict | None:
        v = self.sessions.get(sid or ""); return v if v and v["exp"] > time.time() else None

    def drop(self, sid: str | None) -> dict | None:
        return self.sessions.pop(sid or "", None)

    def drop_user(self, fb_id: str) -> int:
        gone = [k for k, v in self.sessions.items() if v["profile"].id == fb_id]
        for k in gone: del self.sessions[k]
        return len(gone)
