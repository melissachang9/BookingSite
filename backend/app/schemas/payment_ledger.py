from __future__ import annotations

from datetime import datetime

from app.schemas.base import CamelModel


class TransactionRow(CamelModel):
    """One money movement. `cash_cents` is signed: money in is positive, money out negative,
    and movements that only reclassify held money (redeemed, forfeited, to wallet) are 0."""

    id: str
    occurred_at: datetime
    # payment | deposit_collected | refund | deposit_redeemed | deposit_forfeited | deposit_to_wallet
    type: str
    amount_cents: int
    cash_cents: int
    tip_cents: int = 0
    method: str | None = None
    status: str | None = None
    customer_id: str | None = None
    customer_name: str | None = None
    booking_id: str | None = None
    sale_id: str | None = None
    sale_number: int | None = None
    payment_id: str | None = None
    provider_id: str | None = None
    location_id: str | None = None
    actor_name: str | None = None
    notes: str | None = None


class TransactionListResponse(CamelModel):
    transactions: list[TransactionRow]
    total: int
    limit: int
    offset: int


class HeldMoneyBucket(CamelModel):
    """Opening + collected - used - returned - forfeited = closing, for a period."""

    opening_cents: int
    collected_cents: int
    redeemed_cents: int
    refunded_cents: int
    moved_to_wallet_cents: int
    forfeited_cents: int
    closing_cents: int


class WalletBucket(CamelModel):
    opening_cents: int
    added_cents: int
    used_cents: int
    closing_cents: int


class LiabilitySummaryResponse(CamelModel):
    period_start: datetime | None = None
    period_end: datetime | None = None
    deposits: HeldMoneyBucket
    wallet: WalletBucket


class RefundOwedItem(CamelModel):
    payment_id: str
    booking_id: str | None = None
    customer_id: str
    customer_name: str | None = None
    amount_cents: int
    owed_since: datetime
    notes: str | None = None


class BalanceOwedItem(CamelModel):
    booking_id: str
    sale_number: int | None = None
    customer_id: str
    customer_name: str | None = None
    service_name: str | None = None
    balance_due_cents: int
    completed_at: datetime | None = None


class MoneyOwedResponse(CamelModel):
    refunds_owed: list[RefundOwedItem]
    balances_owed: list[BalanceOwedItem]
    refunds_owed_total_cents: int
    balances_owed_total_cents: int
