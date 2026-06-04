def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_tenant_settings_expose_custom_email_defaults(client) -> None:
    body = client.get("/api/v1/tenants/brow-beauty-lab").json()
    custom = body["settings"]["customEmail"]
    assert custom == {"fromAddress": None, "domain": None, "verified": False}


def test_patch_custom_email_sets_from_address_and_domain(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"fromAddress": "hello@browbeautylab.com", "domain": "browbeautylab.com"},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    custom = response.json()["settings"]["customEmail"]
    assert custom["fromAddress"] == "hello@browbeautylab.com"
    assert custom["domain"] == "browbeautylab.com"
    assert custom["verified"] is False


def test_patch_custom_email_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"domain": "browbeautylab.com"},
    )
    assert response.status_code == 401


def test_patch_custom_email_rejects_invalid_address(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"fromAddress": "not-an-email"},
        headers=headers,
    )
    assert response.status_code == 422


def test_patch_custom_email_rejects_invalid_domain(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"domain": "no spaces allowed"},
        headers=headers,
    )
    assert response.status_code == 422


def test_patch_custom_email_clears_with_empty_string(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"fromAddress": "hello@browbeautylab.com", "domain": "browbeautylab.com"},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"fromAddress": "", "domain": ""},
        headers=headers,
    )
    assert response.status_code == 200
    custom = response.json()["settings"]["customEmail"]
    assert custom["fromAddress"] is None
    assert custom["domain"] is None


def test_patch_custom_email_does_not_set_verified_true(client) -> None:
    headers = _auth_headers(client)
    # Even if a future client tries to inject `verified`, the server ignores it.
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"domain": "browbeautylab.com", "verified": True},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["settings"]["customEmail"]["verified"] is False


def test_email_dns_returns_empty_records_when_no_domain(client) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/email-dns", headers=headers)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["domain"] is None
    assert body["records"] == []
    assert body["verified"] is False


def test_email_dns_returns_computed_records_for_domain(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/custom-email",
        json={"domain": "browbeautylab.com"},
        headers=headers,
    )
    response = client.get("/api/v1/tenants/brow-beauty-lab/email-dns", headers=headers)
    assert response.status_code == 200
    body = response.json()
    assert body["domain"] == "browbeautylab.com"
    assert body["verified"] is False
    types = [r["type"] for r in body["records"]]
    assert types == ["CNAME", "TXT", "TXT"]
    hosts = [r["host"] for r in body["records"]]
    assert "booking._domainkey.browbeautylab.com" in hosts
    assert "browbeautylab.com" in hosts
    assert "_dmarc.browbeautylab.com" in hosts


def test_email_dns_requires_auth(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/email-dns")
    assert response.status_code == 401
