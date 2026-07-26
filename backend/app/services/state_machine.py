"""Explicit booking state machine with validated transitions.

Per AGENTS.md, the documented lifecycle is:

  BookingDraft: draft -> slot_held -> awaiting_form -> awaiting_payment -> confirmed
  Booking:     confirmed -> completed | canceled | no_show

Every status mutation must go through `guard_transition()` which raises
a 409 Conflict if the transition is not allowed.
"""

from __future__ import annotations

from app.core.http import api_exception

# ---------------------------------------------------------------------------
# Valid transitions
# ---------------------------------------------------------------------------

BOOKING_DRAFT_TRANSITIONS: dict[str, set[str]] = {
    "draft": {"slot_held"},
    "slot_held": {"awaiting_form", "awaiting_payment", "confirmed"},
    "awaiting_form": {"slot_held", "awaiting_payment"},
    "awaiting_payment": {"confirmed"},
    "confirmed": set(),  # terminal for drafts
}

BOOKING_TRANSITIONS: dict[str, set[str]] = {
    "confirmed": {"completed", "no_show", "canceled"},
    "completed": set(),
    "no_show": set(),
    "canceled": set(),
}

# ---------------------------------------------------------------------------
# Guard
# ---------------------------------------------------------------------------


def guard_transition(
    entity_type: str,
    entity_id: str,
    current_status: str,
    new_status: str,
) -> None:
    """Raise 409 if the transition is not allowed."""
    transitions = (
        BOOKING_DRAFT_TRANSITIONS
        if entity_type == "booking_draft"
        else BOOKING_TRANSITIONS
    )
    allowed = transitions.get(current_status, set())
    if new_status not in allowed:
        raise api_exception(
            409,
            "conflict",
            f"Cannot transition {entity_type} {entity_id} "
            f"from '{current_status}' to '{new_status}'.",
        )
