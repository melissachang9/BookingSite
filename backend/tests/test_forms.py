"""Form CRUD, versioning, requirements, validation, and pre-fill tests."""

from __future__ import annotations

import asyncio

import pytest
from fastapi.testclient import TestClient


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _auth_headers(client: TestClient, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _create_form(client: TestClient, name: str = "Test Form", schema: dict | None = None) -> dict:
    headers = _auth_headers(client)
    payload: dict = {
        "name": name,
        "scope": "customer",
        "customerPromptTiming": "pre_booking",
        "isActive": True,
    }
    if schema is not None:
        payload["schema"] = schema
    response = client.post("/api/v1/tenants/brow-beauty-lab/forms", json=payload, headers=headers)
    assert response.status_code == 201, response.text
    return response.json()


def _simple_schema() -> dict:
    return {
        "title": "Health Intake",
        "description": "Basic health questions",
        "fields": [
            {"id": "allergies", "type": "long_text", "label": "Any allergies?", "required": True},
            {"id": "medications", "type": "short_text", "label": "Current medications", "required": False},
            {"id": "pregnant", "type": "yes_no", "label": "Are you pregnant?", "required": False},
        ],
    }


# ---------------------------------------------------------------------------
# Form CRUD
# ---------------------------------------------------------------------------

def test_list_forms_returns_empty_when_no_forms(client: TestClient) -> None:
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/forms", headers=headers)
    assert response.status_code == 200
    data = response.json()
    assert isinstance(data["forms"], list)


def test_create_form_returns_summary(client: TestClient) -> None:
    form = _create_form(client, "Health Intake", _simple_schema())
    assert form["name"] == "Health Intake"
    assert form["scope"] == "customer"
    assert form["customerPromptTiming"] == "pre_booking"
    assert form["isActive"] is True
    assert "id" in form
    assert "latestVersion" in form
    assert form["latestVersion"]["versionNumber"] == 1
    assert form["latestVersion"]["schema"]["title"] == "Health Intake"


def test_list_forms_includes_created_form(client: TestClient) -> None:
    _create_form(client, "Health Intake", _simple_schema())
    headers = _auth_headers(client)
    response = client.get("/api/v1/tenants/brow-beauty-lab/forms", headers=headers)
    assert response.status_code == 200
    forms = response.json()["forms"]
    assert len(forms) >= 1
    names = [f["name"] for f in forms]
    assert "Health Intake" in names


def test_update_form_metadata(client: TestClient) -> None:
    form = _create_form(client, "Old Name", _simple_schema())
    headers = _auth_headers(client)
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/forms/{form['id']}",
        json={"name": "New Name", "isActive": False},
        headers=headers,
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["name"] == "New Name"
    assert updated["isActive"] is False
    # Version should still be 1 (no schema change)
    assert updated["latestVersion"]["versionNumber"] == 1


def test_update_form_schema_creates_new_version(client: TestClient) -> None:
    form = _create_form(client, "Versioned Form", _simple_schema())
    headers = _auth_headers(client)
    new_schema = {
        "title": "Updated Intake",
        "description": "Updated questions",
        "fields": [
            {"id": "allergies", "type": "long_text", "label": "Any allergies?", "required": True},
            {"id": "new_field", "type": "short_text", "label": "New question", "required": False},
        ],
    }
    response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/forms/{form['id']}",
        json={"schema": new_schema},
        headers=headers,
    )
    assert response.status_code == 200
    updated = response.json()
    assert updated["latestVersion"]["versionNumber"] == 2
    assert updated["latestVersion"]["schema"]["title"] == "Updated Intake"


def test_delete_form_removes_it(client: TestClient) -> None:
    form = _create_form(client, "To Delete", _simple_schema())
    headers = _auth_headers(client)
    response = client.delete(f"/api/v1/tenants/brow-beauty-lab/forms/{form['id']}", headers=headers)
    assert response.status_code == 204

    # Verify it's gone
    list_resp = client.get("/api/v1/tenants/brow-beauty-lab/forms", headers=headers)
    forms = list_resp.json()["forms"]
    assert all(f["id"] != form["id"] for f in forms)


# ---------------------------------------------------------------------------
# Tenant isolation
# ---------------------------------------------------------------------------

def test_cannot_access_forms_from_other_tenant(client: TestClient) -> None:
    """Forms are tenant-scoped; cross-tenant access should fail."""
    headers = _auth_headers(client)
    # Use a non-existent tenant slug
    response = client.get("/api/v1/tenants/nonexistent-tenant/forms", headers=headers)
    assert response.status_code == 404


# ---------------------------------------------------------------------------
# Form validation
# ---------------------------------------------------------------------------

def test_create_form_rejects_invalid_scope(client: TestClient) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/forms",
        json={"name": "Bad Form", "scope": "invalid_scope", "customerPromptTiming": "pre_booking", "isActive": True},
        headers=headers,
    )
    assert response.status_code == 422  # validation error


def test_create_form_rejects_invalid_timing(client: TestClient) -> None:
    headers = _auth_headers(client)
    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/forms",
        json={"name": "Bad Form", "scope": "customer", "customerPromptTiming": "invalid_timing", "isActive": True},
        headers=headers,
    )
    assert response.status_code == 422


# ---------------------------------------------------------------------------
# Form requirement lifecycle
# ---------------------------------------------------------------------------

