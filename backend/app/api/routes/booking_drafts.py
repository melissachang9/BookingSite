from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.booking_drafts import (
    BookingDraftSummaryResponse,
    CreateBookingDraftRequest,
    UpdateBookingDraftRequest,
)
from app.schemas.forms import FormResponseSummaryResponse, SubmitFormRequirementRequest
from app.services.booking_drafts import confirm_booking_draft, create_booking_draft, get_booking_draft, update_booking_draft
from app.services.booking_forms import submit_booking_form_requirement


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


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/confirm",
    response_model=BookingSummaryResponse,
    summary="Confirm a public booking draft when no deposit is required",
)
async def confirm_booking_draft_route(
    tenant_slug: str,
    booking_draft_id: str,
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await confirm_booking_draft(session, tenant_slug, booking_draft_id)


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/form-requirements/{requirement_id}/submit",
    response_model=FormResponseSummaryResponse,
    summary="Submit a required pre-booking form for a booking draft",
)
async def submit_booking_form_requirement_route(
    tenant_slug: str,
    booking_draft_id: str,
    requirement_id: str,
    payload: SubmitFormRequirementRequest,
    session: AsyncSession = Depends(get_db_session),
) -> FormResponseSummaryResponse:
    return await submit_booking_form_requirement(session, tenant_slug, booking_draft_id, requirement_id, payload)