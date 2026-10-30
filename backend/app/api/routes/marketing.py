from __future__ import annotations

from datetime import date

from fastapi import APIRouter, Depends, Query, Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.marketing import (
    CreateMarketingSpendRequest,
    MarketingReportResponse,
    MarketingSpendListResponse,
    MarketingSpendResponse,
)
from app.services.marketing import (
    build_marketing_report,
    create_marketing_spend,
    list_marketing_spend,
    remove_marketing_spend,
)
from app.services.reports.ranges import build_range
from app.services.tenants import get_tenant_by_slug

router = APIRouter(prefix="/tenants/{tenant_slug}/marketing", tags=["marketing"])


@router.get("/spend", response_model=MarketingSpendListResponse, summary="List marketing spend entries")
async def list_spend(
    tenant_slug: str,
    start_date: date | None = Query(default=None, alias="from"),
    end_date: date | None = Query(default=None, alias="to"),
    _: User = Depends(require_tenant_permission("reports.financial")),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingSpendListResponse:
    return await list_marketing_spend(session, tenant_slug, start_date, end_date)


@router.post("/spend", response_model=MarketingSpendResponse, status_code=201, summary="Record marketing spend")
async def create_spend(
    tenant_slug: str,
    payload: CreateMarketingSpendRequest,
    actor: User = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingSpendResponse:
    return await create_marketing_spend(session, tenant_slug, payload, actor)


@router.delete("/spend/{spend_id}", status_code=204, summary="Remove a spend entry (kept in the audit trail)")
async def remove_spend(
    tenant_slug: str,
    spend_id: str,
    actor: User = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    await remove_marketing_spend(session, tenant_slug, spend_id, actor)
    return Response(status_code=204)


@router.get("/report", response_model=MarketingReportResponse, summary="Spend, new clients and CAC by channel")
async def marketing_report(
    tenant_slug: str,
    start_date: date = Query(alias="from"),
    end_date: date = Query(alias="to"),
    _: User = Depends(require_tenant_permission("reports.financial")),
    session: AsyncSession = Depends(get_db_session),
) -> MarketingReportResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return await build_marketing_report(session, tenant, build_range(tenant, start_date, end_date))
