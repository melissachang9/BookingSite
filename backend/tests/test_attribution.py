"""Marketing attribution: captured on the draft, copied to the booking, frozen as the customer's first touch."""

from __future__ import annotations

import asyncio

from test_provider_terms_and_resources import (
    API,
    _auth,
    _confirm,
    _location_id,
    _next_monday,
    _providers_for,
    _service_named,
    _slots,
    _work_mondays,
)

TENANT = "brow-beauty-lab"


def _draft_with(client, service_id: str, slot: dict, attribution: dict | None, *, method: str = "public_online"):
    body = {
        "tenantSlug": TENANT,
        "serviceId": service_id,
        "providerId": slot["providerId"],
        "locationId": slot["locationId"],
        "startsAt": slot["startAt"],
        "bookingMethod": method,
        "customer": {"name": "Attributed Guest", "email": f"attr-{slot['startAt']}@example.com", "phone": "555-0111"},
    }
    if attribution is not None:
        body["attribution"] = attribution
    return client.post(f"{API}/booking-drafts", json=body)


def _setup(client):
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    slots = _slots(client, service["id"], location_id, _next_monday(), provider["id"])
    return headers, service, slots


def _row(model, entity_id: str):
    from app.db.session import get_session_maker

    async def _run():
        async with get_session_maker()() as session:
            return await session.get(model, entity_id)

    return asyncio.run(_run())


def test_attribution_is_cleaned_and_follows_the_draft_into_booking_and_customer(client) -> None:
    from app.db.models import Booking, BookingDraft, Customer

    _, service, slots = _setup(client)
    created = _draft_with(
        client,
        service["id"],
        slots[0],
        {"source": "  Instagram ", "medium": "Paid", "campaign": "spring-glow", "referrerUrl": "https://l.instagram.com/x", "landingPath": "/brow-beauty-lab"},
    )
    assert created.status_code in (200, 201), created.json()
    draft_id = created.json()["id"]

    draft = _row(BookingDraft, draft_id)
    assert (draft.utm_source, draft.utm_medium, draft.utm_campaign) == ("instagram", "paid", "spring-glow")
    customer = _row(Customer, draft.customer_id)
    assert (customer.first_touch_source, customer.first_touch_medium, customer.first_touch_campaign) == ("instagram", "paid", "spring-glow")
    assert customer.first_touch_landing_path == "/brow-beauty-lab"
    assert customer.first_booking_at is None

    booking = _confirm(client, draft_id, "attr-confirm@example.com")
    stored = _row(Booking, booking["id"])
    assert (stored.utm_source, stored.utm_campaign) == ("instagram", "spring-glow")
    # Confirming saves the guest's real contact details, which may create their customer record.
    refreshed = _row(Customer, stored.customer_id)
    assert refreshed.first_touch_source == "instagram"
    assert refreshed.first_booking_id == booking["id"]
    assert refreshed.first_booking_at is not None


def test_first_touch_is_not_overwritten_by_a_later_visit(client) -> None:
    from app.db.models import BookingDraft, Customer

    _, service, slots = _setup(client)
    first = _draft_with(client, service["id"], slots[0], {"source": "google", "medium": "cpc"})
    assert first.status_code in (200, 201), first.json()
    customer_id = _row(BookingDraft, first.json()["id"]).customer_id

    # Same person comes back from a different campaign.
    body = {
        "tenantSlug": TENANT,
        "serviceId": service["id"],
        "providerId": slots[8]["providerId"],
        "locationId": slots[8]["locationId"],
        "startsAt": slots[8]["startAt"],
        "customer": {"name": "Attributed Guest", "email": f"attr-{slots[0]['startAt']}@example.com", "phone": "555-0111"},
        "attribution": {"source": "tiktok", "medium": "social"},
    }
    second = client.post(f"{API}/booking-drafts", json=body)
    assert second.status_code in (200, 201), second.json()
    assert _row(BookingDraft, second.json()["id"]).utm_source == "tiktok"
    assert _row(Customer, customer_id).first_touch_source == "google"


