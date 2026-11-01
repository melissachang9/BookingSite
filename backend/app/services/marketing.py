"""Marketing spend entries and the acquisition-cost report built from them."""

from __future__ import annotations

from datetime import date, datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import FunnelEvent, MarketingSpend, User
from app.schemas.marketing import (
    CreateMarketingSpendRequest,
    FunnelSourceRow,
    MarketingChannelRow,
    MarketingReportResponse,
    MarketingSpendListResponse,
    MarketingSpendResponse,
)
from app.services.audit import record_audit
from app.services.reports.clients import build_clients_report
from app.services.reports.ranges import ReportRange
from app.services.tenants import get_tenant_by_slug


def normalize_channel(value: str) -> str:
    """Channels are matched to a customer's first-touch source, which is stored lowercase."""
    return " ".join(value.strip().lower().split())


def _label(channel: str) -> str:
    return channel.replace("_", " ").replace("-", " ").capitalize()


def _response(entry: MarketingSpend, creator_name: str | None) -> MarketingSpendResponse:
    return MarketingSpendResponse(
        id=entry.id,
        channel=entry.channel,
        campaign=entry.campaign,
        period_start=entry.period_start,
        period_end=entry.period_end,
        amount_cents=entry.amount_cents,
        note=entry.note,
        source_system=entry.source_system,
        created_by_name=creator_name,
        created_at=entry.created_at,
    )


async def list_marketing_spend(
    session: AsyncSession, tenant_slug: str, start: date | None, end: date | None
) -> MarketingSpendListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    query = (
        select(MarketingSpend, User.name)
        .outerjoin(User, User.id == MarketingSpend.created_by_user_id)
        .where(MarketingSpend.tenant_id == tenant.id, MarketingSpend.removed_at.is_(None))
        .order_by(MarketingSpend.period_start.desc(), MarketingSpend.created_at.desc())
    )
    if start is not None:
        query = query.where(MarketingSpend.period_start >= start)
    if end is not None:
        query = query.where(MarketingSpend.period_start <= end)
    rows = (await session.execute(query)).all()
    return MarketingSpendListResponse(items=[_response(entry, name) for entry, name in rows])


async def create_marketing_spend(
    session: AsyncSession, tenant_slug: str, payload: CreateMarketingSpendRequest, actor: User
) -> MarketingSpendResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    channel = normalize_channel(payload.channel)
    if not channel:
        raise api_exception(422, "validation_error", "Choose the channel the money was spent on.")
    if payload.period_end < payload.period_start:
        raise api_exception(422, "validation_error", "The end date must be on or after the start date.")
    entry = MarketingSpend(
        tenant_id=tenant.id,
        channel=channel,
        campaign=payload.campaign.strip() if payload.campaign and payload.campaign.strip() else None,
        period_start=payload.period_start,
        period_end=payload.period_end,
        amount_cents=payload.amount_cents,
        note=payload.note.strip() if payload.note and payload.note.strip() else None,
        created_by_user_id=actor.id,
    )
    session.add(entry)
    await session.flush()
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="marketing_spend",
        entity_id=entry.id,
        action="create",
        actor=actor,
        notes=f"{channel}: {payload.amount_cents} cents",
    )
    await session.commit()
    return _response(entry, actor.name)


async def remove_marketing_spend(session: AsyncSession, tenant_slug: str, spend_id: str, actor: User) -> None:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    entry = await session.scalar(
        select(MarketingSpend).where(
            MarketingSpend.tenant_id == tenant.id,
            MarketingSpend.id == spend_id,
            MarketingSpend.removed_at.is_(None),
        )
    )
    if entry is None:
        raise api_exception(404, "not_found", "Spend entry was not found for this tenant.")
    entry.removed_at = datetime.now(timezone.utc)
    entry.removed_by_user_id = actor.id
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="marketing_spend",
        entity_id=entry.id,
        action="remove",
        actor=actor,
        notes=f"{entry.channel}: {entry.amount_cents} cents",
    )
    await session.commit()


async def _funnel_by_source(session: AsyncSession, tenant, rng: ReportRange) -> list[FunnelSourceRow]:
    """Online carts started in the range, grouped by where the visitor came from, and how many got each step."""
    started = (
        await session.execute(
            select(FunnelEvent.booking_draft_id, FunnelEvent.utm_source).where(
                FunnelEvent.tenant_id == tenant.id,
                FunnelEvent.kind == "booking_started",
                FunnelEvent.booking_method == "public_online",
                FunnelEvent.occurred_at >= rng.start_utc,
                FunnelEvent.occurred_at < rng.end_utc,
            )
        )
    ).all()
    source_of = {draft_id: (source or "direct") for draft_id, source in started}
    if not source_of:
        return []
    reached: dict[str, set[str]] = {}
    for draft_id, kind in (
        await session.execute(
            select(FunnelEvent.booking_draft_id, FunnelEvent.kind).where(
                FunnelEvent.tenant_id == tenant.id,
                FunnelEvent.booking_draft_id.in_(list(source_of)),
            )
        )
    ).all():
        reached.setdefault(kind, set()).add(draft_id)

    rows: dict[str, dict[str, int]] = {}
    for draft_id, source in source_of.items():
        row = rows.setdefault(source, {"started": 0, "contact": 0, "checkout": 0, "confirmed": 0})
        row["started"] += 1
        row["contact"] += draft_id in reached.get("contact_details_saved", set())
        row["checkout"] += draft_id in reached.get("checkout_session_started", set())
        row["confirmed"] += draft_id in reached.get("booking_confirmed", set())
    return [
        FunnelSourceRow(
            source=source,
            label=_label(source),
            started=row["started"],
            contact_saved=row["contact"],
            checkout_started=row["checkout"],
            confirmed=row["confirmed"],
            conversion=row["confirmed"] / row["started"] if row["started"] else None,
        )
        for source, row in sorted(rows.items(), key=lambda item: (-item[1]["started"], item[0]))
    ]


async def build_marketing_report(session: AsyncSession, tenant, rng: ReportRange) -> MarketingReportResponse:
    """Spend and new clients per channel. An entry counts toward the range its period starts in, so a
    month of spend is never split across two reports."""
    spend_rows = (
        await session.scalars(
            select(MarketingSpend).where(
                MarketingSpend.tenant_id == tenant.id,
                MarketingSpend.removed_at.is_(None),
                MarketingSpend.period_start >= rng.start,
                MarketingSpend.period_start <= rng.end,
            )
        )
    ).all()
    spend: dict[str, int] = {}
    for entry in spend_rows:
        spend[entry.channel] = spend.get(entry.channel, 0) + entry.amount_cents

    clients = await build_clients_report(session, tenant, rng, include_financial=False)
    new_clients = {row.key: row.count for row in clients.sources}

    channels = []
    for channel in sorted(set(spend) | set(new_clients), key=lambda key: (-spend.get(key, 0), key)):
        won = new_clients.get(channel, 0)
        cost = spend.get(channel, 0)
        channels.append(
            MarketingChannelRow(
                channel=channel,
                label=_label(channel),
                spend_cents=cost,
                new_clients=won,
                cac_cents=round(cost / won) if won and cost else None,
            )
        )
    funnel = await _funnel_by_source(session, tenant, rng)
    total_spend = sum(spend.values())
    total_new = clients.summary.new_clients
    return MarketingReportResponse(
        range=rng.to_response(),
        channels=channels,
        total_spend_cents=total_spend,
        total_new_clients=total_new,
        blended_cac_cents=round(total_spend / total_new) if total_new and total_spend else None,
        funnel=funnel,
    )
