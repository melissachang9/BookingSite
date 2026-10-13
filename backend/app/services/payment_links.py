"""Phone bookings: hold the slot and send the client a link to pay their deposit.

The link opens the storefront payment page for the held draft. The hold lasts
`paymentLinkExpiryMinutes` from the FIRST send; resending never extends it, so
a slot can't be held forever by repeatedly sending links.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.http import api_exception
from app.db.models import BookingDraft, BookingDraftFormRequirement, Provider, Service, User
from app.schemas.booking_drafts import BookingDraftSummaryResponse
from app.schemas.payments import (
    CreateCheckoutSessionRequest,
    DeliveryResultResponse,
    PaymentLinkRequest,
    PaymentLinkResponse,
)
from app.services.audit import record_audit
from app.services.booking_drafts import _ensure_aware, _ensure_not_expired, _load_booking_draft
from app.services.booking_notifications import send_payment_link
from app.services.payment_processor import resolve_payment_processor
from app.services.payments import (
    _append_payment_event,
    _load_checkout_payment,
    _payment_link_expiry_minutes,
    _require_online_checkout_available,
    create_checkout_session,
)
from app.services.presenters import booking_draft_to_summary
from app.services.state_machine import ACTIVE_BOOKING_DRAFT_STATUSES
from app.services.tenants import get_tenant_by_slug


async def send_deposit_payment_link(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: PaymentLinkRequest,
    actor: User,
) -> PaymentLinkResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    tenant_id = tenant.id
    draft = await _load_booking_draft(session, booking_draft_id, tenant_id, for_update=True)

    if draft.confirmed_booking_id is not None:
        raise api_exception(409, "conflict", "This booking is already confirmed.")
    _ensure_not_expired(draft)
    if draft.customer is None:
        raise api_exception(400, "bad_request", "Add the client before sending a payment link.")
    if draft.deposit_cents <= 0:
        raise api_exception(409, "conflict", "This service has no deposit. Confirm the booking without payment instead.")
    _require_online_checkout_available(resolve_payment_processor(tenant))
    if "sms" in payload.channels and not (draft.customer.sms_consent or payload.sms_consent_confirmed):
        raise api_exception(
            409,
            "conflict",
            "Texts need the client's OK. Tick \"the client asked for a text\" if they did.",
        )

    minutes = _payment_link_expiry_minutes(tenant.settings_json)
    now = datetime.now(timezone.utc)
    if draft.payment_requested_at is None:
        # First send: the hold now lasts as long as the link. Never shortened, never re-extended.
        draft.payment_requested_at = now
        link_expiry = now + timedelta(minutes=minutes)
        if link_expiry > _ensure_aware(draft.expires_at):
            draft.expires_at = link_expiry
            if draft.hold is not None:
                draft.hold.expires_at = link_expiry

    if payload.sms_consent_confirmed and not draft.customer.sms_consent:
        draft.customer.sms_consent = True
        if not draft.customer.sms_phone:
            draft.customer.sms_phone = draft.customer.phone
        await record_audit(
            session,
            tenant_id=tenant_id,
            entity_type="customer",
            entity_id=draft.customer.id,
            action="sms_consent_recorded",
            actor=actor,
            notes="Client asked for a text with their payment link; confirmed by staff.",
        )
    await session.commit()

    storefront = get_settings().storefront_public_base_url.rstrip("/")
    page = f"{storefront}/{tenant_slug}/book/{booking_draft_id}"
    checkout = await create_checkout_session(
        session,
        tenant_slug,
        CreateCheckoutSessionRequest(
            tenant_slug=tenant_slug,
            booking_draft_id=booking_draft_id,
            kind="deposit",
            success_url=f"{page}/success",
            cancel_url=page,
        ),
    )

    draft = await _load_booking_draft(session, booking_draft_id, tenant_id)
    tenant = await get_tenant_by_slug(session, tenant_slug)
    outcomes = await send_payment_link(
        session,
        draft,
        tenant=tenant,
        payment_url=checkout.checkout_url,
        deposit_cents=draft.deposit_cents,
        minutes=minutes,
        channels=list(payload.channels),
        actor=actor,
    )

    sent = [o for o in outcomes if o.status == "sent"]
    if sent:
        payment = await _load_checkout_payment(session, tenant_id=tenant_id, session_id=checkout.session_id)
        for outcome in sent:
            _append_payment_event(
                session,
                payment,
                kind="payment_link_sent",
                amount_cents=payment.amount_cents,
                notes=f"Payment link sent by {outcome.channel} to {outcome.recipient}.",
                actor_type="user",
                actor_id=actor.id,
                display_name=actor.name,
            )
        await session.commit()

    draft = await _load_booking_draft(session, booking_draft_id, tenant_id)
    return PaymentLinkResponse(
        booking_draft=booking_draft_to_summary(draft),
        payment_url=checkout.checkout_url,
        hold_expires_at=draft.expires_at,
        deliveries=[
            DeliveryResultResponse(channel=o.channel, status=o.status, recipient=o.recipient, error=o.error)
            for o in outcomes
        ],
    )


async def list_pending_booking_drafts(
    session: AsyncSession,
    tenant_slug: str,
    *,
    starts_at_gte: datetime,
    starts_at_lte: datetime,
) -> list[BookingDraftSummaryResponse]:
    """Held slots for the calendar: staff-entered drafts, plus online drafts
    whose client is at the payment page. Expired and finished drafts never show."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    drafts = (
        await session.scalars(
            select(BookingDraft)
            .options(
                selectinload(BookingDraft.tenant),
                selectinload(BookingDraft.customer),
                selectinload(BookingDraft.intake_plan),
                selectinload(BookingDraft.add_ons),
                selectinload(BookingDraft.service).selectinload(Service.location_links),
                selectinload(BookingDraft.provider).selectinload(Provider.service_links),
                selectinload(BookingDraft.provider).selectinload(Provider.location_links),
                selectinload(BookingDraft.form_requirements).selectinload(BookingDraftFormRequirement.form_version),
            )
            .where(
                BookingDraft.tenant_id == tenant.id,
                BookingDraft.status.in_(tuple(ACTIVE_BOOKING_DRAFT_STATUSES)),
                BookingDraft.confirmed_booking_id.is_(None),
                BookingDraft.expires_at > datetime.now(timezone.utc),
                BookingDraft.starts_at >= starts_at_gte,
                BookingDraft.starts_at <= starts_at_lte,
                or_(BookingDraft.booking_method == "staff_entered", BookingDraft.status == "awaiting_payment"),
            )
            .order_by(BookingDraft.starts_at.asc())
        )
    ).all()
    return [booking_draft_to_summary(draft) for draft in drafts]
