from datetime import datetime, timedelta, timezone

import pytest
from fastapi.testclient import TestClient

from app.services.reminders import _get_reminder_windows, _FALLBACK_REMINDER_WINDOWS_HOURS


def _auth_headers(client: TestClient, demo_credentials: dict) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json=demo_credentials)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def test_send_intake_reminders_endpoint_returns_summary(
    client: TestClient,
    demo_credentials: dict,
) -> None:
    """The cron endpoint should return a summary dict even when no reminders are due."""
    headers = _auth_headers(client, demo_credentials)

    response = client.post(
        "/api/v1/testing/cron/send-intake-reminders",
        headers=headers,
    )

    assert response.status_code == 200
    payload = response.json()
    assert "sent" in payload
    assert "skipped" in payload
    assert "failed" in payload
    assert payload["sent"] == 0  # No reminders scheduled in demo seed


def test_send_intake_reminders_endpoint_accessible_in_test_mode(
    client: TestClient,
) -> None:
    """The cron endpoint is accessible without auth in test mode (no reset token configured)."""
    response = client.post(
        "/api/v1/testing/cron/send-intake-reminders",
    )

    # In test mode without a configured reset token, the guard passes through
    assert response.status_code == 200
    payload = response.json()
    assert payload["sent"] == 0


def test_get_reminder_windows_uses_tenant_setting() -> None:
    """When a tenant configures reminderHoursBefore, that single value is used."""
    windows = _get_reminder_windows({"reminderHoursBefore": 48})
    assert windows == (48,)


def test_get_reminder_windows_falls_back_when_missing() -> None:
    """When no reminderHoursBefore is set, the fallback multi-window cadence is used."""
    windows = _get_reminder_windows({})
    assert windows == _FALLBACK_REMINDER_WINDOWS_HOURS


def test_get_reminder_windows_falls_back_when_zero() -> None:
    """A zero or negative value is treated as unconfigured."""
    windows = _get_reminder_windows({"reminderHoursBefore": 0})
    assert windows == _FALLBACK_REMINDER_WINDOWS_HOURS


def test_get_reminder_windows_falls_back_when_wrong_type() -> None:
    """A non-integer value is treated as unconfigured."""
    windows = _get_reminder_windows({"reminderHoursBefore": "24"})
    assert windows == _FALLBACK_REMINDER_WINDOWS_HOURS
