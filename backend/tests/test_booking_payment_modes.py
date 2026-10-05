"""What a service takes at booking (Services › Online booking), and deleting a
category without losing its services."""

from datetime import datetime, timedelta, timezone

from app.db.models import ProviderService, Service
from app.services.service_terms import resolve_booking_deposit

TENANT = "brow-beauty-lab"
API = f"/api/v1/tenants/{TENANT}"


# --------------------------------------------------------------------------- unit


def _service(mode: str | None, value: int | None = None, percent: int | None = None, deposit: int = 2500) -> Service:
    return Service(
        price_cents=18000,
        deposit_cents=deposit,
        booking_payment_mode=mode,
        booking_payment_value_cents=value,
        booking_payment_percent=percent,
    )


def test_deposit_by_payment_mode() -> None:
    assert resolve_booking_deposit(_service("none"), None, 18000, 5000) == 0
    assert resolve_booking_deposit(_service("full"), None, 18000, 5000) == 18000
    assert resolve_booking_deposit(_service("partial_flat", value=5000), None, 18000, 9999) == 5000
    assert resolve_booking_deposit(_service("partial_percent", percent=30), None, 18000, 5000) == 5400


def test_deposit_falls_back_and_caps() -> None:
    # Blank fixed amount -> studio default deposit.
    assert resolve_booking_deposit(_service("partial_flat"), None, 18000, 5000) == 5000
    # Services saved before payment modes keep their own deposit.
    assert resolve_booking_deposit(_service(None, deposit=2500), None, 18000, 5000) == 2500
    # Never more than the visit costs.
    assert resolve_booking_deposit(_service("partial_flat", value=50000), None, 18000, 0) == 18000


def test_full_payment_includes_add_ons_and_provider_deposit_wins() -> None:
    assert resolve_booking_deposit(_service("full"), None, 22000, 0) == 22000
    link = ProviderService(deposit_cents_override=1000)
    assert resolve_booking_deposit(_service("full"), link, 22000, 0) == 1000


# --------------------------------------------------------------------------- API


def _auth(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "owner@browbeautylab.test", "password": "DemoBooking123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _service_named(client, name: str) -> dict:
    return next(s for s in client.get(f"{API}/services").json()["services"] if s["name"] == name)


def _draft_deposit(client, headers, service: dict) -> int:
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service["id"] in p["serviceIds"])
    location_id = client.get(f"{API}/locations").json()["locations"][0]["id"]
    client.put(
        f"{API}/providers/{provider_id}/schedule",
        headers=headers,
        json={"locationId": location_id, "entries": [
            {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True},
        ]},
    )
    today = datetime.now(timezone.utc).date()
    monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
    slot = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": monday, "windowDays": 1},
    ).json()["slots"][0]
    draft = client.post(
        f"{API}/booking-drafts",
        json={"tenantSlug": TENANT, "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"]},
    )
    assert draft.status_code in (200, 201), draft.json()
    return draft.json()["depositCents"]


def test_draft_deposit_follows_the_service_payment_mode(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")

    full = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"bookingPaymentMode": "full"})
    assert full.status_code == 200, full.json()
    assert _draft_deposit(client, headers, service) == service["priceCents"]

    client.patch(f"{API}/services/{service['id']}", headers=headers,
                 json={"bookingPaymentMode": "partial_percent", "bookingPaymentPercent": 30})
    assert _draft_deposit(client, headers, service) == round(service["priceCents"] * 0.3)

    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"bookingPaymentMode": "none"})
    assert _draft_deposit(client, headers, service) == 0


def test_payment_mode_is_validated(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    bad_mode = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"bookingPaymentMode": "half"})
    assert bad_mode.status_code == 422
    no_percent = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"bookingPaymentMode": "partial_percent"})
    assert no_percent.status_code == 422


def test_clearing_the_fixed_amount_uses_the_studio_default(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    client.patch(f"{API}/services/{service['id']}", headers=headers,
                 json={"bookingPaymentMode": "partial_flat", "bookingPaymentValueCents": 1500})
    cleared = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"clearBookingPaymentValue": True})
    assert cleared.status_code == 200, cleared.json()
    assert cleared.json()["bookingPaymentValueCents"] is None


# --------------------------------------------------------------------------- categories


def _category(client, headers, name: str) -> str:
    response = client.post(f"{API}/service-categories", headers=headers, json={"name": name})
    assert response.status_code in (200, 201), response.json()
    return response.json()["id"]


def test_deleting_a_category_can_move_its_services(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    old = _category(client, headers, "Advanced facials")
    new = _category(client, headers, "Advanced rejuvenation")
    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": old})

    response = client.delete(f"{API}/service-categories/{old}", headers=headers, params={"moveToCategoryId": new})
    assert response.status_code == 204
    assert _service_named(client, "Signature Facial")["categoryId"] == new


def test_deleting_a_category_without_a_target_uncategorizes(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    old = _category(client, headers, "Advanced facials")
    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": old})
    assert client.delete(f"{API}/service-categories/{old}", headers=headers).status_code == 204
    assert _service_named(client, "Signature Facial")["categoryId"] is None


def test_category_move_target_is_validated(client) -> None:
    headers = _auth(client)
    old = _category(client, headers, "Advanced facials")
    same = client.delete(f"{API}/service-categories/{old}", headers=headers, params={"moveToCategoryId": old})
    assert same.status_code == 422
    unknown = client.delete(f"{API}/service-categories/{old}", headers=headers, params={"moveToCategoryId": "nope"})
    assert unknown.status_code == 404
    # Nothing was deleted by the rejected requests.
    ids = [c["id"] for c in client.get(f"{API}/service-categories", headers=headers).json()["categories"]]
    assert old in ids
