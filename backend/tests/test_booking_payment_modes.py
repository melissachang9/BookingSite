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
    assert resolve_booking_deposit(_service("none"), None, 18000) == 0
    assert resolve_booking_deposit(_service("full"), None, 18000) == 18000
    assert resolve_booking_deposit(_service("partial_flat", value=5000), None, 18000) == 5000
    assert resolve_booking_deposit(_service("partial_percent", percent=30), None, 18000) == 5400


def test_deposit_falls_back_and_caps() -> None:
    # Services saved before payment modes existed keep their own deposit.
    assert resolve_booking_deposit(_service(None, deposit=2500), None, 18000) == 2500
    # Never more than the visit costs.
    assert resolve_booking_deposit(_service("partial_flat", value=50000), None, 18000) == 18000


def test_full_payment_includes_add_ons_and_provider_deposit_wins() -> None:
    assert resolve_booking_deposit(_service("full"), None, 22000) == 22000
    link = ProviderService(deposit_cents_override=1000)
    assert resolve_booking_deposit(_service("full"), link, 22000) == 1000


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


def test_a_fixed_payment_needs_an_amount(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    client.patch(f"{API}/services/{service['id']}", headers=headers,
                 json={"bookingPaymentMode": "partial_flat", "bookingPaymentValueCents": 1500})
    cleared = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"clearBookingPaymentValue": True})
    assert cleared.status_code == 422, cleared.json()


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


# --------------------------------------------------------------------------- category inheritance


def _category_with_rule(client, headers, name: str, **rule) -> str:
    category_id = _category(client, headers, name)
    response = client.patch(f"{API}/service-categories/{category_id}", headers=headers, json=rule)
    assert response.status_code == 200, response.json()
    return category_id


def _move_service(client, headers, service: dict, category_id: str, **extra) -> dict:
    response = client.patch(
        f"{API}/services/{service['id']}", headers=headers, json={"categoryId": category_id, **extra}
    )
    assert response.status_code == 200, response.json()
    return response.json()


def test_resolver_uses_service_then_category_then_legacy() -> None:
    from app.db.models import ServiceCategory
    from app.services.service_terms import effective_online_booking

    category = ServiceCategory(booking_payment_mode="partial_percent", booking_payment_percent=50)
    inheriting = Service(price_cents=20000, deposit_cents=2500)
    assert resolve_booking_deposit_with(inheriting, category, 20000) == 10000
    assert effective_online_booking(inheriting, category).payment_source == "category"

    own_rule = Service(price_cents=20000, deposit_cents=2500, booking_payment_mode="none")
    assert resolve_booking_deposit_with(own_rule, category, 20000) == 0
    assert effective_online_booking(own_rule, category).payment_source == "service"

    # A category rule beats a leftover legacy deposit; with no rule anywhere the legacy deposit stands.
    assert resolve_booking_deposit_with(inheriting, None, 20000) == 2500
    assert effective_online_booking(Service(price_cents=1, deposit_cents=0), None).payment_source == "none"


def resolve_booking_deposit_with(service: Service, category, total: int) -> int:
    # The resolver reads the category the service already has loaded.
    service.category = category
    return resolve_booking_deposit(service, None, total)


def test_resolver_inherits_card_on_file_and_provider_selection() -> None:
    from app.db.models import ServiceCategory
    from app.services.service_terms import effective_online_booking

    category = ServiceCategory(require_card_on_file=True, provider_selection_mode="auto_assign")
    inheriting = Service(price_cents=1, deposit_cents=0)
    effective = effective_online_booking(inheriting, category)
    assert (effective.require_card_on_file, effective.require_card_source) == (True, "category")
    assert (effective.provider_selection_mode, effective.provider_selection_source) == ("auto_assign", "category")

    overriding = Service(price_cents=1, deposit_cents=0, require_card_on_file=False, provider_selection_mode="hide")
    effective = effective_online_booking(overriding, category)
    assert (effective.require_card_on_file, effective.require_card_source) == (False, "service")
    assert (effective.provider_selection_mode, effective.provider_selection_source) == ("hide", "service")

    bare = effective_online_booking(inheriting, None)
    assert (bare.require_card_on_file, bare.provider_selection_mode) == (False, "client_choice")


def test_draft_deposit_inherits_the_category_rule_until_the_service_sets_its_own(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category_with_rule(client, headers, "Laser", bookingPaymentMode="full")
    moved = _move_service(client, headers, service, category_id, inheritBookingPayment=True)
    assert moved["effectiveBookingPaymentSource"] == "category"
    assert moved["effectiveBookingPaymentMode"] == "full"
    assert _draft_deposit(client, headers, service) == service["priceCents"]

    own = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"bookingPaymentMode": "none"})
    assert own.status_code == 200
    assert own.json()["effectiveBookingPaymentSource"] == "service"
    assert _draft_deposit(client, headers, service) == 0


