import asyncio
from datetime import datetime, timedelta, timezone


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


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


def _expire_booking_draft(booking_draft_id: str) -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.db.models import BookingDraft, SlotHold
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            draft = await session.scalar(select(BookingDraft).where(BookingDraft.id == booking_draft_id))
            assert draft is not None
            draft.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            hold = await session.scalar(select(SlotHold).where(SlotHold.booking_draft_id == booking_draft_id))
            assert hold is not None
            hold.expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await session.commit()

    asyncio.run(_run())


def _move_booking_start(booking_id: str, starts_at: datetime) -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.db.models import Booking
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            booking = await session.scalar(select(Booking).where(Booking.id == booking_id))
            assert booking is not None
            duration = booking.ends_at - booking.starts_at
            booking.starts_at = starts_at
            booking.ends_at = starts_at + duration
            await session.commit()

    asyncio.run(_run())


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
                "paymentDepositStatuses": [payment.deposit_status for payment in booking.payments],
                "paymentEventKinds": [event.kind for payment in booking.payments for event in payment.events],
                "bookingEventKinds": [event.event_kind for event in booking.payment_events],
                "bookingEventPayloads": [event.payload_json for event in booking.payment_events],
            }

    return asyncio.run(_run())


def _first_service(client) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return services_response.json()["services"][0]


def _service_by_name(client, name: str) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return next(service for service in services_response.json()["services"] if service["name"] == name)


def _confirm_paid_deposit_booking(client) -> dict[str, object]:
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
                "name": "Paid Deposit Guest",
                "email": "paid-deposit@example.com",
                "phone": "555-0302",
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
            "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
        },
    )
    session_id = checkout_response.json()["sessionId"]

    complete_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/{session_id}/complete"
    )

    assert complete_response.status_code == 200
    return {
        "service": service,
        "dateText": date_text,
        "firstSlot": first_slot,
        "booking": complete_response.json(),
    }


def test_get_tenant_summary(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab")

    assert response.status_code == 200
    payload = response.json()
    assert payload["slug"] == "brow-beauty-lab"
    assert payload["name"] == "Brow Beauty Lab"
    assert payload["settings"]["minLeadTimeMinutes"] == 60
    assert payload["branding"]["bookingScreening"]["enabled"] is True
    assert payload["branding"]["bookingScreening"]["options"]
    assert payload["branding"]["bookingAd"]["imageUrl"] == "/studio-hero.png"


def test_list_services_returns_seeded_catalog(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["services"]) >= 3
    assert payload["services"][0]["locationIds"]
    assert payload["services"][0]["imageUrl"]


def test_list_locations_returns_seeded_active_locations(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["locations"]) == 2
    assert all(location["isActive"] for location in payload["locations"])
    assert {location["name"] for location in payload["locations"]} == {"Downtown Studio", "Uptown Suite"}


def test_availability_returns_slots_for_service(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(0)

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["days"]
    assert payload["slots"]
    assert payload["nextAvailableSlot"] is not None


def test_list_service_providers_returns_active_service_providers(client) -> None:
    service = _first_service(client)

    response = client.get(f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/providers")

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]
    assert all(provider["isActive"] for provider in payload["providers"])
    assert all(service["id"] in provider["serviceIds"] for provider in payload["providers"])
    assert any(provider["description"] for provider in payload["providers"])
    assert any(provider["availabilityLabel"] for provider in payload["providers"])


def test_list_service_providers_supports_location_filter(client) -> None:
    service = _first_service(client)
    location_id = service["locationIds"][0]

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/providers",
        params={"locationId": location_id},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]
    assert all(location_id in provider["locationIds"] for provider in payload["providers"])


def test_availability_supports_monthly_window_and_provider_filter(client) -> None:
    service = _first_service(client)
    providers_response = client.get(f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/providers")
    provider = providers_response.json()["providers"][0]
    date_text = _next_weekday(0)

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={
            "serviceId": service["id"],
            "providerId": provider["id"],
            "date": date_text,
            "windowDays": 31,
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["days"]) == 31
    assert payload["nextAvailableSlot"] is not None
    assert payload["nextAvailableSlot"]["providerId"] == provider["id"]
    assert all(slot["providerId"] == provider["id"] for slot in payload["slots"])


def test_create_booking_draft_holds_slot_and_blocks_conflict(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(0)
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    availability_payload = availability_response.json()
    first_slot = availability_payload["slots"][0]

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": first_slot["providerId"],
            "locationId": first_slot["locationId"],
            "startsAt": first_slot["startAt"],
            "customer": {
                "name": "Runtime Validation",
                "email": "runtime@example.com",
                "phone": "555-0100",
            },
        },
    )

    assert create_response.status_code == 200
    draft_payload = create_response.json()
    assert draft_payload["status"] == "slot_held"
    assert draft_payload["customer"]["email"] == "runtime@example.com"

    conflict_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": first_slot["providerId"],
            "locationId": first_slot["locationId"],
            "startsAt": first_slot["startAt"],
        },
    )

    assert conflict_response.status_code == 409
    assert conflict_response.json()["error"]["code"] == "conflict"


