"""Forgot-password, staff invitations and invite-only business signup."""

from __future__ import annotations

import re
from urllib.parse import parse_qs, urlparse

import pytest

from test_provider_terms_and_resources import API, _auth

OWNER = {"email": "owner@browbeautylab.test", "password": "DemoBooking123"}


@pytest.fixture()
def outbox(monkeypatch):
    """Capture emails instead of sending them."""
    from app.services import account_emails

    sent: list[dict] = []

    async def fake_send(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr(account_emails, "send_transactional_email", fake_send)
    return sent


def _token_from(message: dict) -> str:
    link = re.search(r"https?://\S+reset-password\?\S+", message["text_body"]).group(0)
    return parse_qs(urlparse(link).query)["token"][0]


def _login(client, email: str, password: str):
    return client.post("/api/v1/auth/login", json={"email": email, "password": password})


def test_forgot_password_emails_a_working_link_and_the_link_works_once(client, outbox) -> None:
    assert client.post("/api/v1/auth/forgot-password", json={"email": OWNER["email"]}).status_code == 200
    [message] = outbox
    assert message["recipient_email"] == OWNER["email"]
    token = _token_from(message)

    reset = client.post("/api/v1/auth/reset-password", json={"token": token, "newPassword": "BrandNewPass456"})
    assert reset.status_code == 200, reset.json()
    assert _login(client, OWNER["email"], OWNER["password"]).status_code == 401
    assert _login(client, OWNER["email"], "BrandNewPass456").status_code == 200

    # The same link cannot be used again: it was tied to the old password.
    again = client.post("/api/v1/auth/reset-password", json={"token": token, "newPassword": "AnotherPass789"})
    assert again.status_code == 400 and again.json()["error"]["code"] == "invalid_token"
    assert _login(client, OWNER["email"], "BrandNewPass456").status_code == 200


def test_forgot_password_never_reveals_whether_an_email_has_an_account(client, outbox) -> None:
    known = client.post("/api/v1/auth/forgot-password", json={"email": OWNER["email"]})
    unknown = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})
    assert known.status_code == unknown.status_code == 200
    assert known.json() == unknown.json()
    assert [m["recipient_email"] for m in outbox] == [OWNER["email"]]


def test_a_failed_email_send_does_not_change_the_answer(client, monkeypatch) -> None:
    from app.services import account_emails

    async def broken(**kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(account_emails, "send_transactional_email", broken)
    assert client.post("/api/v1/auth/forgot-password", json={"email": OWNER["email"]}).status_code == 200


def test_bad_tokens_are_refused(client, outbox) -> None:
    from app.core.security import create_access_token

    for token in ("x" * 40, create_access_token({"sub": "whoever"})[0]):
        response = client.post("/api/v1/auth/reset-password", json={"token": token, "newPassword": "ValidPass123"})
        assert response.status_code == 400, token
    client.post("/api/v1/auth/forgot-password", json={"email": OWNER["email"]})
    short = client.post("/api/v1/auth/reset-password", json={"token": _token_from(outbox[0]), "newPassword": "short"})
    assert short.status_code == 422


def test_a_deactivated_account_cannot_use_a_reset_link(client, outbox) -> None:
    headers = _auth(client)
    created = client.post(
        f"{API}/users", headers=headers, json={"email": "temp@example.com", "name": "Temp", "role": "staff", "initialPassword": "TempPass123"}
    )
    assert created.status_code == 201, created.json()
    client.post("/api/v1/auth/forgot-password", json={"email": "temp@example.com"})
    token = _token_from(outbox[-1])
    client.patch(f"{API}/users/{created.json()['id']}", headers=headers, json={"isActive": False})
    response = client.post("/api/v1/auth/reset-password", json={"token": token, "newPassword": "ValidPass123"})
    assert response.status_code == 400


def test_a_password_set_is_audited(client, outbox) -> None:
    from sqlalchemy import select

    import asyncio

    from app.db.models import AuditEvent
    from app.db.session import get_session_maker

    client.post("/api/v1/auth/forgot-password", json={"email": OWNER["email"]})
    client.post("/api/v1/auth/reset-password", json={"token": _token_from(outbox[0]), "newPassword": "BrandNewPass456"})

    async def _events():
        async with get_session_maker()() as session:
            return (await session.scalars(select(AuditEvent).where(AuditEvent.action == "password_set"))).all()

    [event] = asyncio.run(_events())
    assert event.entity_type == "user" and event.actor_id == event.entity_id


def test_staff_created_without_a_password_are_invited_by_email(client, outbox) -> None:
    headers = _auth(client)
    created = client.post(f"{API}/staff", headers=headers, json={"email": "newhire@example.com", "name": "New Hire", "role": "staff"})
    assert created.status_code == 201, created.json()
    assert created.json()["user"]["inviteSent"] is True
    [message] = [m for m in outbox if m["recipient_email"] == "newhire@example.com"]
    assert "invited" in message["subject"].lower()
    assert "invite=1" in message["text_body"]
    # They cannot sign in until they choose a password; the invite link then lets them.
    assert _login(client, "newhire@example.com", "").status_code in (401, 422)
    assert _login(client, "newhire@example.com", "guessing-123").status_code == 401
    token = _token_from(message)
    assert client.post("/api/v1/auth/reset-password", json={"token": token, "newPassword": "MyOwnPassword9"}).status_code == 200
    assert _login(client, "newhire@example.com", "MyOwnPassword9").status_code == 200


def test_the_owner_is_told_when_an_invite_could_not_be_sent(client, monkeypatch) -> None:
    from app.services import account_emails

    async def broken(**kwargs):
        raise RuntimeError("provider down")

    monkeypatch.setattr(account_emails, "send_transactional_email", broken)
    headers = _auth(client)
    created = client.post(f"{API}/users", headers=headers, json={"email": "stuck@example.com", "name": "Stuck", "role": "staff"})
    assert created.status_code == 201
    assert created.json()["inviteSent"] is False


def test_staff_created_with_a_password_get_no_email(client, outbox) -> None:
    headers = _auth(client)
    created = client.post(
        f"{API}/users", headers=headers, json={"email": "direct@example.com", "name": "Direct", "role": "staff", "initialPassword": "TempPass123"}
    )
    assert created.status_code == 201
    assert created.json()["inviteSent"] is None
    assert outbox == []


def test_creating_a_business_needs_the_invite_code_when_one_is_configured(client, monkeypatch) -> None:
    from app.core.config import get_settings

    body = {
        "name": "Invited Studio", "slug": "invited-studio", "timezone": "America/Toronto", "locationName": "Main",
        "ownerName": "Pat Owner", "ownerEmail": "pat@invited.example", "ownerPassword": "OwnerPass123",
    }
    monkeypatch.setenv("PLATFORM_ADMIN_TOKEN", "invite-code-for-tests")
    get_settings.cache_clear()
    assert client.post("/api/v1/tenants", json=body).status_code == 403
    assert client.post("/api/v1/tenants", json=body, headers={"X-Platform-Admin-Token": "wrong-code-wrong-code"}).status_code == 403
    ok = client.post("/api/v1/tenants", json=body, headers={"X-Platform-Admin-Token": "invite-code-for-tests"})
    assert ok.status_code == 201, ok.json()


def test_signup_is_open_in_development_when_no_code_is_set(client) -> None:
    body = {
        "name": "Open Studio", "slug": "open-studio", "timezone": "America/Toronto", "locationName": "Main",
        "ownerName": "Sam Owner", "ownerEmail": "sam@open.example", "ownerPassword": "OwnerPass123",
    }
    assert client.post("/api/v1/tenants", json=body).status_code == 201
