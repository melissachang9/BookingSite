"""Periodic cleanup of lapsed booking drafts and expired slot holds.

A draft holds its slot until ``expires_at`` (15 minutes for online bookings,
the payment-link window for staff phone bookings). Availability already
ignores expired holds at read time; this sweeper makes the lapse explicit:

1. Drafts still in an active status past ``expires_at`` move to ``expired``,
   their open checkout payments are canceled with a compensating event, and
   any processor session is closed so the customer can't pay a dead hold.
2. Expired slot-hold rows and orphaned draft room/equipment reservations are
   deleted.

Both steps are idempotent: a repeat sweep changes nothing.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timezone

from sqlalchemy import delete, exists, select, update

from app.db.models import BookingDraft, ResourceAllocation, SlotHold
from app.db.session import get_session_maker
from app.services.state_machine import ACTIVE_BOOKING_DRAFT_STATUSES

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 60  # every minute; payment-link holds are short


async def expire_lapsed_booking_drafts() -> int:
    """Mark active drafts past their hold as expired. Returns how many changed."""
    # Imported lazily: booking_drafts imports this module's neighbours at load.
    from app.services.booking_drafts import _cancel_pending_draft_payments
    from app.services.payment_processor import expire_stripe_checkout_session_quietly

    now = datetime.now(timezone.utc)
    active = tuple(ACTIVE_BOOKING_DRAFT_STATUSES)
    session_ids: list[str] = []
    expired_count = 0

    async with get_session_maker()() as session:
        candidate_ids = (
            await session.scalars(
                select(BookingDraft.id).where(
                    BookingDraft.status.in_(active),
                    BookingDraft.expires_at <= now,
                )
            )
        ).all()

        for draft_id in candidate_ids:
            # Compare-and-set so concurrent sweepers (or a payment completing
            # at the same moment) can't both act on one draft. Every active
            # status may move to "expired" in the draft state machine.
            result = await session.execute(
                update(BookingDraft)
                .where(
                    BookingDraft.id == draft_id,
                    BookingDraft.status.in_(active),
                    BookingDraft.expires_at <= now,
                )
                .values(status="expired")
            )
            if result.rowcount != 1:
                continue
            expired_count += 1

            draft = await session.get(BookingDraft, draft_id)
            if draft is None:
                continue
            canceled = await _cancel_pending_draft_payments(
                session,
                draft,
                event_kind="checkout_expired",
                notes="Payment link closed because the held slot expired before payment.",
                actor=None,
            )
            session_ids.extend(p.checkout_session_id for p in canceled if p.checkout_session_id)
            await session.execute(
                delete(SlotHold).where(SlotHold.booking_draft_id == draft_id)
            )

        await session.commit()

    for session_id in session_ids:
        await expire_stripe_checkout_session_quietly(session_id)

    if expired_count:
        logger.info("Expired %d lapsed booking draft(s)", expired_count)
    return expired_count


async def cleanup_expired_slot_holds() -> int:
    """Delete all expired slot holds.  Returns the number of rows deleted."""
    async with get_session_maker()() as session:
        result = await session.execute(
            delete(SlotHold).where(SlotHold.expires_at <= datetime.now(timezone.utc))
        )
        # Room/equipment reservations of drafts that never became bookings and
        # no longer have a hold. Idempotent: a repeat sweep deletes nothing.
        await session.execute(
            delete(ResourceAllocation).where(
                ResourceAllocation.booking_id.is_(None),
                ~exists(
                    select(SlotHold.id).where(SlotHold.booking_draft_id == ResourceAllocation.booking_draft_id)
                ),
            )
        )
        await session.commit()
        count = result.rowcount
        if count:
            logger.info("Cleaned up %d expired slot hold(s)", count)
        return count


async def run_hold_sweep() -> None:
    """One full sweep: expire lapsed drafts, then delete dead holds."""
    await expire_lapsed_booking_drafts()
    await cleanup_expired_slot_holds()


async def run_periodic_cleanup() -> None:
    """Background task that runs the hold sweep on a loop."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            await run_hold_sweep()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Slot hold cleanup failed, will retry")
