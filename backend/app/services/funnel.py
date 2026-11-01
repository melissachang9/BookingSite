"""Funnel instrumentation for conversion tracking.

Each step a visitor takes toward booking is written as a `FunnelEvent` row in the caller's transaction (so it
exists exactly when the step happened) and also logged as a JSON line for operators:

  booking_started -> contact_details_saved -> form_requirement_submitted -> financing_started ->
  checkout_session_started -> booking_confirmed
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import BookingDraft, FunnelEvent

logger = logging.getLogger("booking.funnel")

FUNNEL_KINDS = (
    "booking_started",
    "contact_details_saved",
    "form_requirement_submitted",
    "financing_started",
    "checkout_session_started",
    "booking_confirmed",
)


def track(session: AsyncSession, draft: BookingDraft, step: str, /, **detail: Any) -> FunnelEvent:
    """Record one funnel step for a booking draft. The caller commits."""
    now = datetime.now(timezone.utc)
    event = FunnelEvent(
        tenant_id=draft.tenant_id,
        booking_draft_id=draft.id,
        customer_id=draft.customer_id,
        kind=step,
        occurred_at=now,
        booking_method=draft.booking_method,
        utm_source=draft.utm_source,
        utm_medium=draft.utm_medium,
        utm_campaign=draft.utm_campaign,
        detail_json=detail or None,
    )
    session.add(event)
    payload: dict[str, Any] = {
        "event": step,
        "tenant_id": draft.tenant_id,
        "booking_draft_id": draft.id,
        "timestamp": now.isoformat(),
        **detail,
    }
    logger.info(json.dumps(payload, default=str))
    return event
