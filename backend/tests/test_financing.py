def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _create_service(client, headers: dict[str, str], price_cents: int = 120_000) -> dict:
    location = client.get("/api/v1/tenants/brow-beauty-lab/locations").json()["locations"][0]
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": f"Financing test {price_cents}",
            "durationMinutes": 60,
            "priceCents": price_cents,
            "depositCents": 0,
            "locationIds": [location["id"]],
        },
        headers=headers,
    )
    assert response.status_code == 201, response.json()
    return response.json()


def _set_studio_financing(client, headers: dict[str, str], **overrides) -> None:
    financing = {
        "enabled": True,
        "buttonText": "Pay over time",
        "linkUrl": "https://financing.example.com/apply",
        "months": 12,
        **overrides,
    }
    response = client.patch("/api/v1/tenants/brow-beauty-lab/branding", json={"financing": financing}, headers=headers)
    assert response.status_code == 200, response.json()


def _service(client, service_id: str) -> dict:
    services = client.get("/api/v1/tenants/brow-beauty-lab/services").json()["services"]
    return next(item for item in services if item["id"] == service_id)


def _turn_on(client, headers, service_id: str, **fields) -> dict:
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service_id}", json={"financingMode": "on", **fields}, headers=headers
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _create_category(client, headers, name: str) -> dict:
    response = client.post("/api/v1/tenants/brow-beauty-lab/service-categories", json={"name": name}, headers=headers)
    assert response.status_code in (200, 201), response.json()
    return response.json()


def _set_category_financing(client, headers, category_id: str, mode: str) -> dict:
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category_id}", json={"financingMode": mode}, headers=headers
    )
    assert response.status_code == 200, response.json()
    return response.json()


def test_services_show_no_financing_until_the_studio_turns_it_on(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)

    assert service["effectiveFinancing"] is None
    assert _turn_on(client, headers, service["id"])["effectiveFinancing"] is None


def test_financing_is_opt_in_per_service(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, price_cents=120_000)
    _set_studio_financing(client, headers)

    # The studio setting alone shows nothing.
    assert _service(client, service["id"])["effectiveFinancing"] is None

    financing = _turn_on(client, headers, service["id"])["effectiveFinancing"]
    assert financing == {
        "buttonText": "Pay over time",
        "linkUrl": "https://financing.example.com/apply",
        "months": 12,
        "monthlyCents": 10_000,
        "aprLabel": None,
        "disclosure": None,
        "termsUrl": None,
    }


def test_monthly_amount_rounds_to_the_nearest_cent(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, price_cents=10_000)
    _set_studio_financing(client, headers, months=3)

    assert _turn_on(client, headers, service["id"])["effectiveFinancing"]["monthlyCents"] == 3_333


def test_financing_button_text_has_a_default(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)
    _set_studio_financing(client, headers, buttonText="  ")

    assert _turn_on(client, headers, service["id"])["effectiveFinancing"]["buttonText"] == "See financing options"


def test_a_category_turns_financing_on_for_its_services(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Financed treatments")
    service = _create_service(client, headers)
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"categoryId": category["id"]}, headers=headers
    )
    _set_studio_financing(client, headers)
    assert _service(client, service["id"])["effectiveFinancing"] is None

    updated = _set_category_financing(client, headers, category["id"], "on")
    assert updated["financingMode"] == "on"
    assert _service(client, service["id"])["effectiveFinancing"]["monthlyCents"] == 10_000


def test_a_service_can_opt_out_of_its_categorys_financing(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Mostly financed")
    service = _create_service(client, headers)
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"categoryId": category["id"]}, headers=headers
    )
    _set_studio_financing(client, headers)
    _set_category_financing(client, headers, category["id"], "on")

    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"financingMode": "off"}, headers=headers
    )
    assert response.status_code == 200, response.json()
    assert response.json()["financingMode"] == "off"
    assert response.json()["effectiveFinancing"] is None

    back = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"inheritFinancing": True}, headers=headers
    )
    assert back.json()["financingMode"] is None
    assert back.json()["effectiveFinancing"] is not None


def test_a_service_can_turn_financing_on_in_a_category_that_has_it_off(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Financing off")
    service = _create_service(client, headers)
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"categoryId": category["id"]}, headers=headers
    )
    _set_studio_financing(client, headers)
    _set_category_financing(client, headers, category["id"], "off")
    assert _service(client, service["id"])["effectiveFinancing"] is None

    assert _turn_on(client, headers, service["id"])["effectiveFinancing"] is not None


def test_a_service_can_use_its_own_financing_link(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)
    _set_studio_financing(client, headers)

    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        json={"financingMode": "custom", "financingUrl": "https://other.example.com/apply"},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    financing = response.json()["effectiveFinancing"]
    assert financing["linkUrl"] == "https://other.example.com/apply"
    assert financing["monthlyCents"] == 10_000

    again = _turn_on(client, headers, service["id"])
    assert again["effectiveFinancing"]["linkUrl"] == "https://financing.example.com/apply"
    assert again["financingUrl"] is None


