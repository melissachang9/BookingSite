"""Provider price/duration/deposit overrides and room/equipment constraints
flowing through availability, booking drafts and bookings."""

import asyncio
from datetime import datetime, timedelta, timezone

from app.db.models import ProviderService, Service
from app.services.resource_availability import ResourceRequirement, Usage, peak_usage, pick_resources
from app.services.service_terms import resolve_service_terms

TENANT = "brow-beauty-lab"
API = f"/api/v1/tenants/{TENANT}"


# --------------------------------------------------------------------------- unit


def _service(price: int = 12000, deposit: int = 2500, duration: int = 60) -> Service:
    return Service(price_cents=price, deposit_cents=deposit, duration_minutes=duration)


def test_resolve_terms_uses_service_values_without_override() -> None:
    terms = resolve_service_terms(_service(), None)
    assert (terms.price_cents, terms.deposit_cents, terms.duration_minutes) == (12000, 2500, 60)


def test_resolve_terms_applies_each_provider_override() -> None:
    link = ProviderService(price_cents_override=15000, deposit_cents_override=5000, duration_minutes_override=75)
    terms = resolve_service_terms(_service(), link)
    assert (terms.price_cents, terms.deposit_cents, terms.duration_minutes) == (15000, 5000, 75)


def test_resolve_terms_caps_deposit_at_the_provider_price() -> None:
    link = ProviderService(price_cents_override=2000)
    terms = resolve_service_terms(_service(deposit=2500), link)
    assert terms.price_cents == 2000
    assert terms.deposit_cents == 2000


def _at(hour: int, minute: int = 0) -> datetime:
    return datetime(2030, 1, 7, hour, minute, tzinfo=timezone.utc)


def test_peak_usage_counts_overlap_not_total() -> None:
    usages = [Usage(_at(9), _at(10), 1), Usage(_at(10), _at(11), 1), Usage(_at(9, 30), _at(10, 30), 1)]
    assert peak_usage(usages, _at(9), _at(11)) == 2  # never 3 at once
    assert peak_usage(usages, _at(11), _at(12)) == 0  # back-to-back is free


def test_pick_resources_takes_any_free_room_and_all_equipment() -> None:
    room_a = ResourceRequirement("room-a", True, None, 1, 1)
    room_b = ResourceRequirement("room-b", True, None, 1, 1)
    panel = ResourceRequirement("panel", False, None, 2, 1)
    usage = {"room-a": [Usage(_at(9), _at(10), 1)], "panel": [Usage(_at(9), _at(10), 1)]}
    assert pick_resources([room_a, room_b, panel], usage, "loc", _at(9), _at(10)) == [("room-b", 1), ("panel", 1)]

    usage["room-b"] = [Usage(_at(9), _at(10), 1)]
    assert pick_resources([room_a, room_b, panel], usage, "loc", _at(9), _at(10)) is None  # no room free


def test_pick_resources_respects_equipment_units_and_location() -> None:
    panel = ResourceRequirement("panel", False, None, 2, 1)
    usage = {"panel": [Usage(_at(9), _at(10), 1), Usage(_at(9), _at(10), 1)]}
    assert pick_resources([panel], usage, "loc", _at(9), _at(10)) is None  # both units in use

    pinned_room = ResourceRequirement("room-a", True, "downtown", 1, 1)
    assert pick_resources([pinned_room], {}, "uptown", _at(9), _at(10)) is None
    assert pick_resources([pinned_room], {}, "downtown", _at(9), _at(10)) == [("room-a", 1)]


# --------------------------------------------------------------------------- API helpers


def _auth(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "owner@browbeautylab.test", "password": "DemoBooking123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _service_named(client, name: str) -> dict:
    services = client.get(f"{API}/services").json()["services"]
    return next(service for service in services if service["name"] == name)


def _providers_for(client, headers, service_id: str) -> list[dict]:
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    return [p for p in providers if p["isActive"] and service_id in p["serviceIds"]]


def _location_id(client) -> str:
    return client.get(f"{API}/locations").json()["locations"][0]["id"]


def _next_monday() -> str:
    today = datetime.now(timezone.utc).date()
    return (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()


def _work_mondays(client, headers, provider_id: str, location_id: str) -> None:
    response = client.put(
        f"{API}/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [{"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True}],
        },
    )
    assert response.status_code == 200, response.json()


def _slots(client, service_id: str, location_id: str, date: str, provider_id: str | None = None) -> list[dict]:
    params = {"serviceId": service_id, "locationId": location_id, "date": date, "windowDays": 1}
    if provider_id:
        params["providerId"] = provider_id
    response = client.get(f"{API}/availability", params=params)
    assert response.status_code == 200, response.json()
    return response.json()["slots"]


def _draft(client, service_id: str, slot: dict):
    return client.post(
        f"{API}/booking-drafts",
        json={
            "tenantSlug": TENANT,
            "serviceId": service_id,
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
        },
    )


