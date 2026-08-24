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
        microneedling = services.get("microneedling")
        consult = services.get("New Client Consultation")
        brow = services.get("Brow Shape and Tint")
        xerf = services.get("XERF RF Skin Tightening – Model Pricing Service")
        if not all([facial, microneedling, consult, brow, xerf]):
            print("Missing services:", [k for k, v in [("facial", facial), ("microneedling", microneedling), ("consult", consult), ("brow", brow), ("xerf", xerf)] if v is None])
            return

        # --- wipe existing bookings for a clean, deterministic week ---
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
        specs = [
            # in-progress today (Sun): spans "now" so it renders ink-filled
            ("Hana Ito", microneedling, sun, 20, 0, "confirmed", "paid", "pending_initial"),
            # Wed 12:00 90-min (XERF) -> --top 192 / --h 92 (worked example)
            ("Maya Sharif", xerf, wed, 12, 0, "confirmed", "paid", "pending_initial"),
            # Wed 14:00 30-min (consult) -> --top 320 / --h 28
            ("Tom Reyes", consult, wed, 14, 0, "confirmed", "not_required", "waived"),
            # Thu 13:00 two concurrent 60-min (lanes)
            ("Leah Barnes", facial, thu, 13, 0, "confirmed", "paid", "pending_initial"),
            ("Anouk V.", microneedling, thu, 13, 0, "confirmed", "paid", "pending_initial"),
            # Fri completed + canceled
            ("Joy Adebayo", facial, fri, 12, 0, "completed", "paid", "collected"),
            ("Zoe Adeyemi", brow, fri, 15, 0, "canceled", "refunded", "waived"),
            # Sat 10:00 60-min -> --top 64 / --h 60 (worked example)
            ("Ivy Chen", facial, sat, 10, 0, "confirmed", "paid", "pending_initial"),
            ("Maya Sharif", microneedling, sat, 11, 30, "confirmed", "paid", "pending_initial"),
        ]

        for name, service, day, hour, minute, status, deposit, resolution in specs:
            starts_at = _la(datetime(day.year, day.month, day.day), hour, minute)
            ends_at = starts_at + timedelta(minutes=service.duration_minutes)
            completed_at = ends_at if status == "completed" else None
            canceled_at = _la(datetime(day.year, day.month, day.day), 18) if status == "canceled" else None
            session.add(
                Booking(
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