def test_a_free_service_shows_no_financing(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, price_cents=0)
    _set_studio_financing(client, headers)

    assert _turn_on(client, headers, service["id"])["effectiveFinancing"] is None


def test_turning_the_studio_setting_off_hides_financing_everywhere(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Studio switch")
    service = _create_service(client, headers)
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}", json={"categoryId": category["id"]}, headers=headers
    )
    _set_studio_financing(client, headers)
    _set_category_financing(client, headers, category["id"], "on")
    _turn_on(client, headers, service["id"])
    _set_studio_financing(client, headers, enabled=False)

    assert _service(client, service["id"])["effectiveFinancing"] is None


def test_category_financing_rejects_unknown_modes(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Bad mode")
    url = f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}"

    assert client.patch(url, json={"financingMode": "custom"}, headers=headers).status_code == 422
    assert client.patch(url, json={"financingMode": "on"}, headers=headers).status_code == 200
    assert client.patch(url, json={"clearFinancing": True}, headers=headers).json()["financingMode"] is None


def test_optional_apr_label_disclosure_and_terms_link_come_through(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)
    _set_studio_financing(
        client,
        headers,
        aprLabel=" 0% APR ",
        disclosure="Subject to approval.",
        termsUrl="https://financing.example.com/terms",
    )

    financing = _turn_on(client, headers, service["id"])["effectiveFinancing"]
    assert financing["aprLabel"] == "0% APR"
    assert financing["disclosure"] == "Subject to approval."
    assert financing["termsUrl"] == "https://financing.example.com/terms"


def test_apr_label_disclosure_and_terms_link_are_absent_unless_filled_in(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)
    _set_studio_financing(client, headers)

    financing = _turn_on(client, headers, service["id"])["effectiveFinancing"]
    assert financing["aprLabel"] is None
    assert financing["disclosure"] is None
    assert financing["termsUrl"] is None


def test_financing_wording_is_length_checked_and_the_terms_link_must_be_a_web_address(client) -> None:
    headers = _auth_headers(client)
    for bad in (
        {"aprLabel": "x" * 25},
        {"disclosure": "x" * 401},
        {"termsUrl": "javascript:alert(1)"},
    ):
        financing = {"enabled": True, "buttonText": "Pay", "linkUrl": "https://f.example.com", "months": 12, **bad}
        response = client.patch("/api/v1/tenants/brow-beauty-lab/branding", json={"financing": financing}, headers=headers)
        assert response.status_code == 422, bad


def test_studio_financing_needs_a_web_link_and_a_sensible_term(client) -> None:
    headers = _auth_headers(client)
    for bad in (
        {"linkUrl": "javascript:alert(1)"},
        {"linkUrl": "ftp://financing.example.com"},
        {"linkUrl": ""},
        {"months": 1},
        {"months": 120},
        {"buttonText": "x" * 61},
    ):
        financing = {"enabled": True, "buttonText": "Pay", "linkUrl": "https://f.example.com", "months": 12, **bad}
        response = client.patch("/api/v1/tenants/brow-beauty-lab/branding", json={"financing": financing}, headers=headers)
        assert response.status_code == 422, bad


def test_service_financing_rejects_bad_mode_and_links(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers)
    url = f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}"

    assert client.patch(url, json={"financingMode": "sometimes"}, headers=headers).status_code == 422
    assert client.patch(url, json={"financingMode": "custom"}, headers=headers).status_code == 422
    assert (
        client.patch(url, json={"financingMode": "custom", "financingUrl": "javascript:alert(1)"}, headers=headers).status_code
        == 422
    )


def test_studio_financing_requires_authentication(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"financing": {"enabled": True, "linkUrl": "https://f.example.com", "months": 12}},
    )
    assert response.status_code == 401


def test_another_studio_cannot_change_financing_and_does_not_inherit_it(client) -> None:
    headers = _auth_headers(client)
    _set_studio_financing(client, headers)
    created = client.post(
        "/api/v1/tenants",
        json={
            "name": "Other Studio",
            "slug": "other-financing-studio",
            "timezone": "America/New_York",
            "locationName": "Other Suite",
            "ownerName": "Sam Lee",
            "ownerEmail": "owner@otherfinancing.test",
            "ownerPassword": "OwnerAccess123",
        },
    )
    assert created.status_code == 201
    other_headers = _auth_headers(client, email="owner@otherfinancing.test", password="OwnerAccess123")

    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"financing": {"enabled": False}},
        headers=other_headers,
    )
    assert response.status_code == 403
    other = client.get("/api/v1/tenants/other-financing-studio").json()
    assert other["branding"].get("financing") in (None, {"enabled": False, "buttonText": None, "linkUrl": None, "months": None})
    assert client.get("/api/v1/tenants/brow-beauty-lab").json()["branding"]["financing"]["enabled"] is True