def test_get_booking_draft_requires_matching_tenant(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(0)
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

    _create_secondary_tenant()

    response = client.get(f"/api/v1/tenants/other-tenant/booking-drafts/{booking_draft_id}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_update_booking_draft_customer(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(1)
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
                "name": "Updated Draft Customer",
                "email": "updated@example.com",
                "phone": "555-0101",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200
    payload = update_response.json()
    assert payload["customer"]["name"] == "Updated Draft Customer"
    assert payload["customer"]["email"] == "updated@example.com"
    assert payload["customer"]["phone"] == "555-0101"
    assert payload["intakePlan"]["completionTiming"] == "before_visit"
    assert payload["intakePlan"]["status"] == "reminders_scheduled"
    assert payload["intakePlan"]["reminderChannels"] == ["email", "sms"]
    assert payload["intakePlan"]["emailReminderScheduledAt"] is not None
    assert payload["intakePlan"]["smsReminderScheduledAt"] is not None


def test_update_booking_draft_requires_complete_contact_details(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(1)
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
                "name": "Missing Phone",
                "email": "missing-phone@example.com",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 422
    assert update_response.json()["error"]["code"] == "validation_error"


def test_update_booking_draft_rejects_expired_draft(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(1)
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

    _expire_booking_draft(booking_draft_id)

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Expired Draft Customer",
                "email": "expired@example.com",
                "phone": "555-0102",
            }
        },
    )

    assert update_response.status_code == 409
    assert update_response.json()["error"]["code"] == "conflict"


def test_create_booking_draft_reuses_expired_slot_hold(client) -> None:
    service = _first_service(client)
    date_text = _next_weekday(0)
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
    first_draft_id = create_response.json()["id"]

    _expire_booking_draft(first_draft_id)

    retry_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": first_slot["providerId"],
            "locationId": first_slot["locationId"],
            "startsAt": first_slot["startAt"],
        },
    )

    assert retry_response.status_code == 200
    assert retry_response.json()["status"] == "slot_held"


def test_create_booking_draft_accepts_late_local_day_slot(client) -> None:
    service = _service_by_name(client, "New Client Consultation")
    date_text = _next_weekday(0)
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    availability_payload = availability_response.json()
    late_slot = next(
        slot for slot in reversed(availability_payload["slots"]) if slot["startAt"][:10] != date_text
    )

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": late_slot["providerId"],
            "locationId": late_slot["locationId"],
            "startsAt": late_slot["startAt"],
        },
    )

    assert create_response.status_code == 200
    assert create_response.json()["startsAt"] == late_slot["startAt"]


def test_confirm_booking_draft_promotes_zero_deposit_draft_and_blocks_availability(client) -> None:
    service = _service_by_name(client, "New Client Consultation")
    date_text = _next_weekday(2)
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
                "name": "Consultation Guest",
                "email": "consultation@example.com",
                "phone": "555-0200",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    confirm_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/confirm"
    )

    assert confirm_response.status_code == 200
    payload = confirm_response.json()
    assert payload["status"] == "confirmed"
    assert payload["depositStatus"] == "not_required"
    assert payload["paymentResolution"] == "waived"
    assert payload["customer"]["email"] == "consultation@example.com"
    assert payload["customerManageToken"]

    booking_response = client.get(f"/api/v1/tenants/brow-beauty-lab/bookings/{payload['id']}")

    assert booking_response.status_code == 200
    assert booking_response.json()["status"] == "confirmed"

    manage_response = client.get(f"/api/v1/bookings/manage/{payload['customerManageToken']}")

    assert manage_response.status_code == 200
    manage_payload = manage_response.json()
    assert manage_payload["tenant"]["slug"] == "brow-beauty-lab"
    assert manage_payload["booking"]["id"] == payload["id"]
    assert manage_payload["booking"]["status"] == "confirmed"
    assert manage_payload["booking"]["service"]["name"] == service["name"]
    assert manage_payload["booking"]["provider"]["name"] == first_slot["providerName"]
    assert manage_payload["cancellationWindowHours"] == 24
    assert manage_payload["refundInsideWindow"] is False
    assert manage_payload["cancellationDeadlineAt"] is not None

    availability_after_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )

    assert availability_after_response.status_code == 200
    assert not any(
        slot["startAt"] == first_slot["startAt"]
        and slot["providerId"] == first_slot["providerId"]
        and slot["locationId"] == first_slot["locationId"]
        for slot in availability_after_response.json()["slots"]
    )


