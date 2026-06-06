from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user, require_tenant_permission
from app.core.http import api_exception
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.customers import CustomerListResponse, CustomerLookupResponse, CustomerProfileResponse
from app.services.auth import ROLE_PERMISSION_ALLOWLIST
from app.services.customers import get_customer_profile, list_tenant_customers, lookup_tenant_customers


router = APIRouter(prefix="/customers", tags=["customers"])


@router.get("", response_model=CustomerLookupResponse, summary="Lookup customers for the authenticated tenant")
async def lookup_customers(
    search: str = Query(..., min_length=1),
    limit: int = Query(8, ge=1, le=20),
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerLookupResponse:
    if "customers.view" not in ROLE_PERMISSION_ALLOWLIST.get(current_user.role, set()):
        raise api_exception(403, "forbidden", "You do not have permission to view customers.")

    return await lookup_tenant_customers(
        session,
        current_user.tenant_id,
        search,
        limit,
        current_user_id=current_user.id,
        current_user_role=current_user.role,
    )


@router.get(
    "/tenants/{tenant_slug}/customers",
    response_model=CustomerListResponse,
    summary="List all customers for a tenant",
)
async def list_customers(
    tenant_slug: str,
    search: str | None = Query(default=None),
    limit: int = Query(default=50, ge=1, le=200),
    offset: int = Query(default=0, ge=0),
    _: object = Depends(require_tenant_permission("customers.view")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerListResponse:
    return await list_tenant_customers(session, tenant_slug, search=search, limit=limit, offset=offset)


@router.get(
    "/tenants/{tenant_slug}/customers/{customer_id}",
    response_model=CustomerProfileResponse,
    summary="Get a customer profile with booking history",
)
async def get_customer(
    tenant_slug: str,
    customer_id: str,
    _: object = Depends(require_tenant_permission("customers.view")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerProfileResponse:
    return await get_customer_profile(session, tenant_slug, customer_id)