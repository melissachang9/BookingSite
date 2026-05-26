from __future__ import annotations

import asyncio
from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import json

from app.core.config import get_settings
from app.services.payment_processor import (
    StripeCheckoutSession,
    StripeCheckoutStatus,
    StripeRefund,
    build_stripe_success_url,
)


def _stripe_success_url(booking_draft_id: str) -> str:
    return f"/brow-beauty-lab/book/{booking_draft_id}/success?sessionId={{CHECKOUT_SESSION_ID}}"


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


def _service_by_name(client, name: str) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return next(service for service in services_response.json()["services"] if service["name"] == name)


def _set_stripe_env(monkeypatch) -> None:
    monkeypatch.setenv("STRIPE_SECRET_KEY", "sk_test_123")
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", "whsec_test_123")
    monkeypatch.setenv("STOREFRONT_PUBLIC_BASE_URL", "http://127.0.0.1:3001")
    get_settings.cache_clear()


def _create_secondary_tenant() -> None:
    async def _run() -> None:
        from app.db.models import Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            session.add(
                Tenant(
                    slug="other-tenant",
                    name="Other Tenant",
                    timezone="America/New_York",
                    branding_json={},
                    settings_json={
                        "cancellationWindowHours": 24,
                        "refundInsideWindow": False,
                        "reminderHoursBefore": 24,
                        "minLeadTimeMinutes": 60,
                        "maxAdvanceBookingDays": 45,
                        "defaultDepositCents": 2500,
                        "noShowFeeCents": 5000,
                        "autoChargeNoShowFee": False,
                    },
                )
            )
            await session.commit()

    asyncio.run(_run())


def _stripe_webhook_headers(payload: dict[str, object], *, secret: str = "whsec_test_123") -> dict[str, str]:
    body = json.dumps(payload).encode("utf-8")
    timestamp = str(int(datetime.now(timezone.utc).timestamp()))
    signed_payload = f"{timestamp}.".encode("utf-8") + body
    signature = hmac.new(secret.encode("utf-8"), signed_payload, hashlib.sha256).hexdigest()
    return {
        "Stripe-Signature": f"t={timestamp},v1={signature}",
        "Content-Type": "application/json",
    }


def _create_paid_deposit_booking(client) -> dict[str, str]:
    service = _service_by_name(client, "Signature Facial")
    date_text = _next_weekday(3)
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    first_slot = availability_response.json()["slots"][0]

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": first_slot["providerId"],
            "locationId": first_slot["locationId"],
            "startsAt": first_slot["startAt"],
        },
    )
    booking_draft_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Stripe Deposit Guest",
                "email": "stripe-deposit@example.com",
                "phone": "555-0312",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )
    assert update_response.status_code == 200

    return {
        "bookingDraftId": booking_draft_id,
        "serviceId": service["id"],
        "serviceName": service["name"],
        "depositCents": service["depositCents"],
    }


def _booking_payment_snapshot(booking_id: str) -> dict[str, object]:
    async def _run() -> dict[str, object]:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Booking, Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            booking = await session.scalar(
                select(Booking)
                .options(
                    selectinload(Booking.payment_events),
                    selectinload(Booking.payments).selectinload(Payment.events),
                )
                .where(Booking.id == booking_id)
            )
            assert booking is not None
            return {
                "paymentEventKinds": [event.kind for payment in booking.payments for event in payment.events],
                "paymentEventNotes": [event.notes for payment in booking.payments for event in payment.events],
                "bookingEventPayloads": [event.payload_json for event in booking.payment_events],
            }

    return asyncio.run(_run())


def test_build_stripe_success_url_preserves_checkout_session_placeholder(monkeypatch) -> None:
    _set_stripe_env(monkeypatch)

    result = build_stripe_success_url(_stripe_success_url("draft_123"))

    assert result == "http://127.0.0.1:3001/brow-beauty-lab/book/draft_123/success?sessionId={CHECKOUT_SESSION_ID}"


