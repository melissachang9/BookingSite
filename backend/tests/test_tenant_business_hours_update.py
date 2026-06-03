def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_default_business_hours_settings_present(client) -> None:
    settings = client.get("/api/v1/tenants/brow-beauty-lab").json()["settings"]
    assert settings["businessHoursEnabled"] is False
    assert settings["restrictProvidersToBusinessHours"] is False
    week = settings["businessHours"]
    assert set(week.keys()) == {"mon", "tue", "wed", "thu", "fri", "sat", "sun"}
    assert week["mon"] == {"open": "09:00", "close": "17:00", "closed": False}
    assert week["sat"]["closed"] is True
    assert week["sun"]["closed"] is True


def test_update_business_hours_full_week(client) -> None:
    headers = _auth_headers(client)
    week = {
        "mon": {"open": "10:00", "close": "18:00", "closed": False},
        "tue": {"open": "10:00", "close": "18:00", "closed": False},
        "wed": {"open": "10:00", "close": "18:00", "closed": False},
        "thu": {"open": "10:00", "close": "18:00", "closed": False},
        "fri": {"open": "10:00", "close": "20:00", "closed": False},
        "sat": {"open": "11:00", "close": "16:00", "closed": False},
        "sun": {"open": "09:00", "close": "17:00", "closed": True},
    }
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": True,
            "businessHours": week,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    settings = response.json()["settings"]
    assert settings["businessHoursEnabled"] is True
    assert settings["restrictProvidersToBusinessHours"] is True
    assert settings["businessHours"]["fri"]["close"] == "20:00"
    assert settings["businessHours"]["sun"]["closed"] is True


def test_update_business_hours_partial_payload_keeps_existing_week(client) -> None:
    headers = _auth_headers(client)
    # Toggle on without sending businessHours payload preserves defaults.
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={"businessHoursEnabled": True},
        headers=headers,
    )
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["businessHoursEnabled"] is True
    assert settings["businessHours"]["mon"]["open"] == "09:00"


def test_update_business_hours_rejects_bad_format(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={"businessHours": {"mon": {"open": "9 am", "close": "17:00", "closed": False}}},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_business_hours_rejects_open_after_close(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={"businessHours": {"mon": {"open": "18:00", "close": "09:00", "closed": False}}},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_business_hours_allows_closed_with_any_times(client) -> None:
    headers = _auth_headers(client)
    # closed=true should bypass open<close ordering rule
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={"businessHours": {"mon": {"open": "18:00", "close": "09:00", "closed": True}}},
        headers=headers,
    )
    assert response.status_code == 200


def test_update_business_hours_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/hours",
        json={"businessHoursEnabled": True},
    )
    assert response.status_code == 401