def _confirm(client, draft_id: str, email: str) -> dict:
    update = client.patch(
        f"{API}/booking-drafts/{draft_id}",
        json={
            "customer": {"name": "Terms Guest", "email": email, "phone": "555-0199"},
            "intakeCompletionTiming": "before_visit",
        },
    )
    assert update.status_code == 200, update.json()
    confirm = client.post(f"{API}/booking-drafts/{draft_id}/confirm")
    assert confirm.status_code == 200, confirm.json()
    return confirm.json()


def _set_variant(client, headers, service_id: str, provider_id: str, **overrides) -> None:
    entry = {
        "providerId": provider_id,
        "priceCents": None,
        "durationMinutes": None,
        "depositCents": None,
        "commissionFlatCents": None,
        "commissionBasisPoints": None,
        **overrides,
    }
    response = client.put(f"{API}/services/{service_id}/provider-variants", headers=headers, json={"variants": [entry]})
    assert response.status_code == 200, response.json()


def _create_resource(client, headers, name: str, kind: str, quantity: int = 1, location_id: str | None = None) -> str:
    response = client.post(
        f"{API}/resources",
        headers=headers,
        json={"name": name, "kind": kind, "quantity": quantity, "locationId": location_id},
    )
    assert response.status_code in (200, 201), response.json()
    assert response.json()["quantity"] == quantity
    return response.json()["id"]


def _require(client, headers, service_id: str, entries: list[tuple[str, int]]):
    return client.put(
        f"{API}/services/{service_id}/resources",
        headers=headers,
        json={"resources": [{"resourceId": rid, "quantity": qty} for rid, qty in entries]},
    )


def _shared_start(slots: list[dict], providers: list[str]) -> str:
    """A start time every listed provider has free."""
    by_start: dict[str, set[str]] = {}
    for slot in slots:
        by_start.setdefault(slot["startAt"], set()).add(slot["providerId"])
    return next(start for start, ids in sorted(by_start.items()) if set(providers) <= ids)


# --------------------------------------------------------------------------- overrides