def test_create_checkout_session_uses_stripe_when_configured(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**kwargs):
        assert kwargs["booking_draft_id"] == draft["bookingDraftId"]
        assert kwargs["amount_cents"] == draft["depositCents"]
        assert kwargs["success_url"] == _stripe_success_url(draft["bookingDraftId"])
        assert kwargs["cancel_url"] == f"/brow-beauty-lab/book/{draft['bookingDraftId']}"
        return StripeCheckoutSession(
            session_id="cs_test_checkout_123",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_123",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["sessionId"] == "cs_test_checkout_123"
    assert payload["checkoutUrl"] == "https://checkout.stripe.com/pay/cs_test_checkout_123"


def test_complete_checkout_session_confirms_booking_with_paid_stripe_session(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_checkout_456",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_456",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    async def _fake_get_stripe_checkout_session(session_id: str):
        assert session_id == "cs_test_checkout_456"
        return StripeCheckoutStatus(
            session_id=session_id,
            status="complete",
            payment_status="paid",
            payment_intent_id="pi_test_456",
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)
    monkeypatch.setattr("app.services.payments.get_stripe_checkout_session", _fake_get_stripe_checkout_session)

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )
    assert checkout_response.status_code == 200

    complete_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/cs_test_checkout_456/complete"
    )

    assert complete_response.status_code == 200
    payload = complete_response.json()
    assert payload["status"] == "confirmed"
    assert payload["depositStatus"] == "paid"
    assert payload["paymentResolution"] == "pending"


def test_cancel_manage_booking_calls_stripe_refund_when_configured(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_checkout_789",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_789",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    async def _fake_get_stripe_checkout_session(session_id: str):
        assert session_id == "cs_test_checkout_789"
        return StripeCheckoutStatus(
            session_id=session_id,
            status="complete",
            payment_status="paid",
            payment_intent_id="pi_test_789",
        )

    async def _fake_create_stripe_refund(session_id: str, *, amount_cents: int, idempotency_key: str):
        assert session_id == "cs_test_checkout_789"
        assert amount_cents == draft["depositCents"]
        assert idempotency_key.startswith("customer-cancel-")
        return StripeRefund(
            refund_id="re_test_789",
            amount_cents=amount_cents,
            payment_intent_id="pi_test_789",
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)
    monkeypatch.setattr("app.services.payments.get_stripe_checkout_session", _fake_get_stripe_checkout_session)
    monkeypatch.setattr("app.services.booking_drafts.create_stripe_refund", _fake_create_stripe_refund)

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )
    assert checkout_response.status_code == 200

    complete_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/cs_test_checkout_789/complete"
    )
    assert complete_response.status_code == 200
    booking = complete_response.json()

    cancel_response = client.post(
        f"/api/v1/bookings/manage/{booking['customerManageToken']}/cancel",
        json={"reason": "Need to move this appointment."},
    )

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["booking"]["status"] == "canceled"
    assert payload["booking"]["depositStatus"] == "refunded"

    snapshot = _booking_payment_snapshot(booking["id"])
    assert "refund_recorded" in snapshot["paymentEventKinds"]
    assert any(note and "re_test_789" in note for note in snapshot["paymentEventNotes"])
    assert any(payload.get("externalRefundIds") == ["re_test_789"] for payload in snapshot["bookingEventPayloads"])


def test_stripe_webhook_confirms_booking_without_success_page_return(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_checkout_webhook",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_webhook",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )
    assert checkout_response.status_code == 200

    event_payload = {
        "id": "evt_checkout_completed_123",
        "type": "checkout.session.completed",
        "created": int(datetime.now(timezone.utc).timestamp()),
        "data": {
            "object": {
                "id": "cs_test_checkout_webhook",
                "payment_status": "paid",
                "payment_intent": "pi_test_webhook_123",
                "metadata": {
                    "tenant_slug": "brow-beauty-lab",
                    "booking_draft_id": draft["bookingDraftId"],
                    "payment_kind": "deposit",
                },
            }
        },
    }

    webhook_response = client.post(
        "/api/v1/payments/webhooks/stripe",
        content=json.dumps(event_payload),
        headers=_stripe_webhook_headers(event_payload),
    )

    assert webhook_response.status_code == 200
    assert webhook_response.json() == {"status": "processed", "reason": "checkout_completed"}

    complete_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/cs_test_checkout_webhook/complete"
    )
    assert complete_response.status_code == 200
    booking = complete_response.json()
    assert booking["status"] == "confirmed"
    assert booking["depositStatus"] == "paid"

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["paymentEventKinds"].count("checkout_completed") == 1
    assert any(note and "Stripe webhook" in note for note in snapshot["paymentEventNotes"])


