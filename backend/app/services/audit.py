"""Lightweight audit trail for tenant-scoped mutations.

Payments and bookings already have their own event tables (PaymentEvent,
BookingPaymentEvent).  This module covers everything else: customers,
services, providers, forms, users, permissions, tenant settings, etc.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import AuditEvent, User


async def record_audit(
    session: AsyncSession,
    *,
    tenant_id: str,
    entity_type: str,
    entity_id: str,
    action: str,
    actor: User | None = None,
    changes: dict[str, Any] | None = None,
    notes: str | None = None,
) -> None:
    """Record an immutable audit event.

    Call this inside the same transaction as the mutation so the audit
    is atomic with the data change.
    """
    session.add(
        AuditEvent(
            tenant_id=tenant_id,
            entity_type=entity_type,
            entity_id=entity_id,
            action=action,
            actor_type="user" if actor is not None else "system",
            actor_id=actor.id if actor is not None else None,
            actor_name=actor.name if actor is not None else None,
            changes_json=changes,
            notes=notes,
        )
    )


# ---------------------------------------------------------------------------
# Convenience helpers that build the changes dict from old/new values.
# ---------------------------------------------------------------------------


def diff_changes(
    old: dict[str, Any],
    new: dict[str, Any],
    *,
    tracked_keys: set[str] | None = None,
) -> dict[str, Any] | None:
    """Return a {key: {"from": old_val, "to": new_val}} dict for changed keys.

    If tracked_keys is provided, only those keys are compared.
    Returns None if nothing changed.
    """
    changes: dict[str, Any] = {}
    keys = tracked_keys if tracked_keys is not None else (old.keys() | new.keys())
    for key in keys:
        old_val = old.get(key)
        new_val = new.get(key)
        if old_val != new_val:
            changes[key] = {"from": old_val, "to": new_val}
    return changes or None
