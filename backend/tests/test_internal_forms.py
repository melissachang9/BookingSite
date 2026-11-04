"""Internal forms: staff-only records filled in from a client's profile."""
from __future__ import annotations

from tests.test_booking_operations import _auth_headers, _confirm_paid_deposit_booking, _create_other_tenant_owner

BASE = "/api/v1/tenants/brow-beauty-lab"

SCHEMA = {
    "title": "Treatment note",
    "description": "Private notes about this visit.",
    "fields": [
        {"id": "formula", "type": "short_text", "label": "Formula used", "required": True},
        {"id": "reaction", "type": "long_text", "label": "Skin reaction", "required": False},
        {"id": "patchTested", "type": "yes_no", "label": "Patch tested", "required": False},
    ],
}


def _create_internal_form(client, headers, name: str = "Treatment note", schema: dict | None = None) -> dict:
    response = client.post(
        f"{BASE}/forms",
        headers=headers,
        json={"name": name, "scope": "internal", "isActive": True, "schema": schema or SCHEMA},
    )
    assert response.status_code == 201, response.text
    return response.json()


def _customer_and_booking(client) -> tuple[str, str]:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    booking = client.get(f"{BASE}/bookings/{booking_id}").json()
    return booking["customerId"], booking_id


def _submit(client, headers, customer_id: str, form_id: str, answers: dict, **extra):
    return client.post(
        f"{BASE}/customers/{customer_id}/internal-forms/{form_id}/responses",
        headers=headers,
        json={"answers": answers, **extra},
    )


def _staff_headers(client, owner_headers, email: str, role: str = "staff") -> dict[str, str]:
    created = client.post(
        f"{BASE}/users",
        headers=owner_headers,
        json={"email": email, "name": "Floor Staff", "role": role, "initialPassword": "TempPass123"},
    )
    assert created.status_code == 201, created.text
    return _auth_headers(client, email, "TempPass123")


