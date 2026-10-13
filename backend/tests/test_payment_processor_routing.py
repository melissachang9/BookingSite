"""Phase A of the Clover work: processor routing, the simulated-checkout
guard, late captured payments, refund dispatch, and the payment-link setting."""

import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from tests.test_staff_booking_drafts import (
    TENANT,
    _create_other_tenant_owner,
    _create_staff_user,
    _deny_permission,
    _login,
    _next_weekday,
    _service,
    _slot,
)


def _tenant(settings_json: dict):
    return SimpleNamespace(settings_json=settings_json)


# ---------------------------------------------------------------------------
# Router (pure)
# ---------------------------------------------------------------------------


def test_router_prefers_the_tenants_explicit_choice(monkeypatch) -> None:
    from app.core.config import get_settings
    from app.services.payment_processor import resolve_payment_processor

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    get_settings.cache_clear()
    assert resolve_payment_processor(_tenant({"paymentProcessor": "clover"})) == "clover"
    assert resolve_payment_processor(_tenant({"paymentProcessor": "none"})) == "none"
    assert resolve_payment_processor(_tenant({"paymentProcessor": "stripe"})) == "stripe"
    # Legacy tenants (no setting) keep using Stripe when it is configured.
    assert resolve_payment_processor(_tenant({})) == "stripe"


def test_router_simulates_only_outside_production(monkeypatch) -> None:
    from app.core.config import get_settings
    from app.services.payment_processor import resolve_payment_processor, simulated_checkout_allowed

    get_settings.cache_clear()
    assert simulated_checkout_allowed() is True  # APP_ENV=test
    assert resolve_payment_processor(_tenant({})) == "simulated"

    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    assert simulated_checkout_allowed() is False
    assert resolve_payment_processor(_tenant({})) == "none"
    # Stripe chosen but not configured must not silently simulate either.
    assert resolve_payment_processor(_tenant({"paymentProcessor": "stripe"})) == "none"
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Checkout creation / completion guards
# ---------------------------------------------------------------------------


def _public_draft(client) -> dict:
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json={
            "tenantSlug": TENANT,
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
            "customer": {"name": "Online Guest", "email": "guest@example.com", "phone": "555-0111"},
        },
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _start_checkout(client, draft_id: str):
    return client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions",
        json={
            "tenantSlug": TENANT,
            "bookingDraftId": draft_id,
            "kind": "deposit",
            "successUrl": f"/{TENANT}/book/{draft_id}/success",
            "cancelUrl": f"/{TENANT}/book/{draft_id}",
        },
    )


def _set_tenant_setting(key: str, value) -> None:
    async def _go():
        from sqlalchemy import select

        from app.db.models import Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == TENANT))
            tenant.settings_json = {**tenant.settings_json, key: value}
            await session.commit()

    asyncio.run(_go())


