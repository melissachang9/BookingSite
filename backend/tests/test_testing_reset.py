import asyncio
from datetime import datetime, timedelta, timezone


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


def _first_service(client) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return services_response.json()["services"][0]


def _service_by_name(client, name: str) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return next(service for service in services_response.json()["services"] if service["name"] == name)


def _first_slot(client, service_id: str) -> dict[str, str]:
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service_id, "date": _next_weekday(0)},
    )
    assert availability_response.status_code == 200
    return availability_response.json()["slots"][0]


def _create_booking_draft(client, service: dict[str, str], slot: dict[str, str]):
    return client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
            "customer": {
                "name": "E2E Reset Customer",
                "email": "e2e-reset@example.com",
                "phone": "555-0130",
            },
        },
    )


def _parse_datetime(value: str) -> datetime:
    parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    return parsed if parsed.tzinfo is not None else parsed.replace(tzinfo=timezone.utc)


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


def _confirm_consultation_booking(client) -> dict[str, str]:
    service = _service_by_name(client, "New Client Consultation")
    slot = _first_slot(client, service["id"])
    create_response = _create_booking_draft(client, service, slot)

    assert create_response.status_code == 200
    booking_draft_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "E2E Move Booking",
                "email": "e2e-move@example.com",
                "phone": "555-0199",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )

    assert update_response.status_code == 200

    confirm_response = client.post(f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}/confirm")

    assert confirm_response.status_code == 200
    return confirm_response.json()


def test_reset_e2e_data_clears_booking_drafts_holds_and_customers(client) -> None:
    service = _first_service(client)
    slot = _first_slot(client, service["id"])
    create_response = _create_booking_draft(client, service, slot)
    assert create_response.status_code == 200
    booking_draft_id = create_response.json()["id"]

    reset_response = client.post("/api/v1/testing/e2e/reset")

    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["tenantSlug"] == "brow-beauty-lab"
    assert reset_payload["slotHoldsDeleted"] == 1
    assert reset_payload["bookingDraftsDeleted"] == 1
    # Includes the customer from the booking draft above plus 4 seeded demo customers.
    assert reset_payload["customersDeleted"] == 5

    stale_draft_response = client.get(f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}")
    assert stale_draft_response.status_code == 404

    retry_response = _create_booking_draft(client, service, slot)
    assert retry_response.status_code == 200
    assert retry_response.json()["startsAt"] == slot["startAt"]


def test_reset_e2e_data_rejects_unknown_tenant(client) -> None:
    response = client.post("/api/v1/testing/e2e/reset", json={"tenantSlug": "missing-tenant"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"


def test_reset_e2e_data_clears_submitted_form_requirements_and_responses(client) -> None:
    service = _service_by_name(client, "Brow Shape and Tint")
    slot = _first_slot(client, service["id"])
    create_response = _create_booking_draft(client, service, slot)

    assert create_response.status_code == 200
    draft_payload = create_response.json()
    booking_draft_id = draft_payload["id"]
    requirement = draft_payload["formRequirements"][0]

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

    reset_response = client.post("/api/v1/testing/e2e/reset")

    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["tenantSlug"] == "brow-beauty-lab"
    assert reset_payload["slotHoldsDeleted"] == 1
    assert reset_payload["bookingDraftsDeleted"] == 1
    # Includes the customer from the booking draft above plus 4 seeded demo customers.
    assert reset_payload["customersDeleted"] == 5

    retry_response = _create_booking_draft(client, service, slot)

    assert retry_response.status_code == 200
    assert retry_response.json()["startsAt"] == slot["startAt"]


def test_move_booking_start_updates_confirmed_booking_for_e2e(client) -> None:
    booking = _confirm_consultation_booking(client)
    original_start = _parse_datetime(booking["startsAt"])
    original_end = _parse_datetime(booking["endsAt"])
    original_duration = original_end - original_start
    moved_start = datetime.now(timezone.utc) + timedelta(hours=4)

    response = client.post(
        f"/api/v1/testing/e2e/bookings/{booking['id']}/move-start",
        json={"startsAt": moved_start.isoformat()},
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["tenantSlug"] == "brow-beauty-lab"
    assert payload["bookingId"] == booking["id"]

    moved_response = client.get(f"/api/v1/tenants/brow-beauty-lab/bookings/{booking['id']}")

    assert moved_response.status_code == 200
    moved_booking = moved_response.json()
    updated_start = _parse_datetime(moved_booking["startsAt"])
    updated_end = _parse_datetime(moved_booking["endsAt"])
    assert updated_start == moved_start
    assert updated_end - updated_start == original_duration


def test_move_booking_start_requires_starts_at_value(client) -> None:
    booking = _confirm_consultation_booking(client)

    response = client.post(f"/api/v1/testing/e2e/bookings/{booking['id']}/move-start", json={})

    assert response.status_code == 422


def test_move_booking_start_is_tenant_safe(client) -> None:
    booking = _confirm_consultation_booking(client)
    _create_secondary_tenant()

    response = client.post(
        f"/api/v1/testing/e2e/bookings/{booking['id']}/move-start",
        json={
            "tenantSlug": "other-tenant",
            "startsAt": (datetime.now(timezone.utc) + timedelta(hours=4)).isoformat(),
        },
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"