"""Booking state machine and the cancellation-window boundary."""
from __future__ import annotations

from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from app.services import booking_drafts
from tests.test_booking_operations import _auth_headers, _confirm_paid_deposit_booking


def _status(client, booking_id: str, status: str, **extra):
    return client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}/status",
        headers=_auth_headers(client),
        json={"status": status, **extra},
    )


def _cancel(client, booking_id: str):
    return client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}/cancel",
        headers=_auth_headers(client),
        json={"reason": "test"},
    )


# --- cancellation window boundary -------------------------------------------------------------

class _FrozenClock(datetime):
    frozen = datetime(2030, 1, 10, 12, 0, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls.frozen


def _inside_window(monkeypatch, *, window_hours: int, hours_before_start: float, extra_seconds: float = 0) -> bool:
    start = _FrozenClock.frozen + timedelta(hours=hours_before_start, seconds=extra_seconds)
    monkeypatch.setattr(booking_drafts, "datetime", _FrozenClock)
    tenant = SimpleNamespace(settings_json={"cancellationWindowHours": window_hours, "refundInsideWindow": False})
    booking = SimpleNamespace(starts_at=start)
    return booking_drafts._cancellation_policy_for_booking(tenant, booking)[3]


def test_cancelling_exactly_at_the_deadline_is_outside_the_window(monkeypatch) -> None:
    assert _inside_window(monkeypatch, window_hours=24, hours_before_start=24) is False


def test_cancelling_one_second_after_the_deadline_is_inside_the_window(monkeypatch) -> None:
    assert _inside_window(monkeypatch, window_hours=24, hours_before_start=24, extra_seconds=-1) is True


def test_cancelling_one_second_before_the_deadline_is_outside_the_window(monkeypatch) -> None:
    assert _inside_window(monkeypatch, window_hours=24, hours_before_start=24, extra_seconds=1) is False


def test_a_zero_hour_window_only_penalizes_after_the_start_time(monkeypatch) -> None:
    assert _inside_window(monkeypatch, window_hours=0, hours_before_start=1) is False
    assert _inside_window(monkeypatch, window_hours=0, hours_before_start=-1) is True


# --- state transitions ------------------------------------------------------------------------

def test_a_completed_booking_cannot_become_no_show_or_canceled(client) -> None:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    assert _status(client, booking_id, "completed", paymentResolution="follow_up").status_code == 200

    assert _status(client, booking_id, "no_show").status_code == 409
    assert _cancel(client, booking_id).status_code == 409


def test_a_no_show_booking_cannot_be_completed_or_canceled(client) -> None:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    assert _status(client, booking_id, "no_show").status_code == 200

    assert _status(client, booking_id, "completed", paymentResolution="follow_up").status_code == 409
    assert _cancel(client, booking_id).status_code == 409


def test_a_canceled_booking_cannot_be_completed_or_marked_no_show(client) -> None:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    assert _cancel(client, booking_id).status_code == 200

    assert _status(client, booking_id, "completed", paymentResolution="follow_up").status_code == 409
    assert _status(client, booking_id, "no_show").status_code == 409


def test_completing_twice_is_idempotent_but_cannot_change_the_payment_outcome(client) -> None:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    first = _status(client, booking_id, "completed", paymentResolution="follow_up")
    assert first.status_code == 200

    again = _status(client, booking_id, "completed", paymentResolution="follow_up")
    assert again.status_code == 200
    assert again.json()["status"] == "completed"

    different = _status(client, booking_id, "completed", paymentResolution="collected")
    assert different.status_code == 409


@pytest.mark.parametrize("status", ["completed", "no_show"])
def test_unknown_bookings_return_a_structured_not_found(client, status: str) -> None:
    response = _status(client, "00000000-0000-0000-0000-000000000000", status, paymentResolution="follow_up")
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"
