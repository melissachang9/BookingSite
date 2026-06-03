from datetime import datetime, timedelta, timezone


def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


def _service(client) -> dict[str, str]:
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert response.status_code == 200
    return response.json()["services"][0]


def _slots_for(client, service_id: str, date_text: str) -> list[dict]:
    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service_id, "date": date_text, "windowDays": 1},
    )
    assert response.status_code == 200, response.json()
    from datetime import datetime
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("America/Los_Angeles")
    return [
        slot
        for slot in response.json()["slots"]
        if datetime.fromisoformat(slot["startAt"].replace("Z", "+00:00")).astimezone(tz).date().isoformat()
        == date_text
    ]


def _patch_hours(client, payload: dict) -> None:
    headers = _auth_headers(client)
    response = client.patch("/api/v1/tenants/brow-beauty-lab/hours", json=payload, headers=headers)
    assert response.status_code == 200, response.json()


def test_availability_baseline_when_business_hours_disabled(client) -> None:
    service = _service(client)
    date_text = _next_weekday(2)  # Wednesday
    baseline = _slots_for(client, service["id"], date_text)
    assert len(baseline) > 0


def test_availability_zero_when_restricted_and_day_closed(client) -> None:
    service = _service(client)
    date_text = _next_weekday(2)  # Wednesday
    week = {
        "mon": {"open": "09:00", "close": "17:00", "closed": True},
        "tue": {"open": "09:00", "close": "17:00", "closed": True},
        "wed": {"open": "09:00", "close": "17:00", "closed": True},
        "thu": {"open": "09:00", "close": "17:00", "closed": True},
        "fri": {"open": "09:00", "close": "17:00", "closed": True},
        "sat": {"open": "09:00", "close": "17:00", "closed": True},
        "sun": {"open": "09:00", "close": "17:00", "closed": True},
    }
    _patch_hours(
        client,
        {
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": True,
            "businessHours": week,
        },
    )
    slots = _slots_for(client, service["id"], date_text)
    assert slots == []


def test_availability_unchanged_when_enabled_but_not_restricted(client) -> None:
    service = _service(client)
    date_text = _next_weekday(2)
    baseline = _slots_for(client, service["id"], date_text)
    _patch_hours(
        client,
        {
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": False,
            "businessHours": {
                "mon": {"open": "09:00", "close": "17:00", "closed": True},
                "tue": {"open": "09:00", "close": "17:00", "closed": True},
                "wed": {"open": "09:00", "close": "17:00", "closed": True},
                "thu": {"open": "09:00", "close": "17:00", "closed": True},
                "fri": {"open": "09:00", "close": "17:00", "closed": True},
                "sat": {"open": "09:00", "close": "17:00", "closed": True},
                "sun": {"open": "09:00", "close": "17:00", "closed": True},
            },
        },
    )
    advisory = _slots_for(client, service["id"], date_text)
    assert len(advisory) == len(baseline)


def test_availability_window_clips_to_business_open_close(client) -> None:
    service = _service(client)
    date_text = _next_weekday(2)
    _patch_hours(
        client,
        {
            "businessHoursEnabled": True,
            "restrictProvidersToBusinessHours": True,
            "businessHours": {
                "mon": {"open": "10:00", "close": "12:00", "closed": False},
                "tue": {"open": "10:00", "close": "12:00", "closed": False},
                "wed": {"open": "10:00", "close": "12:00", "closed": False},
                "thu": {"open": "10:00", "close": "12:00", "closed": False},
                "fri": {"open": "10:00", "close": "12:00", "closed": False},
                "sat": {"open": "09:00", "close": "17:00", "closed": True},
                "sun": {"open": "09:00", "close": "17:00", "closed": True},
            },
        },
    )
    slots = _slots_for(client, service["id"], date_text)
    # Convert to tenant local time (America/Los_Angeles) for sanity bounds.
    from zoneinfo import ZoneInfo

    tz = ZoneInfo("America/Los_Angeles")
    for slot in slots:
        local_start = datetime.fromisoformat(slot["startAt"].replace("Z", "+00:00")).astimezone(tz)
        local_end = datetime.fromisoformat(slot["endAt"].replace("Z", "+00:00")).astimezone(tz)
        assert local_start.time() >= datetime.strptime("10:00", "%H:%M").time()
        assert local_end.time() <= datetime.strptime("12:00", "%H:%M").time()