def test_staff_fill_in_an_internal_form_and_it_appears_on_the_profile(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, booking_id = _customer_and_booking(client)
    staff = _staff_headers(client, owner, "floor@browbeautylab.test")

    options = client.get(f"{BASE}/internal-forms", headers=staff).json()["items"]
    assert [option["id"] for option in options] == [form["id"]]
    assert options[0]["schema"]["fields"][0]["id"] == "formula"

    response = _submit(client, staff, customer_id, form["id"], {"formula": "Brown 5N", "patchTested": True}, bookingId=booking_id)
    assert response.status_code == 201, response.text
    saved = response.json()
    assert saved["scope"] == "internal"
    assert saved["submittedByName"] == "Floor Staff"
    assert saved["bookingId"] == booking_id
    assert saved["formVersionNumber"] == 1

    listed = client.get(f"{BASE}/customers/{customer_id}/internal-form-responses", headers=staff).json()["items"]
    assert [item["id"] for item in listed] == [saved["id"]]
    assert listed[0]["answers"]["formula"] == "Brown 5N"


def test_internal_responses_never_appear_in_the_customer_facing_list(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)
    assert _submit(client, owner, customer_id, form["id"], {"formula": "Secret"}).status_code == 201

    customer_list = client.get(f"{BASE}/customers/{customer_id}/form-responses", headers=owner).json()["items"]
    assert all(item["scope"] != "internal" for item in customer_list)
    assert "Secret" not in str(customer_list)


def test_answers_are_validated_against_the_form(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)

    missing = _submit(client, owner, customer_id, form["id"], {"reaction": "None"})
    assert missing.status_code == 422
    assert missing.json()["error"]["code"] == "validation_error"

    unknown = _submit(client, owner, customer_id, form["id"], {"formula": "x", "notAQuestion": "y"})
    assert unknown.status_code == 422


def test_a_response_keeps_the_version_it_was_answered_against(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)
    first = _submit(client, owner, customer_id, form["id"], {"formula": "Version one"}).json()

    edited = client.patch(
        f"{BASE}/forms/{form['id']}",
        headers=owner,
        json={"schema": {"title": "Revised", "fields": [{"id": "formula", "type": "short_text", "label": "Mix", "required": True}]}},
    )
    assert edited.status_code == 200
    second = _submit(client, owner, customer_id, form["id"], {"formula": "Version two"}).json()

    assert second["formVersionNumber"] == 2
    listed = {item["id"]: item for item in client.get(f"{BASE}/customers/{customer_id}/internal-form-responses", headers=owner).json()["items"]}
    assert listed[first["id"]]["formVersionNumber"] == 1
    assert listed[first["id"]]["schema"]["fields"][0]["label"] == "Formula used"
    assert listed[second["id"]]["schema"]["fields"][0]["label"] == "Mix"


def test_a_form_with_responses_cannot_be_deleted(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)
    assert _submit(client, owner, customer_id, form["id"], {"formula": "Keep me"}).status_code == 201

    assert client.delete(f"{BASE}/forms/{form['id']}", headers=owner).status_code == 409
    assert client.get(f"{BASE}/customers/{customer_id}/internal-form-responses", headers=owner).json()["items"]


def test_customer_facing_and_inactive_forms_cannot_be_filled_in_as_internal(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    customer_form = client.post(
        f"{BASE}/forms",
        headers=owner,
        json={"name": "Waiver", "scope": "customer", "customerPromptTiming": "pre_booking", "isActive": True, "schema": SCHEMA},
    ).json()
    assert _submit(client, owner, customer_id, customer_form["id"], {"formula": "x"}).status_code == 404

    inactive = _create_internal_form(client, owner, name="Retired note")
    assert client.patch(f"{BASE}/forms/{inactive['id']}", headers=owner, json={"isActive": False}).status_code == 200
    assert _submit(client, owner, customer_id, inactive["id"], {"formula": "x"}).status_code == 409
    assert inactive["id"] not in [option["id"] for option in client.get(f"{BASE}/internal-forms", headers=owner).json()["items"]]


def test_booking_must_belong_to_the_same_client(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)

    response = _submit(client, owner, customer_id, form["id"], {"formula": "x"}, bookingId="00000000-0000-0000-0000-000000000000")
    assert response.status_code == 404


def test_permissions_gate_filling_in_and_viewing(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)

    user_id = client.post(
        f"{BASE}/users",
        headers=owner,
        json={"email": "limited@browbeautylab.test", "name": "Limited", "role": "staff", "initialPassword": "TempPass123"},
    ).json()["id"]
    client.put(
        f"{BASE}/users/{user_id}/permissions",
        headers=owner,
        json={"overrides": [{"key": "forms.submit_internal", "allowed": False}, {"key": "forms.view_internal", "allowed": False}]},
    )
    limited = _auth_headers(client, "limited@browbeautylab.test", "TempPass123")

    assert client.get(f"{BASE}/internal-forms", headers=limited).status_code == 403
    assert _submit(client, limited, customer_id, form["id"], {"formula": "x"}).status_code == 403
    assert client.get(f"{BASE}/customers/{customer_id}/internal-form-responses", headers=limited).status_code == 403
    assert client.get(f"{BASE}/internal-forms").status_code == 401


def test_filling_in_an_internal_form_is_audited(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)
    response_id = _submit(client, owner, customer_id, form["id"], {"formula": "Audited"}).json()["id"]

    import asyncio

    from sqlalchemy import select

    from app.db.models import AuditEvent
    from app.db.session import get_session_maker

    async def _events() -> list[AuditEvent]:
        async with get_session_maker()() as session:
            return list(await session.scalars(select(AuditEvent).where(AuditEvent.entity_id == response_id)))

    events = asyncio.run(_events())
    assert [(event.entity_type, event.action) for event in events] == [("form_response", "submit_internal")]
    assert events[0].actor_name


def test_other_businesses_cannot_see_or_fill_in_these_forms(client) -> None:
    owner = _auth_headers(client)
    form = _create_internal_form(client, owner)
    customer_id, _ = _customer_and_booking(client)
    assert _submit(client, owner, customer_id, form["id"], {"formula": "Mine"}).status_code == 201

    email, password = _create_other_tenant_owner(client)
    other = _auth_headers(client, email, password)
    other_base = "/api/v1/tenants/other-tenant"

    assert client.get(f"{other_base}/internal-forms", headers=other).json()["items"] == []
    assert client.get(f"{other_base}/customers/{customer_id}/internal-form-responses", headers=other).status_code == 404
    cross = client.post(
        f"{other_base}/customers/{customer_id}/internal-forms/{form['id']}/responses",
        headers=other,
        json={"answers": {"formula": "x"}},
    )
    assert cross.status_code == 404
    # And the other business's login cannot reach this business's records.
    assert client.get(f"{BASE}/customers/{customer_id}/internal-form-responses", headers=other).status_code in (401, 403, 404)
