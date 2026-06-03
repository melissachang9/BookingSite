def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_default_business_fields_present(client) -> None:
    payload = client.get("/api/v1/tenants/brow-beauty-lab").json()
    settings = payload["settings"]
    assert settings["country"] == "US"
    assert settings["currency"] == "USD"
    assert settings["smsPhone"] is None
    assert payload["name"]  # baseline


def test_owner_can_update_business_details(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={
            "name": "Brow Beauty Studio",
            "homepageUrl": "https://browbeautystudio.com",
            "country": "CA",
            "currency": "CAD",
            "smsPhone": "+1 416 555 0199",
        },
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["name"] == "Brow Beauty Studio"
    assert body["branding"]["homepageUrl"] == "https://browbeautystudio.com"
    assert body["settings"]["country"] == "CA"
    assert body["settings"]["currency"] == "CAD"
    assert body["settings"]["smsPhone"] == "+1 416 555 0199"

    follow_up = client.get("/api/v1/tenants/brow-beauty-lab").json()
    assert follow_up["name"] == "Brow Beauty Studio"
    assert follow_up["settings"]["currency"] == "CAD"


def test_update_business_partial_payload_preserves_other_fields(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"currency": "EUR"},
        headers=headers,
    )
    assert response.status_code == 200
    body = response.json()
    assert body["settings"]["currency"] == "EUR"
    assert body["settings"]["country"] == "US"  # unchanged default


def test_update_business_rejects_unsupported_currency(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"currency": "XYZ"},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_business_rejects_bad_country_code(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"country": "12"},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_business_rejects_bad_phone(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"smsPhone": "abc"},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_business_clears_sms_phone_when_null(client) -> None:
    headers = _auth_headers(client)
    # First set
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"smsPhone": "+1 555 123 4567"},
        headers=headers,
    )
    # Then clear
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"smsPhone": ""},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["settings"]["smsPhone"] is None


def test_update_business_requires_authentication(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/business",
        json={"name": "Unauthorized"},
    )
    assert response.status_code == 401
