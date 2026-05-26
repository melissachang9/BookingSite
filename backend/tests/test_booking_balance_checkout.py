import asyncio
from datetime import datetime, timedelta, timezone


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
                "bookingStatus": booking.status,
                "depositStatus": booking.deposit_status,
                "paymentResolution": booking.payment_resolution,
                "paymentStatuses": [payment.status for payment in booking.payments],
                "paymentKinds": [payment.checkout_session_kind for payment in booking.payments],
                "paymentEventKinds": [event.kind for payment in booking.payments for event in payment.events],
                "bookingEventKinds": [event.event_kind for event in booking.payment_events],
            }

    return asyncio.run(_run())


def _confirm_paid_deposit_booking(client) -> dict[str, object]:
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
                "name": "Hosted Balance Guest",
                "email": "hosted-balance@example.com",
                "phone": "555-0500",
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
    session_id = checkout_response.json()["sessionId"]

    complete_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/{session_id}/complete"
    )
    assert complete_response.status_code == 200
    return {
        "service": service,
        "booking": complete_response.json(),
    }


def test_create_booking_balance_checkout_requires_authentication(client) -> None:
    created = _confirm_paid_deposit_booking(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingId": created["booking"]["id"],
            "kind": "booking_balance",
            "successUrl": f"http://127.0.0.1:3001/cancel/{created['booking']['customerManageToken']}",
            "cancelUrl": f"http://127.0.0.1:3001/cancel/{created['booking']['customerManageToken']}",
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_create_and_complete_booking_balance_checkout_updates_booking_payment_state(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        headers=headers,
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingId": booking["id"],
            "kind": "booking_balance",
            "successUrl": f"http://127.0.0.1:3001/cancel/{booking['customerManageToken']}",
            "cancelUrl": f"http://127.0.0.1:3001/cancel/{booking['customerManageToken']}",
        },
    )

    assert create_response.status_code == 200
    create_payload = create_response.json()
    assert create_payload["checkoutUrl"].startswith(f"http://127.0.0.1:3001/cancel/{booking['customerManageToken']}/payment")
    assert create_payload["sessionId"]

    complete_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/{create_payload['sessionId']}/complete"
    )

    assert complete_response.status_code == 200
    payload = complete_response.json()
    assert payload["status"] == "confirmed"
    assert payload["paymentResolution"] == "collected"
    assert payload["depositStatus"] == "paid_in_full"
    assert payload["balanceDueCents"] == 0

    snapshot = _booking_payment_snapshot(booking["id"])
    assert "booking_balance" in snapshot["paymentKinds"]
    assert "checkout_completed" in snapshot["paymentEventKinds"]
    assert "booking_balance_checkout_completed" in snapshot["bookingEventKinds"]


def test_create_booking_balance_checkout_rejects_bookings_without_balance_due(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    manual_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": booking["balanceDueCents"],
            "paymentMethodType": "cash",
        },
    )
    assert manual_response.status_code == 200

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        headers=headers,
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingId": booking["id"],
            "kind": "booking_balance",
            "successUrl": f"http://127.0.0.1:3001/cancel/{booking['customerManageToken']}",
            "cancelUrl": f"http://127.0.0.1:3001/cancel/{booking['customerManageToken']}",
        },
    )

    assert create_response.status_code == 409
    assert create_response.json()["error"]["code"] == "conflict"


def test_create_booking_balance_checkout_rejects_cross_tenant_actor(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    owner_email, owner_password = _create_other_tenant_owner(client)
    headers = _auth_headers(client, email=owner_email, password=owner_password)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        headers=headers,
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingId": created["booking"]["id"],
            "kind": "booking_balance",
            "successUrl": f"http://127.0.0.1:3001/cancel/{created['booking']['customerManageToken']}",
            "cancelUrl": f"http://127.0.0.1:3001/cancel/{created['booking']['customerManageToken']}",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"