def test_provider_overrides_flow_into_slots_drafts_and_bookings(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    _set_variant(client, headers, service["id"], provider["id"], priceCents=5000, durationMinutes=45)

    monday = _next_monday()
    slot = _slots(client, service["id"], location_id, monday, provider["id"])[0]
    start = datetime.fromisoformat(slot["startAt"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(slot["endAt"].replace("Z", "+00:00"))
    assert end - start == timedelta(minutes=45)
    assert slot["priceCents"] == 5000

    draft = _draft(client, service["id"], slot)
    assert draft.status_code == 201 or draft.status_code == 200, draft.json()
    assert (draft.json()["priceCents"], draft.json()["durationMinutes"]) == (5000, 45)

    booking = _confirm(client, draft.json()["id"], "terms-override@example.com")
    assert booking["priceCents"] == 5000

    # The booking keeps the price it was sold at when the service price changes.
    patch = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"priceCents": 9900})
    assert patch.status_code == 200, patch.json()
    reloaded = client.get(f"{API}/bookings/{booking['id']}", headers=headers).json()
    assert reloaded["priceCents"] == 5000


def test_provider_deposit_override_sets_the_draft_deposit(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    _set_variant(client, headers, service["id"], provider["id"], depositCents=1000)

    slot = _slots(client, service["id"], location_id, _next_monday(), provider["id"])[0]
    draft = _draft(client, service["id"], slot)
    assert draft.json()["depositCents"] == 1000
    assert draft.json()["priceCents"] == service["priceCents"]


def test_hold_blocks_overlapping_slots_for_the_same_provider(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    monday = _next_monday()

    slots = _slots(client, service["id"], location_id, monday, provider["id"])
    held = slots[4]
    assert _draft(client, service["id"], held).status_code in (200, 201)

    held_start = datetime.fromisoformat(held["startAt"].replace("Z", "+00:00"))
    after = {s["startAt"] for s in _slots(client, service["id"], location_id, monday, provider["id"])}
    overlapping = (held_start + timedelta(minutes=15)).isoformat().replace("+00:00", "Z")
    assert held["startAt"] not in after
    assert overlapping not in after  # a different but overlapping window


def test_customer_can_reschedule_into_an_overlapping_time(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    monday = _next_monday()

    slots = _slots(client, service["id"], location_id, monday, provider["id"])
    booking = _confirm(client, _draft(client, service["id"], slots[4]).json()["id"], "reschedule@example.com")
    new_start = datetime.fromisoformat(slots[4]["startAt"].replace("Z", "+00:00")) + timedelta(minutes=15)

    response = client.post(
        f"/api/v1/bookings/manage/{booking['customerManageToken']}/reschedule",
        json={"startsAt": new_start.isoformat()},
    )
    assert response.status_code == 200, response.json()


# --------------------------------------------------------------------------- resources


def test_room_is_shared_across_providers(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    providers = [p["id"] for p in _providers_for(client, headers, service["id"])[:2]]
    assert len(providers) == 2, "seed needs two providers for Signature Facial"
    location_id = _location_id(client)
    for provider_id in providers:
        _work_mondays(client, headers, provider_id, location_id)
    monday = _next_monday()

    room = _create_resource(client, headers, "Facial room 1", "room")
    assert _require(client, headers, service["id"], [(room, 1)]).status_code == 200

    start = _shared_start(_slots(client, service["id"], location_id, monday), providers)
    first = next(s for s in _slots(client, service["id"], location_id, monday, providers[0]) if s["startAt"] == start)
    assert _draft(client, service["id"], first).status_code in (200, 201)

    # The only room is taken, so the other provider can't be booked then either.
    assert not any(s["startAt"] == start for s in _slots(client, service["id"], location_id, monday, providers[1]))
    second = {**first, "providerId": providers[1]}
    assert _draft(client, service["id"], second).status_code == 409

    # A second room frees the slot again.
    room_two = _create_resource(client, headers, "Facial room 2", "room")
    assert _require(client, headers, service["id"], [(room, 1), (room_two, 1)]).status_code == 200
    assert any(s["startAt"] == start for s in _slots(client, service["id"], location_id, monday, providers[1]))


def test_equipment_units_cap_concurrent_bookings(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    providers = [p["id"] for p in _providers_for(client, headers, service["id"])[:2]]
    location_id = _location_id(client)
    for provider_id in providers:
        _work_mondays(client, headers, provider_id, location_id)
    monday = _next_monday()

    panel = _create_resource(client, headers, "LED panel", "equipment", quantity=1)
    assert _require(client, headers, service["id"], [(panel, 1)]).status_code == 200
    start = _shared_start(_slots(client, service["id"], location_id, monday), providers)
    first = next(s for s in _slots(client, service["id"], location_id, monday, providers[0]) if s["startAt"] == start)
    assert _draft(client, service["id"], first).status_code in (200, 201)
    assert not any(s["startAt"] == start for s in _slots(client, service["id"], location_id, monday, providers[1]))

    # Owning a second unit lets a second booking run at the same time.
    update = client.patch(f"{API}/resources/{panel}", headers=headers, json={"quantity": 2})
    assert update.status_code == 200, update.json()
    assert any(s["startAt"] == start for s in _slots(client, service["id"], location_id, monday, providers[1]))


def test_location_pinned_room_only_serves_its_location(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    provider_id = _providers_for(client, headers, service["id"])[0]["id"]
    locations = client.get(f"{API}/locations").json()["locations"]
    assert len(locations) >= 2, "seed needs two locations"
    home, away = locations[0]["id"], locations[1]["id"]
    _work_mondays(client, headers, provider_id, home)

    room = _create_resource(client, headers, "Away room", "room", location_id=away)
    assert _require(client, headers, service["id"], [(room, 1)]).status_code == 200
    assert _slots(client, service["id"], home, _next_monday(), provider_id) == []


def test_inactive_resources_do_not_block(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    provider_id = _providers_for(client, headers, service["id"])[0]["id"]
    locations = client.get(f"{API}/locations").json()["locations"]
    home, away = locations[0]["id"], locations[1]["id"]
    _work_mondays(client, headers, provider_id, home)

    # A room only usable elsewhere blocks this location while it's active...
    room = _create_resource(client, headers, "Retired room", "room", location_id=away)
    assert _require(client, headers, service["id"], [(room, 1)]).status_code == 200
    assert _slots(client, service["id"], home, _next_monday(), provider_id) == []
    # ...and is ignored once retired.
    retire = client.patch(f"{API}/resources/{room}", headers=headers, json={"isActive": False})
    assert retire.status_code == 200, retire.json()
    assert _slots(client, service["id"], home, _next_monday(), provider_id) != []


def test_equipment_requirement_cannot_exceed_units_owned(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    panel = _create_resource(client, headers, "Wand", "equipment", quantity=1)
    response = _require(client, headers, service["id"], [(panel, 2)])
    assert response.status_code == 422


def test_resource_quantity_is_validated(client) -> None:
    headers = _auth(client)
    response = client.post(f"{API}/resources", headers=headers, json={"name": "Nothing", "kind": "equipment", "quantity": 0})
    assert response.status_code == 422


# --------------------------------------------------------------------------- tenant isolation


def _other_tenant_provider_id() -> str:
    async def _run() -> str:
        from app.db.models import Provider, Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = Tenant(slug="other-tenant", name="Other Tenant", timezone="America/New_York", branding_json={}, settings_json={})
            session.add(tenant)
            await session.flush()
            provider = Provider(tenant_id=tenant.id, name="Elsewhere", is_active=True)
            session.add(provider)
            await session.commit()
            return provider.id

    return asyncio.run(_run())


def test_booking_cannot_move_to_another_tenants_provider(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    provider = _providers_for(client, headers, service["id"])[0]
    location_id = _location_id(client)
    _work_mondays(client, headers, provider["id"], location_id)
    slot = _slots(client, service["id"], location_id, _next_monday(), provider["id"])[0]
    booking = _confirm(client, _draft(client, service["id"], slot).json()["id"], "isolation@example.com")

    response = client.patch(
        f"{API}/bookings/{booking['id']}",
        headers=headers,
        json={"providerId": _other_tenant_provider_id()},
    )
    assert response.status_code == 404
    reloaded = client.get(f"{API}/bookings/{booking['id']}", headers=headers).json()
    assert reloaded["providerId"] == provider["id"]
