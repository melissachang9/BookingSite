def test_create_tenant_returns_new_owner_and_location(client) -> None:
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Luna Skin Studio",
            "slug": "luna-skin-studio",
            "timezone": "America/New_York",
            "locationName": "Luna Flagship",
            "ownerName": "Nora Quinn",
            "ownerEmail": "owner@lunaskinstudio.test",
            "ownerPassword": "StudioSetup123",
            "homepageUrl": "https://lunaskinstudio.example.com",
        },
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["tenant"]["slug"] == "luna-skin-studio"
    assert payload["tenant"]["name"] == "Luna Skin Studio"
    assert payload["tenant"]["defaultLocationId"] == payload["locationId"]
    assert "defaultDepositCents" not in payload["tenant"]["settings"]
    assert payload["ownerEmail"] == "owner@lunaskinstudio.test"

    tenant_response = client.get("/api/v1/tenants/luna-skin-studio")
    assert tenant_response.status_code == 200
    assert tenant_response.json()["name"] == "Luna Skin Studio"


def test_create_tenant_rejects_invalid_slug(client) -> None:
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Broken Slug Studio",
            "slug": "Broken Slug Studio",
            "timezone": "America/Los_Angeles",
            "locationName": "Main Room",
            "ownerName": "Jamie Lee",
            "ownerEmail": "owner@brokenslug.test",
            "ownerPassword": "StudioSetup123",
        },
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_create_tenant_rejects_duplicate_owner_email(client) -> None:
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Another Brow Lab",
            "slug": "another-brow-lab",
            "timezone": "America/Los_Angeles",
            "locationName": "Main Room",
            "ownerName": "Taylor Drew",
            "ownerEmail": "owner@browbeautylab.test",
            "ownerPassword": "StudioSetup123",
        },
    )

    assert response.status_code == 409
    assert response.json()["error"]["code"] == "conflict"

def _create_payload(slug: str, **extra) -> dict:
    return {
        "name": slug.replace("-", " ").title(),
        "slug": slug,
        "timezone": "America/New_York",
        "locationName": "Main",
        "ownerName": "Owner Person",
        "ownerEmail": f"owner@{slug}.test",
        "ownerPassword": "StudioSetup123",
        **extra,
    }


def test_create_tenant_saves_chosen_cancellation_policy(client) -> None:
    response = client.post(
        "/api/v1/tenants",
        json=_create_payload("credit-policy-studio", cancellationWindowHours=48, cancellationRefundMethod="wallet_credit"),
    )
    assert response.status_code == 201
    settings = response.json()["tenant"]["settings"]
    assert settings["cancellationWindowHours"] == 48
    assert settings["cancellationRefundMethod"] == "wallet_credit"


def test_create_tenant_policy_defaults_to_refunding_the_original_payment(client) -> None:
    response = client.post("/api/v1/tenants", json=_create_payload("default-policy-studio"))
    assert response.status_code == 201
    settings = response.json()["tenant"]["settings"]
    assert (settings["cancellationWindowHours"], settings["cancellationRefundMethod"]) == (24, "original_payment")


def test_create_tenant_rejects_unknown_refund_method(client) -> None:
    response = client.post("/api/v1/tenants", json=_create_payload("odd-method-studio", cancellationRefundMethod="cash"))
    assert response.status_code == 422


def test_create_tenant_rejects_out_of_range_cancellation_window(client) -> None:
    response = client.post("/api/v1/tenants", json=_create_payload("bad-window-studio", cancellationWindowHours=500))
    assert response.status_code == 422