def test_category_payment_rule_is_validated(client) -> None:
    headers = _auth(client)
    category_id = _category(client, headers, "Laser")
    path = f"{API}/service-categories/{category_id}"
    assert client.patch(path, headers=headers, json={"bookingPaymentMode": "half"}).status_code == 422
    assert client.patch(path, headers=headers, json={"bookingPaymentMode": "partial_percent"}).status_code == 422
    assert client.patch(path, headers=headers, json={"bookingPaymentMode": "partial_flat"}).status_code == 422
    assert client.patch(path, headers=headers, json={"providerSelectionMode": "random"}).status_code == 422

    ok = client.patch(path, headers=headers, json={"bookingPaymentMode": "partial_flat", "bookingPaymentValueCents": 4000})
    assert ok.status_code == 200
    assert ok.json()["bookingPaymentValueCents"] == 4000
    cleared = client.patch(path, headers=headers, json={"clearBookingPayment": True})
    assert cleared.json()["bookingPaymentMode"] is None
    assert cleared.json()["bookingPaymentValueCents"] is None


def test_category_card_on_file_and_provider_selection_reach_the_service(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category_with_rule(
        client, headers, "Laser", requireCardOnFile=True, providerSelectionMode="auto_assign"
    )
    moved = _move_service(client, headers, service, category_id, inheritRequireCardOnFile=True, providerSelectionMode="")
    assert moved["effectiveRequireCardOnFile"] is True
    assert moved["effectiveRequireCardSource"] == "category"
    assert moved["effectiveProviderSelectionMode"] == "auto_assign"
    assert moved["effectiveProviderSelectionSource"] == "category"

    overridden = client.patch(
        f"{API}/services/{service['id']}", headers=headers, json={"requireCardOnFile": False, "providerSelectionMode": "hide"}
    ).json()
    assert overridden["effectiveRequireCardOnFile"] is False
    assert overridden["effectiveProviderSelectionMode"] == "hide"


def test_a_service_cannot_join_another_tenants_category(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    response = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": "not-a-category"})
    assert response.status_code == 404


def test_category_changes_to_online_booking_rules_are_audited(client) -> None:
    import asyncio

    headers = _auth(client)
    category_id = _category_with_rule(client, headers, "Laser", bookingPaymentMode="full")

    async def _events() -> list:
        from sqlalchemy import select

        from app.db.models import AuditEvent
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            rows = await session.scalars(
                select(AuditEvent).where(AuditEvent.entity_id == category_id, AuditEvent.action == "update")
            )
            return [(row.actor_id, row.changes_json) for row in rows]

    events = asyncio.run(_events())
    assert events and events[-1][0] is not None
    assert events[-1][1] == {"booking_payment_mode": "full"}


def test_a_provider_deposit_beats_the_category_and_service_rules(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category_with_rule(client, headers, "Laser", bookingPaymentMode="full")
    _move_service(client, headers, service, category_id, inheritBookingPayment=True)
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service["id"] in p["serviceIds"])

    saved = client.put(
        f"{API}/services/{service['id']}/provider-variants",
        headers=headers,
        json={"variants": [{"providerId": provider_id, "depositCents": 1234}]},
    )
    assert saved.status_code == 200, saved.json()
    assert _draft_deposit(client, headers, service) == 1234

    too_high = client.put(
        f"{API}/services/{service['id']}/provider-variants",
        headers=headers,
        json={"variants": [{"providerId": provider_id, "depositCents": service["priceCents"] + 1}]},
    )
    assert too_high.status_code == 422

    cleared = client.put(
        f"{API}/services/{service['id']}/provider-variants",
        headers=headers,
        json={"variants": [{"providerId": provider_id}]},
    )
    assert cleared.status_code == 200
    assert _draft_deposit(client, headers, service) == service["priceCents"]


# --------------------------------------------------------------------------- tax


def _draft_amounts(client, headers, service: dict) -> dict:
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
    return draft.json()


def _set_tax_rate(client, headers, percent: float) -> None:
    """Service tax rate at every location (the rate lives on locations)."""
    for location in client.get(f"{API}/locations/manage", headers=headers).json()["locations"]:
        response = client.patch(
            f"{API}/locations/{location['id']}", headers=headers, json={"serviceTaxRatePercent": percent}
        )
        assert response.status_code == 200, response.json()


def test_tax_resolver_follows_service_then_category_then_taxable() -> None:
    from app.db.models import ServiceCategory
    from app.services.service_terms import effective_taxable

    assert effective_taxable(Service(price_cents=1, deposit_cents=0), None) == (True, "default")
    exempt = ServiceCategory(is_taxable=False)
    assert effective_taxable(Service(price_cents=1, deposit_cents=0), exempt) == (False, "category")
    own = Service(price_cents=1, deposit_cents=0, is_taxable=True)
    assert effective_taxable(own, exempt) == (True, "service")


def test_a_non_taxable_category_removes_tax_until_a_service_opts_back_in(client) -> None:
    headers = _auth(client)
    _set_tax_rate(client, headers, 10)
    service = _service_named(client, "Signature Facial")
    base = _draft_amounts(client, headers, service)
    assert base["taxCents"] > 0

    category_id = _category_with_rule(client, headers, "Wellness", isTaxable=False)
    moved = _move_service(client, headers, service, category_id)
    assert (moved["effectiveIsTaxable"], moved["effectiveTaxSource"]) == (False, "category")
    assert _draft_amounts(client, headers, service)["taxCents"] == 0

    opted_in = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"isTaxable": True}).json()
    assert (opted_in["effectiveIsTaxable"], opted_in["effectiveTaxSource"]) == (True, "service")
    assert _draft_amounts(client, headers, service)["taxCents"] == base["taxCents"]

    back = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"inheritIsTaxable": True}).json()
    assert back["isTaxable"] is None
    assert back["effectiveIsTaxable"] is False


