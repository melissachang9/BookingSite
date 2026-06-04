def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _create_staff_user(client, headers, email: str = "perm.user@browbeautylab.test", role: str = "staff") -> str:
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=headers,
        json={
            "email": email,
            "name": "Perm User",
            "role": role,
            "initialPassword": "TempPass123",
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()["id"]


def test_get_user_permissions_returns_role_defaults_with_empty_overrides(client) -> None:
    headers = _auth_headers(client)
    user_id = _create_staff_user(client, headers)

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["userId"] == user_id
    assert body["role"] == "staff"
    assert body["overrides"] == []
    assert isinstance(body["roleDefaults"], list)
    assert len(body["effective"]) >= len(body["roleDefaults"])
    # role defaults should all show as allowed in effective set
    effective_map = {grant["key"]: grant["allowed"] for grant in body["effective"]}
    for key in body["roleDefaults"]:
        assert effective_map.get(key) is True


def test_get_user_permissions_requires_auth(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/users/anything/permissions")
    assert response.status_code == 401


def test_put_user_permissions_grants_extra_permission(client) -> None:
    headers = _auth_headers(client)
    user_id = _create_staff_user(client, headers, email="grant.extra@browbeautylab.test")

    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
        json={"overrides": [{"key": "settings.manage", "allowed": True}]},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert {"key": "settings.manage", "allowed": True} in body["overrides"]
    effective_map = {grant["key"]: grant["allowed"] for grant in body["effective"]}
    assert effective_map["settings.manage"] is True


def test_put_user_permissions_denies_default_permission(client) -> None:
    headers = _auth_headers(client)
    user_id = _create_staff_user(client, headers, email="deny.default@browbeautylab.test")

    # Pick any role default to deny.
    initial = client.get(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
    ).json()
    assert initial["roleDefaults"], "expected staff to have role defaults"
    target_key = initial["roleDefaults"][0]

    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
        json={"overrides": [{"key": target_key, "allowed": False}]},
    )
    assert response.status_code == 200, response.json()
    effective_map = {grant["key"]: grant["allowed"] for grant in response.json()["effective"]}
    assert effective_map[target_key] is False


def test_put_user_permissions_replaces_existing_overrides(client) -> None:
    headers = _auth_headers(client)
    user_id = _create_staff_user(client, headers, email="replace.over@browbeautylab.test")

    client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
        json={"overrides": [{"key": "settings.manage", "allowed": True}]},
    )
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
        json={"overrides": []},
    )
    assert response.status_code == 200
    assert response.json()["overrides"] == []


def test_put_user_permissions_rejects_unknown_key(client) -> None:
    headers = _auth_headers(client)
    user_id = _create_staff_user(client, headers, email="bad.key@browbeautylab.test")

    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=headers,
        json={"overrides": [{"key": "made.up.key", "allowed": True}]},
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_permission_key"


def test_put_user_permissions_rejects_owner(client) -> None:
    headers = _auth_headers(client)
    me = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=headers).json()
    owner_id = next(u["id"] for u in me["users"] if u["role"] == "owner")

    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{owner_id}/permissions",
        headers=headers,
        json={"overrides": [{"key": "settings.manage", "allowed": False}]},
    )
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "owner_permissions_locked"


def test_overrides_affect_require_tenant_permission_gate(client) -> None:
    """Granting settings.manage to a staff user lets them list users."""
    owner_headers = _auth_headers(client)
    user_id = _create_staff_user(client, owner_headers, email="gate.user@browbeautylab.test")

    # Staff cannot list users by default (settings.manage gate)
    staff_headers = _auth_headers(client, email="gate.user@browbeautylab.test", password="TempPass123")
    denied = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=staff_headers)
    assert denied.status_code == 403

    # Owner grants settings.manage override
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=owner_headers,
        json={"overrides": [{"key": "settings.manage", "allowed": True}]},
    )

    # Same staff bearer token, but the gate re-reads overrides per request
    allowed = client.get("/api/v1/tenants/brow-beauty-lab/users", headers=staff_headers)
    assert allowed.status_code == 200


def test_session_response_reflects_overrides(client) -> None:
    owner_headers = _auth_headers(client)
    user_id = _create_staff_user(client, owner_headers, email="session.reflect@browbeautylab.test")
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/users/{user_id}/permissions",
        headers=owner_headers,
        json={"overrides": [{"key": "settings.manage", "allowed": True}]},
    )
    login = client.post(
        "/api/v1/auth/login",
        json={"email": "session.reflect@browbeautylab.test", "password": "TempPass123"},
    )
    assert login.status_code == 200
    grants = {g["key"]: g["allowed"] for g in login.json()["user"]["permissions"]}
    assert grants["settings.manage"] is True
