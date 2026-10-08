"""Opt-in demo history for the Reports dashboard.

Adds ~90 days of realistic activity (clients across sources, completed visits
with tips/add-ons/discounts, no-shows, cancellations, refunds, abandoned
drafts) to the demo tenant. It is NOT run at startup because other tests and
E2E flows rely on the small default dataset.

    docker compose exec backend python -m app.db.seed_reports [--days 90] [--tenant brow-beauty-lab]

Idempotent: re-running does nothing once the marker clients exist.
"""

from __future__ import annotations

import argparse
import asyncio
import random
from datetime import datetime, timedelta, timezone

from sqlalchemy import select

from app.db.models import (
    Booking,
    BookingDraft,
    BookingItem,
    BookingPaymentEvent,
    Customer,
    Location,
    Payment,
    PaymentEvent,
    Provider,
    ProviderTimeOff,
    Service,
    Tenant,
)
from app.db.session import get_session_maker, initialize_database
from app.services.presenters import booking_subtotal_cents

MARKER_DOMAIN = "report-demo.example"
FIRST_NAMES = [
    "Ava", "Noah", "Mia", "Liam", "Zoe", "Ethan", "Ivy", "Lucas", "Nora", "Owen", "Ella", "Mason",
    "Ruby", "Leo", "Chloe", "Jack", "Lily", "Henry", "Grace", "Isaac", "Hazel", "Caleb", "Maya",
    "Eli", "Stella", "Ryan", "Aria", "Dylan", "Layla", "Evan",
]
LAST_NAMES = ["Stone", "Reyes", "Nguyen", "Khan", "Moore", "Silva", "Cole", "Park", "Bennett", "Ortiz", "Frost", "Lane"]
SOURCES = ["online", "online", "online", "referral", "instagram", "google", "walk_in", "staff_entered"]
CANCEL_REASONS = ["Schedule conflict", "Feeling unwell", "Found another provider", "Weather", "Provider unavailable"]
ADD_ONS = [("Brow lamination add-on", 3500), ("Lash tint", 2500), ("Hydrating mask", 3000), ("LED therapy", 4500)]
PAYMENT_METHODS = ["card", "card", "stripe", "cash", "external_pos"]


