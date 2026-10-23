from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class SaleSummaryRow(CamelModel):
    id: str
    sale_number: int
    customer_id: str
    customer_name: str | None = None
    completed_at: datetime
    currency: str
    subtotal_cents: int
    discount_cents: int
    tax_cents: int
    tip_cents: int
    total_cents: int
    paid_cents: int
    balance_due_cents: int


class SaleListResponse(CamelModel):
    sales: list[SaleSummaryRow]
    total: int
    limit: int
    offset: int


class ReceiptBusiness(CamelModel):
    name: str
    phone: str | None = None
    website: str | None = None
    location_name: str | None = None
    address_lines: list[str] = []


class ReceiptCustomer(CamelModel):
    id: str
    name: str
    email: str | None = None


class ReceiptLine(CamelModel):
    name: str
    kind: str
    quantity: int
    unit_price_cents: int
    line_total_cents: int
    tax_cents: int
    provider_name: str | None = None


class ReceiptPayment(CamelModel):
    payment_id: str | None = None
    method: str
    # "deposit" for money taken before the visit and applied here
    received_cents: int
    refunded_cents: int
    net_cents: int
    tip_cents: int
    card_brand: str | None = None
    card_last4: str | None = None
    paid_at: datetime | None = None


class SaleReceiptResponse(CamelModel):
    sale_id: str
    sale_number: int
    completed_at: datetime
    currency: str
    time_zone: str
    business: ReceiptBusiness
    customer: ReceiptCustomer
    lines: list[ReceiptLine]
    subtotal_cents: int
    discount_cents: int
    tax_cents: int
    tip_cents: int
    total_cents: int
    payments: list[ReceiptPayment]
    paid_cents: int
    balance_due_cents: int


class EmailReceiptRequest(CamelModel):
    # Defaults to the client's email on file.
    email: str | None = Field(default=None, max_length=254)


class EmailReceiptResponse(CamelModel):
    sale_id: str
    recipient_email: str
    sent_at: datetime


class WalletTransactionRow(CamelModel):
    id: str
    created_at: datetime
    amount_cents: int
    kind: str
    notes: str | None = None
    actor_name: str | None = None
    booking_id: str | None = None


class WalletHistoryResponse(CamelModel):
    customer_id: str
    balance_cents: int
    transactions: list[WalletTransactionRow]
