from __future__ import annotations

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.catalog import AdTrackingStatusResponse, UpdateMetaConversionsRequest
from app.services.ad_conversions import ad_tracking_status, connect_meta_conversions, disconnect_meta_conversions

router = APIRouter(prefix="/tenants/{tenant_slug}/ad-tracking", tags=["ad-tracking"])


@router.get("", response_model=AdTrackingStatusResponse, summary="Server-side ad conversion status")
async def get_ad_tracking_status(
    tenant_slug: str,
    _: User = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> AdTrackingStatusResponse:
    return await ad_tracking_status(session, tenant_slug)


@router.put("/meta", response_model=AdTrackingStatusResponse, summary="Store the Meta Conversions API token")
async def put_meta_conversions(
    tenant_slug: str,
    payload: UpdateMetaConversionsRequest,
    actor: User = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> AdTrackingStatusResponse:
    return await connect_meta_conversions(session, tenant_slug, payload, actor)


@router.delete("/meta", response_model=AdTrackingStatusResponse, summary="Remove the Meta Conversions API token")
async def delete_meta_conversions(
    tenant_slug: str,
    actor: User = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> AdTrackingStatusResponse:
    return await disconnect_meta_conversions(session, tenant_slug, actor)
