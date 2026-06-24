from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import (
    Booking,
    BookingDraft,
    BookingDraftFormRequirement,
    BookingDraftIntakePlan,
    Tenant,
)
from app.services.notifications import send_transactional_email


def _format_booking_start(starts_at: datetime) -> str:
    return starts_at.strftime("%a, %b %d at %I:%M %p %Z")


async def send_due_intake_reminders(session: AsyncSession) -> dict[str, int]:
    """Send email reminders for bookings whose intake reminder window has arrived.

    Returns a summary dict with counts of sent, skipped, and failed reminders.
    """
    now = datetime.now(timezone.utc)

    due_plans = (
        await session.scalars(
            select(BookingDraftIntakePlan)
            .options(
                selectinload(BookingDraftIntakePlan.booking_draft)
                .selectinload(BookingDraft.customer),
                selectinload(BookingDraftIntakePlan.booking_draft)
                .selectinload(BookingDraft.service),
                selectinload(BookingDraftIntakePlan.booking_draft)
                .selectinload(BookingDraft.provider),
            )
            .where(
                BookingDraftIntakePlan.status == "reminders_scheduled",
                BookingDraftIntakePlan.email_reminder_scheduled_at.is_not(None),
                BookingDraftIntakePlan.email_reminder_scheduled_at <= now,
                BookingDraftIntakePlan.email_reminder_sent_at.is_(None),
            )
        )
    ).all()

    sent = 0
    skipped = 0
    failed = 0

    for plan in due_plans:
        draft = plan.booking_draft
        if draft is None or draft.customer is None or not draft.customer.email:
            skipped += 1
            continue

        customer_name = draft.customer.name or "there"
        service_name = draft.service.name if draft.service is not None else "your appointment"
        provider_name = draft.provider.name if draft.provider is not None else "your provider"
        appointment_label = _format_booking_start(draft.starts_at)

        subject = f"Reminder: {service_name} with {provider_name}"
        text_body = "\n".join([
            f"Hi {customer_name},",
            "",
            f"This is a reminder about your upcoming {service_name} appointment with {provider_name} on {appointment_label}.",
            "",
            "If you have any pending intake forms, please complete them before your visit.",
            "",
            "Reply to this email if you need to reschedule or have any questions.",
        ])
        html_body = "".join([
            f"<p>Hi {escape(customer_name)},</p>",
            f"<p>This is a reminder about your upcoming <strong>{escape(service_name)}</strong> appointment "
            f"with <strong>{escape(provider_name)}</strong> on <strong>{escape(appointment_label)}</strong>.</p>",
            "<p>If you have any pending intake forms, please complete them before your visit.</p>",
            "<p>Reply to this email if you need to reschedule or have any questions.</p>",
        ])

        try:
            await send_transactional_email(
                recipient_email=draft.customer.email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
            )
            plan.email_reminder_sent_at = now
            sent += 1
        except Exception:
            failed += 1

    if sent > 0 or skipped > 0 or failed > 0:
        await session.commit()

    return {"sent": sent, "skipped": skipped, "failed": failed}


# Reminder window for confirmed bookings with pending intake forms.
# The primary window comes from the tenant's reminder_hours_before setting.
# We enforce a minimum 6h gap between sends via Booking.last_form_reminder_sent_at.
_CONFIRMED_FORM_REMINDER_MIN_GAP = timedelta(hours=6)
# Fallback windows used when the tenant setting is unavailable.
_FALLBACK_REMINDER_WINDOWS_HOURS = (72, 24, 4)


def _get_reminder_windows(tenant_settings: dict) -> tuple[int, ...]:
    """Return the reminder window(s) for a tenant.

    Uses the tenant's configured reminder_hours_before as the primary window,
    falling back to a sensible multi-window cadence when not configured.
    """
    raw = tenant_settings.get("reminderHoursBefore")
    if isinstance(raw, int) and raw > 0:
        return (raw,)
    return _FALLBACK_REMINDER_WINDOWS_HOURS


