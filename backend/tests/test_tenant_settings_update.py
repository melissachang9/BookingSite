def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def test_default_tenant_settings_include_calendar_display_hours(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab")
    assert response.status_code == 200
    settings = response.json()["settings"]
    assert settings["calendarDisplayStartHour"] == 9
    assert settings["calendarDisplayEndHour"] == 19


def test_owner_can_update_calendar_display_hours(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"calendarDisplayStartHour": 7, "calendarDisplayEndHour": 20},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    settings = response.json()["settings"]
    assert settings["calendarDisplayStartHour"] == 7
    assert settings["calendarDisplayEndHour"] == 20

    # Persisted across reads
    follow_up = client.get("/api/v1/tenants/brow-beauty-lab").json()["settings"]
    assert follow_up["calendarDisplayStartHour"] == 7
    assert follow_up["calendarDisplayEndHour"] == 20


def test_update_calendar_display_hours_rejects_invalid_range(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"calendarDisplayStartHour": 15, "calendarDisplayEndHour": 10},
        headers=headers,
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_update_calendar_display_hours_rejects_out_of_bounds(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"calendarDisplayStartHour": -1, "calendarDisplayEndHour": 25},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_tenant_settings_requires_authentication(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"calendarDisplayStartHour": 8, "calendarDisplayEndHour": 18},
    )
    assert response.status_code == 401


def test_update_business_policies_saves_all_fields(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={
            "cancellationWindowHours": 48,
            "refundInsideWindow": True,
            "minLeadTimeMinutes": 120,
            "maxAdvanceBookingDays": 60,
            "defaultDepositCents": 2500,
            "noShowFeeCents": 5000,
            "taxRatePercent": 8.25,
            "autoChargeNoShowFee": True,
        },
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    settings = response.json()["settings"]
    assert settings["cancellationWindowHours"] == 48
    assert settings["refundInsideWindow"] is True
    assert settings["minLeadTimeMinutes"] == 120
    assert settings["maxAdvanceBookingDays"] == 60
    assert settings["defaultDepositCents"] == 2500
    assert settings["noShowFeeCents"] == 5000
    assert settings["taxRatePercent"] == 8.25
    assert settings["autoChargeNoShowFee"] is True

    # Persisted across reads
    follow_up = client.get("/api/v1/tenants/brow-beauty-lab").json()["settings"]
    assert follow_up["cancellationWindowHours"] == 48
    assert follow_up["refundInsideWindow"] is True
    assert follow_up["minLeadTimeMinutes"] == 120


def test_update_settings_rejects_negative_cancellation_window(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"cancellationWindowHours": -1},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_settings_rejects_excessive_cancellation_window(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"cancellationWindowHours": 200},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_settings_rejects_negative_deposit(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"defaultDepositCents": -100},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_settings_rejects_excessive_tax_rate(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"taxRatePercent": 150},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_settings_rejects_zero_max_advance_days(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"maxAdvanceBookingDays": 0},
        headers=headers,
    )
    assert response.status_code == 422


def test_update_settings_rejects_excessive_min_lead_time(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/settings",
        json={"minLeadTimeMinutes": 2000},
        headers=headers,
    )
    assert response.status_code == 422
