from __future__ import annotations

from datetime import datetime

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.bookings import (
    BookingListResponse,
    BookingSummaryResponse,
    CancelManageBookingRequest,
    CustomerManageBookingResponse,
    UpdateBookingStatusRequest,
)
from app.schemas.forms import BookingFormResponseListResponse
from app.schemas.payments import RecordManualPaymentRequest
from app.services.booking_drafts import cancel_manage_booking, get_booking, get_manage_booking
from app.services.booking_forms import list_booking_form_responses
from app.services.bookings import list_bookings, record_manual_payment, update_booking_status


router = APIRouter(tags=["bookings"])


@router.get(
    "/tenants/{tenant_slug}/bookings",
    response_model=BookingListResponse,
    summary="List tenant bookings for operator workflows",
)
async def list_bookings_route(
    tenant_slug: str,
    status: str | None = Query(default=None),
    starts_at_gte: datetime | None = Query(default=None, alias="startsAtGte"),
    starts_at_lte: datetime | None = Query(default=None, alias="startsAtLte"),
    provider_id: str | None = Query(default=None, alias="providerId"),
    customer_id: str | None = Query(default=None, alias="customerId"),
    location_id: str | None = Query(default=None, alias="locationId"),
    limit: int = Query(default=25, ge=1, le=100),
    offset: int = Query(default=0, ge=0),
    _: object = Depends(require_tenant_permission("bookings.view")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingListResponse:
    status_filters = [entry.strip() for entry in status.split(",") if entry.strip()] if status else None
    return await list_bookings(
        session,
        tenant_slug,
        status_filters=status_filters,
        starts_at_gte=starts_at_gte,
        starts_at_lte=starts_at_lte,
        provider_id=provider_id,
        customer_id=customer_id,
        location_id=location_id,
        limit=limit,
        offset=offset,
    )


@router.get(
    "/bookings/manage/{token}",
    response_model=CustomerManageBookingResponse,
    summary="Get a customer manage-booking view",
)
async def get_manage_booking_route(
    token: str,
    session: AsyncSession = Depends(get_db_session),
) -> CustomerManageBookingResponse:
    return await get_manage_booking(session, token)


@router.post(
    "/bookings/manage/{token}/cancel",
    response_model=CustomerManageBookingResponse,
    summary="Cancel a booking from a customer manage link",
)
async def cancel_manage_booking_route(
    token: str,
    payload: CancelManageBookingRequest,
    session: AsyncSession = Depends(get_db_session),
) -> CustomerManageBookingResponse:
    return await cancel_manage_booking(session, token, payload)


@router.get(
    "/tenants/{tenant_slug}/bookings/{booking_id}",
    response_model=BookingSummaryResponse,
    summary="Get a confirmed booking",
)
async def get_booking_route(
    tenant_slug: str,
    booking_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await get_booking(session, tenant_slug, booking_id)


@router.post(
    "/tenants/{tenant_slug}/bookings/{booking_id}/payments/manual",
    response_model=BookingSummaryResponse,
    summary="Record an operator-collected booking balance",
)
async def record_manual_payment_route(
    tenant_slug: str,
    booking_id: str,
    payload: RecordManualPaymentRequest,
    current_user: User = Depends(require_tenant_permission("bookings.collect_payment")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await record_manual_payment(session, tenant_slug, booking_id, payload, current_user)


@router.post(
    "/tenants/{tenant_slug}/bookings/{booking_id}/status",
    response_model=BookingSummaryResponse,
    summary="Finalize a confirmed booking as completed or no-show",
)
async def update_booking_status_route(
    tenant_slug: str,
    booking_id: str,
    payload: UpdateBookingStatusRequest,
    current_user: User = Depends(require_tenant_permission("bookings.complete")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await update_booking_status(session, tenant_slug, booking_id, payload, current_user)


@router.get(
    "/tenants/{tenant_slug}/bookings/{booking_id}/form-responses",
    response_model=BookingFormResponseListResponse,
    summary="List submitted form responses for a confirmed booking",
)
async def list_booking_form_responses_route(
    tenant_slug: str,
    booking_id: str,
    _: object = Depends(require_tenant_permission("bookings.view")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingFormResponseListResponse:
    return await list_booking_form_responses(session, tenant_slug, booking_id)