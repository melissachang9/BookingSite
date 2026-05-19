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


def _first_service(client) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return services_response.json()["services"][0]


def _service_by_name(client, name: str) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return next(service for service in services_response.json()["services"] if service["name"] == name)


def test_get_tenant_summary(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab")

    assert response.status_code == 200
    payload = response.json()
    assert payload["slug"] == "brow-beauty-lab"
    assert payload["name"] == "Brow Beauty Lab"
    assert payload["settings"]["minLeadTimeMinutes"] == 60


def test_list_services_returns_seeded_catalog(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["services"]) >= 3
    assert payload["services"][0]["locationIds"]


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
            }
        },
    )

    assert update_response.status_code == 200
    assert update_response.json()["customer"]["name"] == "Updated Draft Customer"


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