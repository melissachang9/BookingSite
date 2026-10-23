"""Tax collected, read from the numbered sales (never recomputed from today's rates)."""

from __future__ import annotations

from collections import defaultdict

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Location, Sale, SaleLine, Tenant
from app.schemas.reports import TaxKindRow, TaxLocationRow, TaxReportResponse
from app.services.reports.ranges import ReportRange


async def build_tax_report(
    session: AsyncSession,
    tenant: Tenant,
    rng: ReportRange,
    *,
    location_id: str | None = None,
    provider_id: str | None = None,
) -> TaxReportResponse:
    query = (
        select(SaleLine, Sale)
        .join(Sale, Sale.id == SaleLine.sale_id)
        .where(
            Sale.tenant_id == tenant.id,
            Sale.status == "completed",
            Sale.completed_at >= rng.start_utc,
            Sale.completed_at < rng.end_utc,
        )
    )
    if location_id:
        query = query.where(Sale.location_id == location_id)
    if provider_id:
        query = query.where(SaleLine.provider_id == provider_id)

    sale_ids: set[str] = set()
    by_kind: dict[str, list[int]] = defaultdict(lambda: [0, 0])
    by_location: dict[str | None, list[int]] = defaultdict(lambda: [0, 0])
    sales_total = taxable_total = tax_total = 0
    for line, sale in (await session.execute(query)).all():
        value = line.unit_price_cents * line.quantity
        sale_ids.add(sale.id)
        sales_total += value
        tax_total += line.tax_cents
        if line.tax_cents > 0:
            taxable_total += value
        by_kind[line.kind][0] += value
        by_kind[line.kind][1] += line.tax_cents
        by_location[sale.location_id][0] += value
        by_location[sale.location_id][1] += line.tax_cents

    names = {
        loc.id: loc.name
        for loc in (await session.scalars(select(Location).where(Location.tenant_id == tenant.id))).all()
    }
    return TaxReportResponse(
        start_date=rng.start,
        end_date=rng.end,
        sales_count=len(sale_ids),
        sales_cents=sales_total,
        taxable_sales_cents=taxable_total,
        tax_collected_cents=tax_total,
        by_kind=[TaxKindRow(kind=k, sales_cents=v[0], tax_cents=v[1]) for k, v in sorted(by_kind.items())],
        by_location=[
            TaxLocationRow(location_id=k, location_name=names.get(k), sales_cents=v[0], tax_cents=v[1])
            for k, v in sorted(by_location.items(), key=lambda item: -item[1][1])
        ],
    )
