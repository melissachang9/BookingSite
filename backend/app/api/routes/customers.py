from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_current_user, require_tenant_permission
from app.core.http import api_exception
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.customers import CustomerBookingAttempt, CustomerBookingAttemptListResponse, CustomerListResponse, DismissBookingAttemptRequest, MarkBookingAttemptFollowedUpRequest, CustomerLookupResponse, CustomerProfileResponse, UpdateCustomerRequest, UpsertCustomerRequest, UpsertCustomerResponse
from app.schemas.forms import BookingFormResponseListResponse
from app.schemas.catalog import TenantUserListResponse
from app.services.auth import ROLE_PERMISSION_ALLOWLIST
from app.services.booking_forms import list_customer_form_responses
from app.services.customers import create_or_update_customer, dismiss_booking_attempt, get_customer_profile, list_booking_attempts, list_tenant_customers, mark_booking_attempt_followed_up, lookup_tenant_customers, update_customer
from app.services.audit import record_audit
from app.services.tenants import list_tenant_users


router = APIRouter(tags=["customers"])


@router.get(
    "/customers",
    response_model=CustomerLookupResponse,
    summary="Lookup customers for the authenticated tenant",
)
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


@router.post(
    "/customers",
    response_model=UpsertCustomerResponse,
    summary="Create or update a customer for the authenticated tenant",
)
async def create_or_update_customer_route(
    payload: UpsertCustomerRequest,
    current_user: User = Depends(get_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> UpsertCustomerResponse:
    if "customers.manage" not in ROLE_PERMISSION_ALLOWLIST.get(current_user.role, set()):
        raise api_exception(403, "forbidden", "You do not have permission to manage customers.")

    return await create_or_update_customer(session, payload, current_user.tenant_id)


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
    "/tenants/{tenant_slug}/customers/owner-candidates",
    response_model=TenantUserListResponse,
    summary="List tenant users available for customer owner assignment",
)
async def list_owner_candidates(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("customers.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantUserListResponse:
    return await list_tenant_users(session, tenant_slug)


@router.get(
    "/tenants/{tenant_slug}/booking-attempts",
    response_model=CustomerBookingAttemptListResponse,
    summary="Clients who opened financing or left checkout without booking, for follow-up",
)
async def list_booking_attempts_route(
    tenant_slug: str,
    outcome: str | None = Query(default=None, pattern="^(financing_started|abandoned)$"),
    include_followed_up: bool = Query(default=False, alias="includeFollowedUp"),
    _: object = Depends(require_tenant_permission("customers.view")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerBookingAttemptListResponse:
    items = await list_booking_attempts(session, tenant_slug, outcome=outcome, include_followed_up=include_followed_up)
    return CustomerBookingAttemptListResponse(items=items)


@router.post(
    "/tenants/{tenant_slug}/booking-attempts/{booking_draft_id}/follow-up",
    response_model=CustomerBookingAttempt,
    summary="Mark an unfinished booking as followed up",
)
async def mark_booking_attempt_followed_up_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: MarkBookingAttemptFollowedUpRequest,
    actor: User = Depends(require_tenant_permission("customers.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerBookingAttempt:
    return await mark_booking_attempt_followed_up(session, tenant_slug, booking_draft_id, payload.note, actor)


@router.post(
    "/tenants/{tenant_slug}/booking-attempts/{booking_draft_id}/dismiss",
    response_model=CustomerBookingAttempt,
    summary="Remove an unfinished booking from the follow-up list, with a reason",
)
async def dismiss_booking_attempt_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: DismissBookingAttemptRequest,
    actor: User = Depends(require_tenant_permission("customers.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerBookingAttempt:
    return await dismiss_booking_attempt(session, tenant_slug, booking_draft_id, payload.reason, payload.note, actor)


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


@router.patch(
    "/tenants/{tenant_slug}/customers/{customer_id}",
    response_model=CustomerProfileResponse,
    summary="Update a customer's details, notes, or owner assignment",
)
async def update_customer_route(
    tenant_slug: str,
    customer_id: str,
    payload: UpdateCustomerRequest,
    actor: User = Depends(require_tenant_permission("customers.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> CustomerProfileResponse:
    result = await update_customer(session, tenant_slug, customer_id, payload, actor)
    await record_audit(session, tenant_id=result.customer.tenant_id, entity_type="customer", entity_id=customer_id, action="update", actor=actor)
    return result


@router.get(
    "/tenants/{tenant_slug}/customers/{customer_id}/form-responses",
    response_model=BookingFormResponseListResponse,
    summary="List submitted form responses for a customer",
)
async def list_customer_form_responses_route(
    tenant_slug: str,
    customer_id: str,
    _: object = Depends(require_tenant_permission("customers.view")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingFormResponseListResponse:
    return await list_customer_form_responses(session, tenant_slug, customer_id)
