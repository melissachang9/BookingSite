"""Server-side Meta conversions: token storage, queueing on confirmation, sending with retries."""

from __future__ import annotations

import asyncio

import httpx
from sqlalchemy import select

from test_attribution import _draft_with, _row, _setup
from test_provider_terms_and_resources import API, _auth, _confirm

PIXEL = "123456789012345"
TOKEN = "EAAB" + "x" * 40


def _connect(client, headers, *, pixel: bool = True, test_code: str | None = None):
    if pixel:
        saved = client.patch(f"{API}/settings", json={"metaPixelId": PIXEL}, headers=headers)
        assert saved.status_code == 200, saved.json()
    body = {"accessToken": TOKEN}
    if test_code:
        body["testEventCode"] = test_code
    return client.put(f"{API}/ad-tracking/meta", json=body, headers=headers)


def _events():
    from app.db.models import ConversionEvent
    from app.db.session import get_session_maker

    async def _run():
        async with get_session_maker()() as session:
            return list((await session.scalars(select(ConversionEvent).order_by(ConversionEvent.created_at))).all())

    return asyncio.run(_run())


def _send(monkeypatch, responder):
    from app.services import ad_conversions

    calls: list[dict] = []

    async def fake_post(url: str, body: dict):
        calls.append({"url": url, "body": body})
        return responder(len(calls))

    monkeypatch.setattr(ad_conversions, "_post_to_meta", fake_post)
    return calls, asyncio.run(ad_conversions.send_pending_conversions())


def _ok(_n: int) -> httpx.Response:
    return httpx.Response(200, json={"events_received": 1})


def test_token_is_write_only_and_needs_a_pixel_id(client) -> None:
    headers = _auth(client)
    refused = _connect(client, headers, pixel=False)
    assert refused.status_code == 422

    connected = _connect(client, headers, test_code="TEST123")
    assert connected.status_code == 200, connected.json()
    body = connected.json()
    assert body["metaConnected"] is True and body["metaTestMode"] is True
    assert TOKEN not in str(body)
    assert TOKEN not in str(client.get(f"{API}/ad-tracking", headers=headers).json())
    assert TOKEN not in str(client.get(f"{API}").json())

    removed = client.delete(f"{API}/ad-tracking/meta", headers=headers)
    assert removed.status_code == 200 and removed.json()["metaConnected"] is False


def test_ad_tracking_routes_need_the_settings_permission(client) -> None:
    assert client.get(f"{API}/ad-tracking").status_code in (401, 403)
    assert client.put(f"{API}/ad-tracking/meta", json={"accessToken": TOKEN}).status_code in (401, 403)
    assert client.delete(f"{API}/ad-tracking/meta").status_code in (401, 403)


def test_malformed_token_is_rejected(client) -> None:
    headers = _auth(client)
    client.patch(f"{API}/settings", json={"metaPixelId": PIXEL}, headers=headers)
    for token in ("short", "has spaces in it which is not allowed at all", "<script>" + "a" * 30):
        response = client.put(f"{API}/ad-tracking/meta", json={"accessToken": token}, headers=headers)
        assert response.status_code == 422, token


def test_confirmed_online_booking_is_queued_and_sent_with_hashed_user_data(client, monkeypatch) -> None:
    headers, service, slots = _setup(client)
    _connect(client, headers)
    created = _draft_with(client, service["id"], slots[0], {"source": "facebook", "fbclid": "IwAR-abc"})
    booking = _confirm(client, created.json()["id"], "Capi.Guest@Example.com")

    queued = [e for e in _events() if e.booking_id == booking["id"]]
    assert len(queued) == 1
    assert (queued[0].platform, queued[0].event_name, queued[0].status) == ("meta", "Schedule", "pending")
    assert queued[0].event_id == booking["id"]

    calls, attempted = _send(monkeypatch, _ok)
    assert attempted >= 1
    mine = [c for c in calls if c["body"]["data"][0]["event_id"] == booking["id"]]
    assert len(mine) == 1
    assert mine[0]["url"].endswith(f"/{PIXEL}/events")
    event = mine[0]["body"]["data"][0]
    assert event["event_name"] == "Schedule" and event["action_source"] == "website"
    import hashlib

    assert event["user_data"]["em"] == [hashlib.sha256(b"capi.guest@example.com").hexdigest()]
    assert event["user_data"]["fbc"].endswith(".IwAR-abc")
    assert "Capi.Guest" not in str(mine[0]["body"])
    assert event["custom_data"]["currency"] == "USD"
    assert mine[0]["body"]["access_token"] == TOKEN

    done = [e for e in _events() if e.booking_id == booking["id"]][0]
    assert done.status == "sent" and done.sent_at is not None
    # A second pass has nothing left to send for it.
    _, again = _send(monkeypatch, _ok)
    assert again == 0


