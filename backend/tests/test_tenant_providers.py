def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _locations(client) -> list[dict]:
    return client.get("/api/v1/tenants/brow-beauty-lab/locations").json()["locations"]


def _services(client) -> list[dict]:
    return client.get("/api/v1/tenants/brow-beauty-lab/services").json()["services"]


def test_list_providers_admin_returns_full_roster(client) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/providers/manage", headers=headers)
    assert response.status_code == 200
    providers = response.json()["providers"]
    assert len(providers) >= 1
    first = providers[0]
    for key in ("id", "name", "isActive", "isBookableOnline", "serviceIds", "locationIds"):
        assert key in first


def test_list_providers_admin_requires_permission(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/providers/manage")
    assert response.status_code == 401


def test_create_provider_success(client) -> None:
    headers = _auth_headers(client)
    locations = _locations(client)
    services = _services(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/providers",
        headers=headers,
        json={
            "name": "Test Provider",
            "email": "test.provider@browbeautylab.test",
            "locationIds": [locations[0]["id"]],
            "serviceIds": [services[0]["id"]],
            "isBookableOnline": True,
        },
    )
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["name"] == "Test Provider"
    assert body["isBookableOnline"] is True
    assert locations[0]["id"] in body["locationIds"]
    assert services[0]["id"] in body["serviceIds"]


def test_create_provider_rejects_foreign_location(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/providers",
        headers=headers,
        json={
            "name": "Bad",
            "locationIds": ["bogus-location-id"],
            "serviceIds": [],
        },
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_locations"


def test_update_provider_replaces_locations_and_services(client) -> None:
    headers = _auth_headers(client)
    locations = _locations(client)
    services = _services(client)
    created = client.post(
        "/api/v1/tenants/brow-beauty-lab/providers",
        headers=headers,
        json={"name": "Edit Me", "locationIds": [locations[0]["id"]], "serviceIds": []},
    ).json()
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/providers/{created['id']}",
        headers=headers,
        json={
            "name": "Edited",
            "isBookableOnline": False,
            "locationIds": [locations[0]["id"]],
            "serviceIds": [services[0]["id"]],
        },
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["name"] == "Edited"
    assert body["isBookableOnline"] is False
    assert services[0]["id"] in body["serviceIds"]


def test_deactivate_provider_sets_inactive(client) -> None:
    headers = _auth_headers(client)
    locations = _locations(client)
    created = client.post(
        "/api/v1/tenants/brow-beauty-lab/providers",
        headers=headers,
        json={"name": "Delete Me", "locationIds": [locations[0]["id"]], "serviceIds": []},
    ).json()
    response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/providers/{created['id']}", headers=headers
    )
    assert response.status_code == 200
    assert response.json()["isActive"] is False


def test_create_staff_combo_creates_user_and_provider(client) -> None:
    headers = _auth_headers(client)
    locations = _locations(client)
    services = _services(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/staff",
        headers=headers,
        json={
            "email": "combo.provider@browbeautylab.test",
            "name": "Combo Provider",
            "role": "provider",
            "initialPassword": "TempPass123",
            "phone": "+1 555-555-1212",
            "provider": {
                "locationIds": [locations[0]["id"]],
                "serviceIds": [services[0]["id"]],
                "isBookableOnline": True,
            },
        },
    )
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["user"]["email"] == "combo.provider@browbeautylab.test"
    assert body["user"]["phone"] == "+1 555-555-1212"
    assert body["provider"] is not None
    assert body["provider"]["userId"] == body["user"]["id"]
    assert body["provider"]["isBookableOnline"] is True


def test_create_staff_combo_user_only(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/staff",
        headers=headers,
        json={
            "email": "useronly@browbeautylab.test",
            "name": "Front Desk",
            "role": "staff",
            "initialPassword": "TempPass123",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["provider"] is None
    assert body["user"]["email"] == "useronly@browbeautylab.test"


def test_create_staff_combo_duplicate_email_409(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/staff",
        headers=headers,
        json={
            "email": "owner@browbeautylab.test",
            "name": "Dup",
            "role": "staff",
            "initialPassword": "TempPass123",
        },
    )
    assert response.status_code == 409


def test_create_user_accepts_phone_and_avatar(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json={
            "email": "withphone@browbeautylab.test",
            "name": "Has Phone",
            "role": "staff",
            "initialPassword": "TempPass123",
            "phone": "+1 555-867-5309",
            "avatarUrl": "https://example.com/a.png",
        },
    )
    assert response.status_code == 201
    body = response.json()
    assert body["phone"] == "+1 555-867-5309"
    assert body["avatarUrl"] == "https://example.com/a.png"