def test_manage_booking_requires_valid_customer_token(client) -> None:
    response = client.get("/api/v1/bookings/manage/not-a-real-token")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_cancel_manage_booking_refunds_paid_deposit_and_reopens_availability(client) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]
    service = confirmed["service"]
    date_text = confirmed["dateText"]
    first_slot = confirmed["firstSlot"]

    cancel_response = client.post(
        f"/api/v1/bookings/manage/{booking['customerManageToken']}/cancel",
        json={"reason": "Need to reschedule."},
    )

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["booking"]["status"] == "canceled"
    assert payload["booking"]["depositStatus"] == "refunded"
    assert payload["booking"]["paymentResolution"] == "waived"
    assert payload["isInsideCancellationWindow"] is False

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["bookingStatus"] == "canceled"
    assert snapshot["depositStatus"] == "refunded"
    assert snapshot["paymentResolution"] == "waived"
    assert snapshot["paymentStatuses"] == ["refunded"]
    assert snapshot["paymentDepositStatuses"] == ["refunded"]
    assert "refund_recorded" in snapshot["paymentEventKinds"]
    assert "customer_canceled" in snapshot["bookingEventKinds"]
    assert any(event.get("reason") == "Need to reschedule." for event in snapshot["bookingEventPayloads"])
    assert any(event.get("refundedAmountCents") == service["depositCents"] for event in snapshot["bookingEventPayloads"])

    availability_after_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )

    assert availability_after_response.status_code == 200
    assert any(
        slot["startAt"] == first_slot["startAt"]
        and slot["providerId"] == first_slot["providerId"]
        and slot["locationId"] == first_slot["locationId"]
        for slot in availability_after_response.json()["slots"]
    )


def test_cancel_manage_booking_forfeits_deposit_inside_cancellation_window(client) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]
    inside_window_start = datetime.now(timezone.utc) + timedelta(hours=4)
    _move_booking_start(booking["id"], inside_window_start)

    cancel_response = client.post(
        f"/api/v1/bookings/manage/{booking['customerManageToken']}/cancel",
        json={"reason": "Can no longer make it today."},
    )

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["booking"]["status"] == "canceled"
    assert payload["booking"]["depositStatus"] == "forfeited"
    assert payload["booking"]["paymentResolution"] == "collected"
    assert payload["isInsideCancellationWindow"] is True
    assert payload["refundInsideWindow"] is False

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["bookingStatus"] == "canceled"
    assert snapshot["depositStatus"] == "forfeited"
    assert snapshot["paymentResolution"] == "collected"
    assert snapshot["paymentStatuses"] == ["succeeded"]
    assert snapshot["paymentDepositStatuses"] == ["forfeited"]
    assert "deposit_forfeited" in snapshot["paymentEventKinds"]
    assert any(event.get("forfeitedAmountCents") == confirmed["service"]["depositCents"] for event in snapshot["bookingEventPayloads"])


def test_cancel_manage_booking_requires_valid_customer_token(client) -> None:
    response = client.post("/api/v1/bookings/manage/not-a-real-token/cancel", json={"reason": "Testing invalid token."})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_cancel_manage_booking_rejects_tampered_tenant_token(client) -> None:
    from app.core.security import create_customer_manage_token

    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]
    tampered_token, _ = create_customer_manage_token(
        {
            "bookingId": booking["id"],
            "tenantId": "tampered-tenant-id",
        }
    )

    response = client.post(
        f"/api/v1/bookings/manage/{tampered_token}/cancel",
        json={"reason": "Trying another tenant."},
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_confirm_booking_draft_requires_customer_details(client) -> None:
    service = _service_by_name(client, "New Client Consultation")
    date_text = _next_weekday(2)
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

    confirm_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/confirm"
    )

    assert confirm_response.status_code == 400
    assert confirm_response.json()["error"]["code"] == "bad_request"


