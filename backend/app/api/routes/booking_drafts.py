from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.booking_drafts import (
    BookingDraftSummaryResponse,
    CreateBookingDraftRequest,
    UpdateBookingDraftRequest,
)
from app.services.booking_drafts import create_booking_draft, get_booking_draft, update_booking_draft


router = APIRouter(tags=["booking-drafts"])


@router.post(
    "/tenants/{tenant_slug}/booking-drafts",
    response_model=BookingDraftSummaryResponse,
    summary="Create a public booking draft and slot hold",
)
async def create_booking_draft_route(
    tenant_slug: str,
    payload: CreateBookingDraftRequest,
    session: AsyncSession = Depends(get_db_session),
) -> BookingDraftSummaryResponse:
    return await create_booking_draft(session, tenant_slug, payload)


@router.get(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}",
    response_model=BookingDraftSummaryResponse,
    summary="Get a booking draft",
)
async def get_booking_draft_route(
    tenant_slug: str,
    booking_draft_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> BookingDraftSummaryResponse:
    return await get_booking_draft(session, tenant_slug, booking_draft_id)


@router.patch(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}",
    response_model=BookingDraftSummaryResponse,
    summary="Update customer details on a booking draft",
)
async def update_booking_draft_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: UpdateBookingDraftRequest,
    session: AsyncSession = Depends(get_db_session),
) -> BookingDraftSummaryResponse:
    return await update_booking_draft(session, tenant_slug, booking_draft_id, payload)