"""Seed an intake form attached to a service plus bookings that require it.

Creates a "Microneedling Intake & Consent" form (customer-facing, pre-booking),
attaches it to the microneedling service, and ensures a few confirmed bookings
exist on that service so the calendar shows appointments with forms attached.

Run from the repo root with the backend on the path:

    PYTHONPATH=backend python scripts/seed_bookings_with_forms.py

Idempotent-ish: it reuses an existing form/service/customer records and adds
new bookings for the chosen day only when they don't already exist.
"""

from __future__ import annotations

import asyncio
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.models import (
    Booking,
    BookingDraft,
    Customer,
    FormDefinition,
    FormVersion,
    Provider,
    Service,
    ServiceFormAttachment,
    Tenant,
)
from app.db.session import get_session_maker

TENANT_SLUG = "brow-beauty-lab"
LA = ZoneInfo("America/Los_Angeles")

FORM_NAME = "Microneedling Intake & Consent"

FORM_FIELDS = [
    {
        "id": "recent_treatment",
        "type": "yes_no",
        "label": "Any laser, peel, or microneedling in the last 2 weeks?",
    },
    {
        "id": "retinoid_use",
        "type": "yes_no",
        "label": "Currently using retinoids or exfoliants?",
    },
    {
        "id": "skin_notes",
        "type": "long_text",
        "label": "Skin sensitivities or concerns",
    },
    {
        "id": "consent",
        "type": "consent",
        "label": "I consent to microneedling and understand the aftercare.",
    },
]


def _la(d: datetime, hour: int, minute: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, tzinfo=LA)


