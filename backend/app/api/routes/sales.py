from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.sales import (
    EmailReceiptRequest,
    EmailReceiptResponse,
    SaleListResponse,
    SaleReceiptResponse,
    WalletHistoryResponse,
)
from app.services.receipts import email_receipt, get_receipt, list_sales, wallet_history
from app.services.tenants import get_tenant_by_slug

router = APIRouter(tags=["sales"])


@router.get(
    "/tenants/{tenant_slug}/sales",
    response_model=SaleListResponse,
    summary="List numbered sales, newest first",
)
async def list_sales_route(
    tenant_slug: str,
    customer_id: str | None = Query(default=None, alias="customerId"),
    occurred_from: datetime | None = Query(default=None, alias="occurredFrom"),
    occurred_to: datetime | None = Query(default=None, alias="occurredTo"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: object = Depends(require_tenant_permission("payments.view")),
    session: AsyncSession = Depends(get_db_session),
) -> SaleListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return await list_sales(
        session, tenant, customer_id=customer_id, start=occurred_from, end=occurred_to, limit=limit, offset=offset
    )


@router.get(
    "/tenants/{tenant_slug}/sales/{sale_id}/receipt",
    response_model=SaleReceiptResponse,
    summary="A printable receipt for a sale",
)
async def get_receipt_route(
    tenant_slug: str,
    sale_id: str,
    _: object = Depends(require_tenant_permission("payments.view")),
    session: AsyncSession = Depends(get_db_session),
) -> SaleReceiptResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return await get_receipt(session, tenant, sale_id)


@router.post(
    "/tenants/{tenant_slug}/sales/{sale_id}/receipt/email",
    response_model=EmailReceiptResponse,
    summary="Email a sale's receipt to the client",
)
async def email_receipt_route(
    tenant_slug: str,
    sale_id: str,
    payload: EmailReceiptRequest,
    actor: User = Depends(require_tenant_permission("payments.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> EmailReceiptResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return await email_receipt(session, tenant, sale_id, email=payload.email, actor=actor)


@router.get(
    "/tenants/{tenant_slug}/customers/{customer_id}/wallet",
    response_model=WalletHistoryResponse,
    summary="A client's wallet balance and its history",
)
async def wallet_history_route(
    tenant_slug: str,
    customer_id: str,
    _: object = Depends(require_tenant_permission("customers.view")),
    session: AsyncSession = Depends(get_db_session),
) -> WalletHistoryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return await wallet_history(session, tenant, customer_id)
