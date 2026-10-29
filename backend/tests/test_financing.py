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
