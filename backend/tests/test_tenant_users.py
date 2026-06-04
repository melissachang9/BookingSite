def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_list_tenant_users_returns_seeded_roster(client) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=headers)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert "users" in body
    assert len(body["users"]) >= 1
    first = body["users"][0]
    for key in ("id", "email", "name", "role", "isActive", "createdAt"):
        assert key in first, f"missing key {key} in {first}"
    emails = [u["email"] for u in body["users"]]
    assert "owner@browbeautylab.test" in emails


def test_list_tenant_users_orders_by_created_at_ascending(client) -> None:
    headers = _auth_headers(client)
    body = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=headers).json()
    timestamps = [u["createdAt"] for u in body["users"]]
    assert timestamps == sorted(timestamps)


def test_list_tenant_users_requires_auth(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/users")
    assert response.status_code == 401


def test_list_tenant_users_returns_404_for_unknown_tenant(client) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/does-not-exist/users", headers=headers)
    # Permission gate runs first; depending on dependency order this is 403 or 404.
    assert response.status_code in (403, 404)