def test_checkout_is_refused_when_no_processor_is_available(client, monkeypatch) -> None:
    draft = _public_draft(client)
    monkeypatch.setenv("APP_ENV", "production")
    from app.core.config import get_settings

    get_settings.cache_clear()
    response = _start_checkout(client, draft["id"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "payments_unavailable"
    get_settings.cache_clear()


def test_simulated_session_cannot_be_completed_in_production(client, monkeypatch) -> None:
    draft = _public_draft(client)
    created = _start_checkout(client, draft["id"])
    assert created.status_code == 200, created.json()
    session_id = created.json()["sessionId"]

    monkeypatch.setenv("APP_ENV", "production")
    from app.core.config import get_settings

    get_settings.cache_clear()
    response = client.post(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session_id}/complete")
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "payments_unavailable"
    get_settings.cache_clear()


def test_clover_session_cannot_be_completed_without_a_charge(client) -> None:
    _set_tenant_setting("paymentProcessor", "clover")
    draft = _public_draft(client)
    created = _start_checkout(client, draft["id"])
    assert created.status_code == 200, created.json()

    response = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{created.json()['sessionId']}/complete"
    )
    assert response.status_code == 409
    assert "card" in response.json()["error"]["message"].lower()

    async def _payment():
        from sqlalchemy import select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(select(Payment).where(Payment.booking_draft_id == draft["id"]))
            return payment.processor, payment.processor_channel, payment.status

    assert asyncio.run(_payment()) == ("clover", "ecom", "pending")


# ---------------------------------------------------------------------------
# Late captured payments are never marked canceled
# ---------------------------------------------------------------------------


def test_late_stripe_capture_is_flagged_not_canceled(client, monkeypatch) -> None:
    from app.core.config import get_settings
    from app.services.payment_processor import StripeCheckoutSession, StripeCheckoutStatus

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    get_settings.cache_clear()

    async def _fake_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_late_1",
            checkout_url="https://checkout.stripe.com/pay/cs_test_late_1",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    async def _fake_status(session_id: str):
        return StripeCheckoutStatus(session_id=session_id, status="complete", payment_status="paid", payment_intent_id="pi_late")

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_session)
    monkeypatch.setattr("app.services.payments.get_stripe_checkout_session", _fake_status)

    draft = _public_draft(client)
    assert _start_checkout(client, draft["id"]).status_code == 200

    async def _expire_checkout():
        from sqlalchemy import select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(select(Payment).where(Payment.booking_draft_id == draft["id"]))
            payment.checkout_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await session.commit()

    asyncio.run(_expire_checkout())
    response = client.post(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/cs_test_late_1/complete")
    assert response.status_code == 409
    assert "after the checkout expired" in response.json()["error"]["message"]

    async def _state():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(
                select(Payment).options(selectinload(Payment.events)).where(Payment.booking_draft_id == draft["id"])
            )
            return payment.status, [event.kind for event in payment.events]

    status, kinds = asyncio.run(_state())
    assert status == "pending"  # not canceled: staff must refund or rebook
    assert kinds.count("late_payment_received") == 1

    # Repeating (e.g. a webhook retry) doesn't add a second event.
    client.post(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/cs_test_late_1/complete")
    assert asyncio.run(_state())[1].count("late_payment_received") == 1
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Refund dispatch
# ---------------------------------------------------------------------------


def _payment(**overrides):
    base = dict(
        processor=None,
        processor_channel=None,
        checkout_session_id=None,
        processor_payment_id=None,
        processor_merchant_id=None,
    )
    base.update(overrides)
    return SimpleNamespace(**base)


def test_refund_router_ignores_manual_payments() -> None:
    from app.services.payment_processor import refund_payment_via_processor

    result = asyncio.run(refund_payment_via_processor(payment=_payment(), amount_cents=100, idempotency_key="k"))
    assert result is None


def test_refund_router_leaves_clover_device_payments_to_staff() -> None:
    from app.services.payment_processor import refund_payment_via_processor

    payment = _payment(processor="clover", processor_channel="device")
    assert asyncio.run(refund_payment_via_processor(payment=payment, amount_cents=100, idempotency_key="k")) is None


def test_refund_router_never_wallet_credits_a_clover_online_charge() -> None:
    # A Clover card payment with no charge id can't be refunded, and must not fall back to wallet credit.
    from fastapi import HTTPException

    from app.services.payment_processor import refund_payment_via_processor

    payment = _payment(processor="clover", processor_channel="ecom")
    with pytest.raises(HTTPException) as caught:
        asyncio.run(refund_payment_via_processor(payment=payment, amount_cents=100, idempotency_key="k"))
    assert caught.value.status_code == 409


def test_refund_router_falls_back_to_the_stripe_prefix_for_legacy_rows(monkeypatch) -> None:
    from app.core.config import get_settings
    from app.services import payment_processor
    from app.services.payment_processor import StripeRefund, refund_payment_via_processor

    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    get_settings.cache_clear()
    seen = {}

    async def _fake_refund(session_id, *, amount_cents, idempotency_key):
        seen.update(session_id=session_id, amount=amount_cents, key=idempotency_key)
        return StripeRefund(refund_id="re_1", amount_cents=amount_cents, payment_intent_id="pi_1")

    monkeypatch.setattr(payment_processor, "create_stripe_refund", _fake_refund)
    payment = _payment(checkout_session_id="cs_test_legacy")
    result = asyncio.run(refund_payment_via_processor(payment=payment, amount_cents=250, idempotency_key="cancel-1"))
    assert result is not None and result.processor == "stripe" and result.processor_refund_id == "re_1"
    assert seen == {"session_id": "cs_test_legacy", "amount": 250, "key": "cancel-1"}
    get_settings.cache_clear()


# ---------------------------------------------------------------------------
# Settings + permissions
# ---------------------------------------------------------------------------


def test_payment_link_expiry_setting_has_bounds_and_default(client) -> None:
    owner = _login(client)
    summary = client.get(f"/api/v1/tenants/{TENANT}").json()
    assert summary["settings"]["paymentLinkExpiryMinutes"] == 30

    for bad in (29, 1441):
        response = client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=owner, json={"paymentLinkExpiryMinutes": bad})
        assert response.status_code == 422, bad

    ok = client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=owner, json={"paymentLinkExpiryMinutes": 90})
    assert ok.status_code == 200, ok.json()
    assert ok.json()["settings"]["paymentLinkExpiryMinutes"] == 90


def test_payment_processor_cannot_be_set_through_settings(client) -> None:
    owner = _login(client)
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=owner, json={"paymentProcessor": "clover"})
    assert client.get(f"/api/v1/tenants/{TENANT}").json()["settings"]["paymentProcessor"] is None


def test_balance_checkout_honours_permission_overrides(client) -> None:
    owner = _login(client)
    user_id = _create_staff_user(client, owner, "no.balance@browbeautylab.test")
    _deny_permission(client, owner, user_id, "bookings.collect_payment")
    staff = _login(client, "no.balance@browbeautylab.test", "TempPass123")

    response = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions",
        headers=staff,
        json={
            "tenantSlug": TENANT,
            "bookingId": "does-not-matter",
            "kind": "booking_balance",
            "successUrl": "/s",
            "cancelUrl": "/c",
        },
    )
    assert response.status_code == 403

    other = _create_other_tenant_owner(client)
    cross = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions",
        headers=other,
        json={"tenantSlug": TENANT, "bookingId": "x", "kind": "booking_balance", "successUrl": "/s", "cancelUrl": "/c"},
    )
    assert cross.status_code == 403
