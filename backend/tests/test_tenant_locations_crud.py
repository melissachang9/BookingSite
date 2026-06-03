def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _default_location_id(client) -> str:
    return client.get("/api/v1/tenants/brow-beauty-lab").json()["defaultLocationId"]


def test_list_locations_includes_phone_field(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations")
    assert response.status_code == 200
    body = response.json()["locations"]
    assert len(body) >= 1
    assert "phone" in body[0]


def test_create_location_success(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={
            "name": "Riverside Studio",
            "timeZone": "America/Los_Angeles",
            "addressLine1": "123 River Rd",
            "city": "Portland",
            "state": "OR",
            "postalCode": "97201",
            "phone": "+1 (503) 555-0199",
        },
        headers=headers,
    )
    assert response.status_code == 201, response.json()
    created = response.json()
    assert created["name"] == "Riverside Studio"
    assert created["phone"] == "+1 (503) 555-0199"
    assert created["isActive"] is True

    listing = client.get("/api/v1/tenants/brow-beauty-lab/locations").json()["locations"]
    assert any(loc["id"] == created["id"] for loc in listing)


def test_create_location_rejects_duplicate_name(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={"name": "Downtown Studio", "timeZone": "America/Los_Angeles"},
        headers=headers,
    )
    assert response.status_code == 409


def test_create_location_rejects_bad_phone(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={"name": "Bad Phone Studio", "timeZone": "America/Los_Angeles", "phone": "abc"},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_location_changes_name_and_phone(client) -> None:
    headers = _auth_headers(client)
    created = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={"name": "Annex Studio", "timeZone": "America/Los_Angeles"},
        headers=headers,
    ).json()
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/locations/{created['id']}",
        json={"name": "Annex Beauty Bar", "phone": "503-555-0100"},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["name"] == "Annex Beauty Bar"
    assert body["phone"] == "503-555-0100"


def test_deactivate_location_hides_from_public_list(client) -> None:
    headers = _auth_headers(client)
    created = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={"name": "Pop Up Studio", "timeZone": "America/Los_Angeles"},
        headers=headers,
    ).json()
    delete_response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/locations/{created['id']}",
        headers=headers,
    )
    assert delete_response.status_code == 200
    assert delete_response.json()["isActive"] is False

    listing = client.get("/api/v1/tenants/brow-beauty-lab/locations").json()["locations"]
    assert not any(loc["id"] == created["id"] for loc in listing)

    admin_listing = client.get(
        "/api/v1/tenants/brow-beauty-lab/locations/manage",
        headers=headers,
    ).json()["locations"]
    assert any(loc["id"] == created["id"] and loc["isActive"] is False for loc in admin_listing)


def test_cannot_deactivate_default_location(client) -> None:
    headers = _auth_headers(client)
    default_id = _default_location_id(client)
    response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/locations/{default_id}",
        headers=headers,
    )
    assert response.status_code == 409


def test_cannot_set_default_location_inactive_via_patch(client) -> None:
    headers = _auth_headers(client)
    default_id = _default_location_id(client)
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/locations/{default_id}",
        json={"isActive": False},
        headers=headers,
    )
    assert response.status_code == 409


def test_location_routes_require_auth(client) -> None:
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/locations",
        json={"name": "Unauthorized Studio", "timeZone": "America/Los_Angeles"},
    )
    assert response.status_code == 401


def test_admin_list_requires_auth(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations/manage")
    assert response.status_code == 401
