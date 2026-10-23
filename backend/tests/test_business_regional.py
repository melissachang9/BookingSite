import asyncio

from tests.test_booking_operations import _auth_headers, _create_other_tenant_owner

TENANT = "brow-beauty-lab"
URL = f"/api/v1/tenants/{TENANT}/business"


def _audit(entity_id: str, action: str) -> list[dict]:
    async def _go():
        from sqlalchemy import select

        from app.db.models import AuditEvent
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            rows = (
                await session.scalars(
                    select(AuditEvent).where(AuditEvent.entity_id == entity_id, AuditEvent.action == action)
                )
            ).all()
            return [{"actor": r.actor_id, "changes": r.changes_json} for r in rows]

    return asyncio.run(_go())


def _connect_processor(tenant_id: str, currency: str = "USD") -> None:
    async def _go():
        from app.db.models import ProcessorConnection
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            session.add(
                ProcessorConnection(
                    tenant_id=tenant_id,
                    processor="clover",
                    environment="sandbox",
                    auth_mode="api_keys",
                    merchant_id="M-TEST",
                    merchant_currency=currency,
                    status="connected",
                )
            )
            await session.commit()

    asyncio.run(_go())


def test_owner_can_change_the_timezone_and_it_is_audited(client) -> None:
    headers = _auth_headers(client)
    before = client.get(f"/api/v1/tenants/{TENANT}", headers=headers).json()
    response = client.patch(URL, headers=headers, json={"timezone": "America/Vancouver"})
    assert response.status_code == 200, response.json()
    assert response.json()["timezone"] == "America/Vancouver"

    audits = _audit(before["id"], "update_business_regional")
    assert len(audits) == 1
    assert audits[0]["changes"]["timezone"] == {"from": before["timezone"], "to": "America/Vancouver"}
    assert audits[0]["actor"]  # who made the change is recorded


def test_unchanged_timezone_writes_no_audit_row(client) -> None:
    headers = _auth_headers(client)
    current = client.get(f"/api/v1/tenants/{TENANT}", headers=headers).json()
    response = client.patch(URL, headers=headers, json={"timezone": current["timezone"]})
    assert response.status_code == 200
    assert _audit(current["id"], "update_business_regional") == []


def test_invalid_timezone_is_rejected(client) -> None:
    headers = _auth_headers(client)
    for bad in ("Mars/Olympus", "not a zone", ""):
        assert client.patch(URL, headers=headers, json={"timezone": bad}).status_code == 422, bad


def test_currency_change_is_audited_with_old_and_new_value(client) -> None:
    headers = _auth_headers(client)
    before = client.get(f"/api/v1/tenants/{TENANT}", headers=headers).json()
    target = "CAD" if before["settings"]["currency"] != "CAD" else "USD"
    response = client.patch(URL, headers=headers, json={"currency": target})
    assert response.status_code == 200, response.json()
    assert response.json()["settings"]["currency"] == target
    audits = _audit(before["id"], "update_business_regional")
    assert audits[0]["changes"]["currency"] == {"from": before["settings"]["currency"], "to": target}


def test_currency_change_with_a_connected_processor_is_allowed_and_flagged_as_a_mismatch(client) -> None:
    headers = _auth_headers(client)
    tenant = client.get(f"/api/v1/tenants/{TENANT}", headers=headers).json()
    _connect_processor(tenant["id"], currency=tenant["settings"]["currency"])

    other = "CAD" if tenant["settings"]["currency"] != "CAD" else "USD"
    changed = client.patch(URL, headers=headers, json={"currency": other})
    assert changed.status_code == 200, changed.json()
    assert changed.json()["settings"]["currency"] == other

    capabilities = client.get(f"{URL.replace('/business', '')}/payments/capabilities", headers=headers).json()
    assert capabilities["currencyMismatch"] is True
    assert capabilities["canChargeCards"] is False  # card features switch off until currencies agree


def test_regional_settings_need_permission_and_stay_in_their_tenant(client) -> None:
    assert client.patch(URL, json={"timezone": "America/Vancouver"}).status_code in (401, 403)
    other_email, other_password = _create_other_tenant_owner(client)
    other = _auth_headers(client, other_email, other_password)
    assert client.patch(URL, headers=other, json={"timezone": "America/Vancouver"}).status_code in (403, 404)
    assert client.get(f"/api/v1/tenants/{TENANT}").json()["timezone"] != "America/Vancouver"
