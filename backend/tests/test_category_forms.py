"""Forms a service category requires for every service in it."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

TENANT = "brow-beauty-lab"
API = f"/api/v1/tenants/{TENANT}"


def _auth(client) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": "owner@browbeautylab.test", "password": "DemoBooking123"})
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _service_named(client, name: str) -> dict:
    return next(s for s in client.get(f"{API}/services").json()["services"] if s["name"] == name)


def _category(client, headers, name: str) -> str:
    response = client.post(f"{API}/service-categories", headers=headers, json={"name": name})
    assert response.status_code in (200, 201), response.json()
    return response.json()["id"]


def _form(client, headers, name: str, *, category_ids=None, service_ids=None, timing: str = "pre_booking") -> dict:
    body = {"name": name, "scope": "customer", "customerPromptTiming": timing, "categoryIds": category_ids or []}
    if service_ids is not None:
        body["serviceIds"] = service_ids
    response = client.post(f"{API}/forms", headers=headers, json=body)
    assert response.status_code == 201, response.text
    return response.json()


def _draft_requirements(client, headers, service: dict) -> tuple[str, list[dict]]:
    providers = client.get(f"{API}/providers/manage", headers=headers).json()["providers"]
    provider_id = next(p["id"] for p in providers if p["isActive"] and service["id"] in p["serviceIds"])
    location_id = client.get(f"{API}/locations").json()["locations"][0]["id"]
    client.put(
        f"{API}/providers/{provider_id}/schedule",
        headers=headers,
        json={"locationId": location_id, "entries": [
            {"weekday": 0, "locationId": location_id, "startTime": "09:00", "endTime": "17:00", "isActive": True},
        ]},
    )
    today = datetime.now(timezone.utc).date()
    monday = (today + timedelta(days=(7 - today.weekday()) % 7 or 7)).isoformat()
    slot = client.get(
        f"{API}/availability",
        params={"serviceId": service["id"], "providerId": provider_id, "locationId": location_id, "date": monday, "windowDays": 1},
    ).json()["slots"][0]
    draft = client.post(
        f"{API}/booking-drafts",
        json={"tenantSlug": TENANT, "serviceId": service["id"], "providerId": provider_id,
              "locationId": location_id, "startsAt": slot["startAt"]},
    )
    assert draft.status_code in (200, 201), draft.json()
    body = draft.json()
    return body["status"], body["formRequirements"]


def test_form_lists_the_categories_that_require_it(client) -> None:
    headers = _auth(client)
    category_id = _category(client, headers, "Laser")
    form = _form(client, headers, "Laser consent", category_ids=[category_id])
    assert form["categoryIds"] == [category_id]

    listed = client.get(f"{API}/forms", headers=headers).json()["items"]
    assert next(item for item in listed if item["id"] == form["id"])["categoryIds"] == [category_id]
    categories = client.get(f"{API}/service-categories", headers=headers).json()["categories"]
    assert next(c for c in categories if c["id"] == category_id)["formIds"] == [form["id"]]


def test_a_category_form_is_required_for_every_service_in_the_category(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category(client, headers, "Laser")
    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": category_id})

    _, before = _draft_requirements(client, headers, service)
    form = _form(client, headers, "Laser consent", category_ids=[category_id])
    status, requirements = _draft_requirements(client, headers, service)

    assert len(requirements) == len(before) + 1
    assert any(r["formId"] == form["id"] and r["status"] == "pending" for r in requirements)
    assert status == "awaiting_form"


def test_a_form_on_both_the_service_and_its_category_is_required_once(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category(client, headers, "Laser")
    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": category_id})
    form = _form(client, headers, "Laser consent", category_ids=[category_id], service_ids=[service["id"]])

    _, requirements = _draft_requirements(client, headers, service)
    assert [r["formId"] for r in requirements].count(form["id"]) == 1


def test_removing_a_category_from_a_form_stops_requiring_it(client) -> None:
    headers = _auth(client)
    service = _service_named(client, "Signature Facial")
    category_id = _category(client, headers, "Laser")
    client.patch(f"{API}/services/{service['id']}", headers=headers, json={"categoryId": category_id})
    form = _form(client, headers, "Laser consent", category_ids=[category_id])

    updated = client.patch(f"{API}/forms/{form['id']}", headers=headers, json={"categoryIds": []})
    assert updated.status_code == 200
    assert updated.json()["categoryIds"] == []
    _, requirements = _draft_requirements(client, headers, service)
    assert all(r["formId"] != form["id"] for r in requirements)


def test_a_form_cannot_use_a_category_from_another_tenant(client) -> None:
    headers = _auth(client)
    response = client.post(
        f"{API}/forms",
        headers=headers,
        json={"name": "Sneaky", "scope": "customer", "categoryIds": ["not-this-tenants-category"]},
    )
    assert response.status_code == 404


def test_deleting_a_category_removes_its_form_links_but_keeps_the_form(client) -> None:
    headers = _auth(client)
    category_id = _category(client, headers, "Laser")
    form = _form(client, headers, "Laser consent", category_ids=[category_id])

    assert client.delete(f"{API}/service-categories/{category_id}", headers=headers).status_code == 204
    listed = client.get(f"{API}/forms", headers=headers).json()["items"]
    assert next(item for item in listed if item["id"] == form["id"])["categoryIds"] == []