def test_stripe_webhook_is_idempotent_for_retries(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_checkout_retry",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_retry",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )
    assert checkout_response.status_code == 200

    event_payload = {
        "id": "evt_checkout_retry_123",
        "type": "checkout.session.completed",
        "created": int(datetime.now(timezone.utc).timestamp()),
        "data": {
            "object": {
                "id": "cs_test_checkout_retry",
                "payment_status": "paid",
                "payment_intent": "pi_test_retry_123",
                "metadata": {
                    "tenant_slug": "brow-beauty-lab",
                    "booking_draft_id": draft["bookingDraftId"],
                    "payment_kind": "deposit",
                },
            }
        },
    }

    first_response = client.post(
        "/api/v1/payments/webhooks/stripe",
        content=json.dumps(event_payload),
        headers=_stripe_webhook_headers(event_payload),
    )
    second_response = client.post(
        "/api/v1/payments/webhooks/stripe",
        content=json.dumps(event_payload),
        headers=_stripe_webhook_headers(event_payload),
    )

    assert first_response.status_code == 200
    assert second_response.status_code == 200

    complete_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/cs_test_checkout_retry/complete"
    )
    assert complete_response.status_code == 200
    booking = complete_response.json()

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["paymentEventKinds"].count("checkout_completed") == 1


def test_stripe_webhook_rejects_invalid_signature(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)

    event_payload = {
        "id": "evt_invalid_signature",
        "type": "checkout.session.completed",
        "created": int(datetime.now(timezone.utc).timestamp()),
        "data": {"object": {"id": "cs_test_invalid_signature", "metadata": {"tenant_slug": "brow-beauty-lab"}}},
    }

    response = client.post(
        "/api/v1/payments/webhooks/stripe",
        content=json.dumps(event_payload),
        headers={
            "Stripe-Signature": "t=1,v1=bad-signature",
            "Content-Type": "application/json",
        },
    )

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "bad_request"


def test_stripe_webhook_does_not_cross_tenants(client, monkeypatch) -> None:
    _set_stripe_env(monkeypatch)
    _create_secondary_tenant()
    draft = _create_paid_deposit_booking(client)

    async def _fake_create_stripe_checkout_session(**_kwargs):
        return StripeCheckoutSession(
            session_id="cs_test_checkout_tenant_isolation",
            checkout_url="https://checkout.stripe.com/pay/cs_test_checkout_tenant_isolation",
            expires_at=datetime.now(timezone.utc) + timedelta(minutes=30),
        )

    monkeypatch.setattr("app.services.payments.create_stripe_deposit_checkout_session", _fake_create_stripe_checkout_session)

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft["bookingDraftId"],
            "kind": "deposit",
            "successUrl": _stripe_success_url(draft["bookingDraftId"]),
            "cancelUrl": f"/brow-beauty-lab/book/{draft['bookingDraftId']}",
        },
    )
    assert checkout_response.status_code == 200

    event_payload = {
        "id": "evt_wrong_tenant_123",
        "type": "checkout.session.completed",
        "created": int(datetime.now(timezone.utc).timestamp()),
        "data": {
            "object": {
                "id": "cs_test_checkout_tenant_isolation",
                "payment_status": "paid",
                "payment_intent": "pi_test_wrong_tenant_123",
                "metadata": {
                    "tenant_slug": "other-tenant",
                    "booking_draft_id": draft["bookingDraftId"],
                    "payment_kind": "deposit",
                },
            }
        },
    }

    response = client.post(
        "/api/v1/payments/webhooks/stripe",
        content=json.dumps(event_payload),
        headers=_stripe_webhook_headers(event_payload),
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"