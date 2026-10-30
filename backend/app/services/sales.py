"""Sales: the numbered record of a completed checkout.

A sale is written once, when a visit is checked out, and never edited. Deposits and
other money taken earlier stay payments against the client; the sale just lists what
was sold, the tax and any tip, and its number.
"""

from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import Booking, BookingItem, Sale, SaleLine, SaleSequence, SaleTender, SaleTip, Service, ServiceAddOn, User
from app.services.presenters import booking_price_cents, booking_tax_cents
from app.services.service_terms import effective_taxable
from app.services.tenants import tenant_currency


# Payments taken before the visit that sit as money held for the client until checkout.
DEPOSIT_CHECKOUT_KINDS = ("deposit", "deposit_in_person")


def tender_kind_for_payment(payment) -> str:
    return "deposit" if payment.checkout_session_kind in DEPOSIT_CHECKOUT_KINDS else payment.payment_method_type


async def allocate_sale_number(session: AsyncSession, tenant_id: str) -> int:
    """Next number for this business. Runs inside the checkout transaction, so a
    rolled-back checkout hands the number back and the sequence stays gap-free."""
    for _ in range(2):
        result = await session.execute(
            update(SaleSequence)
            .where(SaleSequence.tenant_id == tenant_id)
            .values(last_number=SaleSequence.last_number + 1)
        )
        if result.rowcount:
            number = await session.scalar(
                select(SaleSequence.last_number).where(SaleSequence.tenant_id == tenant_id)
            )
            return int(number)
        try:
            async with session.begin_nested():
                session.add(SaleSequence(tenant_id=tenant_id, last_number=0))
                await session.flush()
        except IntegrityError:
            pass  # another checkout created it first; the retry increments it
    raise RuntimeError("Could not allocate a sale number")