async def send_due_confirmed_booking_form_reminders(session: AsyncSession) -> dict[str, int]:
    """Send automated form reminders for confirmed bookings that still have pending requirements.

    For each confirmed booking with at least one pending form requirement, send a reminder
    when the appointment crosses one of the configured "hours-before-start" windows, as long
    as no reminder has been sent in the last 6 hours.
    """
    from app.services.booking_forms import _build_form_manage_url, _build_form_reminder_content
    from app.core.security import create_customer_manage_token

    now = datetime.now(timezone.utc)

    # Load all tenants so we can read per-tenant reminder settings.
    tenants = (
        await session.scalars(select(Tenant))
    ).all()
    tenant_by_id: dict[str, Tenant] = {t.id: t for t in tenants}

    # Use the widest possible window across all tenants for the candidate query.
    all_windows: set[int] = set()
    for t in tenants:
        all_windows.update(_get_reminder_windows(t.settings_json))
    if not all_windows:
        all_windows = set(_FALLBACK_REMINDER_WINDOWS_HOURS)
    latest_target = now + timedelta(hours=max(all_windows))

    pending_requirement_subquery = (
        select(BookingDraftFormRequirement.id)
        .where(
            BookingDraftFormRequirement.status == "pending",
            BookingDraftFormRequirement.booking_id == Booking.id,
        )
        .exists()
    )

    candidates = (
        await session.scalars(
            select(Booking)
            .options(
                selectinload(Booking.customer),
                selectinload(Booking.service),
                selectinload(Booking.provider),
            )
            .where(
                Booking.status == "confirmed",
                Booking.starts_at > now,
                Booking.starts_at <= latest_target,
                pending_requirement_subquery,
            )
        )
    ).all()

    sent = 0
    skipped = 0
    failed = 0

    for booking in candidates:
        if booking.customer is None or not booking.customer.email:
            skipped += 1
            continue

        # Skip if a reminder was sent within the last gap.
        if booking.last_form_reminder_sent_at is not None:
            last_sent = booking.last_form_reminder_sent_at
            if last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=timezone.utc)
            if now - last_sent < _CONFIRMED_FORM_REMINDER_MIN_GAP:
                skipped += 1
                continue

        hours_until_start = (booking.starts_at - now).total_seconds() / 3600.0
        # Use the booking's tenant reminder windows.
        tenant = tenant_by_id.get(booking.tenant_id)
        tenant_windows = _get_reminder_windows(tenant.settings_json) if tenant is not None else _FALLBACK_REMINDER_WINDOWS_HOURS
        # Trigger when we've crossed (or are at) any reminder window. We pick the
        # smallest window that is >= hours_until_start.
        target_window = None
        for window_hours in sorted(tenant_windows):
            if hours_until_start <= window_hours:
                target_window = window_hours
                break
        if target_window is None:
            skipped += 1
            continue

        # Count pending requirements for the message.
        pending_count_rows = (
            await session.scalars(
                select(BookingDraftFormRequirement).where(
                    BookingDraftFormRequirement.booking_id == booking.id,
                    BookingDraftFormRequirement.status == "pending",
                )
            )
        ).all()
        pending_count = len(pending_count_rows)
        if pending_count == 0:
            skipped += 1
            continue

        try:
            token, _ = create_customer_manage_token({"bookingId": booking.id, "tenantId": booking.tenant_id})
            manage_url = _build_form_manage_url(token)
            subject, text_body, html_body = _build_form_reminder_content(booking, pending_count, manage_url)
            await send_transactional_email(
                recipient_email=booking.customer.email,
                subject=subject,
                text_body=text_body,
                html_body=html_body,
            )
            booking.last_form_reminder_sent_at = now
            sent += 1
        except Exception:
            failed += 1

    if sent > 0 or skipped > 0 or failed > 0:
        await session.commit()

    return {"sent": sent, "skipped": skipped, "failed": failed}
