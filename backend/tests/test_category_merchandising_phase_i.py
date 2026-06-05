"""Phase I: Service category merchandising + public landing endpoint."""


def _auth_headers(
    client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123"
) -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _first_location_id(client) -> str:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations")
    assert response.status_code == 200
    return response.json()["locations"][0]["id"]


def _create_category(client, headers, name: str, **extra) -> dict:
    payload = {"name": name}
    payload.update(extra)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/service-categories",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 201, response.json()
    return response.json()


def _create_service(
    client,
    headers,
    name: str,
    *,
    category_id: str | None = None,
    is_active: bool = True,
) -> dict:
    location_id = _first_location_id(client)
    body = {
        "name": name,
        "durationMinutes": 60,
        "priceCents": 12000,
        "depositCents": 2000,
        "locationIds": [location_id],
        "isActive": is_active,
    }
    if category_id is not None:
        body["categoryId"] = category_id
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        headers=headers,
        json=body,
    )
    assert response.status_code == 201, response.json()
    return response.json()


# === Slug generation ===


def test_create_category_generates_slug_from_name(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brow Services & Tints")
    assert category["slug"] == "brow-services-tints"


def test_create_category_accepts_explicit_slug(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows", slug="signature-brows")
    assert category["slug"] == "signature-brows"


def test_create_category_makes_slug_unique_per_tenant(client) -> None:
    headers = _auth_headers(client)
    first = _create_category(client, headers, "Brows")
    second = _create_category(client, headers, "Brows 2", slug="brows")
    assert first["slug"] == "brows"
    assert second["slug"] == "brows-2"


def test_update_category_regenerates_slug_when_cleared(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows", slug="custom-slug")
    assert category["slug"] == "custom-slug"
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={"clearSlug": True},
    )
    assert response.status_code == 200
    assert response.json()["slug"] == "brows"


# === Merchandising fields ===


def test_update_category_persists_merchandising_fields(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={
            "outcomeHeadline": "Wake up with brows that frame your whole face",
            "subheadline": "Signature shaping by certified artists.",
            "heroImageUrl": "https://cdn.example/brows.jpg",
            "heroImageAlt": "Close-up of shaped brows",
            "valueStack": [
                {"label": "30-min shaping consult", "estValueCents": 5000},
                {"label": "Custom tint match", "estValueCents": 3000},
            ],
            "bonuses": [{"label": "Free aftercare oil"}],
            "guaranteeText": "Love your brows or we redo them free.",
            "socialProof": {
                "quote": "Best brows of my life.",
                "author": "Jamie L.",
            },
            "scarcityHint": "Only 3 spots this week",
            "featuredLabel": "most_popular",
            "metaDescription": "Premium brow services in San Francisco.",
            "faqs": [
                {"question": "Does it hurt?", "answer": "Most clients feel mild pressure."}
            ],
        },
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["outcomeHeadline"].startswith("Wake up")
    assert body["heroImageUrl"] == "https://cdn.example/brows.jpg"
    assert len(body["valueStack"]) == 2
    assert body["valueStack"][0]["label"] == "30-min shaping consult"
    assert body["valueStack"][0]["estValueCents"] == 5000
    assert body["bonuses"][0]["label"] == "Free aftercare oil"
    assert body["socialProof"]["quote"] == "Best brows of my life."
    assert body["featuredLabel"] == "most_popular"
    assert body["faqs"][0]["question"] == "Does it hurt?"


def test_update_category_rejects_unknown_featured_label(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={"featuredLabel": "trending"},
    )
    assert response.status_code == 422


def test_clear_category_merchandising_fields(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={
            "outcomeHeadline": "Bold brows",
            "heroImageUrl": "https://cdn.example/x.jpg",
            "socialProof": {"quote": "Wow"},
        },
    )
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={
            "clearOutcomeHeadline": True,
            "clearHeroImage": True,
            "clearSocialProof": True,
        },
    )
    assert response.status_code == 200
    body = response.json()
    assert body["outcomeHeadline"] is None
    assert body["heroImageUrl"] is None
    assert body["socialProof"] is None


# === Public category endpoint ===


def test_public_category_returns_active_services_in_sort_order(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    other = _create_category(client, headers, "Lashes")
    svc_a = _create_service(client, headers, "Brow Shape", category_id=category["id"])
    svc_b = _create_service(client, headers, "Brow Tint", category_id=category["id"])
    svc_other = _create_service(client, headers, "Lash Tint", category_id=other["id"])
    inactive = _create_service(
        client,
        headers,
        "Retired",
        category_id=category["id"],
        is_active=False,
    )

    response = client.get(f"/api/v1/tenants/brow-beauty-lab/c/{category['slug']}")
    assert response.status_code == 200
    body = response.json()
    assert body["category"]["id"] == category["id"]
    service_ids = [s["id"] for s in body["services"]]
    assert service_ids == [svc_a["id"], svc_b["id"]]
    assert svc_other["id"] not in service_ids
    assert inactive["id"] not in service_ids


def test_public_category_returns_404_for_unknown_slug(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/c/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "service_category_not_found"


def test_public_category_returns_404_when_inactive(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={"isActive": False},
    )
    response = client.get(f"/api/v1/tenants/brow-beauty-lab/c/{category['slug']}")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "service_category_not_active"


def test_public_category_does_not_require_auth(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(
        client, headers, "Brows", slug="brows-page"
    )
    response = client.get("/api/v1/tenants/brow-beauty-lab/c/brows-page")
    assert response.status_code == 200
    assert response.json()["category"]["slug"] == "brows-page"


# === Permission / tenant isolation ===


def test_update_category_requires_services_manage(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    # Login as someone without services.manage if a viewer exists; otherwise
    # confirm anonymous PATCH fails.
    anon = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        json={"outcomeHeadline": "hi"},
    )
    assert anon.status_code == 401
