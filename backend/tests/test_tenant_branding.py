def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_tenant_branding_includes_new_fields(client) -> None:
    body = client.get("/api/v1/tenants/brow-beauty-lab").json()
    branding = body["branding"]
    assert "logoUrl" in branding
    assert "faviconUrl" in branding
    assert "photos" in branding
    assert isinstance(branding["photos"], list)


def test_update_tenant_branding_merges_fields(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={
            "logoUrl": "https://cdn.example.com/logo.png",
            "faviconUrl": "https://cdn.example.com/favicon.ico",
            "primaryColor": "#112233",
            "accentColor": "#abc",
            "photos": [
                "https://cdn.example.com/p1.jpg",
                "https://cdn.example.com/p2.jpg",
            ],
        },
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    branding = response.json()["branding"]
    assert branding["logoUrl"] == "https://cdn.example.com/logo.png"
    assert branding["faviconUrl"] == "https://cdn.example.com/favicon.ico"
    assert branding["primaryColor"] == "#112233"
    assert branding["accentColor"] == "#abc"
    assert branding["photos"] == [
        "https://cdn.example.com/p1.jpg",
        "https://cdn.example.com/p2.jpg",
    ]

    # Existing fields preserved (homepageUrl, serviceCatalogMode).
    assert "serviceCatalogMode" in branding


def test_update_branding_partial_does_not_clear_other_fields(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"logoUrl": "https://cdn.example.com/seed.png", "primaryColor": "#aabbcc"},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"accentColor": "#102030"},
        headers=headers,
    )
    assert response.status_code == 200
    branding = response.json()["branding"]
    assert branding["logoUrl"] == "https://cdn.example.com/seed.png"
    assert branding["primaryColor"] == "#aabbcc"
    assert branding["accentColor"] == "#102030"


def test_update_branding_clears_optional_field_with_empty_string(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"logoUrl": "https://cdn.example.com/x.png"},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"logoUrl": ""},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["branding"]["logoUrl"] is None


def test_update_branding_rejects_invalid_color(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"primaryColor": "not-a-color"},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_branding_replaces_photos_array(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"photos": ["https://cdn.example.com/a.jpg", "https://cdn.example.com/b.jpg"]},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"photos": ["https://cdn.example.com/c.jpg"]},
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["branding"]["photos"] == ["https://cdn.example.com/c.jpg"]


def test_update_branding_rejects_empty_photo_url(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"photos": ["https://cdn.example.com/a.jpg", "   "]},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_branding_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/branding",
        json={"primaryColor": "#112233"},
    )
    assert response.status_code == 401
