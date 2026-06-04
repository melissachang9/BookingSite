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
    response = client.put(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/schedule",
        headers=headers,
        json={"entries": []},
    )
    assert response.status_code == 200
    assert response.json()["entries"] == []


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
