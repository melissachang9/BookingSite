"""Sensitive changes leave an audit record with who did it, including ones recorded after the service committed."""

from __future__ import annotations

import asyncio

from test_attribution import _draft_with, _setup
from test_provider_terms_and_resources import API, _auth, _confirm


def _events(entity_id: str | None = None, action: str | None = None) -> list[dict]:
    async def _go():
        from sqlalchemy import select

        from app.db.models import AuditEvent
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            query = select(AuditEvent).order_by(AuditEvent.created_at)
            if entity_id:
                query = query.where(AuditEvent.entity_id == entity_id)
            if action:
                query = query.where(AuditEvent.action == action)
            return [
                {
                    "tenant": row.tenant_id,
                    "entity": row.entity_id,
                    "type": row.entity_type,
                    "action": row.action,
                    "actor": row.actor_id,
                    "actor_type": row.actor_type,
                    "changes": row.changes_json,
                    "notes": row.notes,
                }
                for row in (await session.scalars(query)).all()
            ]

    return asyncio.run(_go())


def _tenant(client) -> dict:
    return client.get(API).json()


def test_a_settings_change_is_audited_even_though_the_audit_is_written_after_the_commit(client) -> None:
    headers = _auth(client)
    tenant = _tenant(client)
    assert client.patch(f"{API}/settings", json={"noShowFeeCents": 4321}, headers=headers).status_code == 200
    [event] = _events(tenant["id"], "update_settings")
    assert event["actor"] and event["actor_type"] == "user" and event["tenant"] == tenant["id"]


def test_business_identity_changes_are_audited_with_old_and_new_values(client) -> None:
    headers = _auth(client)
    tenant = _tenant(client)
    response = client.patch(f"{API}/business", json={"name": "Brow Studio Two", "country": "CA"}, headers=headers)
    assert response.status_code == 200, response.json()
    [event] = _events(tenant["id"], "update_business")
    assert event["changes"]["name"] == {"from": tenant["name"], "to": "Brow Studio Two"}
    assert event["changes"]["country"]["to"] == "CA"
    # Saving the same values again records nothing new.
    client.patch(f"{API}/business", json={"name": "Brow Studio Two", "country": "CA"}, headers=headers)
    assert len(_events(tenant["id"], "update_business")) == 1


def test_staff_booking_changes_record_who_and_why(client) -> None:
    headers, service, slots = _setup(client)
    booking = _confirm(client, _draft_with(client, service["id"], slots[0], None).json()["id"], "audit-1@example.com")
    other = _confirm(client, _draft_with(client, service["id"], slots[8], None).json()["id"], "audit-2@example.com")

    edit = client.patch(f"{API}/bookings/{booking['id']}", headers=headers, json={"notes": "Prefers quiet room"})
    assert edit.status_code == 200, edit.json()
    [updated] = _events(booking["id"], "booking_updated")
    assert updated["actor"] and updated["changes"]["notes"] == "Prefers quiet room"

    done = client.post(f"{API}/bookings/{booking['id']}/status", headers=headers, json={"status": "completed", "paymentResolution": "waived"})
    assert done.status_code == 200, done.json()
    [finished] = _events(booking["id"], "status_changed")
    assert finished["changes"]["status"] == "completed" and finished["actor"]

    cancel = client.post(f"{API}/bookings/{other['id']}/cancel", headers=headers, json={"reason": "Client called"})
    assert cancel.status_code == 200, cancel.json()
    [canceled] = _events(other["id"], "booking_canceled")
    assert canceled["actor"] and canceled["changes"]["reason"] == "Client called"
    assert canceled["tenant"] == _tenant(client)["id"] and canceled["type"] == "booking"


def test_a_customer_cancelling_from_their_link_is_audited_with_no_staff_actor(client) -> None:
    headers, service, slots = _setup(client)
    booking = _confirm(client, _draft_with(client, service["id"], slots[0], None).json()["id"], "audit-3@example.com")
    token = booking["customerManageToken"]
    response = client.post(f"{API.rsplit('/tenants', 1)[0]}/bookings/manage/{token}/cancel", json={"reason": "Sick"})
    assert response.status_code == 200, response.json()
    [event] = _events(booking["id"], "booking_canceled")
    assert event["actor"] is None and event["actor_type"] == "system"
    assert event["changes"]["by"] == "customer" and event["changes"]["reason"] == "Sick"
    assert "manage link" in event["notes"]


def test_failed_changes_leave_no_audit_record(client) -> None:
    headers, service, slots = _setup(client)
    booking = _confirm(client, _draft_with(client, service["id"], slots[0], None).json()["id"], "audit-4@example.com")
    client.post(f"{API}/bookings/{booking['id']}/cancel", headers=headers, json={"reason": "first"})
    # Cancelling again changes nothing, so it must not add a second record.
    again = client.post(f"{API}/bookings/{booking['id']}/cancel", headers=headers, json={"reason": "second"})
    assert again.status_code == 200
    assert len(_events(booking["id"], "booking_canceled")) == 1
    # A change that is refused leaves no record either.
    refused = client.post(f"{API}/bookings/{booking['id']}/status", headers=headers, json={"status": "completed", "paymentResolution": "waived"})
    assert refused.status_code >= 400
    assert _events(booking["id"], "status_changed") == []


def test_service_price_and_resource_changes_are_audited(client) -> None:
    headers = _auth(client)
    services = client.get(f"{API}/services").json()["services"]
    service = services[0]
    reorder = client.put(f"{API}/services/reorder", headers=headers, json={"orderedIds": [s["id"] for s in reversed(services)]})
    assert reorder.status_code == 200, reorder.json()
    assert _events(action="reorder"), "reordering services should be audited"

    variants = client.put(f"{API}/services/{service['id']}/provider-variants", headers=headers, json={"variants": []})
    assert variants.status_code == 200, variants.json()
    [event] = _events(service["id"], "replace_provider_variants")
    assert event["actor"]

    resources = client.put(f"{API}/services/{service['id']}/resources", headers=headers, json={"resources": []})
    assert resources.status_code == 200, resources.json()
    assert len(_events(service["id"], "replace_resources")) == 1