def _allocate_proportionally(total: int, weights: list[int]) -> list[int]:
    """Split `total` across weights, whole cents, remainder to the largest weights first."""
    weight_sum = sum(weights)
    if total <= 0 or weight_sum <= 0:
        return [0] * len(weights)
    shares = [total * weight // weight_sum for weight in weights]
    remainder = total - sum(shares)
    for index in sorted(range(len(weights)), key=lambda i: -weights[i])[:remainder]:
        shares[index] += 1
    return shares


async def _add_on_costs(session: AsyncSession, bookings: list[Booking]) -> dict[str, int | None]:
    ids = {item.source_add_on_id for booking in bookings for item in booking.items if item.source_add_on_id}
    if not ids:
        return {}
    rows = await session.execute(select(ServiceAddOn.id, ServiceAddOn.cost_cents).where(ServiceAddOn.id.in_(ids)))
    return {add_on_id: cost for add_on_id, cost in rows.all()}


async def _service_costs(session: AsyncSession, bookings: list[Booking]) -> dict[str, int | None]:
    ids = {item.source_service_id for booking in bookings for item in booking.items if item.source_service_id}
    if not ids:
        return {}
    rows = await session.execute(select(Service.id, Service.cost_cents).where(Service.id.in_(ids)))
    return {service_id: cost for service_id, cost in rows.all()}


def _item_unit_cost(
    item: BookingItem, add_on_costs: dict[str, int | None], service_costs: dict[str, int | None]
) -> int | None:
    """Cost of one unit of a checkout item: the catalog cost behind an add-on or service, or the cost
    typed in for a retail product. Null when none was entered."""
    if item.source_add_on_id:
        return add_on_costs.get(item.source_add_on_id)
    if item.source_service_id:
        return service_costs.get(item.source_service_id)
    return item.cost_cents


async def create_sale_for_bookings(
    session: AsyncSession,
    bookings: list[Booking],
    *,
    discounts: dict[str, int],
    actor: User,
    tip_split: list[tuple[str, int]] | None = None,
) -> Sale:
    """Record one sale for one or more bookings of the same client being checked out together.

    Call after each booking's `tax_cents` is set. `discounts` maps booking id to its discount.
    `tip_split` overrides the default split of the tip across providers; it must add up to the tip.
    """
    first = bookings[0]
    if any(b.customer_id != first.customer_id or b.tenant_id != first.tenant_id for b in bookings):
        raise api_exception(409, "conflict", "A group checkout must be for one client.")
    sale_number = await allocate_sale_number(session, first.tenant_id)
    now = datetime.now(timezone.utc)

    add_on_costs = await _add_on_costs(session, bookings)
    service_costs = await _service_costs(session, bookings)
    lines: list[SaleLine] = []
    taxable_flags: list[bool] = []
    tax_total = 0
    for booking in bookings:
        service_taxable = effective_taxable(booking.service)[0]
        lines.append(
            SaleLine(
                tenant_id=booking.tenant_id,
                booking_id=booking.id,
                kind="service",
                name=booking.service.name,
                quantity=1,
                unit_price_cents=booking_price_cents(booking),
                unit_cost_cents=booking.service.cost_cents,
                provider_id=booking.provider_id,
            )
        )
        taxable_flags.append(service_taxable)
        for item in booking.items:
            lines.append(
                SaleLine(
                    tenant_id=booking.tenant_id,
                    booking_id=booking.id,
                    kind="product" if item.kind == "product" else "add_on",
                    name=item.name,
                    quantity=item.quantity,
                    unit_price_cents=item.price_cents,
                    unit_cost_cents=_item_unit_cost(item, add_on_costs, service_costs),
                    provider_id=booking.provider_id,
                )
            )
            taxable_flags.append(item.kind == "product" or service_taxable)
        tax_total += booking.tax_cents if booking.tax_cents is not None else booking_tax_cents(booking)

    # Each booking's tax is authoritative; spread the total over the taxable lines by value.
    weights = [
        line.unit_price_cents * line.quantity if taxable else 0 for line, taxable in zip(lines, taxable_flags)
    ]
    for line, share in zip(lines, _allocate_proportionally(tax_total, weights)):
        line.tax_cents = share

    subtotal = sum(line.unit_price_cents * line.quantity for line in lines)
    discount_total = sum(discounts.get(booking.id, 0) for booking in bookings)

    tenders = [
        SaleTender(
            tenant_id=payment.tenant_id,
            payment_id=payment.id,
            kind=tender_kind_for_payment(payment),
            amount_cents=max(payment.amount_cents - payment.tip_cents, 0),
            tip_cents=payment.tip_cents,
        )
        for booking in bookings
        for payment in booking.payments
        if payment.status == "succeeded"
    ]
    tip_total = sum(t.tip_cents for t in tenders)

    sale = Sale(
        tenant_id=first.tenant_id,
        sale_number=sale_number,
        customer_id=first.customer_id,
        location_id=first.location_id,
        status="completed",
        currency=tenant_currency(first.tenant),
        subtotal_cents=subtotal,
        discount_cents=discount_total,
        tax_cents=tax_total,
        tip_cents=tip_total,
        total_cents=max(subtotal - discount_total, 0) + tax_total,
        completed_at=now,
        completed_by_user_id=actor.id,
        lines=lines,
        tenders=tenders,
    )

    if tip_total > 0:
        for provider_id, share in _tip_shares(lines, bookings, tip_total, tip_split):
            sale.tips.append(SaleTip(tenant_id=first.tenant_id, provider_id=provider_id, amount_cents=share))

    session.add(sale)
    await session.flush()
    for booking in bookings:
        booking.sale_id = sale.id
        booking.sale_number = sale_number
    return sale


def _tip_shares(
    lines: list[SaleLine],
    bookings: list[Booking],
    tip_total: int,
    tip_split: list[tuple[str, int]] | None,
) -> list[tuple[str, int]]:
    if tip_split is not None:
        if any(cents < 0 for _, cents in tip_split) or sum(cents for _, cents in tip_split) != tip_total:
            raise api_exception(409, "conflict", "Tip shares must add up to the tip left on this sale.")
        on_sale = {line.provider_id for line in lines if line.provider_id}
        if any(provider_id not in on_sale for provider_id, _ in tip_split):
            raise api_exception(409, "conflict", "A tip can only be shared with providers on this sale.")
        merged: dict[str, int] = {}
        for provider_id, cents in tip_split:
            merged[provider_id] = merged.get(provider_id, 0) + cents
        return [(pid, cents) for pid, cents in merged.items() if cents > 0]

    # Default: in proportion to the service value each provider performed.
    values: dict[str, int] = {}
    for line in lines:
        if line.kind != "product" and line.provider_id:
            values[line.provider_id] = values.get(line.provider_id, 0) + line.unit_price_cents * line.quantity
    provider_ids = list(values) or [bookings[0].provider_id]
    weights = [values.get(pid, 1) for pid in provider_ids]
    return [
        (pid, share) for pid, share in zip(provider_ids, _allocate_proportionally(tip_total, weights)) if share > 0
    ]


async def create_sale_for_booking(
    session: AsyncSession,
    booking: Booking,
    *,
    discount_cents: int,
    actor: User,
) -> Sale:
    return await create_sale_for_bookings(
        session, [booking], discounts={booking.id: discount_cents}, actor=actor
    )
