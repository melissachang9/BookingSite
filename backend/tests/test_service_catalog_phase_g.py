def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _first_location_id(client) -> str:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations")
    assert response.status_code == 200
    return response.json()["locations"][0]["id"]


def _create_service(client, headers, name: str) -> dict:
    location_id = _first_location_id(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        headers=headers,
        json={
            "name": name,
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2000,
            "locationIds": [location_id],
        },
    )
    assert response.status_code == 201, response.json()
    return response.json()


def _create_category(client, headers, name: str) -> dict:
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/service-categories",
        headers=headers,
        json={"name": name},
    )
    assert response.status_code == 201, response.json()
    return response.json()


# === Service categories ===


def test_list_service_categories_starts_empty(client) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/service-categories", headers=headers)
    assert response.status_code == 200
    assert response.json() == {"categories": []}


def test_create_service_category_assigns_sort_order(client) -> None:
    headers = _auth_headers(client)
    first = _create_category(client, headers, "Brows")
    second = _create_category(client, headers, "Lashes")
    assert first["sortOrder"] == 0
    assert second["sortOrder"] == 1


def test_create_service_category_rejects_duplicate_name(client) -> None:
    headers = _auth_headers(client)
    _create_category(client, headers, "Brows")
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/service-categories",
        headers=headers,
        json={"name": "brows"},
    )
    assert response.status_code == 409


def test_update_service_category_renames(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
        json={"name": "Brow services"},
    )
    assert response.status_code == 200
    assert response.json()["name"] == "Brow services"


def test_delete_service_category_detaches_services(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    service = _create_service(client, headers, "Brow Shaping G1")
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"categoryId": category["id"]},
    )
    response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/service-categories/{category['id']}",
        headers=headers,
    )
    assert response.status_code == 204
    fetched = client.get(
        "/api/v1/tenants/brow-beauty-lab/services",
    )
    assert fetched.status_code == 200
    target = next(s for s in fetched.json()["services"] if s["id"] == service["id"])
    assert target["categoryId"] is None


def test_reorder_service_categories(client) -> None:
    headers = _auth_headers(client)
    a = _create_category(client, headers, "A")
    b = _create_category(client, headers, "B")
    c = _create_category(client, headers, "C")
    response = client.put(
        "/api/v1/tenants/brow-beauty-lab/service-categories/reorder",
        headers=headers,
        json={"orderedIds": [c["id"], a["id"], b["id"]]},
    )
    assert response.status_code == 200
    order = [item["id"] for item in response.json()["categories"]]
    assert order == [c["id"], a["id"], b["id"]]


def test_reorder_service_categories_rejects_unknown_id(client) -> None:
    headers = _auth_headers(client)
    a = _create_category(client, headers, "A")
    response = client.put(
        "/api/v1/tenants/brow-beauty-lab/service-categories/reorder",
        headers=headers,
        json={"orderedIds": [a["id"], "nope"]},
    )
    assert response.status_code == 404


# === Service update + reorder + duplicate ===


def test_update_service_changes_name_and_category(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    service = _create_service(client, headers, "Brow Shaping G2")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"name": "Brow Sculpt", "categoryId": category["id"], "description": "Premium shaping"},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["name"] == "Brow Sculpt"
    assert body["categoryId"] == category["id"]
    assert body["description"] == "Premium shaping"


def test_update_service_clear_category(client) -> None:
    headers = _auth_headers(client)
    category = _create_category(client, headers, "Brows")
    service = _create_service(client, headers, "Brow Shaping G3")
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"categoryId": category["id"]},
    )
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"clearCategory": True},
    )
    assert response.status_code == 200
    assert response.json()["categoryId"] is None


def test_update_service_rejects_deposit_greater_than_price(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Brow Shaping G4")
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}",
        headers=headers,
        json={"depositCents": 50_000},  # > price 12000, within schema bounds
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_deposit"


def test_reorder_services_updates_sort_order(client) -> None:
    headers = _auth_headers(client)
    a = _create_service(client, headers, "Service Alpha")
    b = _create_service(client, headers, "Service Beta")
    response = client.put(
        "/api/v1/tenants/brow-beauty-lab/services/reorder",
        headers=headers,
        json={"orderedIds": [b["id"], a["id"]]},
    )
    assert response.status_code == 200
    order = [item["id"] for item in response.json()["services"]]
    # Reordered services bubble to the front; older seeded ones follow.
    assert order.index(b["id"]) < order.index(a["id"])


def test_duplicate_service_creates_copy_with_suffix(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Original Service G")
    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/duplicate",
        headers=headers,
    )
    assert response.status_code == 201, response.json()
    dup = response.json()
    assert dup["id"] != service["id"]
    assert dup["name"] == "Original Service G (Copy)"
    assert dup["priceCents"] == service["priceCents"]
    assert dup["locationIds"] == service["locationIds"]


