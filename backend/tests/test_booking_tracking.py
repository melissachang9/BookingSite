from tests.test_booking_operations import (
    _auth_headers,
    _confirm_paid_deposit_booking,
    _create_other_tenant_owner,
)


def _url(booking_id: str, suffix: str = "") -> str:
    return f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}{suffix}"


def test_new_online_booking_records_source_channel(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    response = client.get(_url(created["booking"]["id"]))
    assert response.status_code == 200
    assert response.json()["sourceChannel"] == "online"
    assert response.json()["rescheduleCount"] == 0


def test_staff_cancel_records_actor_and_reason(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    response = client.post(
        _url(created["booking"]["id"], "/cancel"),
        headers=headers,
        json={"reason": "Provider out sick"},
    )
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "canceled"
    assert body["canceledBy"] == "staff"
    assert body["cancelReason"] == "Provider out sick"


def test_no_show_stamps_no_show_at(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    response = client.post(
        _url(created["booking"]["id"], "/status"),
        headers=_auth_headers(client),
        json={"status": "no_show"},
    )
    assert response.status_code == 200
    assert response.json()["noShowAt"] is not None


def test_completion_snapshots_tax(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    response = client.post(
        _url(created["booking"]["id"], "/status"),
        headers=_auth_headers(client),
        json={"status": "completed", "paymentResolution": "follow_up"},
    )
    assert response.status_code == 200
    assert response.json()["taxCents"] >= 0


def test_check_in_then_start_service_stamps_once(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking_id = created["booking"]["id"]

    checked_in = client.post(_url(booking_id, "/progress"), headers=headers, json={"action": "check_in"})
    assert checked_in.status_code == 200
    first_stamp = checked_in.json()["checkedInAt"]
    assert first_stamp is not None
    assert checked_in.json()["serviceStartedAt"] is None

    again = client.post(_url(booking_id, "/progress"), headers=headers, json={"action": "check_in"})
    assert again.json()["checkedInAt"] == first_stamp

    started = client.post(_url(booking_id, "/progress"), headers=headers, json={"action": "start_service"})
    assert started.status_code == 200
    assert started.json()["serviceStartedAt"] is not None
    assert started.json()["checkedInAt"] == first_stamp


def test_progress_rejects_invalid_action(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    response = client.post(
        _url(created["booking"]["id"], "/progress"),
        headers=_auth_headers(client),
        json={"action": "teleport"},
    )
    assert response.status_code == 422


def test_progress_rejects_non_confirmed_booking(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    headers = _auth_headers(client)
    booking_id = created["booking"]["id"]
    client.post(_url(booking_id, "/status"), headers=headers, json={"status": "no_show"})
    response = client.post(_url(booking_id, "/progress"), headers=headers, json={"action": "check_in"})
    assert response.status_code == 409


def test_progress_requires_authentication(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    response = client.post(_url(created["booking"]["id"], "/progress"), json={"action": "check_in"})
    assert response.status_code in (401, 403)


def test_progress_is_tenant_isolated(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    other_email, other_password = _create_other_tenant_owner(client)
    other_headers = _auth_headers(client, other_email, other_password)
    response = client.post(
        _url(created["booking"]["id"], "/progress"),
        headers=other_headers,
        json={"action": "check_in"},
    )
    assert response.status_code in (403, 404)
