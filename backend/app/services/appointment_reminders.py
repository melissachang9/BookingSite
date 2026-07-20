"""Appointment reminder service.

Sends email and/or SMS reminders to customers with upcoming confirmed bookings.
Triggered by cron every 15 minutes.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import Booking, Tenant
from app.services.notifications import send_transactional_email


_APPOINTMENT_REMINDER_MIN_GAP = timedelta(hours=6)


def _format_booking_start(starts_at: datetime) -> str:
    return starts_at.strftime("%a, %b %d at %I:%M %p %Z")


async def send_due_appointment_reminders(session: AsyncSession) -> dict[str, int]:
    """Send appointment reminders for confirmed bookings approaching their start time.

    For each confirmed booking whose start time falls within the tenant's
    appointmentReminderHours window, send an email (and optionally SMS) reminder.
    Enforces a 6-hour minimum gap between reminders.
    """
    now = datetime.now(timezone.utc)

    tenants = (await session.scalars(select(Tenant))).all()
    tenant_by_id: dict[str, Tenant] = {t.id: t for t in tenants}

    # Find the widest reminder window across all tenants
    max_window = 24
    for t in tenants:
        raw = t.settings_json.get("appointmentReminderHours")
        if isinstance(raw, int) and raw > 0:
            max_window = max(max_window, raw)

    latest_target = now + timedelta(hours=max_window)

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
            )
        )
    ).all()

    sent = 0
    skipped = 0
    failed = 0

    for booking in candidates:
        if booking.customer is None:
            skipped += 1
            continue

        # Enforce minimum gap between reminders
        if booking.last_appointment_reminder_sent_at is not None:
            last_sent = booking.last_appointment_reminder_sent_at
            if last_sent.tzinfo is None:
                last_sent = last_sent.replace(tzinfo=timezone.utc)
            if now - last_sent < _APPOINTMENT_REMINDER_MIN_GAP:
                skipped += 1
                continue

        tenant = tenant_by_id.get(booking.tenant_id)
        reminder_hours = 24
        channels: list[str] = ["email"]
        if tenant is not None:
            raw_hours = tenant.settings_json.get("appointmentReminderHours")
            if isinstance(raw_hours, int) and raw_hours > 0:
                reminder_hours = raw_hours
            raw_channels = tenant.settings_json.get("appointmentReminderChannels")
            if isinstance(raw_channels, list):
                channels = [c for c in raw_channels if isinstance(c, str)]

        hours_until_start = (booking.starts_at - now).total_seconds() / 3600.0
        if hours_until_start > reminder_hours:
            continue  # Not yet within the reminder window

        customer_name = booking.customer.name or "there"
        service_name = booking.service.name if booking.service is not None else "your appointment"
        provider_name = booking.provider.name if booking.provider is not None else "your provider"
        appointment_label = _format_booking_start(booking.starts_at)

        if "email" in channels and booking.customer.email:
            subject = f"Upcoming: {service_name} with {provider_name}"
            text_body = "\n".join([
                f"Hi {customer_name},",
                "",
                f"This is a reminder about your {service_name} appointment with {provider_name}",
                f"on {appointment_label}.",
                "",
                "If you need to reschedule or cancel, please contact us.",
            ])
            html_body = "".join([
                f"<p>Hi {escape(customer_name)},</p>",
                f"<p>This is a reminder about your <strong>{escape(service_name)}</strong> appointment "
                f"with <strong>{escape(provider_name)}</strong> on <strong>{escape(appointment_label)}</strong>.</p>",
                "<p>If you need to reschedule or cancel, please contact us.</p>",
            ])

            try:
                await send_transactional_email(
                    recipient_email=booking.customer.email,
                    subject=subject,
                    text_body=text_body,
                    html_body=html_body,
                )
            except Exception:
                failed += 1
                continue

        # SMS placeholder - will be implemented when SMS provider is integrated
        if "sms" in channels and booking.customer.sms_consent and booking.customer.sms_phone:
            # TODO: Integrate Twilio or similar SMS provider
            pass

        booking.last_appointment_reminder_sent_at = now
        sent += 1

    if sent > 0 or skipped > 0 or failed > 0:
        await session.commit()

    return {"sent": sent, "skipped": skipped, "failed": failed}
