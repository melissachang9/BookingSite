"""Public and login endpoints are limited per caller; the limiter itself counts a sliding window."""

from __future__ import annotations

import pytest

from app.core.rate_limit import SlidingWindowLimiter

API = "/api/v1"


def test_window_allows_up_to_the_limit_then_blocks_until_it_slides() -> None:
    limiter = SlidingWindowLimiter()
    assert [limiter.check("x", "a", 3, 60, now=t) for t in (0, 1, 2)] == [None, None, None]
    wait = limiter.check("x", "a", 3, 60, now=3)
    assert wait is not None and 55 <= wait <= 61
    # Another caller and another endpoint are unaffected.
    assert limiter.check("x", "b", 3, 60, now=3) is None
    assert limiter.check("y", "a", 3, 60, now=3) is None
    # Once the oldest hit leaves the window there is room again.
    assert limiter.check("x", "a", 3, 60, now=61) is None
    assert limiter.check("x", "a", 3, 60, now=61.5) is None  # hits at 2, 61, 61.5 now fill the window
    assert limiter.check("x", "a", 3, 60, now=61.7) is not None


def test_old_entries_are_pruned() -> None:
    limiter = SlidingWindowLimiter()
    for index in range(1000):
        limiter.check("x", f"caller-{index}", 5, 10, now=float(index) / 1000)
    limiter.check("x", "late", 5, 10, now=100.0)
    for index in range(999):
        limiter.check("x", f"filler-{index}", 5, 10, now=100.0 + index / 1000)
    assert len(limiter._hits) < 1500


@pytest.fixture()
def limited(client, monkeypatch):
    from app.core.config import get_settings
    from app.core.rate_limit import limiter

    monkeypatch.setenv("RATE_LIMIT_ENABLED", "true")
    get_settings.cache_clear()
    limiter.reset()
    yield client
    monkeypatch.setenv("RATE_LIMIT_ENABLED", "false")
    get_settings.cache_clear()
    limiter.reset()


def test_repeated_wrong_passwords_for_one_account_are_blocked_with_retry_after(limited) -> None:
    body = {"email": "owner@browbeautylab.test", "password": "wrong-password"}
    statuses = [limited.post(f"{API}/auth/login", json=body).status_code for _ in range(10)]
    assert statuses[:8] == [401] * 8
    assert statuses[8] == 429
    blocked = limited.post(f"{API}/auth/login", json=body)
    assert blocked.status_code == 429
    assert blocked.json()["error"]["code"] == "rate_limited"
    assert int(blocked.headers["retry-after"]) > 0
    # Even the right password is refused while blocked: guessing gets no feedback.
    right = limited.post(f"{API}/auth/login", json={"email": body["email"], "password": "DemoBooking123"})
    assert right.status_code == 429


def test_a_different_account_from_the_same_address_is_not_locked_out_by_it(limited) -> None:
    for _ in range(9):
        limited.post(f"{API}/auth/login", json={"email": "owner@browbeautylab.test", "password": "nope"})
    other = limited.post(f"{API}/auth/login", json={"email": "someone-else@example.com", "password": "nope"})
    assert other.status_code == 401


def test_tenant_signup_is_limited_per_address(limited) -> None:
    statuses = [limited.post(f"{API}/tenants", json={}).status_code for _ in range(7)]
    # Invalid bodies are rejected (422) until the limit is reached, then every request is a 429.
    assert statuses[:5] == [422] * 5
    assert statuses[5:] == [429, 429]


def test_uploads_and_card_charges_are_limited(limited) -> None:
    png = b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    codes = [
        limited.post(f"{API}/forms/upload", data={"tenant_id": "brow-beauty-lab"}, files={"file": ("a.png", png, "image/png")}).status_code
        for _ in range(31)
    ]
    assert codes[:30] == [200] * 30 and codes[30] == 429

    charge = f"{API}/tenants/brow-beauty-lab/payments/checkout-sessions/none/card-charge"
    results = [limited.post(charge, json={}).status_code for _ in range(11)]
    assert 429 not in results[:10] and results[10] == 429


def test_the_limits_can_be_switched_off_for_local_runs(client) -> None:
    body = {"email": "owner@browbeautylab.test", "password": "wrong-password"}
    assert {client.post(f"{API}/auth/login", json=body).status_code for _ in range(12)} == {401}
