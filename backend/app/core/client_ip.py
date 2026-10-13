from __future__ import annotations

from fastapi import Request

from app.core.config import get_settings


def client_ip(request: Request) -> str | None:
    """The caller's IP, for the card processor's fraud checks.

    X-Forwarded-For is only believed behind a proxy we control
    (TRUST_PROXY_HEADERS), since anyone can send that header themselves.
    """
    if get_settings().trust_proxy_headers:
        forwarded = request.headers.get("x-forwarded-for", "")
        first = forwarded.split(",")[0].strip()
        if first:
            return first
    return request.client.host if request.client else None
