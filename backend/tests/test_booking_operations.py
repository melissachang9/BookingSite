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
                "paymentEventKinds": [event.kind for payment in booking.payments for event in payment.events],
                "bookingEventKinds": [event.event_kind for event in booking.payment_events],
                "bookingEventPayloads": [event.payload_json for event in booking.payment_events],
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
                "name": "Completion Queue Guest",
                "email": "completion-queue@example.com",
                "phone": "555-0400",
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


def test_list_bookings_returns_confirmed_completion_queue(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/bookings",
        params={"status": "confirmed"},
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    item = next(entry for entry in payload["items"] if entry["id"] == created["booking"]["id"])
    assert item["status"] == "confirmed"
    assert item["amountPaidCents"] == created["service"]["depositCents"]
    assert item["balanceDueCents"] == created["service"]["priceCents"] - created["service"]["depositCents"]
    assert payload["meta"]["total"] >= 1


def test_complete_booking_with_follow_up_marks_terminal_state(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/status",
        headers=headers,
        json={
            "status": "completed",
            "paymentResolution": "follow_up",
            "notes": "Collect the remaining balance after the visit.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "completed"
    assert payload["paymentResolution"] == "follow_up"
    assert payload["depositStatus"] == "follow_up"
    assert payload["completedAt"] is not None

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["bookingStatus"] == "completed"
    assert snapshot["bookingEventKinds"][-1] == "booking_completed"


def test_mark_booking_no_show_keeps_separate_terminal_state(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{created['booking']['id']}/status",
        headers=headers,
        json={
            "status": "no_show",
            "notes": "Customer did not arrive.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "no_show"
    assert payload["completedAt"] is None

    snapshot = _booking_payment_snapshot(created["booking"]["id"])
    assert snapshot["bookingStatus"] == "no_show"
    assert snapshot["bookingEventKinds"][-1] == "booking_marked_no_show"


def test_record_manual_payment_collects_exact_remaining_balance(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": booking["balanceDueCents"],
            "paymentMethodType": "cash",
            "notes": "Paid at checkout desk.",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "confirmed"
    assert payload["paymentResolution"] == "collected"
    assert payload["depositStatus"] == "paid_in_full"
    assert payload["balanceDueCents"] == 0

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["paymentResolution"] == "collected"
    assert "payment_recorded" in snapshot["paymentEventKinds"]
    assert "admin_completion" in snapshot["bookingEventKinds"]


def test_record_manual_payment_partial_leaves_remaining_balance(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]
    partial_amount = booking["balanceDueCents"] // 2

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": partial_amount,
            "paymentMethodType": "cash",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["status"] == "confirmed"
    assert payload["paymentResolution"] == "pending"
    assert payload["balanceDueCents"] == booking["balanceDueCents"] - partial_amount

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["paymentResolution"] == "pending"
    assert "payment_recorded" in snapshot["paymentEventKinds"]


def test_record_manual_payment_multiple_until_fully_paid(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]
    half = booking["balanceDueCents"] // 2
    remainder = booking["balanceDueCents"] - half

    # First partial payment
    resp1 = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={"amountCents": half, "paymentMethodType": "cash"},
    )
    assert resp1.status_code == 200
    assert resp1.json()["paymentResolution"] == "pending"
    assert resp1.json()["balanceDueCents"] == remainder

    # Second payment covers remainder
    resp2 = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={"amountCents": remainder, "paymentMethodType": "external_pos"},
    )
    assert resp2.status_code == 200
    assert resp2.json()["paymentResolution"] == "collected"
    assert resp2.json()["balanceDueCents"] == 0


def test_record_manual_payment_rejects_amount_exceeding_balance(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": booking["balanceDueCents"] + 1,
            "paymentMethodType": "cash",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"


def test_record_manual_payment_rejects_unknown_payment_method(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking = created["booking"]

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": booking["balanceDueCents"],
            "paymentMethodType": "venmo",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_record_manual_payment_rejects_invalid_amount_payload(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{created['booking']['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": 0,
            "paymentMethodType": "cash",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_record_manual_payment_rejects_cross_tenant_actor(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    owner_email, owner_password = _create_other_tenant_owner(client)
    headers = _auth_headers(client, email=owner_email, password=owner_password)

    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{created['booking']['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": created["booking"]["balanceDueCents"],
            "paymentMethodType": "external_pos",
        },
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"