def test_staff_entered_drafts_and_missing_attribution_record_nothing(client) -> None:
    from app.db.models import BookingDraft

    headers, service, slots = _setup(client)
    plain = _draft_with(client, service["id"], slots[0], None)
    assert plain.status_code in (200, 201), plain.json()
    assert _row(BookingDraft, plain.json()["id"]).utm_source is None

    staff = client.post(
        f"{API}/booking-drafts",
        headers=headers,
        json={
            "tenantSlug": TENANT,
            "serviceId": service["id"],
            "providerId": slots[16]["providerId"],
            "locationId": slots[16]["locationId"],
            "startsAt": slots[16]["startAt"],
            "bookingMethod": "staff_entered",
            "attribution": {"source": "instagram"},
        },
    )
    assert staff.status_code in (200, 201), staff.json()
    assert _row(BookingDraft, staff.json()["id"]).utm_source is None


def test_clients_report_groups_new_clients_by_first_touch_source(client) -> None:
    from datetime import date, timedelta

    headers, service, slots = _setup(client)
    draft = _draft_with(client, service["id"], slots[0], {"source": "instagram", "medium": "paid"})
    assert draft.status_code in (200, 201), draft.json()
    _confirm(client, draft.json()["id"], "attr-report@example.com")

    # A new client is counted from their first booked visit, which is next Monday.
    today = date.today()
    report = client.get(
        f"{API}/reports/clients",
        headers=headers,
        params={"from": (today - timedelta(days=1)).isoformat(), "to": (today + timedelta(days=14)).isoformat()},
    )
    assert report.status_code == 200, report.json()
    assert "instagram" in {row["key"] for row in report.json()["sources"]}


def _funnel_kinds(draft_id: str) -> list[str]:
    import asyncio

    from sqlalchemy import select

    from app.db.models import FunnelEvent
    from app.db.session import get_session_maker

    async def _run():
        async with get_session_maker()() as session:
            rows = await session.scalars(
                select(FunnelEvent).where(FunnelEvent.booking_draft_id == draft_id).order_by(FunnelEvent.occurred_at.asc())
            )
            return [(row.kind, row.utm_source) for row in rows]

    return asyncio.run(_run())


def test_funnel_steps_are_stored_with_the_visitors_source(client) -> None:
    _, service, slots = _setup(client)
    created = _draft_with(client, service["id"], slots[0], {"source": "instagram", "medium": "paid"})
    assert created.status_code in (200, 201), created.json()
    draft_id = created.json()["id"]
    _confirm(client, draft_id, "funnel-guest@example.com")

    events = _funnel_kinds(draft_id)
    kinds = [kind for kind, _ in events]
    assert kinds[0] == "booking_started"
    assert "contact_details_saved" in kinds
    assert kinds[-1] == "booking_confirmed"
    # Every step carries the source, so conversion by source never depends on the draft still existing.
    assert {source for _, source in events} == {"instagram"}


def test_marketing_report_shows_the_funnel_by_source(client) -> None:
    from datetime import date, timedelta

    headers, service, slots = _setup(client)
    done = _draft_with(client, service["id"], slots[0], {"source": "instagram"})
    _confirm(client, done.json()["id"], "funnel-done@example.com")
    abandoned = _draft_with(client, service["id"], slots[8], {"source": "instagram"})
    assert abandoned.status_code in (200, 201), abandoned.json()
    walk_in = _draft_with(client, service["id"], slots[16], None)
    assert walk_in.status_code in (200, 201), walk_in.json()

    today = date.today()
    report = client.get(
        f"{API}/marketing/report",
        headers=headers,
        params={"from": today.isoformat(), "to": (today + timedelta(days=14)).isoformat()},
    ).json()
    rows = {row["source"]: row for row in report["funnel"]}
    assert rows["instagram"]["started"] == 2
    assert rows["instagram"]["confirmed"] == 1
    assert rows["instagram"]["conversion"] == 0.5
    assert rows["direct"]["started"] == 1 and rows["direct"]["confirmed"] == 0
