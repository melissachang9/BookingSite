"""Seed a week of bookings + provider availability for the demo tenant.

Run from the repo root with the backend on the path:

    PYTHONPATH=backend python scripts/seed_calendar_week.py

Idempotent: deletes existing bookings for the demo tenant, then re-seeds a
deterministic week (Sun-Sat) so the operator calendar renders chips.

The week is anchored to "today" (America/Los_Angeles). Bookings are stored as
timezone-aware datetimes in the tenant timezone so the dashboard's
America/Los_Angeles formatters bucket them onto the correct day.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, time, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select

from app.db.models import (
    Booking,
    Customer,
    Provider,
    ProviderSchedule,
    ProviderTimeOff,
    Service,
    Tenant,
)
from app.db.session import get_session_maker

TENANT_SLUG = "brow-beauty-lab"
LA = ZoneInfo("America/Los_Angeles")


def _la(d: datetime, hour: int, minute: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=LA)


async def main() -> None:
    async with get_session_maker()() as session:
        tenant = await session.scalar(select(Tenant).where(Tenant.slug == TENANT_SLUG))
        if tenant is None:
            print("Tenant not found")
            return

        provider = await session.scalar(
            select(Provider).where(Provider.tenant_id == tenant.id, Provider.is_active.is_(True))
        )
        if provider is None:
            print("No active provider found")
            return

        services = {
            s.name: s
            for s in (await session.scalars(select(Service).where(Service.tenant_id == tenant.id))).all()
        }
        facial = services.get("Signature Facial")
        consult = services.get("New Client Consultation")
        brow = services.get("Brow Shape and Tint")
        if not all([facial, consult, brow]):
            print("Missing services:", [k for k, v in [("facial", facial), ("consult", consult), ("brow", brow)] if v is None])
            return

        # --- wipe existing bookings for a clean, deterministic week ---
        # Bookings are referenced by several child tables (payments, payment
        # events, form responses, wallet transactions, drafts + their form
        # requirements). Delete children first so the parent delete doesn't trip
        # the FK constraints.
        from app.db.models import (
            BookingDraft,
            BookingDraftFormRequirement,
            BookingPaymentEvent,
            FormResponse,
            Payment,
            PaymentEvent,
            WalletTransaction,
        )
        booking_ids_q = select(Booking.id).where(Booking.tenant_id == tenant.id)
        await session.execute(delete(BookingPaymentEvent).where(BookingPaymentEvent.booking_id.in_(booking_ids_q)))
        payment_ids_q = select(Payment.id).where(Payment.booking_id.in_(booking_ids_q))
        await session.execute(delete(PaymentEvent).where(PaymentEvent.payment_id.in_(payment_ids_q)))
        await session.execute(delete(Payment).where(Payment.booking_id.in_(booking_ids_q)))
        await session.execute(delete(FormResponse).where(FormResponse.booking_id.in_(booking_ids_q)))
        await session.execute(delete(WalletTransaction).where(WalletTransaction.booking_id.in_(booking_ids_q)))
        draft_ids_q = select(BookingDraft.id).where(BookingDraft.tenant_id == tenant.id)
        await session.execute(delete(BookingDraftFormRequirement).where(BookingDraftFormRequirement.booking_draft_id.in_(draft_ids_q)))
        await session.execute(delete(BookingDraft).where(BookingDraft.tenant_id == tenant.id))
        await session.execute(delete(Booking).where(Booking.tenant_id == tenant.id))
        await session.execute(delete(ProviderTimeOff).where(ProviderTimeOff.tenant_id == tenant.id))

        # --- ensure Sunday is open so "today" can host the in-progress booking ---
        # Existing schedules: Wed(2) 12-17, Thu(3) 12-17, Fri(4) 12-17, Sat(5) 10-17.
        # Add Sun(6) 10-21 and Mon(0) 10-17; leave Tue(1) closed as the fully-closed day.
        existing_weekdays = {
            s.weekday
            for s in (await session.scalars(select(ProviderSchedule).where(ProviderSchedule.tenant_id == tenant.id))).all()
        }
        for weekday, start, end in [(6, 10, 21), (0, 10, 17)]:
            if weekday not in existing_weekdays:
                session.add(
                    ProviderSchedule(
                        tenant_id=tenant.id,
                        provider_id=provider.id,
                        weekday=weekday,
                        start_time=time(start, 0),
                        end_time=time(end, 0),
                        is_active=True,
                    )
                )

        # --- customers ---
        customer_specs = [
            ("Ivy Chen", "ivy.chen@example.com", "555-0101"),
            ("Maya Sharif", "maya.sharif@example.com", "555-0102"),
            ("Tom Reyes", "tom.reyes@example.com", "555-0103"),
            ("Leah Barnes", "leah.barnes@example.com", "555-0104"),
            ("Anouk V.", "anouk.v@example.com", "555-0105"),
            ("Joy Adebayo", "joy.adebayo@example.com", "555-0106"),
            ("Zoe Adeyemi", "zoe.adeyemi@example.com", "555-0107"),
            ("Hana Ito", "hana.ito@example.com", "555-0108"),
        ]
        customers: dict[str, Customer] = {}
        for name, email, phone in customer_specs:
            existing = await session.scalar(select(Customer).where(Customer.tenant_id == tenant.id, Customer.email == email))
            if existing is not None:
                customers[name] = existing
            else:
                c = Customer(tenant_id=tenant.id, name=name, email=email, phone=phone)
                session.add(c)
                customers[name] = c
        await session.flush()

        # --- anchor the week to today (Sun) ---
        today = datetime.now(LA).date()
        # today is Sunday; offsets: Sun=0, Mon=1, Tue=2, Wed=3, Thu=4, Fri=5, Sat=6
        sun = today
        wed = today + timedelta(days=3)
        thu = today + timedelta(days=4)
        fri = today + timedelta(days=5)
        sat = today + timedelta(days=6)

        # --- bookings: (customer, service, day, hour, minute, status, deposit, resolution) ---
        # Services actually seeded: Signature Facial(60), Brow Shape and Tint(45),
        # New Client Consultation(30). Populate across every open day this week.
        svc_rotate = (facial, brow, consult)
        specs = [
            # --- Sun (today) — in-progress + a morning + afternoon ---
            (customer_specs[0][0], facial, sun, 10, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[1][0], brow, sun, 12, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[2][0], facial, sun, 14, 0, "completed", "paid", "collected"),
            # --- Mon ---
            (customer_specs[3][0], brow, sun + timedelta(days=1), 10, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[4][0], facial, sun + timedelta(days=1), 11, 30, "confirmed", "paid", "pending_initial"),
            (customer_specs[5][0], consult, sun + timedelta(days=1), 13, 0, "confirmed", "not_required", "waived"),
            (customer_specs[0][0], facial, sun + timedelta(days=1), 15, 30, "confirmed", "paid", "pending_initial"),
            # --- Wed ---
            (customer_specs[6][0], facial, wed, 12, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[7][0], consult, wed, 14, 0, "confirmed", "not_required", "waived"),
            (customer_specs[1][0], brow, wed, 16, 0, "confirmed", "paid", "pending_initial"),
            # --- Thu (two concurrent 13:00 for lanes) ---
            (customer_specs[3][0], facial, thu, 13, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[4][0], brow, thu, 13, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[5][0], consult, thu, 15, 30, "confirmed", "not_required", "waived"),
            # --- Fri: completed + canceled ---
            (customer_specs[6][0], facial, fri, 12, 0, "completed", "paid", "collected"),
            (customer_specs[7][0], brow, fri, 15, 0, "canceled", "refunded", "waived"),
            (customer_specs[0][0], consult, fri, 17, 30, "confirmed", "not_required", "waived"),
            # --- Sat (worked examples + a 30-min) ---
            (customer_specs[1][0], facial, sat, 10, 0, "confirmed", "paid", "pending_initial"),
            (customer_specs[2][0], brow, sat, 11, 30, "confirmed", "paid", "pending_initial"),
            (customer_specs[3][0], consult, sat, 14, 0, "confirmed", "not_required", "waived"),
        ]

        # ensure provider can offer these services before booking them
        from app.db.models import ProviderService, ServiceLocation
        for svc in svc_rotate:
            exists = await session.scalar(
                select(ProviderService).where(
                    ProviderService.tenant_id == tenant.id,
                    ProviderService.provider_id == provider.id,
                    ProviderService.service_id == svc.id,
                )
            )
            if exists is None:
                session.add(ProviderService(tenant_id=tenant.id, provider_id=provider.id, service_id=svc.id))

        created_calendar_bookings: list = []
        for name, service, day, hour, minute, status, deposit, resolution in specs:
            starts_at = _la(datetime(day.year, day.month, day.day), hour, minute)
            ends_at = starts_at + timedelta(minutes=service.duration_minutes)
            completed_at = ends_at if status == "completed" else None
            canceled_at = _la(datetime(day.year, day.month, day.day), 18) if status == "canceled" else None
            booking = Booking(
                tenant_id=tenant.id,
                customer_id=customers[name].id,
                service_id=service.id,
                provider_id=provider.id,
                status=status,
                booking_method="public_online",
                deposit_status=deposit,
                payment_resolution=resolution,
                starts_at=starts_at,
                ends_at=ends_at,
                completed_at=completed_at,
                canceled_at=canceled_at,
            )
            session.add(booking)
            created_calendar_bookings.append((booking, name, service, status, resolution))
        await session.flush()

        # --- payments: realise the deposit (and, for completed bookings, the
        # collected balance) as immutable Payment records + events, so the
        # deposit actually reduces the balance the operator sees at checkout. ---
        for booking, name, service, status, resolution in created_calendar_bookings:
            if service.deposit_cents > 0 and booking.deposit_status in ("paid", "refunded"):
                dep_status = "succeeded" if booking.deposit_status == "paid" else "refunded"
                session.add(
                    Payment(
                        tenant_id=tenant.id,
                        booking_id=booking.id,
                        customer_id=customers[name].id,
                        status=dep_status,
                        deposit_status="paid",
                        amount_cents=service.deposit_cents,
                        currency="USD",
                        payment_method_type="card",
                        checkout_session_kind="stripe_deposit_checkout",
                        checkout_session_id=f"seed_deposit_{booking.id}",
                    )
                )
                session.add(
                    BookingPaymentEvent(
                        tenant_id=tenant.id,
                        booking_id=booking.id,
                        event_kind="stripe_deposit_checkout",
                        amount_cents=service.deposit_cents,
                        payload_json={"status": dep_status, "session_id": f"seed_deposit_{booking.id}"},
                    )
                )
            if status == "completed" and resolution == "collected":
                balance_due = max(0, service.price_cents - service.deposit_cents)
                if balance_due > 0:
                    session.add(
                        Payment(
                            tenant_id=tenant.id,
                            booking_id=booking.id,
                            customer_id=customers[name].id,
                            status="succeeded",
                            deposit_status="paid",
                            amount_cents=balance_due,
                            currency="USD",
                            payment_method_type="card",
                            checkout_session_kind="stripe_balance_checkout",
                            checkout_session_id=f"seed_balance_{booking.id}",
                        )
                    )
                    session.add(
                        BookingPaymentEvent(
                            tenant_id=tenant.id,
                            booking_id=booking.id,
                            event_kind="stripe_balance_checkout",
                            amount_cents=balance_due,
                            payload_json={"status": "succeeded", "session_id": f"seed_balance_{booking.id}"},
                        )
                    )

        # --- a custom_hours time-off block (renders as a hatched "time block") ---
        # Sat 13:00-14:00 lunch block
        session.add(
            ProviderTimeOff(
                tenant_id=tenant.id,
                provider_id=provider.id,
                starts_at=_la(datetime(sat.year, sat.month, sat.day), 13, 0),
                ends_at=_la(datetime(sat.year, sat.month, sat.day), 14, 0),
                reason="Lunch",
                override_type="custom_hours",
                start_time=time(13, 0),
                end_time=time(14, 0),
            )
        )

        await session.commit()
        print(f"Seeded {len(specs)} bookings for {tenant.name} (provider {provider.name})")
        print(f"Week: {sun} .. {sat}")
        print("Open days: Sun, Mon, Wed, Thu, Fri, Sat; closed: Tue")


asyncio.run(main())
