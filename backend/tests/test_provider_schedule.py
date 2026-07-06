def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _first_provider_id(client, headers) -> str:
    response = client.get("/api/v1/tenants/brow-beauty-lab/providers/manage", headers=headers)
    assert response.status_code == 200
    return response.json()["providers"][0]["id"]


def _first_location_id(client) -> str:
    return client.get("/api/v1/tenants/brow-beauty-lab/locations").json()["locations"][0]["id"]


def _location_ids(client) -> list[str]:
    response = client.get("/api/v1/tenants/brow-beauty-lab/locations")
    assert response.status_code == 200
    return [loc["id"] for loc in response.json()["locations"]]


def _service_ids(client) -> list[str]:
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert response.status_code == 200
    return [svc["id"] for svc in response.json()["services"]]


def test_get_provider_schedule_returns_seeded_entries(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["providerId"] == provider_id
    assert isinstance(body["entries"], list)
    if body["entries"]:
        first = body["entries"][0]
        for key in ("weekday", "locationId", "startTime", "endTime"):
            assert key in first


def test_get_provider_schedule_requires_auth(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule"
    )
    assert response.status_code == 401


def test_replace_provider_schedule_replaces_entries(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)

    # Replace with a single Monday window
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "entries": [
                {
                    "weekday": 0,
                    "locationId": location_id,
                    "startTime": "09:30",
                    "endTime": "12:00",
                },
                {
                    "weekday": 0,
                    "locationId": location_id,
                    "startTime": "13:00",
                    "endTime": "17:00",
                },
            ]
        },
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert len(body["entries"]) == 2
    weekdays = {e["weekday"] for e in body["entries"]}
    assert weekdays == {0}

    # Re-fetch to confirm persistence
    again = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
    )
    assert len(again.json()["entries"]) == 2


def test_replace_provider_schedule_can_clear_all(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={"locationId": location_id, "entries": []},
    )
    assert response.status_code == 200
    scoped_entries = [
        entry
        for entry in response.json()["entries"]
        if entry.get("locationId") == location_id
    ]
    assert scoped_entries == []


def test_replace_provider_schedule_rejects_end_before_start(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "entries": [
                {
                    "weekday": 0,
                    "locationId": location_id,
                    "startTime": "17:00",
                    "endTime": "09:00",
                }
            ]
        },
    )
    assert response.status_code == 422


def test_replace_provider_schedule_rejects_foreign_location(client) -> None:
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "entries": [
                {
                    "weekday": 2,
                    "locationId": "loc_does_not_exist",
                    "startTime": "09:00",
                    "endTime": "17:00",
                }
            ]
        },
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "invalid_location"


def test_replace_provider_schedule_is_isolated_by_location_scope(client) -> None:
    headers = _auth_headers(client)
    location_ids = _location_ids(client)
    service_ids = _service_ids(client)
    assert len(location_ids) >= 2
    loc_a, loc_b = location_ids[0], location_ids[1]

    created_provider = client.post(
        "/api/v1/tenants/brow-beauty-lab/providers",
        headers=headers,
        json={
            "name": "Schedule Scope Test Provider",
            "email": "schedule.scope.test@browbeautylab.test",
            "locationIds": [loc_a, loc_b],
            "serviceIds": [service_ids[0]] if service_ids else [],
            "isBookableOnline": True,
        },
    )
    assert created_provider.status_code == 201, created_provider.json()
    provider_id = created_provider.json()["id"]

    save_a = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": loc_a,
            "entries": [
                {
                    "weekday": 1,
                    "locationId": loc_a,
                    "startTime": "09:00",
                    "endTime": "17:00",
                }
            ],
        },
    )
    assert save_a.status_code == 200, save_a.json()

    save_b = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": loc_b,
            "entries": [
                {
                    "weekday": 2,
                    "locationId": loc_b,
                    "startTime": "10:00",
                    "endTime": "18:00",
                }
            ],
        },
    )
    assert save_b.status_code == 200, save_b.json()

    read_a = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/work-hours",
        headers=headers,
        params={"location_id": loc_a},
    )
    assert read_a.status_code == 200, read_a.json()
    weekdays_a = {entry["weekday"] for entry in read_a.json()["regularHours"]}
    assert weekdays_a == {1}

    read_b = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/work-hours",
        headers=headers,
        params={"location_id": loc_b},
    )
    assert read_b.status_code == 200, read_b.json()
    weekdays_b = {entry["weekday"] for entry in read_b.json()["regularHours"]}
    assert weekdays_b == {2}

