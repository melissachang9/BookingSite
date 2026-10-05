"""Service add-ons: catalog management, slot length, drafts, bookings, checkout."""

import asyncio
from datetime import datetime, timedelta, timezone

TENANT = "brow-beauty-lab"
API = f"/api/v1/tenants/{TENANT}"


def _auth(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "owner@browbeautylab.test", "password": "DemoBooking123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _service_named(client, name: str) -> dict:
    services = client.get(f"{API}/services").json()["services"]
    return next(service for service in services if service["name"] == name)


def _add_on(client, headers, service_id: str, **fields) -> dict:
    body = {"name": "LED therapy", "priceCents": 4000, "durationMinutes": 15, **fields}
    response = client.post(f"{API}/services/{service_id}/add-ons", headers=headers, json=body)
    assert response.status_code == 201, response.json()
    return response.json()


def _provider_with_monday(client, headers, service_id: str) -> tuple[str, str]:
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service_id in p["serviceIds"])
    location_id = client.get(f"{API}/locations").json()["locations"][0]["id"]
    response = client.put(
        f"{API}/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [{"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True}],
        },
    )
    assert response.status_code == 200, response.json()
    return provider_id, location_id


def _next_monday() -> str:
    today = datetime.now(timezone.utc).date()
    return (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()


def _minutes(slot: dict) -> int:
    start = datetime.fromisoformat(slot["startAt"].replace("Z", "+00:00"))
    end = datetime.fromisoformat(slot["endAt"].replace("Z", "+00:00"))
    return int((end - start).total_seconds() // 60)


# --------------------------------------------------------------------------- catalog


def test_add_on_crud_and_public_listing(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    led = _add_on(client, headers, service["id"])
    mask = _add_on(client, headers, service["id"], name="Hydrating mask", priceCents=2500, durationMinutes=0)
    assert led["sortOrder"] < mask["sortOrder"]

    update = client.patch(
        f"{API}/services/{service['id']}/add-ons/{mask['id']}",
        headers=headers,
        json={"isActive": False, "priceCents": 3000},
    )
    assert update.status_code == 200, update.json()
    assert (update.json()["isActive"], update.json()["priceCents"]) == (False, 3000)

    public = client.get(f"{API}/services/{service['id']}/add-ons").json()["items"]
    assert [item["name"] for item in public] == ["LED therapy"]  # inactive hidden publicly
    managed = client.get(f"{API}/services/{service['id']}/add-ons/manage", headers=headers).json()["items"]
    assert {item["name"] for item in managed} == {"LED therapy", "Hydrating mask"}

    delete = client.delete(f"{API}/services/{service['id']}/add-ons/{mask['id']}", headers=headers)
    assert delete.status_code == 204
    managed = client.get(f"{API}/services/{service['id']}/add-ons/manage", headers=headers).json()["items"]
    assert [item["name"] for item in managed] == ["LED therapy"]


def test_add_on_validation(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    for body in (
        {"name": "", "priceCents": 1000},
        {"name": "Free gift", "priceCents": -1},
        {"name": "Marathon", "priceCents": 1000, "durationMinutes": 999},
    ):
        response = client.post(f"{API}/services/{service['id']}/add-ons", headers=headers, json=body)
        assert response.status_code == 422, body


def test_add_on_management_requires_auth(client) -> None:
    service = _service_named(client, "Signature Facial")
    response = client.post(f"{API}/services/{service['id']}/add-ons", json={"name": "LED", "priceCents": 1000})
    assert response.status_code == 401
    assert client.get(f"{API}/services/{service['id']}/add-ons/manage").status_code == 401


def _create_other_tenant() -> None:
    async def _run() -> None:
        from app.db.models import Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            session.add(Tenant(slug="other-tenant", name="Other Tenant", timezone="America/New_York", branding_json={}, settings_json={}))
            await session.commit()

    asyncio.run(_run())


def test_add_ons_are_tenant_scoped(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    _add_on(client, headers, service["id"])
    _create_other_tenant()
    # Another tenant's slug can't reach this tenant's service or its add-ons.
    response = client.get(f"/api/v1/tenants/other-tenant/services/{service['id']}/add-ons")
    assert response.status_code == 404


# --------------------------------------------------------------------------- booking


def test_add_ons_lengthen_slots_and_reject_foreign_add_ons(client) -> None:
    headers = _auth(client)
    facial = _service_named(client, "Signature Facial")
    brow = _service_named(client, "Brow Shape and Tint")
    led = _add_on(client, headers, facial["id"])
    brow_add_on = _add_on(client, headers, brow["id"], name="Brow wax")
    provider_id, location_id = _provider_with_monday(client, headers, facial["id"])
    params = {"serviceId": facial["id"], "providerId": provider_id, "locationId": location_id, "date": _next_monday(), "windowDays": 1}

    plain = client.get(f"{API}/availability", params=params).json()["slots"][0]
    with_led = client.get(f"{API}/availability", params={**params, "addOnIds": led["id"]}).json()["slots"][0]
    assert _minutes(with_led) == _minutes(plain) + 15

    foreign = client.get(f"{API}/availability", params={**params, "addOnIds": brow_add_on["id"]})
    assert foreign.status_code == 422


def test_add_ons_flow_from_draft_to_booking_items(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    led = _add_on(client, headers, service["id"], priceCents=4000, durationMinutes=15)
    provider_id, location_id = _provider_with_monday(client, headers, service["id"])
    slot = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id,
                "date": _next_monday(), "windowDays": 1, "addOnIds": led["id"]},
    ).json()["slots"][0]

    draft = client.post(
        f"{API}/booking-drafts",
        json={"tenantSlug": TENANT, "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"], "addOnIds": [led["id"]]},
    )
    assert draft.status_code in (200, 201), draft.json()
    body = draft.json()
    assert body["durationMinutes"] == service["durationMinutes"] + 15
    assert body["addOnsTotalCents"] == 4000
    assert [a["name"] for a in body["addOns"]] == ["LED therapy"]

    # Renaming the add-on later doesn't change what this client chose.
    client.patch(f"{API}/services/{service['id']}/add-ons/{led['id']}", headers=headers, json={"name": "Renamed"})

    update = client.patch(
        f"{API}/booking-drafts/{body['id']}",
        json={"customer": {"name": "Add-on Guest", "email": "addon@example.com", "phone": "555-0177"},
              "intakeCompletionTiming": "before_visit"},
    )
    assert update.status_code == 200, update.json()
    booking = client.post(f"{API}/booking-drafts/{body['id']}/confirm")
    assert booking.status_code == 200, booking.json()
    items = booking.json()["items"]
    assert [(i["name"], i["priceCents"], i["sourceAddOnId"]) for i in items] == [("LED therapy", 4000, led["id"])]
    # Balance covers the service and the add-on (before tax).
    assert booking.json()["balanceDueCents"] >= booking.json()["priceCents"] + 4000


def test_draft_rejects_inactive_add_on(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    led = _add_on(client, headers, service["id"], isActive=False)
    provider_id, location_id = _provider_with_monday(client, headers, service["id"])
    slot = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": _next_monday(), "windowDays": 1},
    ).json()["slots"][0]
    draft = client.post(
        f"{API}/booking-drafts",
        json={"tenantSlug": TENANT, "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"], "addOnIds": [led["id"]]},
    )
    assert draft.status_code == 422


def test_staff_can_quick_add_an_add_on_at_checkout(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "New Client Consultation")
    led = _add_on(client, headers, service["id"], priceCents=4000)
    provider_id, location_id = _provider_with_monday(client, headers, service["id"])
    slot = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": _next_monday(), "windowDays": 1},
    ).json()["slots"][0]
    draft_id = client.post(
        f"{API}/booking-drafts",
        json={"tenantSlug": TENANT, "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"]},
    ).json()["id"]
    client.patch(
        f"{API}/booking-drafts/{draft_id}",
        json={"customer": {"name": "Checkout Guest", "email": "checkout-addon@example.com", "phone": "555-0178"},
              "intakeCompletionTiming": "before_visit"},
    )
    booking_id = client.post(f"{API}/booking-drafts/{draft_id}/confirm").json()["id"]

    response = client.post(f"{API}/bookings/{booking_id}/items", headers=headers, json={"sourceAddOnId": led["id"]})
    assert response.status_code in (200, 201), response.json()
    item = response.json()["items"][-1]
    assert (item["name"], item["priceCents"], item["sourceAddOnId"]) == ("LED therapy", 4000, led["id"])