def test_confirm_booking_draft_requires_matching_tenant(client) -> None:
    service = _service_by_name(client, "New Client Consultation")
    date_text = _next_weekday(2)
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
                "name": "Cross Tenant Customer",
                "email": "cross-tenant@example.com",
                "phone": "555-0201",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    _create_secondary_tenant()

    confirm_response = client.post(
        f"/api/v1/tenants/other-tenant/booking-drafts/{booking_draft_id}/confirm"
    )

    assert confirm_response.status_code == 404
    assert confirm_response.json()["error"]["code"] == "not_found"


def test_create_checkout_session_for_deposit_draft_reuses_open_session(client) -> None:
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
                "name": "Deposit Guest",
                "email": "deposit@example.com",
                "phone": "555-0300",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    checkout_payload = {
        "tenantSlug": "brow-beauty-lab",
        "bookingDraftId": booking_draft_id,
        "kind": "deposit",
        "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
        "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
    }
    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json=checkout_payload,
    )

    assert checkout_response.status_code == 200
    first_checkout = checkout_response.json()
    assert first_checkout["checkoutUrl"].startswith(f"/brow-beauty-lab/book/{booking_draft_id}/payment?sessionId=")
    assert first_checkout["sessionId"]
    assert first_checkout["expiresAt"] is not None

    draft_response = client.get(f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}")

    assert draft_response.status_code == 200
    assert draft_response.json()["status"] == "awaiting_payment"

    reused_checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json=checkout_payload,
    )

    assert reused_checkout_response.status_code == 200
    assert reused_checkout_response.json()["sessionId"] == first_checkout["sessionId"]


def test_create_checkout_session_requires_customer_details(client) -> None:
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

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": booking_draft_id,
            "kind": "deposit",
            "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
        },
    )

    assert checkout_response.status_code == 400
    assert checkout_response.json()["error"]["code"] == "bad_request"


def test_create_checkout_session_requires_matching_tenant(client) -> None:
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
                "name": "Tenant Scoped Deposit Guest",
                "email": "tenant-scoped-deposit@example.com",
                "phone": "555-0301",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    _create_secondary_tenant()

    checkout_response = client.post(
        "/api/v1/tenants/other-tenant/payments/checkout-sessions",
        json={
            "tenantSlug": "other-tenant",
            "bookingDraftId": booking_draft_id,
            "kind": "deposit",
            "successUrl": f"/other-tenant/book/{booking_draft_id}/success",
            "cancelUrl": f"/other-tenant/book/{booking_draft_id}",
        },
    )

    assert checkout_response.status_code == 404
    assert checkout_response.json()["error"]["code"] == "not_found"


def test_complete_checkout_session_confirms_booking_and_blocks_availability(client) -> None:
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
                "name": "Paid Deposit Guest",
                "email": "paid-deposit@example.com",
                "phone": "555-0302",
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
            "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
        },
    )
    session_id = checkout_response.json()["sessionId"]

    complete_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/{session_id}/complete"
    )

    assert complete_response.status_code == 200
    payload = complete_response.json()
    assert payload["status"] == "confirmed"
    assert payload["depositStatus"] == "paid"
    assert payload["paymentResolution"] == "pending"
    assert payload["customer"]["email"] == "paid-deposit@example.com"

    booking_response = client.get(f"/api/v1/tenants/brow-beauty-lab/bookings/{payload['id']}")

    assert booking_response.status_code == 200
    assert booking_response.json()["depositStatus"] == "paid"

    availability_after_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )

    assert availability_after_response.status_code == 200
    assert not any(
        slot["startAt"] == first_slot["startAt"]
        and slot["providerId"] == first_slot["providerId"]
        and slot["locationId"] == first_slot["locationId"]
        for slot in availability_after_response.json()["slots"]
    )


