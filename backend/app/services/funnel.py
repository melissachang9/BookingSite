"""Lightweight funnel event instrumentation for conversion tracking.

Emits structured JSON log lines at key booking-funnel steps so operators
and future analytics pipelines can measure drop-off between:
  - contact_details_saved
  - form_requirement_submitted
  - checkout_session_started
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger("booking.funnel")


def _emit(event_kind: str, tenant_id: str, booking_draft_id: str, extra: dict[str, Any] | None = None) -> None:
    payload: dict[str, Any] = {
        "event": event_kind,
        "tenant_id": tenant_id,
        "booking_draft_id": booking_draft_id,
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }
    if extra:
        payload.update(extra)
    logger.info(json.dumps(payload, default=str))


def contact_details_saved(tenant_id: str, booking_draft_id: str, intake_timing: str | None = None) -> None:
    _emit("contact_details_saved", tenant_id, booking_draft_id, {"intake_timing": intake_timing})


def form_requirement_submitted(tenant_id: str, booking_draft_id: str, requirement_id: str, form_id: str) -> None:
    _emit("form_requirement_submitted", tenant_id, booking_draft_id, {"requirement_id": requirement_id, "form_id": form_id})


def checkout_session_started(tenant_id: str, booking_draft_id: str, kind: str, amount_cents: int) -> None:
    _emit("checkout_session_started", tenant_id, booking_draft_id, {"kind": kind, "amount_cents": amount_cents})
