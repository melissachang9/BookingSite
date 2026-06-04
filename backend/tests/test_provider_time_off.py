from datetime import datetime, timedelta, timezone


def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _first_provider_id(client, headers) -> str:
    response = client.get("/api/v1/tenants/brow-beauty-lab/providers/manage", headers=headers)
    assert response.status_code == 200
    return response.json()["providers"][0]["id"]


def _future_window() -> tuple[str, str]:
    start = datetime.now(timezone.utc) + timedelta(days=14, hours=0)
    end = start + timedelta(hours=8)
    return start.isoformat().replace("+00:00", "Z"), end.isoformat().replace("+00:00", "Z")


def test_list_time_off_starts_empty(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
    )
    assert response.status_code == 200
    assert response.json()["items"] == []


def test_list_time_off_requires_auth(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off"
    )
    assert response.status_code == 401


def test_create_time_off_persists_entry(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    starts_at, ends_at = _future_window()

    created = client.post(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
        json={"startsAt": starts_at, "endsAt": ends_at, "reason": "Vacation"},
    )
    assert created.status_code == 201, created.json()
    body = created.json()
    assert body["providerId"] == provider_id
    assert body["reason"] == "Vacation"
    assert "id" in body

    listing = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
    ).json()
    ids = [item["id"] for item in listing["items"]]
    assert body["id"] in ids


def test_create_time_off_rejects_end_before_start(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    starts_at, ends_at = _future_window()
    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
        json={"startsAt": ends_at, "endsAt": starts_at},
    )
    assert response.status_code == 422


def test_delete_time_off_removes_entry(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    starts_at, ends_at = _future_window()

    created = client.post(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
        json={"startsAt": starts_at, "endsAt": ends_at},
    ).json()
    entry_id = created["id"]

    delete_response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off/{entry_id}",
        headers=headers,
    )
    assert delete_response.status_code == 204

    listing = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
    ).json()
    assert all(item["id"] != entry_id for item in listing["items"])


def test_delete_unknown_time_off_returns_404(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.delete(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off/does-not-exist",
        headers=headers,
    )
    assert response.status_code == 404


def test_availability_excludes_slots_inside_time_off(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)

    # Pick a service the provider can perform and a date 21 days out
    services = client.get("/api/v1/tenants/brow-beauty-lab/services").json()["services"]
    service_id = None
    for service in services:
        providers = client.get(
            f"/api/v1/tenants/brow-beauty-lab/services/{service['id']}/providers"
        ).json()["providers"]
        if any(p["id"] == provider_id for p in providers):
            service_id = service["id"]
            break
    assert service_id is not None, "No service found for first provider"

    target_date = (datetime.now(timezone.utc) + timedelta(days=21)).date()
    # Find a weekday this provider has availability on; iterate up to 7 days
    chosen_date = None
    for offset in range(7):
        candidate = target_date + timedelta(days=offset)
        avail = client.get(
            "/api/v1/tenants/brow-beauty-lab/availability",
            params={
                "serviceId": service_id,
                "providerId": provider_id,
                "date": candidate.isoformat(),
                "windowDays": 1,
            },
        ).json()
        if avail.get("slots"):
            chosen_date = candidate
            break
    assert chosen_date is not None, "Provider has no availability in test window"

    # Block the entire chosen day with time off
    day_start = datetime.combine(chosen_date, datetime.min.time(), tzinfo=timezone.utc)
    day_end = day_start + timedelta(days=1)
    created = client.post(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/time-off",
        headers=headers,
        json={
            "startsAt": day_start.isoformat().replace("+00:00", "Z"),
            "endsAt": day_end.isoformat().replace("+00:00", "Z"),
            "reason": "Day off",
        },
    )
    assert created.status_code == 201, created.json()

    avail_after = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={
            "serviceId": service_id,
            "providerId": provider_id,
            "date": chosen_date.isoformat(),
            "windowDays": 1,
        },
    ).json()
    assert avail_after.get("slots") == []