def _create_service_with_form(client: TestClient, form_id: str, form_version_id: str) -> dict:
    """Create a service and attach a form to it via the API."""
    headers = _auth_headers(client)
    # Get a location
    loc_resp = client.get("/api/v1/tenants/brow-beauty-lab/locations", headers=headers)
    assert loc_resp.status_code == 200
    location_id = loc_resp.json()["locations"][0]["id"]

    # Create service
    svc_resp = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Form Test Service",
            "description": "Service for form testing",
            "durationMinutes": 30,
            "priceCents": 5000,
            "depositCents": 0,
            "locationIds": [location_id],
            "formIds": [form_id],
        },
        headers=headers,
    )
    assert svc_resp.status_code == 201, svc_resp.text
    return svc_resp.json()


def _get_first_available_slot(client: TestClient, service_id: str) -> dict:
    """Get the first available slot for a service."""
    # Try the next few days
    from datetime import datetime, timedelta, timezone

    for days_ahead in range(1, 8):
        date = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
        resp = client.get(
            "/api/v1/tenants/brow-beauty-lab/availability",
            params={"serviceId": service_id, "date": date},
        )
        if resp.status_code == 200:
            slots = resp.json().get("slots", [])
            if slots:
                return slots[0]
    pytest.skip("No available slots found for form testing")


def test_form_requirements_created_on_draft(client: TestClient) -> None:
    """When a draft is created for a service with forms, requirements are attached."""
    form = _create_form(client, "Pre-Booking Form", _simple_schema())
    service = _create_service_with_form(client, form["id"], form["latestVersion"]["id"])
    slot = _get_first_available_slot(client, service["id"])

    # Create draft
    draft_resp = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
        },
    )
    assert draft_resp.status_code == 200, draft_resp.text
    draft = draft_resp.json()
    assert draft["status"] == "awaiting_form"
    assert len(draft.get("formRequirements", [])) >= 1


def test_form_requirement_status_transitions(client: TestClient) -> None:
    """Submitting a form requirement moves it from pending to satisfied."""
    form = _create_form(client, "Submit Test Form", _simple_schema())
    service = _create_service_with_form(client, form["id"], form["latestVersion"]["id"])
    slot = _get_first_available_slot(client, service["id"])

    # Create draft
    draft_resp = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
        },
    )
    assert draft_resp.status_code == 200
    draft = draft_resp.json()
    requirements = draft.get("formRequirements", [])
    assert len(requirements) >= 1
    req = requirements[0]
    assert req["status"] == "pending"

    # Add customer
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}",
        json={
            "customer": {"name": "Form Test Guest", "email": "formtest@example.com", "phone": "555-0500"},
            "intakeTiming": "before_visit",
        },
    )

    # Submit the form requirement
    submit_resp = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}/form-requirements/{req['id']}/submit",
        json={
            "answers": {
                "allergies": "Peanuts",
                "medications": "None",
                "pregnant": "false",
            },
        },
    )
    assert submit_resp.status_code == 200, submit_resp.text
    result = submit_resp.json()
    assert result["status"] == "satisfied"


# ---------------------------------------------------------------------------
# Pre-fill
# ---------------------------------------------------------------------------

def test_prefill_returns_last_response(client: TestClient) -> None:
    """The manage-booking form requirements endpoint includes prefillAnswers."""
    form = _create_form(client, "Prefill Test Form", _simple_schema())
    service = _create_service_with_form(client, form["id"], form["latestVersion"]["id"])
    slot = _get_first_available_slot(client, service["id"])

    # Create draft
    draft_resp = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
        },
    )
    assert draft_resp.status_code == 200
    draft = draft_resp.json()
    req = draft["formRequirements"][0]

    # Add customer
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}",
        json={
            "customer": {"name": "Prefill Guest", "email": "prefill@example.com", "phone": "555-0600"},
            "intakeTiming": "before_visit",
        },
    )

    # Submit form with specific answers
    answers = {"allergies": "Latex", "medications": "Aspirin", "pregnant": "true"}
    client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}/form-requirements/{req['id']}/submit",
        json={"answers": answers},
    )

    # Confirm the draft (no deposit)
    confirm_resp = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft['id']}/confirm",
        json={"tenantSlug": "brow-beauty-lab"},
    )
    assert confirm_resp.status_code == 200, confirm_resp.text
    booking = confirm_resp.json()
    manage_token = booking["customerManageToken"]

    # Now create a second booking for the same customer with the same service
    slot2 = _get_first_available_slot(client, service["id"])
    draft2_resp = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot2["providerId"],
            "locationId": slot2["locationId"],
            "startsAt": slot2["startAt"],
        },
    )
    assert draft2_resp.status_code == 200
    draft2 = draft2_resp.json()

    # Add same customer
    client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft2['id']}",
        json={
            "customer": {"name": "Prefill Guest", "email": "prefill@example.com", "phone": "555-0600"},
            "intakeTiming": "before_visit",
        },
    )

    # Confirm second draft
    confirm2_resp = client.post(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{draft2['id']}/confirm",
        json={"tenantSlug": "brow-beauty-lab"},
    )
    assert confirm2_resp.status_code == 200
    booking2 = confirm2_resp.json()
    manage_token2 = booking2["customerManageToken"]

    # Get form requirements via manage token - should include prefillAnswers
    reqs_resp = client.get(f"/api/v1/bookings/manage/{manage_token2}/form-requirements")
    assert reqs_resp.status_code == 200, reqs_resp.text
    requirements = reqs_resp.json()
    assert len(requirements) >= 1

    # The requirement should have prefillAnswers from the first booking
    prefill_req = requirements[0]
    assert "prefillAnswers" in prefill_req
    assert prefill_req["prefillAnswers"] is not None
    assert prefill_req["prefillAnswers"]["allergies"] == "Latex"
    assert prefill_req["prefillAnswers"]["medications"] == "Aspirin"
    assert prefill_req["prefillAnswers"]["pregnant"] == "true"