def test_failures_are_retried_then_marked_failed_with_the_reason(client, monkeypatch) -> None:
    from app.db.models import ConversionEvent
    from app.db.session import get_session_maker
    from app.services import ad_conversions

    headers, service, slots = _setup(client)
    _connect(client, headers)
    booking = _confirm(client, _draft_with(client, service["id"], slots[1], None).json()["id"], "capi-retry@example.com")

    def bad(_n: int) -> httpx.Response:
        return httpx.Response(400, json={"error": {"message": "Invalid OAuth access token."}})

    for _ in range(ad_conversions.MAX_ATTEMPTS):
        _send(monkeypatch, bad)
        # Pull the retry time forward so the next pass picks it up.
        async def _due():
            async with get_session_maker()() as session:
                for ev in (await session.scalars(select(ConversionEvent))).all():
                    if ev.status == "pending":
                        ev.next_attempt_at = None
                await session.commit()

        asyncio.run(_due())

    row = [e for e in _events() if e.booking_id == booking["id"]][0]
    assert row.status == "failed" and row.attempts == ad_conversions.MAX_ATTEMPTS
    assert "Invalid OAuth access token" in (row.last_error or "")
    assert TOKEN not in (row.last_error or "")
    status = client.get(f"{API}/ad-tracking", headers=headers).json()
    assert status["metaFailedCount"] >= 1 and "Invalid OAuth" in status["metaLastError"]


def test_nothing_is_queued_without_a_token_or_for_staff_bookings(client) -> None:
    headers, service, slots = _setup(client)
    # No token yet.
    client.patch(f"{API}/settings", json={"metaPixelId": PIXEL}, headers=headers)
    b1 = _confirm(client, _draft_with(client, service["id"], slots[0], None).json()["id"], "capi-none@example.com")
    assert not [e for e in _events() if e.booking_id == b1["id"]]

    _connect(client, headers)
    staff = client.post(
        f"{API}/booking-drafts",
        headers=headers,
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slots[8]["providerId"],
            "locationId": slots[8]["locationId"],
            "startsAt": slots[8]["startAt"],
            "bookingMethod": "staff_entered",
            "customer": {"name": "Staff Guest", "email": "capi-staff@example.com", "phone": "555-0112"},
        },
    )
    assert staff.status_code in (200, 201), staff.json()
    b2 = _confirm(client, staff.json()["id"], "capi-staff@example.com")
    assert not [e for e in _events() if e.booking_id == b2["id"]]


def test_consent_is_required_in_gdpr_regions(client) -> None:
    headers, service, slots = _setup(client)
    _connect(client, headers)
    assert client.patch(f"{API}/business", json={"country": "DE"}, headers=headers).status_code == 200
    try:
        no_answer = _confirm(client, _draft_with(client, service["id"], slots[0], {"source": "facebook"}).json()["id"], "capi-nc@example.com")
        declined = _confirm(
            client, _draft_with(client, service["id"], slots[8], {"source": "facebook", "adConsent": False}).json()["id"], "capi-no@example.com"
        )
        accepted = _confirm(
            client, _draft_with(client, service["id"], slots[16], {"source": "facebook", "adConsent": True}).json()["id"], "capi-yes@example.com"
        )
        queued = {e.booking_id for e in _events()}
        assert no_answer["id"] not in queued and declined["id"] not in queued
        assert accepted["id"] in queued
    finally:
        client.patch(f"{API}/business", json={"country": "US"}, headers=headers)


def test_status_only_counts_this_tenants_events(client) -> None:
    headers = _auth(client)
    status = client.get(f"{API}/ad-tracking", headers=headers).json()
    assert set(status) >= {"metaConnected", "metaSentCount", "metaPendingCount", "metaFailedCount"}
    assert client.get("/api/v1/tenants/not-a-tenant/ad-tracking", headers=headers).status_code in (403, 404)


def test_google_offline_conversion_file_lists_only_google_click_bookings(client) -> None:
    from datetime import date, timedelta

    headers, service, slots = _setup(client)
    google = _confirm(
        client, _draft_with(client, service["id"], slots[0], {"source": "google", "medium": "cpc", "gclid": "Cj0-GCLID-1"}).json()["id"], "g1@example.com"
    )
    _confirm(client, _draft_with(client, service["id"], slots[8], {"source": "instagram"}).json()["id"], "g2@example.com")

    window = {"from": (date.today() - timedelta(days=1)).isoformat(), "to": (date.today() + timedelta(days=1)).isoformat()}
    response = client.get(f"{API}/marketing/google-conversions", headers=headers, params=window)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    lines = response.text.strip().splitlines()
    assert lines[0] == "Parameters:TimeZone=+0000;"
    assert lines[1] == "Google Click ID,Conversion Name,Conversion Time,Conversion Value,Conversion Currency"
    assert len(lines) == 3 and lines[2].startswith("Cj0-GCLID-1,Booking confirmed,")
    assert lines[2].endswith(",USD")

    # Canceled bookings are not conversions.
    cancel = client.post(f"{API}/bookings/{google['id']}/cancel", headers=headers, json={"reason": "test"})
    if cancel.status_code == 200:
        again = client.get(f"{API}/marketing/google-conversions", headers=headers, params=window).text.strip().splitlines()
        assert len(again) == 2


def test_google_offline_conversion_file_needs_export_permission_and_a_valid_range(client) -> None:
    window = {"from": "2026-01-01", "to": "2026-01-31"}
    assert client.get(f"{API}/marketing/google-conversions", params=window).status_code in (401, 403)
    headers = _auth(client)
    bad = client.get(f"{API}/marketing/google-conversions", headers=headers, params={"from": "2026-02-01", "to": "2026-01-01"})
    assert bad.status_code == 422