def test_a_service_can_be_exempt_on_its_own(client) -> None:
    headers = _auth(client)
    _set_tax_rate(client, headers, 10)
    service = _service_named(client, "Signature Facial")
    exempt = client.patch(f"{API}/services/{service['id']}", headers=headers, json={"isTaxable": False})
    assert exempt.status_code == 200
    assert exempt.json()["effectiveTaxSource"] == "service"
    amounts = _draft_amounts(client, headers, service)
    assert amounts["taxCents"] == 0
    assert amounts["fullAmountCents"] == service["priceCents"]


def test_clearing_a_category_tax_setting_makes_it_taxable_again(client) -> None:
    headers = _auth(client)
    category_id = _category_with_rule(client, headers, "Wellness", isTaxable=False)
    path = f"{API}/service-categories/{category_id}"
    assert client.get(f"{API}/service-categories", headers=headers).json()["categories"][-1]["isTaxable"] is False
    cleared = client.patch(path, headers=headers, json={"clearIsTaxable": True})
    assert cleared.status_code == 200
    assert cleared.json()["isTaxable"] is None


def test_a_duplicated_service_keeps_its_tax_and_booking_rules(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    client.patch(f"{API}/services/{service['id']}", headers=headers,
                 json={"isTaxable": False, "bookingPaymentMode": "full"})
    copy = client.post(f"{API}/services/{service['id']}/duplicate", headers=headers)
    assert copy.status_code in (200, 201), copy.json()
    assert copy.json()["isTaxable"] is False
    assert copy.json()["bookingPaymentMode"] == "full"


# --------------------------------------------------------------------------- storefront category list


def test_the_storefront_lists_only_active_categories_without_signing_in(client) -> None:
    headers = _auth(client)
    active = _category(client, headers, "Lasers")
    hidden = _category(client, headers, "Hidden menu")
    client.patch(f"{API}/service-categories/{hidden}", headers=headers, json={"isActive": False})

    response = client.get(f"{API}/categories")  # no Authorization header
    assert response.status_code == 200
    ids = [c["id"] for c in response.json()["categories"]]
    assert active in ids and hidden not in ids
    # Staff-only details stay off the public list.
    assert all(c.get("formIds") in ([], None) for c in response.json()["categories"])


def test_the_public_category_list_is_per_tenant(client) -> None:
    assert client.get("/api/v1/tenants/not-a-studio/categories").status_code == 404


# --------------------------------------------------------------------------- availability counts


def test_availability_counts_distinct_times_and_never_repeats_a_provider_slot(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service["id"] in p["serviceIds"])
    location_id = client.get(f"{API}/locations").json()["locations"][0]["id"]
    # Two overlapping schedule entries for the same weekday used to offer every time twice.
    entries = [
        {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "13:00", "isActive": True},
        {"weekday": 0, "locationId": location_id, "startTime": "10:00", "endTime": "15:00", "isActive": True},
    ]
    client.put(f"{API}/providers/{provider_id}/schedule", headers=headers, json={"locationId": location_id, "entries": entries})
    today = datetime.now(timezone.utc).date()
    monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()

    availability = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": monday, "windowDays": 1},
    ).json()
    keys = [(s["providerId"], s["locationId"], s["startAt"]) for s in availability["slots"]]
    assert keys and len(keys) == len(set(keys))
    day = availability["days"][0]
    assert day["slotCount"] == len(keys)
    assert day["openingCount"] == len({s["startAt"] for s in availability["slots"]})


def test_openings_count_each_time_once_however_many_providers_are_free(client) -> None:
    service = _service_named(client, "Signature Facial")
    availability = client.get(
        f"{API}/availability", params={"serviceId": service["id"], "date": _next_monday(), "windowDays": 7}
    ).json()
    for day in availability["days"]:
        assert day["openingCount"] <= day["slotCount"]


def _next_monday() -> str:
    today = datetime.now(timezone.utc).date()
    return (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