def test_create_booking_draft_populates_pre_booking_form_requirements(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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

    assert create_response.status_code == 200
    payload = create_response.json()
    assert payload["status"] == "awaiting_form"
    assert len(payload["formRequirements"]) == 1
    assert payload["formRequirements"][0]["customerPromptTiming"] == "pre_booking"
    assert payload["formRequirements"][0]["status"] == "pending"
    assert payload["formRequirements"][0]["schema"]["fields"]


def test_submit_booking_form_requirement_satisfies_pre_booking_requirement(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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
    requirement = create_response.json()["formRequirements"][0]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Form Completion Guest",
                "email": "forms@example.com",
                "phone": "555-0400",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    submit_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/form-requirements/{requirement['id']}/submit",
        json={
            "answers": {
                "recentRetinoidUse": False,
                "skinSensitivityNotes": "No active sensitivity.",
            }
        },
    )

    assert submit_response.status_code == 200
    response_payload = submit_response.json()
    assert response_payload["bookingDraftId"] == booking_draft_id
    assert response_payload["answers"]["recentRetinoidUse"] is False

    draft_response = client.get(f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}")

    assert draft_response.status_code == 200
    assert draft_response.json()["status"] == "slot_held"
    assert all(requirement["status"] == "satisfied" for requirement in draft_response.json()["formRequirements"])


def test_submit_booking_form_requirement_validates_required_answers(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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
    requirement = create_response.json()["formRequirements"][0]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Invalid Form Guest",
                "email": "invalid-form@example.com",
                "phone": "555-0401",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    submit_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/form-requirements/{requirement['id']}/submit",
        json={
            "answers": {
                "skinSensitivityNotes": "Missing the required yes/no answer.",
            }
        },
    )

    assert submit_response.status_code == 422
    assert submit_response.json()["error"]["code"] == "validation_error"


def test_submit_booking_form_requirement_requires_matching_tenant(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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
    requirement = create_response.json()["formRequirements"][0]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Cross Tenant Form Guest",
                "email": "cross-tenant-form@example.com",
                "phone": "555-0402",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    _create_secondary_tenant()

    submit_response = client.post(
        f"/api/v1/tenants/other-tenant/booking-drafts/{booking_draft_id}/form-requirements/{requirement['id']}/submit",
        json={
            "answers": {
                "recentRetinoidUse": True,
                "skinSensitivityNotes": "Tenant mismatch should fail.",
            }
        },
    )

    assert submit_response.status_code == 404
    assert submit_response.json()["error"]["code"] == "not_found"


def test_create_checkout_session_requires_completed_pre_booking_forms(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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
                "name": "Blocked Checkout Guest",
                "email": "blocked-checkout@example.com",
                "phone": "555-0403",
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
            "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
        },
    )

    assert checkout_response.status_code == 400
    assert checkout_response.json()["error"]["code"] == "bad_request"

def _auth_headers(client, demo_credentials) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json=demo_credentials)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_list_booking_form_responses_returns_submitted_answers(client, demo_credentials) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    date_text = _next_weekday(4)
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
    assert create_response.status_code == 200
    draft_payload = create_response.json()
    booking_draft_id = draft_payload["id"]
    requirement = draft_payload["formRequirements"][0]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Form Visibility Guest",
                "email": "form-visibility@example.com",
                "phone": "555-0410",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )
    assert update_response.status_code == 200

    submit_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/form-requirements/{requirement['id']}/submit",
        json={
            "answers": {
                "recentRetinoidUse": True,
                "skinSensitivityNotes": "Mild redness after exfoliation.",
            }
        },
    )
    assert submit_response.status_code == 200

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": booking_draft_id,
            "kind": "deposit",
            "successUrl": f"/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{booking_draft_id}",
        },
    )
    assert checkout_response.status_code == 200
    session_id = checkout_response.json()["sessionId"]

    complete_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions/{session_id}/complete"
    )
    assert complete_response.status_code == 200
    booking_id = complete_response.json()["id"]

    headers = _auth_headers(client, demo_credentials)
    list_response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}/form-responses",
        headers=headers,
    )
    assert list_response.status_code == 200
    items = list_response.json()["items"]
    assert len(items) == 1
    entry = items[0]
    assert entry["formName"] == "Brow Prep Check-In"
    assert entry["scope"] == "customer"
    assert entry["customerPromptTiming"] == "pre_booking"
    assert entry["answers"]["recentRetinoidUse"] is True
    assert entry["answers"]["skinSensitivityNotes"] == "Mild redness after exfoliation."
    assert entry["schema"]["fields"]