def test_work_hours_returns_conflict_warnings_when_outside_business_hours(client) -> None:
    """When business hours are enabled and restricted, schedules outside them produce warnings."""
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)

    # Enable business hours with restriction
    bh_response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        headers=headers,
        json={
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": True,
            "businessHours": {
                "mon": {"open": "10:00", "close": "16:00", "closed": False},
                "tue": {"open": "10:00", "close": "16:00", "closed": False},
                "wed": {"open": "10:00", "close": "16:00", "closed": False},
                "thu": {"open": "10:00", "close": "16:00", "closed": False},
                "fri": {"open": "10:00", "close": "16:00", "closed": False},
                "sat": {"open": "10:00", "close": "16:00", "closed": True},
                "sun": {"open": "10:00", "close": "16:00", "closed": True},
            },
        },
    )
    assert bh_response.status_code == 200, f"Business hours PATCH failed: {bh_response.json()}"

    # Set provider schedule outside business hours (09:00-17:00 vs 10:00-16:00)
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {
                    "weekday": 0,
                    "locationId": location_id,
                    "startTime": "09:00",
                    "endTime": "17:00",
                }
            ],
        },
    )

    # Read work hours - should have warnings
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/work-hours",
        headers=headers,
        params={"location_id": location_id},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert "warnings" in body
    assert len(body["warnings"]) > 0
    assert body["warnings"][0]["type"] == "outside_business_hours"
    assert body["warnings"][0]["weekday"] == 0


def test_work_hours_warns_when_day_closed(client) -> None:
    """When business hours mark a day as closed, active schedules produce day_closed warnings."""
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)

    # Enable business hours with Saturday closed
    bh_response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        headers=headers,
        json={
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": True,
            "businessHours": {
                "mon": {"open": "09:00", "close": "17:00", "closed": False},
                "tue": {"open": "09:00", "close": "17:00", "closed": False},
                "wed": {"open": "09:00", "close": "17:00", "closed": False},
                "thu": {"open": "09:00", "close": "17:00", "closed": False},
                "fri": {"open": "09:00", "close": "17:00", "closed": False},
                "sat": {"open": "09:00", "close": "17:00", "closed": True},
                "sun": {"open": "09:00", "close": "17:00", "closed": True},
            },
        },
    )
    assert bh_response.status_code == 200, f"Business hours PATCH failed: {bh_response.json()}"

    # Set provider schedule on Saturday (weekday 5)
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {
                    "weekday": 5,
                    "locationId": location_id,
                    "startTime": "09:00",
                    "endTime": "17:00",
                }
            ],
        },
    )

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/work-hours",
        headers=headers,
        params={"location_id": location_id},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert "warnings" in body
    day_closed_warnings = [w for w in body["warnings"] if w["type"] == "day_closed"]
    assert len(day_closed_warnings) > 0
    assert day_closed_warnings[0]["weekday"] == 5


def test_work_hours_no_warnings_when_business_hours_disabled(client) -> None:
    """When business hours are disabled, no conflict warnings are generated."""
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)

    # Disable business hours
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        headers=headers,
        json={"businessHoursEnabled": False},
    )

    # Set any schedule
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {
                    "weekday": 0,
                    "locationId": location_id,
                    "startTime": "05:00",
                    "endTime": "23:00",
                }
            ],
        },
    )

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/work-hours",
        headers=headers,
        params={"location_id": location_id},
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["warnings"] == []

