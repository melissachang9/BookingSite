def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_tenant_settings_expose_wallet_membership_defaults(client) -> None:
    body = client.get("/api/v1/tenants/brow-beauty-lab").json()
    settings = body["settings"]
    assert settings["walletEnabled"] is False
    assert settings["walletExpirationMonths"] is None
    assert settings["membershipEnabled"] is False


def test_patch_wallet_membership_enables_flags(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletEnabled": True, "walletExpirationMonths": 12, "membershipEnabled": True},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    settings = response.json()["settings"]
    assert settings["walletEnabled"] is True
    assert settings["walletExpirationMonths"] == 12
    assert settings["membershipEnabled"] is True


def test_patch_wallet_membership_partial_update_preserves_other_fields(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletEnabled": True, "walletExpirationMonths": 6, "membershipEnabled": True},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletExpirationMonths": 24},
        headers=headers,
    )
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["walletEnabled"] is True
    assert settings["walletExpirationMonths"] == 24
    assert settings["membershipEnabled"] is True


def test_patch_wallet_membership_can_clear_expiration(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletExpirationMonths": 12},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletExpirationMonths": None},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["settings"]["walletExpirationMonths"] is None


def test_patch_wallet_membership_rejects_non_positive_expiration(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletExpirationMonths": 0},
        headers=headers,
    )
    assert response.status_code == 422


def test_patch_wallet_membership_rejects_negative_expiration(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletExpirationMonths": -3},
        headers=headers,
    )
    assert response.status_code == 422


def test_patch_wallet_membership_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/wallet-membership",
        json={"walletEnabled": True},
    )
    assert response.status_code == 401
