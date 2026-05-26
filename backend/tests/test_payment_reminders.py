import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace


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


def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": password,
        },
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _create_user(role: str, email: str, password: str, tenant_slug: str = "brow-beauty-lab") -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.core.security import hash_password
        from app.db.models import Tenant, User
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
            assert tenant is not None
            session.add(
                User(
                    tenant_id=tenant.id,
                    email=email,
                    name=f"{role.title()} User",
                    role=role,
                    password_hash=hash_password(password),
                    is_active=True,
                )
            )
            await session.commit()

    asyncio.run(_run())


def _create_other_tenant_owner(client) -> tuple[str, str]:
    owner_email = "owner@other-tenant.test"
    owner_password = "OtherTenant123"
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Other Tenant Studio",
            "slug": "other-tenant",
            "timezone": "America/New_York",
            "locationName": "Second Studio",
            "ownerName": "Taylor Rowe",
            "ownerEmail": owner_email,
            "ownerPassword": owner_password,
        },
    )
    assert response.status_code == 201
    return owner_email, owner_password


def _payment_events_for_draft(booking_draft_id: str) -> list[dict[str, str | None]]:
    async def _run() -> list[dict[str, str | None]]:
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(
                select(Payment)
                .options(selectinload(Payment.events))
                .where(Payment.booking_draft_id == booking_draft_id, Payment.checkout_session_kind == "deposit")
                .order_by(Payment.created_at.desc())
            )
            assert payment is not None
            return [
                {
                    "kind": event.kind,
                    "actor_type": event.actor_type,
                    "actor_id": event.actor_id,
                    "notes": event.notes,
                }
                for event in payment.events
            ]

    return asyncio.run(_run())


def _create_awaiting_payment_draft(client) -> dict[str, str]:
    service = _service_by_name(client, "Signature Facial")
    date_text = _next_weekday(3)
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    assert availability_response.status_code == 200
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
    assert create_response.status_code == 200
    booking_draft_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Deposit Reminder Guest",
                "email": "reminder@example.com",
                "phone": "555-0900",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )
    assert update_response.status_code == 200

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": booking_draft_id,
            "kind": "deposit",
            "successUrl": f"http://127.0.0.1:3001/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"http://127.0.0.1:3001/brow-beauty-lab/book/{booking_draft_id}",
        },
    )
    assert checkout_response.status_code == 200

    return {
        "booking_draft_id": booking_draft_id,
        "checkout_session_id": checkout_response.json()["sessionId"],
    }


def test_send_payment_reminder_returns_delivery_metadata(client, monkeypatch) -> None:
    draft = _create_awaiting_payment_draft(client)
    headers = _auth_headers(client)

    async def _fake_send_transactional_email(*, recipient_email: str, subject: str, text_body: str, html_body: str):
        from datetime import datetime, timezone

        assert recipient_email == "reminder@example.com"
        assert "Signature Facial" in subject
        assert f"/book/{draft['booking_draft_id']}/payment?sessionId=" in text_body
        assert "Complete your deposit checkout" in html_body

        return SimpleNamespace(
            provider="resend",
            recipient_email = recipient_email,
            provider_message_id = "email_123",
            sent_at = datetime.now(timezone.utc),
        )

    monkeypatch.setattr("app.services.payments.send_transactional_email", _fake_send_transactional_email)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/follow-up/{draft['booking_draft_id']}/send-reminder",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["bookingDraftId"] == draft["booking_draft_id"]
    assert payload["recipientEmail"] == "reminder@example.com"
    assert payload["provider"] == "resend"
    assert payload["providerMessageId"] == "email_123"
    assert payload["checkoutSessionId"]
    assert payload["checkoutUrl"].startswith("http://127.0.0.1:3001/brow-beauty-lab/book/")

    events = _payment_events_for_draft(draft["booking_draft_id"])
    reminder_event = next(event for event in events if event["kind"] == "checkout_reminder_sent")
    assert reminder_event["actor_type"] == "user"
    assert reminder_event["actor_id"]
    assert reminder_event["notes"] is not None and "email_123" in reminder_event["notes"]


def test_send_payment_reminder_requires_delivery_configuration(client) -> None:
    draft = _create_awaiting_payment_draft(client)
    headers = _auth_headers(client)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/follow-up/{draft['booking_draft_id']}/send-reminder",
        headers=headers,
    )

    assert response.status_code == 503
    assert response.json()["error"]["code"] == "service_unavailable"


def test_send_payment_reminder_requires_authentication(client) -> None:
    draft = _create_awaiting_payment_draft(client)

    response = client.post(f"/api/v1/tenants/brow-beauty-lab/payments/follow-up/{draft['booking_draft_id']}/send-reminder")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_send_payment_reminder_rejects_user_without_manage_permission(client) -> None:
    draft = _create_awaiting_payment_draft(client)
    provider_email = "provider@browbeautylab.test"
    provider_password = "ProviderAccess123"
    _create_user("provider", provider_email, provider_password)
    headers = _auth_headers(client, email=provider_email, password=provider_password)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/follow-up/{draft['booking_draft_id']}/send-reminder",
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_send_payment_reminder_rejects_cross_tenant_actor(client) -> None:
    draft = _create_awaiting_payment_draft(client)
    owner_email, owner_password = _create_other_tenant_owner(client)
    headers = _auth_headers(client, email=owner_email, password=owner_password)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/follow-up/{draft['booking_draft_id']}/send-reminder",
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"