async def main() -> None:
    async with get_session_maker()() as session:
        tenant = await session.scalar(select(Tenant).where(Tenant.slug == TENANT_SLUG))
        if tenant is None:
            print("Tenant not found")
            return

        provider = await session.scalar(
            select(Provider).where(
                Provider.tenant_id == tenant.id, Provider.is_active.is_(True)
            )
        )
        if provider is None:
            print("No active provider found")
            return

        services = {
            s.name: s
            for s in (
                await session.scalars(select(Service).where(Service.tenant_id == tenant.id))
            ).all()
        }
        microneedling = services.get("microneedling")
        facial = services.get("Signature Facial")
        if microneedling is None or facial is None:
            print("Missing microneedling / Signature Facial service")
            return

        # --- form definition + version ---
        form = await session.scalar(
            select(FormDefinition).where(
                FormDefinition.tenant_id == tenant.id,
                FormDefinition.name == FORM_NAME,
            )
        )
        if form is None:
            form = FormDefinition(
                tenant_id=tenant.id,
                name=FORM_NAME,
                scope="customer",
                customer_prompt_timing="pre_booking",
                review_required=False,
                is_active=True,
                applies_to_all_services=False,
                category="Intake",
            )
            session.add(form)
            await session.flush()
            print(f"Created form: {FORM_NAME}")

        version = await session.scalar(
            select(FormVersion).where(FormVersion.form_id == form.id)
        )
        if version is None:
            version = FormVersion(
                tenant_id=tenant.id,
                form_id=form.id,
                version_number=1,
                schema_json={"title": FORM_NAME, "fields": FORM_FIELDS},
            )
            session.add(version)
            await session.flush()
            print("Created form version 1")

        # --- attach form to microneedling (pre_booking) ---
        existing_attach = await session.scalar(
            select(ServiceFormAttachment).where(
                ServiceFormAttachment.service_id == microneedling.id,
                ServiceFormAttachment.form_version_id == version.id,
            )
        )
        if existing_attach is None:
            session.add(
                ServiceFormAttachment(
                    tenant_id=tenant.id,
                    service_id=microneedling.id,
                    form_id=form.id,
                    form_version_id=version.id,
                    customer_prompt_timing="pre_booking",
                )
            )
            print("Attached form to microneedling (pre_booking)")

        # --- customers ---
        async def ensure_customer(name: str, email: str, phone: str) -> Customer:
            existing = await session.scalar(
                select(Customer).where(
                    Customer.tenant_id == tenant.id, Customer.email == email
                )
            )
            if existing is not None:
                return existing
            c = Customer(tenant_id=tenant.id, name=name, email=email, phone=phone)
            session.add(c)
            await session.flush()
            return c

        anouk = await ensure_customer("Anouk V.", "anouk.v@example.com", "555-0105")
        maya = await ensure_customer("Maya Sharif", "maya.sharif@example.com", "555-0102")
        ivy = await ensure_customer("Ivy Chen", "ivy.chen@example.com", "555-0101")

        # --- bookings on the microneedling service (form-attached) ---
        # Sept 6-11, back-to-back from 10:00 a.m. daily, alternating callers so
        # the calendar shows a dense, easy-to-scan week of form-attached
        # bookings for testing.
        base = datetime(2026, 9, 6)  # Sun Sep 6
        customers_cycle = [anouk, maya, ivy]
        specs = []
        for day_offset in range(6):  # Sep 6..Sep 11
            day = base + timedelta(days=day_offset)
            for i, customer in enumerate(customers_cycle):
                # 10:00, 12:00, 14:00 — spaced throughout the day so the
                # calendar shows multiple form-attached bookings per day.
                specs.append((customer, microneedling, day, 10 + i * 2, 0))

        from app.services.booking_drafts import (
            create_booking_draft,
            confirm_booking_draft_with_payment,
        )
        from app.services.booking_forms import submit_booking_form_requirement
        from app.schemas.booking_drafts import (
            ConfirmWithPaymentRequest,
            CreateBookingDraftRequest,
            CustomerInput,
        )
        from app.schemas.forms import SubmitFormRequirementRequest
        # Use the provider's email to find an owner-level user for the
        # in-person confirmation (staff flow).
        from app.db.models import User

        FORM_ANSWERS = {
            "recent_treatment": False,
            "retinoid_use": True,
            "skin_notes": "Mild redness after exfoliation. No recent laser.",
            "consent": True,
        }

        created = 0
        for customer, service, day, hour, minute in specs:
            starts_at = _la(datetime(day.year, day.month, day.day), hour, minute)
            exists = await session.scalar(
                select(Booking).where(
                    Booking.tenant_id == tenant.id,
                    Booking.service_id == service.id,
                    Booking.starts_at == starts_at,
                    Booking.customer_id == customer.id,
                )
            )
            if exists is not None:
                print(f"  skip (exists): {customer.name} {service.name} {starts_at.isoformat()}")
                continue

            draft_summary = await create_booking_draft(
                session,
                TENANT_SLUG,
                CreateBookingDraftRequest(
                    tenant_slug=TENANT_SLUG,
                    service_id=service.id,
                    provider_id=provider.id,
                    starts_at=starts_at,
                    customer=CustomerInput(
                        name=customer.name,
                        email=customer.email or "",
                        phone=customer.phone or "555-0000",
                    ),
                    booking_method="staff_entered",
                    override_availability=True,
                ),
            )

            draft = (
                await session.execute(
                    select(BookingDraft)
                    .options(selectinload(BookingDraft.form_requirements))
                    .where(BookingDraft.id == draft_summary.id)
                )
            ).scalar_one()

            # Submit the pre-booking form requirement(s) for bookings on the
            # microneedling service (only that service has the form attached).
            if service.id == microneedling.id:
                for req in draft.form_requirements:
                    if req.status == "pending" and req.customer_prompt_timing == "pre_booking":
                        await submit_booking_form_requirement(
                            session,
                            TENANT_SLUG,
                            draft.id,
                            req.id,
                            SubmitFormRequirementRequest(answers=FORM_ANSWERS),
                        )

            draft = (
                await session.execute(
                    select(BookingDraft)
                    .options(selectinload(BookingDraft.form_requirements))
                    .where(BookingDraft.id == draft.id)
                )
            ).scalar_one()

            # Confirm with an in-person deposit payment so the booking skips
            # the not-yet-implemented deposit-checkout path on the public flow.
            actor = await session.scalar(
                select(User).where(User.tenant_id == tenant.id, User.role == "owner")
            ) or provider.user
            amount = service.deposit_cents
            await confirm_booking_draft_with_payment(
                session,
                TENANT_SLUG,
                draft.id,
                ConfirmWithPaymentRequest(
                    payment_method_type="cash",
                    amount_cents=amount,
                ),
                actor,
            )
            created += 1

        print(f"Seeded {created} booking(s) with the form-attached service.")


asyncio.run(main())
