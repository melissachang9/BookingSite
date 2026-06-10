from __future__ import annotations

from datetime import datetime, timezone
from html import escape

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.db.models import BookingDraft, BookingDraftIntakePlan, Customer, Provider, Service
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
