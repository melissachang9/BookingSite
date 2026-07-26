"""Append-only wallet ledger.

Every wallet balance change must go through this module.  The customer's
wallet_balance_cents is always the sum of all WalletTransaction rows.
"""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Customer, User, WalletTransaction


async def record_wallet_transaction(
    session: AsyncSession,
    *,
    customer: Customer,
    amount_cents: int,
    kind: str,
    actor: User | None = None,
    notes: str | None = None,
    booking_id: str | None = None,
    payment_id: str | None = None,
) -> WalletTransaction:
    """Record an immutable wallet transaction and update the customer balance.

    Positive amount_cents = credit (adds to wallet).
    Negative amount_cents = debit (deducts from wallet).
    """
    tx = WalletTransaction(
        tenant_id=customer.tenant_id,
        customer_id=customer.id,
        amount_cents=amount_cents,
        kind=kind,
        actor_type="user" if actor is not None else "system",
        actor_id=actor.id if actor is not None else None,
        actor_name=actor.name if actor is not None else None,
        notes=notes,
        booking_id=booking_id,
        payment_id=payment_id,
    )
    session.add(tx)

    # Recompute balance from the ledger for integrity
    total = await session.scalar(
        select(func.coalesce(func.sum(WalletTransaction.amount_cents), 0)).where(
            WalletTransaction.customer_id == customer.id,
        )
    )
    customer.wallet_balance_cents = max(0, total or 0)

    return tx


async def wallet_balance_cents(session: AsyncSession, customer_id: str) -> int:
    """Return the current wallet balance computed from the ledger."""
    total = await session.scalar(
        select(func.coalesce(func.sum(WalletTransaction.amount_cents), 0)).where(
            WalletTransaction.customer_id == customer_id,
        )
    )
    return max(0, total or 0)
