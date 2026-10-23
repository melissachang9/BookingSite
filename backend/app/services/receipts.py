"""Sales and receipts: list a client's sales, build a printable receipt, email it.

A receipt reads from the numbered sale (lines, tax, tip are the snapshot taken at checkout)
plus the sale's payments as they stand now, so a balance collected later shows up.
"""

from __future__ import annotations

import re
from datetime import datetime, timezone
from html import escape

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Customer, Location, Payment, Provider, Sale, SaleLine, Tenant, User, WalletTransaction
from app.schemas.sales import (
    EmailReceiptResponse,
    ReceiptBusiness,
    ReceiptCustomer,
    ReceiptLine,
    ReceiptPayment,
    SaleListResponse,
    SaleReceiptResponse,
    SaleSummaryRow,
    WalletHistoryResponse,
    WalletTransactionRow,
)
from app.services.audit import record_audit
from app.services.notifications import send_transactional_email
from app.services.payment_ledger import payment_received_cents, payment_refunded_cents
from app.services.sales import tender_kind_for_payment
from app.services.tenants import tenant_currency

EMAIL_PATTERN = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def _utc(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


async def _sale_payments(session: AsyncSession, sale: Sale) -> list[ReceiptPayment]:
    """The sale's payments as they stand now: what came in, what went back, what counts."""
    payments = (
        await session.scalars(
            select(Payment)
            .options(selectinload(Payment.events))
            .join(Booking, Booking.id == Payment.booking_id)
            .where(
                Booking.sale_id == sale.id,
                Booking.tenant_id == sale.tenant_id,
                Payment.status.in_(("succeeded", "refunded")),
            )
            .order_by(Payment.created_at)
        )
    ).all()
    rows: list[ReceiptPayment] = []
    for payment in payments:
        received = payment_received_cents(payment)
        refunded = payment_refunded_cents(payment)
        rows.append(
            ReceiptPayment(
                payment_id=payment.id,
                method=tender_kind_for_payment(payment),
                received_cents=received,
                refunded_cents=refunded,
                net_cents=max(received - payment.tip_cents - refunded, 0),
                tip_cents=payment.tip_cents,
                card_brand=payment.card_brand,
                card_last4=payment.card_last4,
                paid_at=_utc(payment.created_at),
            )
        )
    return rows


async def _load_sale(session: AsyncSession, tenant: Tenant, sale_id: str) -> Sale:
    sale = await session.scalar(
        select(Sale)
        .options(selectinload(Sale.lines))
        .where(Sale.id == sale_id, Sale.tenant_id == tenant.id)
    )
    if sale is None:
        raise api_exception(404, "not_found", "Sale was not found.")
    return sale


async def list_sales(
    session: AsyncSession,
    tenant: Tenant,
    *,
    customer_id: str | None = None,
    start: datetime | None = None,
    end: datetime | None = None,
    limit: int = 25,
    offset: int = 0,
) -> SaleListResponse:
    limit = max(1, min(limit, 100))
    offset = max(0, offset)
    conditions = [Sale.tenant_id == tenant.id]
    if customer_id:
        conditions.append(Sale.customer_id == customer_id)
    if start is not None:
        conditions.append(Sale.completed_at >= start)
    if end is not None:
        conditions.append(Sale.completed_at < end)

    total = int(await session.scalar(select(func.count()).select_from(Sale).where(*conditions)) or 0)
    sales = (
        await session.scalars(
            select(Sale).where(*conditions).order_by(Sale.completed_at.desc(), Sale.sale_number.desc()).limit(limit).offset(offset)
        )
    ).all()
    names = {
        c.id: c.name
        for c in (
            await session.scalars(select(Customer).where(Customer.id.in_({s.customer_id for s in sales})))
        ).all()
    } if sales else {}

    rows: list[SaleSummaryRow] = []
    for sale in sales:
        paid = sum(p.net_cents for p in await _sale_payments(session, sale))
        rows.append(
            SaleSummaryRow(
                id=sale.id,
                sale_number=sale.sale_number,
                customer_id=sale.customer_id,
                customer_name=names.get(sale.customer_id),
                completed_at=_utc(sale.completed_at),
                currency=sale.currency,
                subtotal_cents=sale.subtotal_cents,
                discount_cents=sale.discount_cents,
                tax_cents=sale.tax_cents,
                tip_cents=sale.tip_cents,
                total_cents=sale.total_cents,
                paid_cents=paid,
                balance_due_cents=max(sale.total_cents - paid, 0),
            )
        )
    return SaleListResponse(sales=rows, total=total, limit=limit, offset=offset)


async def get_receipt(session: AsyncSession, tenant: Tenant, sale_id: str) -> SaleReceiptResponse:
    sale = await _load_sale(session, tenant, sale_id)
    customer = await session.get(Customer, sale.customer_id)
    location = await session.get(Location, sale.location_id) if sale.location_id else None
    provider_ids = {line.provider_id for line in sale.lines if line.provider_id}
    provider_names = (
        {p.id: p.name for p in (await session.scalars(select(Provider).where(Provider.id.in_(provider_ids)))).all()}
        if provider_ids
        else {}
    )

    address_lines: list[str] = []
    if location is not None:
        street = ", ".join(part for part in (location.address_line1, location.address_line2) if part)
        city = " ".join(part for part in (location.city, location.state, location.postal_code) if part)
        address_lines = [part for part in (street, city) if part]

    settings = tenant.settings_json if isinstance(tenant.settings_json, dict) else {}
    branding = tenant.branding_json if isinstance(tenant.branding_json, dict) else {}
    payments = await _sale_payments(session, sale)
    paid = sum(p.net_cents for p in payments)

    return SaleReceiptResponse(
        sale_id=sale.id,
        sale_number=sale.sale_number,
        completed_at=_utc(sale.completed_at),
        currency=sale.currency or tenant_currency(tenant),
        time_zone=(location.time_zone if location is not None and location.time_zone else tenant.timezone),
        business=ReceiptBusiness(
            name=tenant.name,
            phone=(location.phone if location is not None and location.phone else settings.get("smsPhone")),
            website=branding.get("homepageUrl"),
            location_name=location.name if location is not None else None,
            address_lines=address_lines,
        ),
        customer=ReceiptCustomer(
            id=sale.customer_id,
            name=customer.name if customer else "Client",
            email=customer.email if customer else None,
        ),
        lines=[
            ReceiptLine(
                name=line.name,
                kind=line.kind,
                quantity=line.quantity,
                unit_price_cents=line.unit_price_cents,
                line_total_cents=line.unit_price_cents * line.quantity,
                tax_cents=line.tax_cents,
                provider_name=provider_names.get(line.provider_id) if line.provider_id else None,
            )
            for line in sorted(sale.lines, key=lambda l: l.created_at)
        ],
        subtotal_cents=sale.subtotal_cents,
        discount_cents=sale.discount_cents,
        tax_cents=sale.tax_cents,
        tip_cents=sale.tip_cents,
        total_cents=sale.total_cents,
        payments=payments,
        paid_cents=paid,
        balance_due_cents=max(sale.total_cents - paid, 0),
    )


def _money(cents: int, currency: str) -> str:
    symbol = {"USD": "$", "CAD": "$", "AUD": "$", "MXN": "$", "EUR": "€", "GBP": "£"}.get(currency, "")
    prefix = symbol or f"{currency} "
    sign = "-" if cents < 0 else ""
    return f"{sign}{prefix}{abs(cents) / 100:,.2f}"


def _method_label(method: str) -> str:
    return {"deposit": "Deposit", "card": "Card", "cash": "Cash", "external_pos": "External POS", "wallet": "Wallet credit"}.get(
        method, method.replace("_", " ").title()
    )


def render_receipt(receipt: SaleReceiptResponse) -> tuple[str, str, str]:
    """(subject, plain text, html) for the receipt email."""
    from zoneinfo import ZoneInfo

    local = receipt.completed_at.astimezone(ZoneInfo(receipt.time_zone))
    when = local.strftime("%b %d, %Y at %I:%M %p").replace(" 0", " ")
    cur = receipt.currency
    subject = f"Your receipt from {receipt.business.name} (#{receipt.sale_number})"

    text = [f"{receipt.business.name}", *receipt.business.address_lines, "", f"Receipt #{receipt.sale_number} - {when}", ""]
    html_rows: list[str] = []
    for line in receipt.lines:
        qty = f" x{line.quantity}" if line.quantity != 1 else ""
        text.append(f"{line.name}{qty}: {_money(line.line_total_cents, cur)}")
        html_rows.append(
            f"<tr><td>{escape(line.name)}{escape(qty)}</td><td style='text-align:right'>{_money(line.line_total_cents, cur)}</td></tr>"
        )
    totals = [("Subtotal", receipt.subtotal_cents)]
    if receipt.discount_cents:
        totals.append(("Discount", -receipt.discount_cents))
    totals.append(("Tax", receipt.tax_cents))
    if receipt.tip_cents:
        totals.append(("Tip", receipt.tip_cents))
    totals.append(("Total", receipt.total_cents + receipt.tip_cents))
    text.append("")
    for label, cents in totals:
        text.append(f"{label}: {_money(cents, cur)}")
        weight = "700" if label == "Total" else "400"
        html_rows.append(
            f"<tr style='font-weight:{weight}'><td>{label}</td><td style='text-align:right'>{_money(cents, cur)}</td></tr>"
        )
    text.append("")
    text.append("Paid:")
    for payment in receipt.payments:
        detail = _method_label(payment.method)
        if payment.card_brand and payment.card_last4:
            detail += f" ({payment.card_brand} ending {payment.card_last4})"
        text.append(f"  {detail}: {_money(payment.net_cents + payment.tip_cents, cur)}")
        html_rows.append(
            f"<tr><td style='color:#666'>Paid - {escape(detail)}</td><td style='text-align:right;color:#666'>"
            f"{_money(payment.net_cents + payment.tip_cents, cur)}</td></tr>"
        )
    if receipt.balance_due_cents:
        text.append(f"Balance due: {_money(receipt.balance_due_cents, cur)}")
        html_rows.append(
            f"<tr style='font-weight:700'><td>Balance due</td><td style='text-align:right'>{_money(receipt.balance_due_cents, cur)}</td></tr>"
        )
    text.append("")
    text.append("Thank you!")

    address = "<br>".join(escape(line) for line in receipt.business.address_lines)
    html = (
        "<div style='font-family:Arial,sans-serif;max-width:480px;margin:0 auto;color:#15110f'>"
        f"<h2 style='margin:0'>{escape(receipt.business.name)}</h2><p style='color:#666;margin:4px 0 16px'>{address}</p>"
        f"<p>Receipt #{receipt.sale_number} &middot; {escape(when)}</p>"
        f"<table style='width:100%;border-collapse:collapse'>{''.join(html_rows)}</table>"
        "<p style='color:#666;margin-top:24px'>Thank you!</p></div>"
    )
    return subject, "\n".join(text), html


async def email_receipt(
    session: AsyncSession, tenant: Tenant, sale_id: str, *, email: str | None, actor: User
) -> EmailReceiptResponse:
    receipt = await get_receipt(session, tenant, sale_id)
    recipient = (email or receipt.customer.email or "").strip()
    if not recipient:
        raise api_exception(409, "conflict", "This client has no email on file. Enter an email address to send the receipt.")
    if not EMAIL_PATTERN.match(recipient):
        raise api_exception(422, "validation_error", "Enter a valid email address.")

    subject, text_body, html_body = render_receipt(receipt)
    await send_transactional_email(recipient_email=recipient, subject=subject, text_body=text_body, html_body=html_body)
    sent_at = datetime.now(timezone.utc)
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="sale",
        entity_id=sale_id,
        action="receipt_emailed",
        actor=actor,
        changes={"recipient": recipient, "saleNumber": receipt.sale_number},
    )
    await session.commit()
    return EmailReceiptResponse(sale_id=sale_id, recipient_email=recipient, sent_at=sent_at)


async def wallet_history(session: AsyncSession, tenant: Tenant, customer_id: str, limit: int = 100) -> WalletHistoryResponse:
    customer = await session.scalar(select(Customer).where(Customer.id == customer_id, Customer.tenant_id == tenant.id))
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found.")
    rows = (
        await session.scalars(
            select(WalletTransaction)
            .where(WalletTransaction.tenant_id == tenant.id, WalletTransaction.customer_id == customer_id)
            .order_by(WalletTransaction.created_at.desc(), WalletTransaction.id.desc())
            .limit(max(1, min(limit, 200)))
        )
    ).all()
    return WalletHistoryResponse(
        customer_id=customer.id,
        balance_cents=customer.wallet_balance_cents,
        transactions=[
            WalletTransactionRow(
                id=row.id,
                created_at=_utc(row.created_at),
                amount_cents=row.amount_cents,
                kind=row.kind,
                notes=row.notes,
                actor_name=row.actor_name,
                booking_id=row.booking_id,
            )
            for row in rows
        ],
    )
