"""Phase J: Service merchandising fields + public detail endpoint."""


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


def _create_service(
    client,
    headers,
    name: str,
    *,
    slug: str | None = None,
    is_active: bool = True,
    price_cents: int = 12000,
    deposit_cents: int = 2000,
) -> dict:
    location_id = _first_location_id(client)
    body = {
        "name": name,
        "durationMinutes": 60,
        "priceCents": price_cents,
        "depositCents": deposit_cents,
        "locationIds": [location_id],
        "isActive": is_active,
    }
    if slug is not None:
        body["slug"] = slug
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        headers=headers,
        json=body,
    )
    assert response.status_code == 201, response.json()
    return response.json()


# === Slug generation ===


def test_create_service_generates_slug_from_name(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Signature Brow Lamination & Tint")
    assert service["slug"] == "signature-brow-lamination-tint"


def test_create_service_accepts_explicit_slug(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Shape", slug="brow-shape-pro")
    assert service["slug"] == "brow-shape-pro"


def test_create_service_makes_slug_unique_per_tenant(client) -> None:
    headers = _auth_headers(client)
    first = _create_service(client, headers, "Brow Lift A")
    second = _create_service(client, headers, "Brow Lift Alt", slug=first["slug"])
    assert first["slug"] == second["slug"].rsplit("-", 1)[0] or first["slug"] == "brow-lift-a"
    assert first["slug"] != second["slug"]
    assert second["slug"].endswith("-2") or second["slug"].endswith("-3")


def test_update_service_with_clear_slug_regenerates_from_name(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Tint Touchup")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"clearSlug": True},
    )
    assert response.status_code == 200, response.json()
    assert response.json()["slug"] == "tint-touchup"


# === Merchandising fields ===


def test_update_service_merch_fields_persist(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Premium")
    payload = {
        "outcomeHeadline": "Wake up with brows that frame your face",
        "subheadline": "Custom shaping, mapping, and tint that lasts six weeks.",
        "compareAtPriceCents": 18000,
        "featuredLabel": "signature",
        "valueStack": [
            {"label": "30-minute consult", "estValueCents": 5000},
            {"label": "Custom mapping", "estValueCents": 4000},
        ],
        "bonuses": [{"label": "Free aftercare kit", "estValueCents": 2500}],
        "guaranteeText": "If you're not in love, we'll redo it free in 7 days.",
        "socialProof": {
            "quote": "Best brows of my life.",
            "author": "Jamie R.",
            "imageUrl": "https://example.com/jamie.jpg",
        },
        "scarcityHint": "Only 3 slots this week",
        "imageUrl": "https://example.com/brow-hero.jpg",
        "imageAltText": "Close-up brow photo",
        "beforeImageUrl": "https://example.com/before.jpg",
        "beforeImageAlt": "Before",
        "afterImageUrl": "https://example.com/after.jpg",
        "afterImageAlt": "After",
        "metaDescription": "Hormozi-grade brow service",
    }
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json=payload,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["outcomeHeadline"] == payload["outcomeHeadline"]
    assert body["subheadline"] == payload["subheadline"]
    assert body["compareAtPriceCents"] == 18000
    assert body["featuredLabel"] == "signature"
    assert body["valueStack"] == [
        {"label": "30-minute consult", "estValueCents": 5000},
        {"label": "Custom mapping", "estValueCents": 4000},
    ]
    assert body["bonuses"] == [{"label": "Free aftercare kit", "estValueCents": 2500}]
    assert body["guaranteeText"] == payload["guaranteeText"]
    assert body["socialProof"] == payload["socialProof"]
    assert body["scarcityHint"] == payload["scarcityHint"]
    assert body["imageUrl"] == payload["imageUrl"]
    assert body["imageAltText"] == payload["imageAltText"]
    assert body["beforeImageUrl"] == payload["beforeImageUrl"]
    assert body["afterImageUrl"] == payload["afterImageUrl"]
    assert body["metaDescription"] == payload["metaDescription"]


def test_update_service_rejects_invalid_featured_label(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Mini")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"featuredLabel": "platinum"},
    )
    assert response.status_code == 422


def test_update_service_rejects_compare_at_below_price(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Anchor", price_cents=15000)
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"compareAtPriceCents": 10000},
    )
    assert response.status_code == 422


def test_clear_flags_null_optional_fields(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Clearable")
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={
            "outcomeHeadline": "Initial",
            "scarcityHint": "Initial",
            "compareAtPriceCents": 20000,
            "featuredLabel": "new",
            "imageUrl": "https://example.com/img.jpg",
            "imageAltText": "alt",
            "socialProof": {"quote": "Wow"},
        },
    )
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={
            "clearOutcomeHeadline": True,
            "clearScarcityHint": True,
            "clearCompareAtPrice": True,
            "clearFeaturedLabel": True,
            "clearImage": True,
            "clearSocialProof": True,
        },
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["outcomeHeadline"] is None
    assert body["scarcityHint"] is None
    assert body["compareAtPriceCents"] is None
    assert body["featuredLabel"] is None
    assert body["imageUrl"] is None
    assert body["imageAltText"] is None
    assert body["socialProof"] is None


# === Public service endpoint ===


def test_public_service_returns_service_and_category(client) -> None:
    headers = _auth_headers(client)
    cat_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/service-categories",
        headers=headers,
        json={"name": "Brow Plus"},
    )
    assert cat_response.status_code == 201
    category = cat_response.json()
    location_id = _first_location_id(client)
    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        headers=headers,
        json={
            "name": "Public Brow Detail",
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2000,
            "locationIds": [location_id],
            "categoryId": category["id"],
        },
    )
    assert create_response.status_code == 201
    service = create_response.json()
    public = client.get(
        f"/api/v1/tenants/brow-beauty-lab/s/{service['slug']}"
    )
    assert public.status_code == 200
    body = public.json()
    assert body["service"]["id"] == service["id"]
    assert body["category"] is not None
    assert body["category"]["id"] == category["id"]


def test_public_service_returns_404_for_unknown_slug(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/s/does-not-exist")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "service_not_found"


def test_public_service_returns_404_when_inactive(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Hidden Brow", is_active=False)
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/s/{service['slug']}"
    )
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "service_not_active"


def test_public_service_requires_no_auth(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Open Brow")
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/s/{service['slug']}"
    )
    assert response.status_code == 200


def test_update_service_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/services/some-id",
        json={"outcomeHeadline": "x"},
    )
    assert response.status_code == 401
