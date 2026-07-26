"""Periodic cleanup of expired slot holds.

Slot holds have a 15-minute TTL.  Availability queries already exclude
expired holds at read time, but the rows accumulate indefinitely without
a sweeper.  This module provides a cleanup function that runs on startup
and then periodically in the background.
"""

from __future__ import annotations

import asyncio
import logging

from sqlalchemy import delete

from app.db.models import SlotHold
from app.db.session import get_session_maker

logger = logging.getLogger(__name__)

CLEANUP_INTERVAL_SECONDS = 300  # every 5 minutes


async def cleanup_expired_slot_holds() -> int:
    """Delete all expired slot holds.  Returns the number of rows deleted."""
    async with get_session_maker()() as session:
        from datetime import datetime, timezone

        result = await session.execute(
            delete(SlotHold).where(SlotHold.expires_at <= datetime.now(timezone.utc))
        )
        await session.commit()
        count = result.rowcount
        if count:
            logger.info("Cleaned up %d expired slot hold(s)", count)
        return count


async def run_periodic_cleanup() -> None:
    """Background task that runs cleanup_expired_slot_holds on a loop."""
    while True:
        try:
            await asyncio.sleep(CLEANUP_INTERVAL_SECONDS)
            await cleanup_expired_slot_holds()
        except asyncio.CancelledError:
            break
        except Exception:
            logger.exception("Slot hold cleanup failed, will retry")
