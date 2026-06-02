from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user
from app.core.http import api_exception
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.customers import CustomerLookupResponse
from app.services.auth import ROLE_PERMISSION_ALLOWLIST
from app.services.customers import lookup_tenant_customers


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

    return await lookup_tenant_customers(session, current_user.tenant_id, search, limit)