def test_duplicate_service_handles_repeated_copies(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Repeat Service G")
    first = client.post(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/duplicate",
        headers=headers,
    ).json()
    second = client.post(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/duplicate",
        headers=headers,
    ).json()
    assert first["name"] == "Repeat Service G (Copy)"
    assert second["name"] == "Repeat Service G (Copy) 2"


# === Per-provider variants ===


def _first_provider_id(client, headers) -> str:
    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/providers/manage",
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()["providers"][0]["id"]


def test_get_provider_variants_returns_empty_initially(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G1")
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["variants"] == []


def test_replace_provider_variants_sets_overrides(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G2")
    provider_id = _first_provider_id(client, headers)

    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {
                    "providerId": provider_id,
                    "priceCents": 25000,
                    "durationMinutes": 90,
                    "depositCents": 5000,
                }
            ]
        },
    )
    assert response.status_code == 200, response.json()
    variants = response.json()["variants"]
    assert len(variants) == 1
    entry = variants[0]
    assert entry["providerId"] == provider_id
    assert entry["priceCents"] == 25000
    assert entry["durationMinutes"] == 90
    assert entry["depositCents"] == 5000


def test_replace_provider_variants_rejects_deposit_exceeding_effective_price(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G3")
    provider_id = _first_provider_id(client, headers)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {
                    "providerId": provider_id,
                    "priceCents": 10000,
                    "depositCents": 99_999,
                }
            ]
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_deposit"


def test_replace_provider_variants_clears_omitted_overrides(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G4")
    provider_id = _first_provider_id(client, headers)
    # Set then clear.
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {"providerId": provider_id, "priceCents": 25000}
            ]
        },
    )
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={"variants": []},
    )
    assert response.status_code == 200
    # Either zero variants returned (link removed) or single variant with all None overrides.
    variants = response.json()["variants"]
    for v in variants:
        assert v["priceCents"] is None
        assert v["durationMinutes"] is None
        assert v["depositCents"] is None


def test_replace_provider_variants_sets_percent_commission(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G5 Commission Percent")
    provider_id = _first_provider_id(client, headers)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {
                    "providerId": provider_id,
                    "commissionBasisPoints": 6000,
                }
            ]
        },
    )
    assert response.status_code == 200, response.json()
    entry = response.json()["variants"][0]
    assert entry["commissionBasisPoints"] == 6000
    assert entry["commissionFlatCents"] is None


def test_replace_provider_variants_sets_flat_commission(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G6 Commission Flat")
    provider_id = _first_provider_id(client, headers)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {
                    "providerId": provider_id,
                    "commissionFlatCents": 2500,
                }
            ]
        },
    )
    assert response.status_code == 200, response.json()
    entry = response.json()["variants"][0]
    assert entry["commissionFlatCents"] == 2500
    assert entry["commissionBasisPoints"] is None


def test_replace_provider_variants_rejects_both_commission_types(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G7 Commission Conflict")
    provider_id = _first_provider_id(client, headers)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {
                    "providerId": provider_id,
                    "commissionFlatCents": 1000,
                    "commissionBasisPoints": 5000,
                }
            ]
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_commission"


def test_replace_provider_variants_clears_commission_when_omitted(client) -> None:
    headers = _auth_headers(client)
    service = _create_service(client, headers, "Variants Service G8 Commission Clear")
    provider_id = _first_provider_id(client, headers)
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={
            "variants": [
                {"providerId": provider_id, "commissionBasisPoints": 4500}
            ]
        },
    )
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/provider-variants",
        headers=headers,
        json={"variants": []},
    )
    assert response.status_code == 200
    for v in response.json()["variants"]:
        assert v["commissionFlatCents"] is None
        assert v["commissionBasisPoints"] is None


def test_permission_gates_block_service_manage_for_unprivileged(client) -> None:
    owner_headers = _auth_headers(client)
    # Create a staff user and a category to attempt to mutate.
    staff_email = "phaseg.staff@browbeautylab.test"
    client.post(
        "/api/v1/tenants/brow-beauty-lab/users",
        headers=owner_headers,
        json={
            "email": staff_email,
            "name": "Phase G Staff",
            "role": "staff",
            "initialPassword": "TempPass123",
        },
    )
    staff_headers = _auth_headers(client, email=staff_email, password="TempPass123")
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/service-categories",
        headers=staff_headers,
        json={"name": "Should fail"},
    )
    assert response.status_code == 403


def test_service_list_orders_by_sort_order(client) -> None:
    headers = _auth_headers(client)
    a = _create_service(client, headers, "SortA Service")
    b = _create_service(client, headers, "SortB Service")
    client.put(
        "/api/v1/tenants/brow-beauty-lab/services/reorder",
        headers=headers,
        json={"orderedIds": [b["id"], a["id"]]},
    )
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    services = response.json()["services"]
    ids = [s["id"] for s in services]
    assert ids.index(b["id"]) < ids.index(a["id"])
