"""Connecting a business to Clover: OAuth, API keys, disconnect, capabilities,
token refresh, and who is allowed to do any of it."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_staff_booking_drafts import (
    TENANT,
    _audit_actions,
    _create_other_tenant_owner,
    _create_staff_user,
    _login,
)

BASE = f"/api/v1/tenants/{TENANT}/payments"


def _set_currency(client, owner, currency: str) -> None:
    response = client.patch(f"/api/v1/tenants/{TENANT}/business", headers=owner, json={"currency": currency})
    assert response.status_code == 200, response.json()


def _connection() -> dict | None:
    async def _go():
        from sqlalchemy import select

        from app.db.models import ProcessorConnection, Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            row = await session.scalar(
                select(ProcessorConnection).join(Tenant, Tenant.id == ProcessorConnection.tenant_id).where(Tenant.slug == TENANT)
            )
            if row is None:
                return None
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == TENANT))
            return {
                "status": row.status,
                "auth_mode": row.auth_mode,
                "merchant_id": row.merchant_id,
                "access_token_enc": row.access_token_enc,
                "refresh_token_enc": row.refresh_token_enc,
                "ecommerce_private_key_enc": row.ecommerce_private_key_enc,
                "pakms_public_key": row.pakms_public_key,
                "access_token_expires_at": row.access_token_expires_at,
                "last_error": row.last_error,
                "processor_setting": tenant.settings_json.get("paymentProcessor"),
            }

    return asyncio.run(_go())


def _expire_access_token() -> None:
    async def _go():
        from sqlalchemy import select

        from app.db.models import ProcessorConnection
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            row = await session.scalar(select(ProcessorConnection))
            row.access_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=1)
            await session.commit()

    asyncio.run(_go())


def _connect_via_oauth(client, owner, fake, *, merchant_id: str = "MERCHANT1", **merchant) -> dict:
    fake.add_merchant(merchant_id, **merchant)
    fake.issue_code(merchant_id)
    url = client.get(f"{BASE}/clover/authorize-url", headers=owner)
    assert url.status_code == 200, url.json()
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(url.json()["authorizeUrl"]).query)["state"][0]
    return client.post(
        f"{BASE}/clover/oauth/complete",
        headers=owner,
        json={"code": "good-code", "merchantId": merchant_id, "state": state},
    )


# ---------------------------------------------------------------------------
# Secrets + permission
# ---------------------------------------------------------------------------


def test_secrets_round_trip_and_rotate_keys(monkeypatch) -> None:
    from cryptography.fernet import Fernet

    from app.core.config import get_settings
    from app.services.payment_secrets import decrypt_secret, encrypt_secret

    old, new = Fernet.generate_key().decode(), Fernet.generate_key().decode()
    monkeypatch.setenv("PAYMENT_SECRETS_KEY", old)
    get_settings.cache_clear()
    token = encrypt_secret("secret-token")
    assert token != "secret-token" and decrypt_secret(token) == "secret-token"

    # New key first, old key still listed: old data still readable, new data uses the new key.
    monkeypatch.setenv("PAYMENT_SECRETS_KEY", f"{new},{old}")
    get_settings.cache_clear()
    assert decrypt_secret(token) == "secret-token"
    assert encrypt_secret("x") != token

    monkeypatch.setenv("PAYMENT_SECRETS_KEY", new)
    get_settings.cache_clear()
    with pytest.raises(Exception):
        decrypt_secret(token)
    get_settings.cache_clear()


def test_secrets_require_a_configured_key(monkeypatch) -> None:
    from fastapi import HTTPException

    from app.core.config import get_settings
    from app.services.payment_secrets import encrypt_secret

    monkeypatch.delenv("PAYMENT_SECRETS_KEY", raising=False)
    get_settings.cache_clear()
    with pytest.raises(HTTPException) as caught:
        encrypt_secret("x")
    assert caught.value.status_code == 503
    get_settings.cache_clear()


def test_only_owners_can_configure_payments(client, fake_clover) -> None:
    owner = _login(client)
    _create_staff_user(client, owner, "front.desk@browbeautylab.test")
    staff = _login(client, "front.desk@browbeautylab.test", "TempPass123")
    other = _create_other_tenant_owner(client)

    for path, method in [("/clover/authorize-url", "get"), ("/clover/disconnect", "post")]:
        assert getattr(client, method)(f"{BASE}{path}", headers=staff).status_code == 403
        assert getattr(client, method)(f"{BASE}{path}", headers=other).status_code == 403
        assert getattr(client, method)(f"{BASE}{path}").status_code == 401

    # A manager template never includes the owner-only key.
    from app.services.auth import ROLE_PERMISSION_ALLOWLIST

    assert "payments.configure" in ROLE_PERMISSION_ALLOWLIST["owner"]
    assert "payments.configure" not in ROLE_PERMISSION_ALLOWLIST["manager"]
    assert "payments.configure" not in ROLE_PERMISSION_ALLOWLIST["staff"]


# ---------------------------------------------------------------------------
# OAuth
# ---------------------------------------------------------------------------


def test_authorize_url_points_at_clover_with_signed_state(client, fake_clover) -> None:
    owner = _login(client)
    response = client.get(f"{BASE}/clover/authorize-url", headers=owner)
    assert response.status_code == 200
    url = response.json()["authorizeUrl"]
    assert url.startswith("https://sandbox.dev.clover.com/oauth/v2/authorize?")
    assert "client_id=test-clover-app" in url
    assert "redirect_uri=http%3A%2F%2Flocalhost%3A5173%2Fsettings%2Fpayments%2Fclover%2Fcallback" in url


def test_authorize_url_needs_server_configuration(client, monkeypatch) -> None:
    from app.core.config import get_settings

    get_settings.cache_clear()
    owner = _login(client)
    response = client.get(f"{BASE}/clover/authorize-url", headers=owner)
    assert response.status_code == 503
    get_settings.cache_clear()


def test_oauth_connects_and_stores_encrypted_tokens(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    response = _connect_via_oauth(client, owner, fake_clover)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["status"] == "connected"
    assert body["processor"] == "clover"
    assert body["authMode"] == "oauth"
    assert body["merchantName"] == "Brow Beauty Lab"
    assert body["canLinkDevicePayments"] is True
    assert body["canChargeCards"] is True
    # No secret appears in any response.
    assert "access" not in str(body).lower() or "accesstoken" not in str(body).lower()

    row = _connection()
    assert row["status"] == "connected" and row["merchant_id"] == "MERCHANT1"
    assert row["processor_setting"] == "clover"
    assert row["pakms_public_key"] == "pakms_public_key_123"
    # Stored encrypted, never as the plaintext the fake issued.
    assert row["access_token_enc"] and not row["access_token_enc"].startswith("access-")
    assert row["refresh_token_enc"] and not row["refresh_token_enc"].startswith("refresh-")

    audits = _audit_actions(TENANT_ID := _tenant_id())
    assert any(action == "connected" for action, _, _ in audits)
    flat = str(audits)
    assert "access-" not in flat and "refresh-" not in flat


def _tenant_id() -> str:
    async def _go():
        from sqlalchemy import select

        from app.db.models import Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            return await session.scalar(select(Tenant.id).where(Tenant.slug == TENANT))

    return asyncio.run(_go())


def test_oauth_rejects_bad_expired_and_foreign_state(client, fake_clover) -> None:
    owner = _login(client)
    fake_clover.add_merchant()
    fake_clover.issue_code()
    bad = client.post(
        f"{BASE}/clover/oauth/complete",
        headers=owner,
        json={"code": "good-code", "merchantId": "MERCHANT1", "state": "not-a-token"},
    )
    assert bad.status_code == 400

    # A state minted for another user in the same business is not accepted.
    from app.services.clover_connections import _encode_state

    other_user_state = _encode_state(_tenant_id(), "someone-else")
    foreign = client.post(
        f"{BASE}/clover/oauth/complete",
        headers=owner,
        json={"code": "good-code", "merchantId": "MERCHANT1", "state": other_user_state},
    )
    assert foreign.status_code == 400
    assert _connection() is None


def test_oauth_rejects_a_rejected_code(client, fake_clover) -> None:
    owner = _login(client)
    url = client.get(f"{BASE}/clover/authorize-url", headers=owner).json()["authorizeUrl"]
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(url).query)["state"][0]
    response = client.post(
        f"{BASE}/clover/oauth/complete",
        headers=owner,
        json={"code": "never-issued", "merchantId": "MERCHANT1", "state": state},
    )
    assert response.status_code == 502
    assert _connection() is None


def test_oauth_blocks_a_currency_mismatch(client, fake_clover) -> None:
    owner = _login(client)  # business is USD by default
    response = _connect_via_oauth(client, owner, fake_clover, currency="CAD")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "currency_mismatch"
    assert _connection() is None


def test_oauth_still_connects_when_card_payments_are_not_enabled(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    response = _connect_via_oauth(client, owner, fake_clover, ecommerce_enabled=False)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["canLinkDevicePayments"] is True
    assert body["canChargeCards"] is False
    assert _connection()["pakms_public_key"] is None


def test_one_clover_account_cannot_serve_two_businesses(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    assert _connect_via_oauth(client, owner, fake_clover).status_code == 200

    other = _create_other_tenant_owner(client)
    client.patch("/api/v1/tenants/other-tenant/business", headers=other, json={"currency": "CAD"})
    fake_clover.issue_code("MERCHANT1", code="second-code")
    url = client.get("/api/v1/tenants/other-tenant/payments/clover/authorize-url", headers=other).json()["authorizeUrl"]
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(url).query)["state"][0]
    response = client.post(
        "/api/v1/tenants/other-tenant/payments/clover/oauth/complete",
        headers=other,
        json={"code": "second-code", "merchantId": "MERCHANT1", "state": state},
    )
    assert response.status_code == 409
    assert "another business" in response.json()["error"]["message"]


# ---------------------------------------------------------------------------
# API keys
# ---------------------------------------------------------------------------


def test_connect_with_api_keys(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    fake_clover.add_merchant("KEYMERCHANT")
    fake_clover.valid_access["platform-token-1"] = "KEYMERCHANT"
    response = client.post(
        f"{BASE}/clover/api-keys",
        headers=owner,
        json={
            "environment": "sandbox",
            "merchantId": "KEYMERCHANT",
            "platformApiToken": "platform-token-1",
            "ecommercePublicKey": "pub_key_1",
            "ecommercePrivateKey": "priv_key_1",
        },
    )
    assert response.status_code == 200, response.json()
    assert response.json()["authMode"] == "api_keys"
    row = _connection()
    assert row["pakms_public_key"] == "pub_key_1"
    assert row["ecommerce_private_key_enc"] and "priv_key_1" not in row["ecommerce_private_key_enc"]
    assert row["refresh_token_enc"] is None


def test_api_keys_are_validated_against_clover(client, fake_clover) -> None:
    owner = _login(client)
    fake_clover.add_merchant("KEYMERCHANT")
    bad = client.post(
        f"{BASE}/clover/api-keys",
        headers=owner,
        json={
            "environment": "sandbox",
            "merchantId": "KEYMERCHANT",
            "platformApiToken": "wrong-token",
            "ecommercePublicKey": "pub",
            "ecommercePrivateKey": "priv",
        },
    )
    assert bad.status_code == 502
    assert _connection() is None
    missing = client.post(f"{BASE}/clover/api-keys", headers=owner, json={"merchantId": "x"})
    assert missing.status_code == 422


# ---------------------------------------------------------------------------
# Disconnect, capabilities, public config
# ---------------------------------------------------------------------------


def test_disconnect_wipes_secrets_and_turns_card_payments_off(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    _connect_via_oauth(client, owner, fake_clover)
    response = client.post(f"{BASE}/clover/disconnect", headers=owner)
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "disconnected"
    row = _connection()
    assert row["status"] == "disconnected"
    assert row["access_token_enc"] is None and row["refresh_token_enc"] is None
    assert row["ecommerce_private_key_enc"] is None and row["pakms_public_key"] is None
    assert row["processor_setting"] == "none"
    assert any(action == "disconnected" for action, _, _ in _audit_actions(_tenant_id()))
    # Disconnecting again is refused rather than silently succeeding.
    assert client.post(f"{BASE}/clover/disconnect", headers=owner).status_code == 409

    # The merchant can be connected to another business afterwards.
    other = _create_other_tenant_owner(client)
    client.patch("/api/v1/tenants/other-tenant/business", headers=other, json={"currency": "CAD"})
    fake_clover.issue_code("MERCHANT1", code="third-code")
    url = client.get("/api/v1/tenants/other-tenant/payments/clover/authorize-url", headers=other).json()["authorizeUrl"]
    from urllib.parse import parse_qs, urlparse

    state = parse_qs(urlparse(url).query)["state"][0]
    moved = client.post(
        "/api/v1/tenants/other-tenant/payments/clover/oauth/complete",
        headers=other,
        json={"code": "third-code", "merchantId": "MERCHANT1", "state": state},
    )
    assert moved.status_code == 200, moved.json()


def test_capabilities_by_state_and_permission(client, fake_clover) -> None:
    owner = _login(client)
    _create_staff_user(client, owner, "cap.staff@browbeautylab.test")
    staff = _login(client, "cap.staff@browbeautylab.test", "TempPass123")

    before = client.get(f"{BASE}/capabilities", headers=staff)
    assert before.status_code == 200
    assert before.json()["status"] is None
    assert before.json()["canChargeCards"] is False
    assert before.json()["processor"] == "simulated"

    _set_currency(client, owner, "CAD")
    _connect_via_oauth(client, owner, fake_clover)
    after = client.get(f"{BASE}/capabilities", headers=staff).json()
    assert after["processor"] == "clover" and after["canLinkDevicePayments"] is True

    # A currency change after connecting is surfaced, and turns features off.
    _set_currency(client, owner, "USD")
    mismatch = client.get(f"{BASE}/capabilities", headers=staff).json()
    assert mismatch["currencyMismatch"] is True
    assert mismatch["canChargeCards"] is False and mismatch["canLinkDevicePayments"] is False

    other = _create_other_tenant_owner(client)
    assert client.get(f"{BASE}/capabilities", headers=other).status_code == 403
    assert client.get(f"{BASE}/capabilities").status_code == 401


def test_public_config_exposes_only_the_public_key(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    assert client.get(f"{BASE}/public-config").json()["clover"] is None

    _connect_via_oauth(client, owner, fake_clover)
    response = client.get(f"{BASE}/public-config")  # no auth: used by the storefront card form
    assert response.status_code == 200
    body = response.json()
    assert body["processor"] == "clover" and body["currency"] == "CAD"
    assert body["clover"] == {
        "merchantId": "MERCHANT1",
        "publicKey": "pakms_public_key_123",
        "sdkUrl": "https://checkout.sandbox.dev.clover.com/sdk.js",
        "locale": "en-CA",
        "environment": "sandbox",
    }
    text = response.text.lower()
    for forbidden in ("token", "secret", "private", "access-", "refresh-"):
        assert forbidden not in text

    client.post(f"{BASE}/clover/disconnect", headers=owner)
    assert client.get(f"{BASE}/public-config").json()["clover"] is None


# ---------------------------------------------------------------------------
# Token refresh
# ---------------------------------------------------------------------------


def _context() -> object:
    from app.services.clover_connections import get_clover_context

    return asyncio.run(get_clover_context(_tenant_id()))


def test_fresh_tokens_are_reused_without_calling_clover(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    _connect_via_oauth(client, owner, fake_clover)
    fake_clover.requests.clear()
    ctx = _context()
    assert ctx.merchant_id == "MERCHANT1" and ctx.access_token.startswith("access-")
    assert fake_clover.calls("/oauth/v2/refresh") == []


def test_expiring_tokens_are_refreshed_once_and_rotated(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    _connect_via_oauth(client, owner, fake_clover)
    first = _context().access_token
    old_refresh_enc = _connection()["refresh_token_enc"]

    _expire_access_token()
    fake_clover.requests.clear()
    refreshed = _context()
    assert refreshed.access_token != first
    assert len(fake_clover.calls("/oauth/v2/refresh")) == 1
    assert _connection()["refresh_token_enc"] != old_refresh_enc  # rotated

    # Now fresh again: no second refresh.
    fake_clover.requests.clear()
    assert _context().access_token == refreshed.access_token
    assert fake_clover.calls("/oauth/v2/refresh") == []


def test_failed_refresh_recovers_then_needs_reauth(client, fake_clover) -> None:
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    _connect_via_oauth(client, owner, fake_clover)

    # Clover forgot the refresh token (e.g. lost response) but still allows recovery.
    stored = next(iter(fake_clover.valid_refresh))
    fake_clover.valid_refresh.clear()
    fake_clover.recoverable.add(stored)
    _expire_access_token()
    # The stored (encrypted) refresh token is `stored`; recovery accepts it.
    assert _context().access_token.startswith("access-")
    assert _connection()["status"] == "connected"

    # Nothing recoverable any more: the owner must reconnect.
    fake_clover.valid_refresh.clear()
    fake_clover.recoverable.clear()
    _expire_access_token()
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        _context()
    assert caught.value.status_code == 503
    assert _connection()["status"] == "needs_reauth"
    assert client.get(f"{BASE}/capabilities", headers=owner).json()["needsReauth"] is True
    assert any(action == "needs_reauth" for action, _, _ in _audit_actions(_tenant_id()))
    with pytest.raises(HTTPException):
        _context()  # stays blocked until reconnected


def test_background_refresh_only_touches_expiring_connections(client, fake_clover) -> None:
    from app.services.clover_connections import refresh_expiring_processor_tokens

    owner = _login(client)
    _set_currency(client, owner, "CAD")
    fake_clover.access_lifetime_seconds = 4 * 3600
    _connect_via_oauth(client, owner, fake_clover)
    fake_clover.requests.clear()
    assert asyncio.run(refresh_expiring_processor_tokens()) == 0  # 4 h left, window is 1 h
    assert fake_clover.calls("/oauth/v2/refresh") == []

    async def _soon():
        from sqlalchemy import select

        from app.db.models import ProcessorConnection
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            row = await session.scalar(select(ProcessorConnection))
            row.access_token_expires_at = datetime.now(timezone.utc) + timedelta(minutes=20)
            await session.commit()

    asyncio.run(_soon())
    assert asyncio.run(refresh_expiring_processor_tokens()) == 1
    assert len(fake_clover.calls("/oauth/v2/refresh")) == 1


def test_no_connection_means_no_context(client) -> None:
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as caught:
        _context()
    assert caught.value.status_code == 409
    assert caught.value.detail["code"] == "processor_not_connected"