async def seed_report_history(tenant_slug: str = "brow-beauty-lab", days: int = 90, seed: int = 7) -> str:
    rng = random.Random(seed)
    async with get_session_maker()() as session:
        tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
        if tenant is None:
            return f"Tenant {tenant_slug!r} not found."
        already = await session.scalar(
            select(Customer.id).where(Customer.tenant_id == tenant.id, Customer.email.like(f"%@{MARKER_DOMAIN}")).limit(1)
        )
        if already is not None:
            return "Report demo history already present; nothing to do."

        services = list((await session.scalars(select(Service).where(Service.tenant_id == tenant.id, Service.is_active.is_(True)))).all())
        providers = list((await session.scalars(select(Provider).where(Provider.tenant_id == tenant.id, Provider.is_active.is_(True)))).all())
        locations = list((await session.scalars(select(Location).where(Location.tenant_id == tenant.id))).all())
        if not services or not providers or not locations:
            return "Tenant has no services/providers/locations to build history from."

        # Give the demo providers different pay models so the Team report shows commission.
        for index, provider in enumerate(providers):
            if provider.compensation_mode in (None, "", "none"):
                if index % 2 == 0:
                    provider.compensation_mode = "service_percent"
                    provider.compensation_service_percent_bp = 4500
                else:
                    provider.compensation_mode = "hourly"
                    provider.compensation_hourly_cents = 2800

        now = datetime.now(timezone.utc)
        customers: list[Customer] = []
        for index in range(36):
            name = f"{FIRST_NAMES[index % len(FIRST_NAMES)]} {LAST_NAMES[(index * 5) % len(LAST_NAMES)]}"
            acquired = now - timedelta(days=rng.randint(5, days + 40))
            customer = Customer(
                tenant_id=tenant.id,
                name=name,
                email=f"{name.lower().replace(' ', '.')}.{index}@{MARKER_DOMAIN}",
                phone=f"555-02{index:02d}",
                source_channel=rng.choice(SOURCES),
                acquired_at=acquired,
                wallet_balance_cents=rng.choice([0, 0, 0, 2500, 5000]),
            )
            session.add(customer)
            customers.append(customer)
        await session.flush()

        # Regulars get picked far more often, so retention and rebooking look real.
        weights = [8 if i < 8 else 3 if i < 20 else 1 for i in range(len(customers))]

        total = 0
        for offset in range(-days, 11):
            day = (now + timedelta(days=offset)).replace(hour=0, minute=0, second=0, microsecond=0)
            if day.weekday() == 6:  # closed Sundays
                continue
            for _ in range(rng.randint(2, 6)):
                customer = rng.choices(customers, weights=weights)[0]
                service = rng.choice(services)
                provider = rng.choice(providers)
                location = rng.choice(locations)
                starts_at = day + timedelta(hours=rng.randint(16, 23), minutes=rng.choice([0, 15, 30, 45]))  # ~9-4pm Pacific
                minutes = service.duration_minutes or 60
                future = starts_at > now
                roll = rng.random()
                status = "confirmed" if future else "completed" if roll < 0.78 else "no_show" if roll < 0.87 else "canceled"
                if future and roll > 0.92:
                    status = "canceled"
                lead_days = rng.choice([0, 1, 2, 3, 5, 7, 10, 14, 21, 35])
                created = starts_at - timedelta(days=lead_days, hours=rng.randint(0, 20))
                booking = Booking(
                    tenant_id=tenant.id,
                    customer_id=customer.id,
                    service_id=service.id,
                    provider_id=provider.id,
                    location_id=location.id,
                    status=status,
                    booking_method="staff_entered" if rng.random() < 0.18 else "public_online",
                    deposit_status="paid",
                    payment_resolution="collected" if status == "completed" else "pending_initial",
                    starts_at=starts_at,
                    ends_at=starts_at + timedelta(minutes=minutes),
                    price_cents=service.price_cents,
                    deposit_cents=service.deposit_cents,
                    source_channel=rng.choice(["online", "online", "referral", "staff_entered", "instagram"]),
                    created_at=min(created, now),
                )
                if rng.random() < 0.08 and status in ("confirmed", "completed"):
                    booking.reschedule_count = 1
                    booking.rescheduled_from_starts_at = starts_at - timedelta(days=rng.randint(1, 6))
                session.add(booking)
                await session.flush()
                total += 1

                if status == "canceled":
                    lead_hours = rng.choice([1, 3, 6, 30, 48, 96])
                    booking.canceled_at = starts_at - timedelta(hours=lead_hours)
                    booking.canceled_by = rng.choice(["customer", "customer", "staff"])
                    booking.cancel_reason = rng.choice(CANCEL_REASONS)
                    continue
                if status == "no_show":
                    booking.no_show_at = starts_at + timedelta(minutes=20)
                    continue
                if status == "confirmed":
                    continue

                # Completed visit: timing, items, discount, tip, payments.
                booking.completed_at = starts_at + timedelta(minutes=minutes + rng.randint(0, 10))
                booking.checked_in_at = starts_at - timedelta(minutes=rng.randint(0, 12))
                booking.service_started_at = starts_at + timedelta(minutes=rng.randint(-2, 15))
                if rng.random() < 0.32:
                    name, price = rng.choice(ADD_ONS)
                    session.add(BookingItem(tenant_id=tenant.id, booking_id=booking.id, name=name, price_cents=price, quantity=1))
                await session.flush()
                await session.refresh(booking, attribute_names=["items"])
                await session.refresh(tenant)
                subtotal = booking_subtotal_cents(booking)
                tax_rate = float((tenant.settings_json or {}).get("taxRatePercent", 0) or 0)
                booking.tax_cents = round(subtotal * tax_rate / 100)

                discount = 0
                if rng.random() < 0.12:
                    discount = rng.choice([500, 1000, 1500])
                    session.add(
                        BookingPaymentEvent(
                            tenant_id=tenant.id,
                            booking_id=booking.id,
                            event_kind="discount_applied",
                            amount_cents=discount,
                            payload_json={"discountType": "amount", "actorLabel": "Seed"},
                        )
                    )
                tip = round(subtotal * rng.choice([0, 0, 0.1, 0.15, 0.2])) if rng.random() < 0.7 else 0
                charged = subtotal + booking.tax_cents - discount
                payment = Payment(
                    tenant_id=tenant.id,
                    booking_id=booking.id,
                    customer_id=customer.id,
                    status="succeeded",
                    deposit_status="paid",
                    amount_cents=charged + tip,
                    tip_cents=tip,
                    payment_method_type=rng.choice(PAYMENT_METHODS),
                    created_at=booking.completed_at,
                )
                session.add(payment)
                await session.flush()
                if rng.random() < 0.05:
                    refund = rng.choice([1000, 2500])
                    session.add(
                        PaymentEvent(
                            tenant_id=tenant.id,
                            payment_id=payment.id,
                            kind="refund_recorded",
                            actor_type="user",
                            occurred_at=booking.completed_at + timedelta(days=1),
                            amount_cents=refund,
                        )
                    )

        # A few time-off blocks so scheduled hours aren't all identical.
        for provider in providers[:2]:
            start = (now - timedelta(days=rng.randint(10, 60))).replace(hour=7, minute=0, second=0, microsecond=0)
            session.add(
                ProviderTimeOff(
                    tenant_id=tenant.id,
                    provider_id=provider.id,
                    starts_at=start,
                    ends_at=start + timedelta(days=2, hours=16),
                    override_type="closed",
                    reason="Vacation",
                )
            )

        # Booking-funnel noise: carts that never confirmed.
        for _ in range(18):
            service = rng.choice(services)
            provider = rng.choice(providers)
            starts_at = now - timedelta(days=rng.randint(1, days), hours=rng.randint(0, 8))
            session.add(
                BookingDraft(
                    tenant_id=tenant.id,
                    service_id=service.id,
                    provider_id=provider.id,
                    location_id=rng.choice(locations).id,
                    status="expired",
                    booking_method="public_online",
                    starts_at=starts_at + timedelta(days=3),
                    ends_at=starts_at + timedelta(days=3, minutes=service.duration_minutes or 60),
                    expires_at=starts_at + timedelta(minutes=15),
                    price_cents=service.price_cents,
                    deposit_cents=service.deposit_cents,
                    duration_minutes=service.duration_minutes or 60,
                    created_at=starts_at,
                )
            )

        await session.commit()
        return f"Seeded {total} bookings for {len(customers)} clients over {days} days."


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--tenant", default="brow-beauty-lab")
    parser.add_argument("--days", type=int, default=90)
    args = parser.parse_args()

    async def run() -> None:
        await initialize_database()
        print(await seed_report_history(args.tenant, args.days))

    asyncio.run(run())


if __name__ == "__main__":
    main()
