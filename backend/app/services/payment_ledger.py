"""Read side of the money record: transactions, held money and money owed.

Everything here is derived from the append-only records (payments and their events,
sale tenders, wallet transactions); nothing in this module writes.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import (
    Booking,
    Customer,
    Payment,
    PaymentEvent,
    Sale,
    SaleTender,
    Tenant,
    WalletTransaction,
)
from app.schemas.payment_ledger import (
    BalanceOwedItem,
    HeldMoneyBucket,
    LiabilitySummaryResponse,
    MoneyOwedResponse,
    RefundOwedItem,
    TransactionListResponse,
    TransactionRow,
    WalletBucket,
)
from app.services.presenters import booking_balance_due_cents
from app.services.sales import DEPOSIT_CHECKOUT_KINDS

# Refund events that return money to the client's card/cash, and the one that turns a deposit into wallet credit.
REFUND_KINDS = ("refund_recorded", "refund_processed", "wallet_returned")
DEPOSIT_TO_WALLET_KIND = "wallet_credited"
TRANSACTION_TYPES = (
    "payment",
    "deposit_collected",
    "refund",
    "deposit_redeemed",
    "deposit_forfeited",
    "deposit_to_wallet",
)
MAX_PAGE = 200


def payment_received_cents(payment: Payment) -> int:
    """What came in, before any refund reduced the row's amount."""
    return payment.original_amount_cents if payment.original_amount_cents is not None else payment.amount_cents


def payment_refunded_cents(payment: Payment) -> int:
    """Total refunded, read from the refund events rather than the row's current amount."""
    return sum(e.amount_cents or 0 for e in payment.events if e.kind in REFUND_KINDS)


def payment_details(payment: Payment) -> str | None:
    """What a person reading the ledger wants to know about how this payment was taken.

    Card brand and last four, the note and reference typed when it was recorded (and by whom),
    or "Paid online" when the client paid through checkout themselves.
    """
    parts: list[str] = []
    if payment.card_brand and payment.card_last4:
        parts.append(f"{payment.card_brand} ending {payment.card_last4}")

    events = sorted(payment.events, key=lambda e: e.occurred_at)
    recorded = next((e for e in reversed(events) if e.kind == "payment_recorded"), None)
    if recorded is not None:
        note = (recorded.notes or "").strip().rstrip(".").strip()
        if note:
            parts.append(note)
        if payment.external_reference and payment.external_reference not in note:
            parts.append(f"Ref {payment.external_reference}")
        if recorded.display_name:
            parts.append(f"Recorded by {recorded.display_name}")
    elif any(e.kind == "checkout_completed" for e in events):
        parts.append("Paid online")
    elif payment.payment_method_type == "wallet":
        parts.append("Paid with wallet credit")
    elif payment.external_reference:
        parts.append(f"Ref {payment.external_reference}")
    return " · ".join(parts) or None


