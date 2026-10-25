"""Thin LLM wrapper. Returns validated pydantic objects; falls back to offline mode with no API key.

Providers: "muse" (Meta Model API, OpenAI-style chat completions) or "anthropic".
Pick with AEP_PROVIDER; default is muse if MUSE_API_KEY is set, else anthropic if ANTHROPIC_API_KEY is set.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import TypeVar

import httpx
from pydantic import BaseModel, ValidationError

T = TypeVar("T", bound=BaseModel)


def _load_dotenv() -> None:
    """Minimal .env loader (never overrides real env vars). .env is gitignored."""
    f = Path(__file__).resolve().parent.parent / ".env"
    if not f.exists():
        return
    for line in f.read_text().splitlines():
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            os.environ.setdefault(k.strip(), v.strip().strip("'\""))


_load_dotenv()
ANTHROPIC_MODEL = os.environ.get("AEP_MODEL", "claude-sonnet-5-5")
MUSE_MODEL = os.environ.get("AEP_MUSE_MODEL", "muse-spark-1.3")
MUSE_REASONING = os.environ.get("AEP_MUSE_REASONING", "low")  # reasoning tokens count against max_tokens
MUSE_BASE = os.environ.get("MUSE_API_BASE", "https://api.meta.ai/v1")


class LLM:
    def __init__(self, provider: str | None = None):
        self.provider = None
        self.anthropic = None
        want = provider or os.environ.get("AEP_PROVIDER")
        muse_key, ant_key = os.environ.get("MUSE_API_KEY"), os.environ.get("ANTHROPIC_API_KEY")
        if want == "muse" or (want is None and muse_key):
            if muse_key:
                self.provider, self._muse_key = "muse", muse_key
        elif ant_key:
            import anthropic
            self.provider, self.anthropic = "anthropic", anthropic.Anthropic(api_key=ant_key)

    @property
    def online(self) -> bool:
        return self.provider is not None

    def _complete(self, system: str, messages: list[dict], model: type[BaseModel], max_tokens: int, effort: str | None = None) -> tuple[str, bool]:
        """Returns (text, truncated)."""
        if self.provider == "muse":
            r = httpx.post(
                f"{MUSE_BASE}/chat/completions",
                headers={"Authorization": f"Bearer {self._muse_key}"},
                json={"model": MUSE_MODEL, "max_tokens": max_tokens, "reasoning_effort": effort or MUSE_REASONING,
                      "messages": [{"role": "system", "content": system}, *messages],
                      "response_format": {"type": "json_schema",
                                          "json_schema": {"name": model.__name__, "schema": model.model_json_schema()}}},
                timeout=180)
            if r.status_code >= 400:
                raise RuntimeError(f"Muse API {r.status_code}: {r.text[:300]}")
            choice = r.json()["choices"][0]
            # content is None when the budget ran out mid-reasoning
            return choice["message"].get("content") or "", choice.get("finish_reason") == "length"
        resp = self.anthropic.messages.create(model=ANTHROPIC_MODEL, max_tokens=max_tokens, system=system, messages=messages)
        return "".join(b.text for b in resp.content if b.type == "text"), resp.stop_reason == "max_tokens"

    def chat(self, system: str, user: str, max_tokens: int = 1500) -> str:
        """Plain-text answer (no JSON schema); used for the learner's live questions."""
        assert self.online
        if self.provider == "muse":
            r = httpx.post(f"{MUSE_BASE}/chat/completions", headers={"Authorization": f"Bearer {self._muse_key}"},
                           json={"model": MUSE_MODEL, "max_tokens": max_tokens, "reasoning_effort": "low",
                                 "messages": [{"role": "system", "content": system}, {"role": "user", "content": user}]}, timeout=60)
            if r.status_code >= 400:
                raise RuntimeError(f"Muse API {r.status_code}")
            return (r.json()["choices"][0]["message"].get("content") or "").strip()
        resp = self.anthropic.messages.create(model=ANTHROPIC_MODEL, max_tokens=max_tokens, system=system, messages=[{"role": "user", "content": user}])
        return "".join(b.text for b in resp.content if b.type == "text").strip()

    def structured(self, system: str, user: str, model: type[T], *, max_tokens: int = 12000, retries: int = 2, effort: str | None = None) -> T:
        """Ask for JSON matching `model`; on invalid output, feed the error back and retry."""
        assert self.online, "structured() needs an API key; agents must check .online first"
        schema = json.dumps(model.model_json_schema())
        sys_prompt = f"{system}\n\nReply with ONLY a JSON object matching this JSON Schema, no prose, no code fences:\n{schema}"
        messages = [{"role": "user", "content": user}]
        last_err = ""
        for _ in range(retries + 2):
            text, truncated = self._complete(sys_prompt, messages, model, max_tokens, effort)
            if truncated:  # same prompt with a bigger budget; reasoning tokens share the cap
                last_err = f"output truncated at {max_tokens} tokens"
                max_tokens = min(max_tokens * 2, 32000)
                continue
            try:
                m = re.search(r"\{.*\}", text, re.S)
                return model.model_validate_json(m.group(0) if m else text)
            except (ValidationError, ValueError) as e:
                last_err = str(e)
                messages += [
                    {"role": "assistant", "content": text},
                    {"role": "user", "content": f"That was invalid: {last_err[:1500]}\nReturn corrected JSON only."},
                ]
        raise RuntimeError(f"LLM output failed validation after retries: {last_err[:500]}")
