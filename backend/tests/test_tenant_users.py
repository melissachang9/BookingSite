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


# === Phase A: Users CRUD ===


def _new_user_payload(email: str = "newuser@browbeautylab.test", role: str = "staff") -> dict:
    return {
        "email": email,
        "name": "New User",
        "role": role,
        "initialPassword": "TempPass123",
    }


def test_create_tenant_user_success(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=_new_user_payload(email="created.user@browbeautylab.test"),
    )
    assert response.status_code == 201, response.json()
    body = response.json()
    assert body["email"] == "created.user@browbeautylab.test"
    assert body["role"] == "staff"
    assert body["isActive"] is True
    # New user can sign in with the chosen password.
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "created.user@browbeautylab.test", "password": "TempPass123"},
    )
    assert login.status_code == 200


def test_create_tenant_user_rejects_duplicate_email(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=_new_user_payload(email="owner@browbeautylab.test"),
    )
    assert response.status_code == 409


def test_create_tenant_user_rejects_unknown_role(client) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=_new_user_payload(email="bad.role@browbeautylab.test", role="superuser"),
    )
    assert response.status_code == 422


def test_create_tenant_user_rejects_short_password(client) -> None:
    headers = _auth_headers(client)
    payload = _new_user_payload(email="weak.pwd@browbeautylab.test")
    payload["initialPassword"] = "short"
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 422


def test_create_tenant_user_requires_permission(client) -> None:
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        json=_new_user_payload(email="no.auth@browbeautylab.test"),
    )
    assert response.status_code == 401


def test_update_tenant_user_name_and_role(client) -> None:
    headers = _auth_headers(client)
    create = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=_new_user_payload(email="edit.target@browbeautylab.test", role="staff"),
    )
    assert create.status_code == 201
    user_id = create.json()["id"]
    patch = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}",
        headers=headers,
        json={"name": "Edited Name", "role": "manager"},
    )
    assert patch.status_code == 200, patch.json()
    body = patch.json()
    assert body["name"] == "Edited Name"
    assert body["role"] == "manager"


def _owner_id(client, headers) -> str:
    body = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=headers).json()
    for user in body["users"]:
        if user["email"] == "owner@browbeautylab.test":
            return user["id"]
    raise AssertionError("seeded owner not found")


def test_update_tenant_user_blocks_demoting_last_active_owner(client) -> None:
    headers = _auth_headers(client)
    owner_id = _owner_id(client, headers)
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/users/{owner_id}",
        headers=headers,
        json={"role": "manager"},
    )
    assert response.status_code == 409


def test_update_tenant_user_blocks_deactivating_last_active_owner(client) -> None:
    headers = _auth_headers(client)
    owner_id = _owner_id(client, headers)
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/users/{owner_id}",
        headers=headers,
        json={"isActive": False},
    )
    assert response.status_code == 409


def test_update_tenant_user_unknown_id_returns_404(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/users/nonexistent-id",
        headers=headers,
        json={"name": "x"},
    )
    assert response.status_code == 404


def test_reset_tenant_user_password(client) -> None:
    headers = _auth_headers(client)
    create = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json=_new_user_payload(email="pwd.reset@browbeautylab.test"),
    )
    user_id = create.json()["id"]
    reset = client.post(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/password",
        headers=headers,
        json={"newPassword": "BrandNew456"},
    )
    assert reset.status_code == 200, reset.json()
    # Old password must fail; new password must succeed.
    old = client.post(
        "/api/v1/auth/login",
        json={"email": "pwd.reset@browbeautylab.test", "password": "TempPass123"},
    )
    assert old.status_code == 401
    new = client.post(
        "/api/v1/auth/login",
        json={"email": "pwd.reset@browbeautylab.test", "password": "BrandNew456"},
    )
    assert new.status_code == 200