def test_list_booking_form_responses_requires_authentication(client) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking_id = confirmed["booking"]["id"]

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}/form-responses"
    )
    assert response.status_code in (401, 403)


def test_list_booking_form_responses_isolates_tenants(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking_id = confirmed["booking"]["id"]

    headers = _auth_headers(client, demo_credentials)
    response = client.get(
        f"/api/v1/tenants/not-a-tenant/bookings/{booking_id}/form-responses",
        headers=headers,
    )
    assert response.status_code in (403, 404)


# ---------------------------------------------------------------------------
# Staff-side cancellation tests
# ---------------------------------------------------------------------------


def test_staff_cancel_booking_refunds_deposit_outside_window(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]
    service = confirmed["service"]
    date_text = confirmed["dateText"]
    first_slot = confirmed["firstSlot"]

    headers = _auth_headers(client, demo_credentials)
    cancel_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/cancel",
        json={"reason": "Customer requested cancellation."},
        headers=headers,
    )

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["status"] == "canceled"
    assert payload["depositStatus"] == "refunded"
    assert payload["paymentResolution"] == "waived"

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["bookingStatus"] == "canceled"
    assert snapshot["depositStatus"] == "refunded"
    assert snapshot["paymentResolution"] == "waived"
    assert snapshot["paymentStatuses"] == ["refunded"]
    assert snapshot["paymentDepositStatuses"] == ["refunded"]
    assert "refund_recorded" in snapshot["paymentEventKinds"]
    assert "staff_canceled" in snapshot["bookingEventKinds"]
    assert any(event.get("reason") == "Customer requested cancellation." for event in snapshot["bookingEventPayloads"])
    assert any(event.get("refundedAmountCents") == service["depositCents"] for event in snapshot["bookingEventPayloads"])

    # Availability should reopen after cancellation
    availability_after_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    assert availability_after_response.status_code == 200
    assert any(
        slot["startAt"] == first_slot["startAt"]
        and slot["providerId"] == first_slot["providerId"]
        and slot["locationId"] == first_slot["locationId"]
        for slot in availability_after_response.json()["slots"]
    )


def test_staff_cancel_booking_forfeits_deposit_inside_window(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]
    inside_window_start = datetime.now(timezone.utc) + timedelta(hours=4)
    _move_booking_start(booking["id"], inside_window_start)

    headers = _auth_headers(client, demo_credentials)
    cancel_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/cancel",
        json={"reason": "No-show risk."},
        headers=headers,
    )

    assert cancel_response.status_code == 200
    payload = cancel_response.json()
    assert payload["status"] == "canceled"
    assert payload["depositStatus"] == "forfeited"
    assert payload["paymentResolution"] == "collected"

    snapshot = _booking_payment_snapshot(booking["id"])
    assert snapshot["bookingStatus"] == "canceled"
    assert snapshot["depositStatus"] == "forfeited"
    assert snapshot["paymentResolution"] == "collected"
    assert snapshot["paymentStatuses"] == ["succeeded"]
    assert snapshot["paymentDepositStatuses"] == ["forfeited"]
    assert "deposit_forfeited" in snapshot["paymentEventKinds"]
    assert "staff_canceled" in snapshot["bookingEventKinds"]
    assert any(event.get("forfeitedAmountCents") == confirmed["service"]["depositCents"] for event in snapshot["bookingEventPayloads"])


def test_staff_cancel_booking_requires_permission(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]

    # No auth headers = unauthenticated
    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/cancel",
        json={},
    )
    assert response.status_code in (401, 403)


def test_staff_cancel_booking_rejects_non_confirmed(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]

    headers = _auth_headers(client, demo_credentials)
    # Cancel once
    client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/cancel",
        json={},
        headers=headers,
    )

    # Cancel again — should return the already-canceled booking without error
    second_response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}/cancel",
        json={},
        headers=headers,
    )
    assert second_response.status_code == 200
    assert second_response.json()["status"] == "canceled"


def test_staff_cancel_booking_isolates_tenants(client, demo_credentials) -> None:
    confirmed = _confirm_paid_deposit_booking(client)
    booking = confirmed["booking"]

    headers = _auth_headers(client, demo_credentials)
    response = client.post(
        f"/api/v1/tenants/not-a-tenant/bookings/{booking['id']}/cancel",
        json={},
        headers=headers,
    )
    assert response.status_code in (403, 404)
