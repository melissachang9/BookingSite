"""Marketing spend (the cost side of CAC): entry, audit, tenant scoping and the per-channel report."""

from __future__ import annotations

from datetime import date, timedelta

from test_attribution import _draft_with, _setup
from test_provider_terms_and_resources import API, _auth, _confirm

MARKETING = f"{API}/marketing"


def _spend(client, headers, **overrides):
    today = date.today()
    body = {
        "channel": "Instagram",
        "campaign": "spring-glow",
        "periodStart": today.isoformat(),
        "periodEnd": today.isoformat(),
        "amountCents": 30000,
        **overrides,
    }
    return client.post(f"{MARKETING}/spend", headers=headers, json=body)


def test_spend_is_recorded_listed_and_removed_with_an_audit_trail(client) -> None:
    headers = _auth(client)
    created = _spend(client, headers)
    assert created.status_code == 201, created.json()
    entry = created.json()
    # Channels are stored lowercase so they line up with a customer's first-touch source.
    assert (entry["channel"], entry["amountCents"], entry["sourceSystem"]) == ("instagram", 30000, "manual")

    listed = client.get(f"{MARKETING}/spend", headers=headers).json()["items"]
    assert [item["id"] for item in listed] == [entry["id"]]

    assert client.delete(f"{MARKETING}/spend/{entry['id']}", headers=headers).status_code == 204
    assert client.get(f"{MARKETING}/spend", headers=headers).json()["items"] == []
    assert client.delete(f"{MARKETING}/spend/{entry['id']}", headers=headers).status_code == 404

    audit = _audit_actions(entry["id"])
    assert audit == ["create", "remove"]


def _audit_actions(entity_id: str) -> list[str]:
    import asyncio

    from sqlalchemy import select

    from app.db.models import AuditEvent
    from app.db.session import get_session_maker

    async def _run() -> list[str]:
        async with get_session_maker()() as session:
            rows = await session.scalars(
                select(AuditEvent).where(AuditEvent.entity_id == entity_id).order_by(AuditEvent.created_at.asc())
            )
            return [row.action for row in rows]

    return asyncio.run(_run())


def test_spend_is_validated(client) -> None:
    headers = _auth(client)
    today = date.today()
    backwards = _spend(client, headers, periodStart=today.isoformat(), periodEnd=(today - timedelta(days=1)).isoformat())
    assert backwards.status_code == 422
    assert _spend(client, headers, amountCents=-1).status_code == 422
    assert _spend(client, headers, channel="   ").status_code == 422


def test_spend_requires_a_signed_in_user_with_permission(client) -> None:
    assert client.get(f"{MARKETING}/spend").status_code in (401, 403)
    assert client.post(f"{MARKETING}/spend", json={}).status_code in (401, 403)


def test_report_divides_channel_spend_by_new_clients_from_that_channel(client) -> None:
    headers, service, slots = _setup(client)
    draft = _draft_with(client, service["id"], slots[0], {"source": "instagram", "medium": "paid"})
    assert draft.status_code in (200, 201), draft.json()
    _confirm(client, draft.json()["id"], "cac-guest@example.com")
    # Money on a channel that won nobody has spend but no CAC.
    assert _spend(client, headers, channel="google", amountCents=5000).status_code == 201
    assert _spend(client, headers, channel="instagram", amountCents=30000).status_code == 201

    today = date.today()
    report = client.get(
        f"{MARKETING}/report",
        headers=headers,
        params={"from": today.isoformat(), "to": (today + timedelta(days=14)).isoformat()},
    )
    assert report.status_code == 200, report.json()
    body = report.json()
    rows = {row["channel"]: row for row in body["channels"]}
    assert rows["instagram"]["spendCents"] == 30000
    assert rows["instagram"]["newClients"] == 1
    assert rows["instagram"]["cacCents"] == 30000
    assert rows["google"]["newClients"] == 0
    assert rows["google"]["cacCents"] is None
    assert body["totalSpendCents"] == 35000
    assert body["blendedCacCents"] == 35000 // max(body["totalNewClients"], 1)


def test_another_tenants_spend_is_invisible_and_cannot_be_removed(client) -> None:
    import asyncio

    from app.db.models import MarketingSpend, Tenant
    from app.db.session import get_session_maker

    async def _foreign_entry() -> str:
        async with get_session_maker()() as session:
            tenant = Tenant(slug="spend-other", name="Other", timezone="America/New_York", branding_json={}, settings_json={})
            session.add(tenant)
            await session.flush()
            entry = MarketingSpend(
                tenant_id=tenant.id, channel="google", period_start=date.today(), period_end=date.today(), amount_cents=999
            )
            session.add(entry)
            await session.commit()
            return entry.id

    foreign_id = asyncio.run(_foreign_entry())
    headers = _auth(client)
    assert client.get(f"{MARKETING}/spend", headers=headers).json()["items"] == []
    assert client.delete(f"{MARKETING}/spend/{foreign_id}", headers=headers).status_code == 404
