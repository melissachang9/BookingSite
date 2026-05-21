from datetime import datetime, timedelta, timezone


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


def _first_service(client) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return services_response.json()["services"][0]


def _first_slot(client, service_id: str) -> dict[str, str]:
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service_id, "date": _next_weekday(0)},
    )
    assert availability_response.status_code == 200
    return availability_response.json()["slots"][0]


def _create_booking_draft(client, service: dict[str, str], slot: dict[str, str]):
    return client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
            "customer": {
                "name": "E2E Reset Customer",
                "email": "e2e-reset@example.com",
                "phone": "555-0130",
            },
        },
    )


def test_reset_e2e_data_clears_booking_drafts_holds_and_customers(client) -> None:
    service = _first_service(client)
    slot = _first_slot(client, service["id"])
    create_response = _create_booking_draft(client, service, slot)
    assert create_response.status_code == 200
    booking_draft_id = create_response.json()["id"]

    reset_response = client.post("/api/v1/testing/e2e/reset")

    assert reset_response.status_code == 200
    reset_payload = reset_response.json()
    assert reset_payload["tenantSlug"] == "brow-beauty-lab"
    assert reset_payload["slotHoldsDeleted"] == 1
    assert reset_payload["bookingDraftsDeleted"] == 1
    assert reset_payload["customersDeleted"] == 1

    stale_draft_response = client.get(f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}")
    assert stale_draft_response.status_code == 404

    retry_response = _create_booking_draft(client, service, slot)
    assert retry_response.status_code == 200
    assert retry_response.json()["startsAt"] == slot["startAt"]


def test_reset_e2e_data_rejects_unknown_tenant(client) -> None:
    response = client.post("/api/v1/testing/e2e/reset", json={"tenantSlug": "missing-tenant"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"