def _utc(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def list_transactions(
    session: AsyncSession,
    tenant: Tenant,
    *,
    start: datetime | None = None,
    end: datetime | None = None,
    types: list[str] | None = None,
    method: str | None = None,
    customer_id: str | None = None,
    location_id: str | None = None,
    provider_id: str | None = None,
    limit: int = 50,
    offset: int = 0,
) -> TransactionListResponse:
    start, end = _utc(start), _utc(end)
    if types:
        unknown = [t for t in types if t not in TRANSACTION_TYPES]
        if unknown:
            raise api_exception(422, "validation_error", f"Unknown transaction type: {unknown[0]}.")
    limit = max(1, min(limit, MAX_PAGE))
    offset = max(0, offset)

    payments = (
        await session.scalars(
            select(Payment)
            .options(selectinload(Payment.events), selectinload(Payment.customer))
            .where(Payment.tenant_id == tenant.id, Payment.status.in_(("succeeded", "refunded")))
        )
    ).all()
    booking_ids = {p.booking_id for p in payments if p.booking_id}
    bookings = {
        b.id: b
        for b in (
            await session.scalars(
                select(Booking).where(Booking.tenant_id == tenant.id, Booking.id.in_(booking_ids))
            )
        ).all()
    } if booking_ids else {}

    rows: list[TransactionRow] = []
    for payment in payments:
        booking = bookings.get(payment.booking_id) if payment.booking_id else None
        common = dict(
            customer_id=payment.customer_id,
            customer_name=payment.customer.name if payment.customer else None,
            booking_id=payment.booking_id,
            sale_id=booking.sale_id if booking else None,
            sale_number=booking.sale_number if booking else None,
            payment_id=payment.id,
            provider_id=booking.provider_id if booking else None,
            location_id=booking.location_id if booking else None,
            method=payment.payment_method_type,
        )
        is_deposit = payment.checkout_session_kind in DEPOSIT_CHECKOUT_KINDS
        # Paying with wallet credit uses money already held for the client; no new cash arrives.
        is_wallet_payment = payment.payment_method_type == "wallet"
        received = payment_received_cents(payment)
        rows.append(
            TransactionRow(
                id=f"payment:{payment.id}",
                occurred_at=_utc(payment.created_at),
                type="deposit_collected" if is_deposit else "payment",
                amount_cents=received,
                cash_cents=0 if is_wallet_payment else received,
                tip_cents=payment.tip_cents,
                status=payment.status,
                notes=payment_details(payment),
                **common,
            )
        )
        for event in payment.events:
            amount = event.amount_cents or 0
            if event.kind in REFUND_KINDS:
                # A wallet payment is refunded back to the wallet, not to the client's card or hand.
                kind, cash = "refund", 0 if event.kind == "wallet_returned" else -amount
            elif event.kind == "deposit_forfeited":
                kind, cash = "deposit_forfeited", 0
            elif event.kind == DEPOSIT_TO_WALLET_KIND and is_deposit:
                kind, cash = "deposit_to_wallet", 0
            else:
                continue
            rows.append(
                TransactionRow(
                    id=f"event:{event.id}",
                    occurred_at=_utc(event.occurred_at),
                    type=kind,
                    amount_cents=amount,
                    cash_cents=cash,
                    actor_name=event.display_name,
                    notes=event.notes,
                    **common,
                )
            )

    tender_rows = (
        await session.execute(
            select(SaleTender, Sale)
            .join(Sale, Sale.id == SaleTender.sale_id)
            .where(Sale.tenant_id == tenant.id, SaleTender.kind == "deposit")
        )
    ).all()
    if tender_rows:
        customers = {
            c.id: c.name
            for c in (
                await session.scalars(select(Customer).where(Customer.id.in_({s.customer_id for _, s in tender_rows})))
            ).all()
        }
        sale_providers: dict[str, str | None] = {}
        for tender, sale in tender_rows:
            if sale.id not in sale_providers:
                sale_providers[sale.id] = await session.scalar(
                    select(Booking.provider_id).where(Booking.sale_id == sale.id).limit(1)
                )
            rows.append(
                TransactionRow(
                    id=f"tender:{tender.id}",
                    occurred_at=_utc(sale.completed_at),
                    type="deposit_redeemed",
                    amount_cents=tender.amount_cents,
                    cash_cents=0,
                    method="deposit",
                    customer_id=sale.customer_id,
                    customer_name=customers.get(sale.customer_id),
                    sale_id=sale.id,
                    sale_number=sale.sale_number,
                    payment_id=tender.payment_id,
                    provider_id=sale_providers[sale.id],
                    location_id=sale.location_id,
                )
            )

    def keep(row: TransactionRow) -> bool:
        if start is not None and row.occurred_at < start:
            return False
        if end is not None and row.occurred_at >= end:
            return False
        if types and row.type not in types:
            return False
        if method and row.method != method:
            return False
        if customer_id and row.customer_id != customer_id:
            return False
        if location_id and row.location_id != location_id:
            return False
        if provider_id and row.provider_id != provider_id:
            return False
        return True

    rows = sorted((r for r in rows if keep(r)), key=lambda r: (r.occurred_at, r.id), reverse=True)
    return TransactionListResponse(
        transactions=rows[offset : offset + limit], total=len(rows), limit=limit, offset=offset
    )


async def _deposit_flows(
    session: AsyncSession, tenant_id: str, start: datetime | None, end: datetime | None
) -> dict[str, int]:
    """Deposit money movements with `start <= time < end` (either bound may be open)."""

    def within(column):
        conditions = []
        if start is not None:
            conditions.append(column >= start)
        if end is not None:
            conditions.append(column < end)
        return conditions

    deposit_payment = (
        Payment.tenant_id == tenant_id,
        Payment.checkout_session_kind.in_(DEPOSIT_CHECKOUT_KINDS),
    )
    payments = (
        await session.scalars(
            select(Payment).where(
                *deposit_payment, Payment.status.in_(("succeeded", "refunded")), *within(Payment.created_at)
            )
        )
    ).all()
    collected = sum(payment_received_cents(p) for p in payments)

    redeemed = await session.scalar(
        select(func.coalesce(func.sum(SaleTender.amount_cents), 0))
        .join(Sale, Sale.id == SaleTender.sale_id)
        .where(Sale.tenant_id == tenant_id, SaleTender.kind == "deposit", *within(Sale.completed_at))
    )

    async def event_total(kinds: tuple[str, ...]) -> int:
        return int(
            await session.scalar(
                select(func.coalesce(func.sum(PaymentEvent.amount_cents), 0))
                .join(Payment, Payment.id == PaymentEvent.payment_id)
                .where(*deposit_payment, PaymentEvent.kind.in_(kinds), *within(PaymentEvent.occurred_at))
            )
            or 0
        )

    return {
        "collected": int(collected),
        "redeemed": int(redeemed or 0),
        "refunded": await event_total(("refund_recorded", "refund_processed")),
        "to_wallet": await event_total((DEPOSIT_TO_WALLET_KIND,)),
        "forfeited": await event_total(("deposit_forfeited",)),
    }


def _net(flows: dict[str, int]) -> int:
    return flows["collected"] - flows["redeemed"] - flows["refunded"] - flows["to_wallet"] - flows["forfeited"]


async def liability_summary(
    session: AsyncSession, tenant: Tenant, *, start: datetime | None, end: datetime | None
) -> LiabilitySummaryResponse:
    """Money held for clients (deposits, wallet) with opening and closing balances for the period."""
    start, end = _utc(start), _utc(end)
    before = await _deposit_flows(session, tenant.id, None, start) if start is not None else None
    period = await _deposit_flows(session, tenant.id, start, end)
    opening = _net(before) if before is not None else 0
    deposits = HeldMoneyBucket(
        opening_cents=opening,
        collected_cents=period["collected"],
        redeemed_cents=period["redeemed"],
        refunded_cents=period["refunded"],
        moved_to_wallet_cents=period["to_wallet"],
        forfeited_cents=period["forfeited"],
        closing_cents=opening + _net(period),
    )

    async def wallet_sum(low: datetime | None, high: datetime | None, sign: str | None) -> int:
        query = select(func.coalesce(func.sum(WalletTransaction.amount_cents), 0)).where(
            WalletTransaction.tenant_id == tenant.id
        )
        if low is not None:
            query = query.where(WalletTransaction.created_at >= low)
        if high is not None:
            query = query.where(WalletTransaction.created_at < high)
        if sign == "credit":
            query = query.where(WalletTransaction.amount_cents > 0)
        elif sign == "debit":
            query = query.where(WalletTransaction.amount_cents < 0)
        return int(await session.scalar(query) or 0)

    wallet_opening = await wallet_sum(None, start, None) if start is not None else 0
    added = await wallet_sum(start, end, "credit")
    used = -await wallet_sum(start, end, "debit")
    wallet = WalletBucket(
        opening_cents=wallet_opening, added_cents=added, used_cents=used, closing_cents=wallet_opening + added - used
    )
    return LiabilitySummaryResponse(period_start=start, period_end=end, deposits=deposits, wallet=wallet)


async def list_money_owed(session: AsyncSession, tenant: Tenant) -> MoneyOwedResponse:
    """Work for staff: deposits to refund on the card device, and completed visits with a balance outstanding."""
    refunds: list[RefundOwedItem] = []
    pending = (
        await session.execute(
            select(PaymentEvent, Payment)
            .join(Payment, Payment.id == PaymentEvent.payment_id)
            .options(selectinload(Payment.customer))
            .where(
                Payment.tenant_id == tenant.id,
                PaymentEvent.kind == "refund_owed",
                Payment.status == "succeeded",
            )
            .order_by(PaymentEvent.occurred_at)
        )
    ).all()
    seen: set[str] = set()
    for event, payment in pending:
        if payment.id in seen:
            continue
        seen.add(payment.id)
        refunds.append(
            RefundOwedItem(
                payment_id=payment.id,
                booking_id=payment.booking_id,
                customer_id=payment.customer_id,
                customer_name=payment.customer.name if payment.customer else None,
                amount_cents=event.amount_cents or payment.amount_cents,
                owed_since=_utc(event.occurred_at),
                notes=event.notes,
            )
        )

    bookings = (
        await session.scalars(
            select(Booking)
            .where(
                Booking.tenant_id == tenant.id,
                Booking.status == "completed",
                Booking.payment_resolution == "follow_up",
            )
            .order_by(Booking.completed_at)
        )
    ).all()
    balances: list[BalanceOwedItem] = []
    for booking in bookings:
        full = await session.scalar(
            select(Booking)
            .options(
                selectinload(Booking.payments),
                selectinload(Booking.items),
                selectinload(Booking.payment_events),
                selectinload(Booking.service),
                selectinload(Booking.tenant),
            )
            .where(Booking.id == booking.id)
        )
        due = booking_balance_due_cents(full)
        if due <= 0:
            continue
        customer = await session.get(Customer, full.customer_id)
        balances.append(
            BalanceOwedItem(
                booking_id=full.id,
                sale_number=full.sale_number,
                customer_id=full.customer_id,
                customer_name=customer.name if customer else None,
                service_name=full.service.name if full.service else None,
                balance_due_cents=due,
                completed_at=_utc(full.completed_at),
            )
        )

    return MoneyOwedResponse(
        refunds_owed=refunds,
        balances_owed=balances,
        refunds_owed_total_cents=sum(r.amount_cents for r in refunds),
        balances_owed_total_cents=sum(b.balance_due_cents for b in balances),
    )
