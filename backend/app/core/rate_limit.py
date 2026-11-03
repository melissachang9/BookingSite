"""Per-caller request limits for the endpoints anyone on the internet can reach.

A sliding window held in this process's memory. That is exact for one app instance; with several, each
instance counts separately, so a caller can get up to that many times the limit. Put a proxy-level limit
in front too when scaling out. Limits are by caller IP (see core/client_ip.py for how that is read).
"""

from __future__ import annotations

import time
from collections import deque
from collections.abc import Awaitable, Callable

from fastapi import HTTPException, Request

from app.core.client_ip import client_ip
from app.core.config import get_settings
from app.core.http import api_exception

_PRUNE_EVERY = 1000


class SlidingWindowLimiter:
    def __init__(self) -> None:
        self._hits: dict[tuple[str, str], deque[float]] = {}
        self._calls = 0

    def reset(self) -> None:
        self._hits.clear()
        self._calls = 0

    def check(self, name: str, key: str, limit: int, window_seconds: int, now: float | None = None) -> int | None:
        """Record a hit. Returns None if allowed, else the seconds until the caller may try again."""
        now = time.monotonic() if now is None else now
        hits = self._hits.setdefault((name, key), deque())
        cutoff = now - window_seconds
        while hits and hits[0] <= cutoff:
            hits.popleft()
        if len(hits) >= limit:
            return max(1, int(hits[0] + window_seconds - now) + 1)
        hits.append(now)
        self._calls += 1
        if self._calls % _PRUNE_EVERY == 0:
            self._prune(now, window_seconds)
        return None

    def _prune(self, now: float, window_seconds: int) -> None:
        for key in [k for k, hits in self._hits.items() if not hits or hits[-1] <= now - window_seconds]:
            del self._hits[key]


limiter = SlidingWindowLimiter()


def enforce_rate_limit(name: str, key: str, *, limit: int, window_seconds: int) -> None:
    """Count one hit for `key` under `name`; raise 429 with Retry-After once over the limit."""
    if not get_settings().rate_limit_enabled:
        return
    retry_after = limiter.check(name, key, limit, window_seconds)
    if retry_after is not None:
        error = api_exception(429, "rate_limited", "Too many requests. Please wait a moment and try again.")
        raise HTTPException(status_code=429, detail=error.detail, headers={"Retry-After": str(retry_after)})


def rate_limit(name: str, *, limit: int, window_seconds: int) -> Callable[[Request], Awaitable[None]]:
    """A route dependency allowing `limit` requests per `window_seconds` from one IP."""

    async def dependency(request: Request) -> None:
        enforce_rate_limit(name, client_ip(request) or "unknown", limit=limit, window_seconds=window_seconds)

    return dependency
