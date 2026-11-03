"""Recurring jobs that must run in every deployment (not only when something calls a test endpoint).

Reminders are sent by a loop in the app's lifespan (see app/main.py). Each reminder run is safe to repeat:
every sender records when it last reminded a booking and skips one reminded recently. On Postgres a
session-level advisory lock also keeps two app instances from running the same cycle at once.
"""

from __future__ import annotations

import logging
from typing import Awaitable, Callable

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_session_maker
from app.services.appointment_reminders import send_due_appointment_reminders
from app.services.reminders import send_due_confirmed_booking_form_reminders, send_due_intake_reminders

logger = logging.getLogger(__name__)

REMINDER_INTERVAL_SECONDS = 5 * 60
REMINDER_LOCK_KEY = 7_315_001  # arbitrary, unique to this job

REMINDER_JOBS: tuple[tuple[str, Callable[[AsyncSession], Awaitable[dict[str, int]]]], ...] = (
    ("appointment reminders", send_due_appointment_reminders),
    ("form reminders", send_due_confirmed_booking_form_reminders),
    ("intake reminders", send_due_intake_reminders),
)


async def run_reminder_cycle() -> dict[str, dict[str, int] | None]:
    """Run every reminder sender once. One failing sender never stops the others.

    Returns each sender's counts, or None for one that raised (logged with its traceback).
    """
    results: dict[str, dict[str, int] | None] = {}
    async with get_session_maker()() as lock_session:
        locked = True
        if lock_session.bind.dialect.name == "postgresql":
            locked = bool(await lock_session.scalar(text("SELECT pg_try_advisory_lock(:key)"), {"key": REMINDER_LOCK_KEY}))
        if not locked:
            logger.info("Reminder cycle skipped: another instance is running it.")
            return results
        try:
            for name, job in REMINDER_JOBS:
                try:
                    async with get_session_maker()() as session:
                        results[name] = await job(session)
                    logger.info("Ran %s: %s", name, results[name])
                except Exception:
                    logger.exception("Sending %s failed; will retry next cycle", name)
                    results[name] = None
        finally:
            if lock_session.bind.dialect.name == "postgresql":
                await lock_session.execute(text("SELECT pg_advisory_unlock(:key)"), {"key": REMINDER_LOCK_KEY})
    return results
