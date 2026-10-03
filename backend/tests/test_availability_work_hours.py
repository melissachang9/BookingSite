
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


def _first_service_id(client) -> str:
    return client.get("/api/v1/tenants/brow-beauty-lab/services").json()["services"][0]["id"]


def test_availability_respects_active_schedule_only(client) -> None:
    """Only active schedule entries should generate slots."""
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)
    service_id = _first_service_id(client)

    # Set Monday schedule active
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True},
            ],
        },
    )

    # Get availability for a Monday
    import datetime
    today = datetime.date.today()
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7  # next Monday
    monday = (today + datetime.timedelta(days=days_until_monday)).isoformat()

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        headers=headers,
        params={
            "serviceId": service_id,
            "providerId": provider_id,
            "locationId": location_id,
            "date": monday,
            "windowDays": 1,
        },
    )
    assert response.status_code == 200, response.json()
    active_slots = response.json()["days"][0]["slotCount"]

    # Now deactivate Monday
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": False},
            ],
        },
    )

    response2 = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        headers=headers,
        params={
            "serviceId": service_id,
            "providerId": provider_id,
            "locationId": location_id,
            "date": monday,
            "windowDays": 1,
        },
    )
    assert response2.status_code == 200, response2.json()
    inactive_slots = response2.json()["days"][0]["slotCount"]

    assert active_slots > 0, f"Expected slots when active, got {active_slots}"
    assert inactive_slots == 0, f"Expected 0 slots when inactive, got {inactive_slots}"


def test_availability_respects_schedule_blocked_services(client) -> None:
    """Schedule entries with blocked_service_ids should exclude those services."""
    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    location_id = _first_location_id(client)
    service_id = _first_service_id(client)

    # Set Monday schedule with this service blocked
    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {
                    "weekday": 0, "locationId": location_id,
                    "startTime": "09:00", "endTime": "17:00", "isActive": True,
                    "blockedServiceIds": [service_id],
                },
            ],
        },
    )

    import datetime
    today = datetime.date.today()
    days_until_monday = (7 - today.weekday()) % 7
    if days_until_monday == 0:
        days_until_monday = 7
    monday = (today + datetime.timedelta(days=days_until_monday)).isoformat()

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        headers=headers,
        params={
            "serviceId": service_id,
            "providerId": provider_id,
            "locationId": location_id,
            "date": monday,
            "windowDays": 1,
        },
    )
    assert response.status_code == 200, response.json()
    slots = response.json()["days"][0]["slotCount"]
    assert slots == 0, f"Expected 0 slots when service is blocked, got {slots}"


def test_availability_uses_location_timezone(client) -> None:
    """Slots generate in the location's timezone, not the business default."""
    import datetime
    from zoneinfo import ZoneInfo

    headers = _auth_headers(client)
    provider_id = _first_provider_id(client, headers)
    service_id = _first_service_id(client)
    location_id = _first_location_id(client)

    # The seeded business is America/Los_Angeles. Move this location to New York
    # so the location-specific timezone differs from the business default.
    patch = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/locations/{location_id}",
        headers=headers,
        json={"timeZone": "America/New_York"},
    )
    assert patch.status_code == 200, patch.json()

    client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={
            "locationId": location_id,
            "entries": [
                {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True},
            ],
        },
    )

    today = datetime.date.today()
    days_until_monday = (7 - today.weekday()) % 7 or 7
    monday = today + datetime.timedelta(days=days_until_monday)

    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        headers=headers,
        params={
            "serviceId": service_id,
            "providerId": provider_id,
            "locationId": location_id,
            "date": monday.isoformat(),
            "windowDays": 1,
        },
    )
    assert response.status_code == 200, response.json()
    slots = response.json()["slots"]
    assert slots, "expected at least one slot"

    first_start = datetime.datetime.fromisoformat(slots[0]["startAt"].replace("Z", "+00:00"))
    ny_expected = datetime.datetime.combine(
        monday, datetime.time(9, 0), ZoneInfo("America/New_York")
    ).astimezone(datetime.timezone.utc)
    la_expected = datetime.datetime.combine(
        monday, datetime.time(9, 0), ZoneInfo("America/Los_Angeles")
    ).astimezone(datetime.timezone.utc)

    # 09:00 is interpreted in the location's zone (New York), not the business zone (LA).
    assert first_start == ny_expected
    assert first_start != la_expected