def _held_draft(client, headers) -> dict:
    from datetime import datetime, timedelta, timezone

    api = "/api/v1/tenants/brow-beauty-lab"
    service = next(s for s in client.get(f"{api}/services").json()["services"] if s["isActive"])
    providers = client.get(f"{api}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service["id"] in p["serviceIds"])
    location_id = client.get(f"{api}/locations").json()["locations"][0]["id"]
    client.put(
        f"{api}/providers/{provider_id}/schedule",
        headers=headers,
        json={"locationId": location_id, "entries": [
            {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True},
        ]},
    )
    today = datetime.now(timezone.utc).date()
    monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
    slot = client.get(
        f"{api}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": monday, "windowDays": 1},
    ).json()["slots"][0]
    draft = client.post(
        f"{api}/booking-drafts",
        json={"tenantSlug": "brow-beauty-lab", "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"]},
    )
    assert draft.status_code in (200, 201), draft.json()
    return draft.json()


def test_starting_financing_is_noted_on_the_draft_without_changing_the_hold(client) -> None:
    headers = _auth_headers(client)
    draft = _held_draft(client, headers)
    url = f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}"
    assert draft["financingStartedAt"] is None

    # Needs contact details first, so staff always have someone to follow up with.
    assert client.post(f"{url}/financing-started").status_code == 400

    saved = client.patch(url, json={"customer": {"name": "Fin Client", "email": "fin@example.com", "phone": "6045550101"}})
    assert saved.status_code == 200, saved.json()

    first = client.post(f"{url}/financing-started")
    assert first.status_code == 200, first.json()
    stamped = first.json()["financingStartedAt"]
    assert stamped is not None
    assert first.json()["status"] == draft["status"]
    assert first.json()["expiresAt"][:19] == draft["expiresAt"][:19]

    # Only the first click is kept.
    assert client.post(f"{url}/financing-started").json()["financingStartedAt"][:26] == stamped[:26]
    assert client.get(url).json()["financingStartedAt"][:26] == stamped[:26]


def test_starting_financing_is_scoped_to_the_tenant(client) -> None:
    headers = _auth_headers(client)
    draft = _held_draft(client, headers)
    other = client.post(f"/api/v1/tenants/not-a-studio/booking-drafts/{draft['id']}/financing-started")
    assert other.status_code == 404


def _lapse_draft(draft_id: str) -> None:
    import asyncio
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.db.models import BookingDraft, SlotHold
    from app.db.session import get_session_maker
    from app.services.slot_hold_cleanup import expire_lapsed_booking_drafts

    async def _go():
        past = datetime.now(timezone.utc) - timedelta(minutes=1)
        async with get_session_maker()() as session:
            draft = await session.scalar(select(BookingDraft).where(BookingDraft.id == draft_id))
            draft.expires_at = past
            hold = await session.scalar(select(SlotHold).where(SlotHold.booking_draft_id == draft_id))
            if hold is not None:
                hold.expires_at = past
            await session.commit()
        await expire_lapsed_booking_drafts()

    asyncio.run(_go())


def _attempts(client, headers, customer_id: str) -> list[dict]:
    response = client.get(f"/api/v1/tenants/brow-beauty-lab/customers/{customer_id}", headers=headers)
    assert response.status_code == 200, response.json()
    return response.json()["bookingAttempts"]


def test_profile_keeps_a_financing_attempt_after_the_hold_lapses(client) -> None:
    headers = _auth_headers(client)
    draft = _held_draft(client, headers)
    url = f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}"
    saved = client.patch(url, json={"customer": {"name": "Fin Later", "email": "finlater@example.com", "phone": "6045557983"}}).json()
    customer_id = saved["customer"]["id"]

    # Contact details alone is an unfinished booking still in progress.
    assert [(a["id"], a["outcome"]) for a in _attempts(client, headers, customer_id)] == [(draft["id"], "in_progress")]

    client.post(f"{url}/financing-started")
    _lapse_draft(draft["id"])

    # Financing can take days; the hold is long gone but the profile still says what happened.
    [attempt] = _attempts(client, headers, customer_id)
    assert attempt["id"] == draft["id"]
    assert attempt["outcome"] == "financing_started"
    assert attempt["financingStartedAt"] is not None
    assert attempt["bookedSince"] is False
    assert attempt["serviceName"]


def test_profile_flags_an_abandoned_booking_that_never_reached_financing(client) -> None:
    headers = _auth_headers(client)
    draft = _held_draft(client, headers)
    url = f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}"
    customer_id = client.patch(url, json={"customer": {"name": "Left Cart", "email": "leftcart@example.com", "phone": "6045552286"}}).json()["customer"]["id"]
    _lapse_draft(draft["id"])

    [attempt] = _attempts(client, headers, customer_id)
    assert attempt["outcome"] == "abandoned"
    assert attempt["financingStartedAt"] is None


def test_booking_attempts_require_customer_access_and_stay_in_the_tenant(client) -> None:
    headers = _auth_headers(client)
    draft = _held_draft(client, headers)
    url = f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}"
    customer_id = client.patch(url, json={"customer": {"name": "Private Pat", "email": "private@example.com", "phone": "6045555474"}}).json()["customer"]["id"]

    assert client.get(f"/api/v1/tenants/brow-beauty-lab/customers/{customer_id}").status_code in (401, 403)
    assert client.get(f"/api/v1/tenants/not-a-studio/customers/{customer_id}", headers=headers).status_code in (403, 404)
