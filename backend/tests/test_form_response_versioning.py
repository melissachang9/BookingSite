"""A submitted response keeps the form version and questions it was answered against."""
from __future__ import annotations

from tests.test_public_booking import _auth_headers, _next_weekday, _service_by_name

BASE = "/api/v1/tenants/brow-beauty-lab"


def _book_with_submitted_form(client) -> str:
    service = _service_by_name(client, "Brow Shape and Tint")
    slot = client.get(f"{BASE}/availability", params={"serviceId": service["id"], "date": _next_weekday(4)}).json()["slots"][0]
    draft = client.post(
        f"{BASE}/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
        },
    ).json()
    draft_id = draft["id"]
    client.patch(
        f"{BASE}/booking-drafts/{draft_id}",
        json={
            "customer": {"name": "Version Guest", "email": "version-guest@example.com", "phone": "555-0411"},
            "intakeCompletionTiming": "before_visit",
        },
    )
    submitted = client.post(
        f"{BASE}/booking-drafts/{draft_id}/form-requirements/{draft['formRequirements'][0]['id']}/submit",
        json={"answers": {"recentRetinoidUse": True, "skinSensitivityNotes": "Original answer."}},
    )
    assert submitted.status_code == 200
    session = client.post(
        f"{BASE}/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": draft_id,
            "kind": "deposit",
            "successUrl": f"/brow-beauty-lab/book/{draft_id}/success",
            "cancelUrl": f"/brow-beauty-lab/book/{draft_id}",
        },
    ).json()["sessionId"]
    return client.post(f"{BASE}/payments/checkout-sessions/{session}/complete").json()["id"]


def test_editing_a_form_does_not_change_submitted_responses(client, demo_credentials) -> None:
    booking_id = _book_with_submitted_form(client)
    headers = _auth_headers(client, demo_credentials)

    before = client.get(f"{BASE}/bookings/{booking_id}/form-responses", headers=headers).json()["items"][0]
    form_id = before["formId"]
    original_fields = before["schema"]["fields"]

    edited = client.patch(
        f"{BASE}/forms/{form_id}",
        headers=headers,
        json={
            "schema": {
                "title": "Rewritten",
                "fields": [{"id": "brandNew", "type": "short_text", "label": "A different question", "required": True}],
            }
        },
    )
    assert edited.status_code == 200
    assert edited.json()["currentVersionNumber"] > 1

    after = client.get(f"{BASE}/bookings/{booking_id}/form-responses", headers=headers).json()["items"][0]
    assert after["answers"] == before["answers"]
    assert after["answers"]["skinSensitivityNotes"] == "Original answer."
    assert after["schema"]["fields"] == original_fields
    assert after.get("formVersionNumber") == before.get("formVersionNumber")
