from __future__ import annotations

from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.payments import (
    CloverApiKeysRequest,
    CloverAuthorizeUrlResponse,
    CloverDevicePaymentListResponse,
    CloverOAuthCompleteRequest,
    ConfirmWithCloverPaymentRequest,
    PaymentCapabilitiesResponse,
    PublicPaymentConfigResponse,
    RecordCloverDevicePaymentRequest,
)
from app.services.clover_payments import (
    confirm_staff_draft_with_clover_payment,
    list_recent_device_payments,
    record_clover_device_payment_for_booking,
    record_clover_device_refund,
)
from app.services.clover_connections import (
    complete_clover_oauth,
    connect_clover_with_api_keys,
    disconnect_clover,
    get_authorize_url,
    get_payment_capabilities,
    get_public_payment_config,
)

router = APIRouter(tags=["payment-processors"])


@router.get(
    "/tenants/{tenant_slug}/payments/capabilities",
    response_model=PaymentCapabilitiesResponse,
    summary="What card payment features this business can use right now",
)
async def get_payment_capabilities_route(
    tenant_slug: str,
    _: User = Depends(require_tenant_permission("calendar.view")),
    session: AsyncSession = Depends(get_db_session),
) -> PaymentCapabilitiesResponse:
    return await get_payment_capabilities(session, tenant_slug)


@router.get(
    "/tenants/{tenant_slug}/payments/public-config",
    response_model=PublicPaymentConfigResponse,
    summary="Public settings the card form needs (merchant id and public key only)",
)
async def get_public_payment_config_route(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> PublicPaymentConfigResponse:
    return await get_public_payment_config(session, tenant_slug)


@router.get(
    "/tenants/{tenant_slug}/payments/clover/authorize-url",
    response_model=CloverAuthorizeUrlResponse,
    summary="Start connecting a Clover account (owner only)",
)
async def get_clover_authorize_url_route(
    tenant_slug: str,
    current_user: User = Depends(require_tenant_permission("payments.configure")),
    session: AsyncSession = Depends(get_db_session),
) -> CloverAuthorizeUrlResponse:
    return await get_authorize_url(session, tenant_slug, current_user)


@router.post(
    "/tenants/{tenant_slug}/payments/clover/oauth/complete",
    response_model=PaymentCapabilitiesResponse,
    summary="Finish connecting a Clover account after the owner approves access",
)
async def complete_clover_oauth_route(
    tenant_slug: str,
    payload: CloverOAuthCompleteRequest,
    current_user: User = Depends(require_tenant_permission("payments.configure")),
    session: AsyncSession = Depends(get_db_session),
) -> PaymentCapabilitiesResponse:
    return await complete_clover_oauth(session, tenant_slug, current_user, payload)


@router.post(
    "/tenants/{tenant_slug}/payments/clover/api-keys",
    response_model=PaymentCapabilitiesResponse,
    summary="Connect Clover with keys from the merchant's own Clover dashboard",
)
async def connect_clover_api_keys_route(
    tenant_slug: str,
    payload: CloverApiKeysRequest,
    current_user: User = Depends(require_tenant_permission("payments.configure")),
    session: AsyncSession = Depends(get_db_session),
) -> PaymentCapabilitiesResponse:
    return await connect_clover_with_api_keys(session, tenant_slug, current_user, payload)


@router.post(
    "/tenants/{tenant_slug}/payments/clover/disconnect",
    response_model=PaymentCapabilitiesResponse,
    summary="Disconnect Clover and wipe its stored credentials",
)
async def disconnect_clover_route(
    tenant_slug: str,
    current_user: User = Depends(require_tenant_permission("payments.configure")),
    session: AsyncSession = Depends(get_db_session),
) -> PaymentCapabilitiesResponse:
    return await disconnect_clover(session, tenant_slug, current_user)


# ---------------------------------------------------------------------------
# Payments taken on the Clover device
# ---------------------------------------------------------------------------


@router.get(
    "/tenants/{tenant_slug}/payments/clover/device-payments",
    response_model=CloverDevicePaymentListResponse,
    summary="Recent payments taken on the Clover device that aren't linked to a booking yet",
)
async def list_clover_device_payments_route(
    tenant_slug: str,
    since_minutes: int = Query(default=60, alias="sinceMinutes", ge=5, le=720),
    booking_draft_id: str | None = Query(default=None, alias="bookingDraftId"),
    booking_id: str | None = Query(default=None, alias="bookingId"),
    _: User = Depends(require_tenant_permission("bookings.collect_payment")),
    session: AsyncSession = Depends(get_db_session),
) -> CloverDevicePaymentListResponse:
    return await list_recent_device_payments(
        session,
        tenant_slug,
        since_minutes=since_minutes,
        booking_draft_id=booking_draft_id,
        booking_id=booking_id,
    )


@router.post(
    "/tenants/{tenant_slug}/booking-drafts/{booking_draft_id}/confirm-with-clover-payment",
    response_model=BookingSummaryResponse,
    summary="Confirm a held booking with a payment taken on the Clover device",
)
async def confirm_with_clover_payment_route(
    tenant_slug: str,
    booking_draft_id: str,
    payload: ConfirmWithCloverPaymentRequest,
    current_user: User = Depends(require_tenant_permission("bookings.collect_payment")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await confirm_staff_draft_with_clover_payment(session, tenant_slug, booking_draft_id, payload, current_user)


@router.post(
    "/tenants/{tenant_slug}/bookings/{booking_id}/payments/clover-device",
    response_model=BookingSummaryResponse,
    summary="Record a Clover device payment against a booking's balance",
)
async def record_clover_device_payment_route(
    tenant_slug: str,
    booking_id: str,
    payload: RecordCloverDevicePaymentRequest,
    current_user: User = Depends(require_tenant_permission("bookings.collect_payment")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await record_clover_device_payment_for_booking(session, tenant_slug, booking_id, payload, current_user)


@router.post(
    "/tenants/{tenant_slug}/bookings/{booking_id}/payments/{payment_id}/record-clover-refund",
    response_model=BookingSummaryResponse,
    summary="Record a refund that staff already made on the Clover device",
)
async def record_clover_device_refund_route(
    tenant_slug: str,
    booking_id: str,
    payment_id: str,
    current_user: User = Depends(require_tenant_permission("payments.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> BookingSummaryResponse:
    return await record_clover_device_refund(session, tenant_slug, booking_id, payment_id, current_user)
