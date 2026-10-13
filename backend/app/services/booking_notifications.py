"""Customer-facing booking confirmation messages (email + SMS).

Sent after a booking is confirmed and committed. Delivery never blocks or
undoes the booking: each channel's outcome (sent / failed / skipped) is
recorded as an audit event so staff can see what the customer received.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from html import escape
from urllib.parse import urljoin

from fastapi import HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_customer_manage_token
from app.db.models import Booking, BookingDraftFormRequirement, Location, Tenant, User
from app.services.audit import record_audit
from app.services.notifications import _twilio_configured, send_transactional_email, send_transactional_sms
from app.services.timezones import resolve_zone

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class DeliveryOutcome:
    channel: str  # "email" | "sms"
    status: str  # "sent" | "failed" | "skipped"
    recipient: str | None
    provider: str | None = None
    provider_message_id: str | None = None
    error: str | None = None


def _email_configured() -> bool:
    settings = get_settings()
    return bool(settings.resend_api_key and settings.resend_from_email)


def _storefront_url(path: str) -> str | None:
    base = (get_settings().storefront_public_base_url or "").strip()
    if not base:
        return None
    return urljoin(f"{base.rstrip('/')}/", path)


async def _local_start_label(session: AsyncSession, booking: Booking, tenant: Tenant) -> str:
    location_tz: str | None = None
    if booking.location_id:
        location_tz = await session.scalar(select(Location.time_zone).where(Location.id == booking.location_id))
    zone = resolve_zone(location_tz, tenant.timezone)
    local = booking.starts_at.astimezone(zone) if booking.starts_at.tzinfo else booking.starts_at.replace(tzinfo=zone)
    hour = local.strftime("%I").lstrip("0") or "12"
    return f"{local.strftime('%a, %b')} {local.day} at {hour}:{local.strftime('%M %p')}"


async def _pending_form_count(session: AsyncSession, booking: Booking) -> int:
    draft = booking.source_draft
    if draft is None:
        return 0
    rows = (
        await session.scalars(
            select(BookingDraftFormRequirement.id).where(
                BookingDraftFormRequirement.tenant_id == booking.tenant_id,
                BookingDraftFormRequirement.booking_draft_id == draft.id,
                BookingDraftFormRequirement.scope == "customer",
                BookingDraftFormRequirement.status == "pending",
            )
        )
    ).all()
    return len(rows)


def _error_text(error: Exception) -> str:
    if isinstance(error, HTTPException) and isinstance(error.detail, dict):
        message = error.detail.get("message")
        if isinstance(message, str) and message:
            return message
    return str(error) or error.__class__.__name__


async def send_booking_confirmation(
    session: AsyncSession,
    booking: Booking,
    *,
    actor: User | None = None,
) -> list[DeliveryOutcome]:
    """Email (and text, with consent) the customer that their booking is confirmed.

    Call after the booking is committed. Records one audit event per channel
    and commits them; returns the per-channel outcomes.
    """
    tenant = booking.tenant
    customer = booking.customer
    service_name = booking.service.name if booking.service is not None else "appointment"
    provider_name = booking.provider.name if booking.provider is not None else None
    when = await _local_start_label(session, booking, tenant)
    token, _ = create_customer_manage_token(
        {"bookingId": booking.id, "tenantId": booking.tenant_id, "customerId": booking.customer_id}
    )
    manage_url = _storefront_url(f"cancel/{token}")
    pending_forms = await _pending_form_count(session, booking)
    forms_url = _storefront_url(f"forms/{token}") if pending_forms else None

    with_provider = f" with {provider_name}" if provider_name else ""
    headline = f"Your {service_name}{with_provider} at {tenant.name} is confirmed for {when}."
    forms_word = "form" if pending_forms == 1 else "forms"

    outcomes: list[DeliveryOutcome] = []

    # Email
    if not customer.email:
        outcomes.append(DeliveryOutcome("email", "skipped", None, error="No email on file."))
    elif not _email_configured():
        outcomes.append(DeliveryOutcome("email", "skipped", customer.email, error="Email delivery is not configured."))
    else:
        text_lines = [f"Hi {customer.name},", "", headline]
        html_parts = [f"<p>Hi {escape(customer.name)},</p>", f"<p>{escape(headline)}</p>"]
        if forms_url:
            text_lines += ["", f"Please complete your {pending_forms} {forms_word} before your visit: {forms_url}"]
            html_parts.append(
                f'<p>Please <a href="{escape(forms_url)}">complete your {pending_forms} {forms_word}</a> before your visit.</p>'
            )
        if manage_url:
            text_lines += ["", f"View or change your booking: {manage_url}"]
            html_parts.append(f'<p><a href="{escape(manage_url)}">View or change your booking</a></p>')
        try:
            result = await send_transactional_email(
                recipient_email=customer.email,
                subject=f"Booking confirmed: {service_name} on {when}",
                text_body="\n".join(text_lines),
                html_body="".join(html_parts),
            )
            outcomes.append(
                DeliveryOutcome("email", "sent", result.recipient_email, result.provider, result.provider_message_id)
            )
        except Exception as error:  # noqa: BLE001 - delivery must not undo the booking
            logger.warning("Booking confirmation email failed for booking %s", booking.id, exc_info=True)
            outcomes.append(DeliveryOutcome("email", "failed", customer.email, error=_error_text(error)))

    # SMS (only with the customer's consent to texts)
    sms_phone = customer.sms_phone or customer.phone
    if not customer.sms_consent:
        outcomes.append(DeliveryOutcome("sms", "skipped", sms_phone, error="Customer has not opted in to texts."))
    elif not sms_phone:
        outcomes.append(DeliveryOutcome("sms", "skipped", None, error="No mobile number on file."))
    elif not _twilio_configured():
        outcomes.append(DeliveryOutcome("sms", "skipped", sms_phone, error="SMS delivery is not configured."))
    else:
        body = headline
        if forms_url:
            body += f" Please complete your {forms_word}: {forms_url}"
        elif manage_url:
            body += f" Manage: {manage_url}"
        try:
            result = await send_transactional_sms(recipient_phone=sms_phone, body=body)
            outcomes.append(
                DeliveryOutcome("sms", "sent", result.recipient_phone, result.provider, result.provider_message_id)
            )
        except Exception as error:  # noqa: BLE001
            logger.warning("Booking confirmation SMS failed for booking %s", booking.id, exc_info=True)
            outcomes.append(DeliveryOutcome("sms", "failed", sms_phone, error=_error_text(error)))

    for outcome in outcomes:
        await record_audit(
            session,
            tenant_id=booking.tenant_id,
            entity_type="booking",
            entity_id=booking.id,
            action=f"confirmation_{outcome.status}",
            actor=actor,
            changes={
                "channel": outcome.channel,
                "recipient": outcome.recipient,
                "provider": outcome.provider,
                "providerMessageId": outcome.provider_message_id,
                "sentAt": datetime.now().astimezone().isoformat() if outcome.status == "sent" else None,
            },
            notes=outcome.error,
        )
    await session.commit()
    return outcomes
