from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import get_optional_current_user, require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.booking_drafts import (
    BookingDraftSummaryResponse,
    ConfirmWithPaymentRequest,
    CreateBookingDraftRequest,
    ReleaseBookingDraftRequest,
    UpdateBookingDraftRequest,
)
from app.schemas.forms import FormRequirementResponse, FormResponseSummaryResponse, SubmitFormRequirementRequest
from app.services.booking_drafts import (
    confirm_booking_draft,
    create_booking_draft,
    get_booking_draft,
    release_booking_draft,
    update_booking_draft,
)
from app.services.booking_forms import save_booking_form_requirement_draft, submit_booking_form_requirement
from app.services.staff_booking_drafts import confirm_staff_draft_with_payment, confirm_staff_draft_without_payment


router = APIRouter(tags=["booking-drafts"])


@router.post(
    "/tenants/{tenant_slug}/booking-drafts",
    response_model=BookingDraftSummaryResponse,
    summary="Create a booking draft and slot hold (online, or staff-entered from the calendar)",
)
async def create_booking_draft_route(
    tenant_slug: str,
    payload: CreateBookingDraftRequest,
    current_user: User | None = Depends(get_optional_current_user),
    session: AsyncSession = Depends(get_db_session),
) -> BookingDraftSummaryResponse:
    # Online drafts are anonymous; staff-entered drafts are permission-checked
    # in the service so the rule lives next to the booking logic.
    return await create_booking_draft(session, tenant_slug, payload, current_user)


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
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/confirm-with-payment",
    response_model=BookingSummaryResponse,
    summary="Confirm a held booking after staff record an in-person payment (POS, cash...)",
)
async def confirm_booking_draft_with_payment_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: ConfirmWithPaymentRequest,
    current_user: User = Depends(require_tenant_permission("bookings.collect_payment")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await confirm_staff_draft_with_payment(session, tenant_slug, booking_draft_id, payload, current_user)


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/confirm-without-payment",
    response_model=BookingSummaryResponse,
    summary="Confirm a held booking for a service that takes no deposit (staff-side)",
)
async def confirm_booking_draft_without_payment_route(
    tenant_slug: str,
    booking_draft_id: str,
    current_user: User = Depends(require_tenant_permission("calendar.create_booking")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await confirm_staff_draft_without_payment(session, tenant_slug, booking_draft_id, current_user)


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/release",
    response_model=BookingDraftSummaryResponse,
    summary="Release a held slot without booking it (staff-side)",
)
async def release_booking_draft_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: ReleaseBookingDraftRequest,
    current_user: User = Depends(require_tenant_permission("calendar.create_booking")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingDraftSummaryResponse:
    return await release_booking_draft(session, tenant_slug, booking_draft_id, payload, current_user)


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


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/form-requirements/{requirement_id}/draft",
    response_model=FormRequirementResponse,
    summary="Save a draft response for a booking draft form requirement",
)
async def save_booking_form_requirement_draft_route(
    tenant_slug: str,
    booking_draft_id: str,
    requirement_id: str,
    payload: SubmitFormRequirementRequest,
    session: AsyncSession = Depends(get_db_session),
) -> FormRequirementResponse:
    return await save_booking_form_requirement_draft(session, tenant_slug, booking_draft_id, requirement_id, payload)
