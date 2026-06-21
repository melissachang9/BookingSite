from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import (
    Booking,
    BookingPaymentEvent,
    Customer,
    FormDefinition,
    FormResponse,
    FormVersion,
    Location,
    Payment,
    ServiceFormAttachment,
    Provider,
    ProviderLocation,
    ProviderSchedule,
    ProviderService,
    Service,
    ServiceLocation,
    Tenant,
    User,
)


DEMO_TENANT_SLUG = "brow-beauty-lab"
DEMO_LOGIN_EMAIL = "owner@browbeautylab.test"
DEMO_LOGIN_PASSWORD = "DemoBooking123"

DEMO_BRANDING = {
    "primaryColor": "#9f5323",
    "accentColor": "#7a3c13",
    "homepageUrl": "https://browbeautylab.example.com",
    "serviceCatalogMode": "flat",
    "serviceCategories": ["Brows", "Facials", "Consultations"],
    "bookingScreening": {
        "enabled": True,
        "title": "How can we help?",
        "options": [
            {
                "id": "new-client",
                "label": "I'm new to Brow Beauty Lab",
                "description": "Start with a consultation or first-time service.",
            },
            {
                "id": "returning-client",
                "label": "I'm returning to Brow Beauty Lab",
                "description": "Book your next visit from the current service menu.",
            },
        ],
    },
    "bookingAd": {
        "headline": "Quiet booking, clear next steps.",
        "body": "Choose the visit type, location, provider preference, and time without losing context.",
        "imageUrl": "/studio-hero.png",
        "imageAltText": "Brow Beauty Lab reception area",
    },
    "serviceMedia": {
        "Signature Facial": {
            "imageUrl": "/service-hero.png",
            "imageAltText": "Facial treatment setup in a calm studio room",
        },
        "Brow Shape and Tint": {
            "imageUrl": "/studio-hero.png",
            "imageAltText": "Brow studio treatment space",
        },
        "New Client Consultation": {
            "imageUrl": "/manage-hero.png",
            "imageAltText": "Consultation check-in moment",
        },
    },
    "providerProfiles": {
        "Jordan Rivera": {
            "description": "Detail-focused brow and facial specialist with a calm, education-led appointment style.",
            "availabilityLabel": "Mon-Fri",
        },
        "Ava Brooks": {
            "description": "Skin-first provider for facials, tinting, and first-time consultations across both studios.",
            "availabilityLabel": "Mon-Sat",
        },
    },
}

DEMO_SETTINGS = {
    "cancellationWindowHours": 24,
    "refundInsideWindow": False,
    "reminderHoursBefore": 24,
    "minLeadTimeMinutes": 60,
    "maxAdvanceBookingDays": 45,
    "defaultDepositCents": 2500,
    "noShowFeeCents": 5000,
    "taxRatePercent": 0,
    "autoChargeNoShowFee": False,
}


def _with_demo_defaults(existing: dict, defaults: dict) -> dict:
    merged = deepcopy(existing or {})
    for key, value in defaults.items():
        if isinstance(value, dict) and isinstance(merged.get(key), dict):
            merged[key] = _with_demo_defaults(merged[key], value)
        else:
            merged.setdefault(key, deepcopy(value))
    return merged


async def _seed_brow_prep_form(session: AsyncSession, tenant: Tenant, brow_service: Service) -> None:
    existing_form = await session.scalar(
        select(FormDefinition).where(FormDefinition.tenant_id == tenant.id, FormDefinition.name == "Brow Prep Check-In")
    )
    if existing_form is None:
        existing_form = FormDefinition(
            tenant_id=tenant.id,
            name="Brow Prep Check-In",
            scope="customer",
            is_active=True,
        )
        session.add(existing_form)
        await session.flush()

    existing_version = await session.scalar(
        select(FormVersion).where(FormVersion.tenant_id == tenant.id, FormVersion.form_id == existing_form.id, FormVersion.version_number == 1)
    )

    v1_schema = {
        "title": "Brow Prep Check-In",
        "description": "A quick pre-booking check to keep the brow appointment safe and on time.",
        "fields": [
            {
                "id": "recentRetinoidUse",
                "type": "yes_no",
                "label": "Have you used retinoids or exfoliating acids in the last 5 days?",
                "required": True,
            },
            {
                "id": "skinSensitivityNotes",
                "type": "long_text",
                "label": "Anything else we should know before your brow appointment?",
                "required": True,
                "placeholder": "Share allergies, recent treatments, or anything that could affect tinting.",
            },
            {
                "id": "browPhoto",
                "type": "file_upload",
                "label": "Upload a brow photo",
                "required": False,
            },
        ],
    }

    if existing_version is None:
        existing_version = FormVersion(
            tenant_id=tenant.id,
            form_id=existing_form.id,
            version_number=1,
            schema_json=v1_schema,
        )
        session.add(existing_version)
        await session.flush()
    else:
        # Ensure existing version 1 has the file_upload field
        existing_version.schema_json = v1_schema
        await session.flush()

    existing_attachment = await session.scalar(
        select(ServiceFormAttachment).where(
            ServiceFormAttachment.tenant_id == tenant.id,
            ServiceFormAttachment.service_id == brow_service.id,
            ServiceFormAttachment.form_version_id == existing_version.id,
        )
    )
    if existing_attachment is None:
        session.add(
            ServiceFormAttachment(
                tenant_id=tenant.id,
                service_id=brow_service.id,
                form_id=existing_form.id,
                form_version_id=existing_version.id,
                customer_prompt_timing=existing_form.customer_prompt_timing or "pre_booking",
            )
        )


async def _seed_booking_history(session: AsyncSession, tenant: Tenant) -> None:
    """Seed past + upcoming bookings, customers, payments, and form responses for the demo tenant."""
    services_rows = (await session.execute(select(Service).where(Service.tenant_id == tenant.id))).scalars().all()
    services = {service.name: service for service in services_rows}
    providers_rows = (await session.execute(select(Provider).where(Provider.tenant_id == tenant.id))).scalars().all()
    providers = {provider.name: provider for provider in providers_rows}
    locations_rows = (await session.execute(select(Location).where(Location.tenant_id == tenant.id))).scalars().all()
    locations = {location.name: location for location in locations_rows}

    if not services or not providers or not locations:
        return

    brow_service = services.get("Brow Shape and Tint")
    facial_service = services.get("Signature Facial")
    consult_service = services.get("New Client Consultation")
    jordan = providers.get("Jordan Rivera")
    ava = providers.get("Ava Brooks")
    downtown = locations.get("Downtown Studio")
    uptown = locations.get("Uptown Suite")

    if not all([brow_service, facial_service, consult_service, jordan, ava, downtown, uptown]):
        return

    # Resolve brow prep form for response seeding
    brow_form = await session.scalar(
        select(FormDefinition).where(FormDefinition.tenant_id == tenant.id, FormDefinition.name == "Brow Prep Check-In")
    )
    brow_form_version = None
    if brow_form is not None:
        brow_form_version = await session.scalar(
            select(FormVersion).where(
                FormVersion.tenant_id == tenant.id,
                FormVersion.form_id == brow_form.id,
                FormVersion.version_number == 1,
            )
        )

    # Create or look up demo customers
    customer_specs = [
        ("Reese Park", "reese.park@example.com", "555-0142", "Prefers afternoon appointments."),
        ("Morgan Ellis", "morgan.ellis@example.com", "555-0188", "First brow tint client. Tends to run 5 min late."),
        ("Sam Patel", "sam.patel@example.com", "555-0231", "Sensitive skin around the brows. Patch-tested."),
        ("Jules Romero", "jules.romero@example.com", "555-0319", "Quiet appointment preferred."),
    ]
    customers: dict[str, Customer] = {}
    for name, email, phone, notes in customer_specs:
        existing = await session.scalar(
            select(Customer).where(Customer.tenant_id == tenant.id, Customer.email == email)
        )
        if existing is not None:
            customers[name] = existing
        else:
            customer = Customer(
                tenant_id=tenant.id,
                name=name,
                email=email,
                phone=phone,
                notes=notes,
            )
            session.add(customer)
            customers[name] = customer
    await session.flush()

    today_local = datetime.now(timezone.utc).date()

    def _at(days_offset: int, hour: int, minute: int = 0) -> datetime:
        target = today_local + timedelta(days=days_offset)
        return datetime(target.year, target.month, target.day, hour, minute, tzinfo=timezone.utc)

    # Booking specs: (customer, service, provider, location, days_offset, hour, status, deposit_status, payment_resolution, notes)
    booking_specs = [
        # Past completed
        ("Reese Park", brow_service, jordan, downtown, -10, 14, "completed", "paid", "collected", "Tint refresh. Pleased with shape."),
        ("Morgan Ellis", facial_service, ava, downtown, -8, 11, "completed", "paid", "collected", "First facial. Went well."),
        ("Sam Patel", brow_service, ava, uptown, -7, 13, "completed", "paid", "collected", None),
        ("Reese Park", facial_service, ava, downtown, -5, 15, "completed", "paid", "collected", None),
        ("Jules Romero", consult_service, jordan, downtown, -4, 10, "completed", "not_required", "waived", "Booked brow follow-up for next week."),
        # Past cancellations
        ("Morgan Ellis", brow_service, jordan, downtown, -6, 16, "canceled", "refunded", "waived", "Client canceled outside window."),
        # No-show
        ("Sam Patel", consult_service, jordan, downtown, -3, 9, "no_show", "not_required", "waived", "Did not arrive. No fee charged."),
        # Today + upcoming confirmed
        ("Jules Romero", brow_service, jordan, downtown, 0, 14, "confirmed", "paid", "pending_initial", "First brow visit."),
        ("Reese Park", brow_service, ava, uptown, 2, 11, "confirmed", "paid", "pending_initial", None),
        ("Morgan Ellis", facial_service, ava, downtown, 4, 13, "confirmed", "paid", "pending_initial", "Bring serum sample."),
        ("Sam Patel", brow_service, jordan, downtown, 7, 15, "confirmed", "paid", "pending_initial", None),
        ("Jules Romero", facial_service, ava, uptown, 11, 12, "confirmed", "paid", "pending_initial", None),
    ]

    created_bookings: list[tuple[Booking, str]] = []  # (booking, customer name)
    for customer_name, service, provider, location, days_offset, hour, status, deposit_status, payment_resolution, notes in booking_specs:
        starts_at = _at(days_offset, hour)
        ends_at = starts_at + timedelta(minutes=service.duration_minutes)
        completed_at = ends_at if status == "completed" else None
        canceled_at = _at(days_offset - 1, 18) if status == "canceled" else None
        booking = Booking(
            tenant_id=tenant.id,
            customer_id=customers[customer_name].id,
            service_id=service.id,
            provider_id=provider.id,
            location_id=location.id,
            status=status,
            booking_method="public_online",
            deposit_status=deposit_status,
            payment_resolution=payment_resolution,
            starts_at=starts_at,
            ends_at=ends_at,
            completed_at=completed_at,
            canceled_at=canceled_at,
            notes=notes,
        )
        session.add(booking)
        created_bookings.append((booking, customer_name))
    await session.flush()

    # Add payments + payment events for each booking
    for booking, customer_name in created_bookings:
        service = next(s for s in services_rows if s.id == booking.service_id)
        # Deposit payment (if service required a deposit)
        if service.deposit_cents > 0 and booking.deposit_status in ("paid", "refunded"):
            deposit_payment_status = "succeeded" if booking.deposit_status == "paid" else "refunded"
            deposit_payment = Payment(
                tenant_id=tenant.id,
                booking_id=booking.id,
                customer_id=customers[customer_name].id,
                status=deposit_payment_status,
                deposit_status="paid",
                amount_cents=service.deposit_cents,
                currency="USD",
                payment_method_type="card",
                checkout_session_kind="stripe_deposit_checkout",
                checkout_session_id=f"seed_deposit_{booking.id}",
            )
            session.add(deposit_payment)
            session.add(
                BookingPaymentEvent(
                    tenant_id=tenant.id,
                    booking_id=booking.id,
                    event_kind="stripe_deposit_checkout",
                    amount_cents=service.deposit_cents,
                    payload_json={"status": deposit_payment_status, "session_id": f"seed_deposit_{booking.id}"},
                )
            )
        # Balance payment for completed bookings where the balance was collected
        if booking.status == "completed" and booking.payment_resolution == "collected":
            balance_due = max(0, service.price_cents - service.deposit_cents)
            if balance_due > 0:
                balance_payment = Payment(
                    tenant_id=tenant.id,
                    booking_id=booking.id,
                    customer_id=customers[customer_name].id,
                    status="succeeded",
                    deposit_status="paid",
                    amount_cents=balance_due,
                    currency="USD",
                    payment_method_type="card",
                    checkout_session_kind="stripe_balance_checkout",
                    checkout_session_id=f"seed_balance_{booking.id}",
                )
                session.add(balance_payment)
                session.add(
                    BookingPaymentEvent(
                        tenant_id=tenant.id,
                        booking_id=booking.id,
                        event_kind="stripe_balance_checkout",
                        amount_cents=balance_due,
                        payload_json={"status": "succeeded", "session_id": f"seed_balance_{booking.id}"},
                    )
                )
            else:
                session.add(
                    BookingPaymentEvent(
                        tenant_id=tenant.id,
                        booking_id=booking.id,
                        event_kind="admin_completion",
                        amount_cents=0,
                        payload_json={"reason": "no_balance_due"},
                    )
                )
        elif booking.status == "completed" and booking.payment_resolution == "waived":
            session.add(
                BookingPaymentEvent(
                    tenant_id=tenant.id,
                    booking_id=booking.id,
                    event_kind="admin_completion",
                    amount_cents=0,
                    payload_json={"reason": "no_balance_due"},
                )
            )

    # Add brow prep form responses for past brow bookings
    if brow_form is not None and brow_form_version is not None:
        sample_answers = [
            {
                "recentRetinoidUse": False,
                "skinSensitivityNotes": "No new products this week. Patch-tested fine last visit.",
                "browPhoto": None,
            },
            {
                "recentRetinoidUse": True,
                "skinSensitivityNotes": "Used retinol cream on Tuesday. Otherwise no changes.",
                "browPhoto": None,
            },
            {
                "recentRetinoidUse": False,
                "skinSensitivityNotes": "Slight redness from sun this weekend. Brows feel fine.",
                "browPhoto": None,
            },
        ]
        brow_index = 0
        for booking, customer_name in created_bookings:
            if booking.service_id != brow_service.id:
                continue
            if booking.status not in ("completed", "confirmed"):
                continue
            answers = sample_answers[brow_index % len(sample_answers)]
            brow_index += 1
            session.add(
                FormResponse(
                    tenant_id=tenant.id,
                    form_id=brow_form.id,
                    form_version_id=brow_form_version.id,
                    customer_id=customers[customer_name].id,
                    booking_id=booking.id,
                    scope="customer",
                    customer_prompt_timing="pre_booking",
                    submitted_at=booking.starts_at - timedelta(hours=2),
                    answers_json=answers,
                )
            )

    await session.flush()


async def seed_demo_data(session: AsyncSession) -> None:
    existing_tenant = await session.scalar(select(Tenant).where(Tenant.slug == DEMO_TENANT_SLUG))
    if existing_tenant is not None:
        existing_tenant.branding_json = _with_demo_defaults(existing_tenant.branding_json, DEMO_BRANDING)
        existing_tenant.settings_json = _with_demo_defaults(existing_tenant.settings_json, DEMO_SETTINGS)
        existing_brow_service = await session.scalar(
            select(Service).where(Service.tenant_id == existing_tenant.id, Service.name == "Brow Shape and Tint")
        )
        if existing_brow_service is not None:
            await _seed_brow_prep_form(session, existing_tenant, existing_brow_service)
        # Seed booking history if no bookings exist (E2E reset may have wiped them)
        existing_booking_count = await session.scalar(
            select(Booking.id).where(Booking.tenant_id == existing_tenant.id).limit(1)
        )
        if existing_booking_count is None:
            await _seed_booking_history(session, existing_tenant)
        await session.commit()
        return

    tenant = Tenant(
        slug=DEMO_TENANT_SLUG,
        name="Brow Beauty Lab",
        timezone="America/Los_Angeles",
        branding_json=deepcopy(DEMO_BRANDING),
        settings_json=deepcopy(DEMO_SETTINGS),
    )
    session.add(tenant)
    await session.flush()

    downtown = Location(
        tenant_id=tenant.id,
        name="Downtown Studio",
        time_zone=tenant.timezone,
        address_line1="120 Market Street",
        city="San Francisco",
        state="CA",
        postal_code="94105",
    )
    uptown = Location(
        tenant_id=tenant.id,
        name="Uptown Suite",
        time_zone=tenant.timezone,
        address_line1="18 Grant Avenue",
        city="San Francisco",
        state="CA",
        postal_code="94108",
    )
    session.add_all([downtown, uptown])
    await session.flush()

    tenant.default_location_id = downtown.id

    owner = User(
        tenant_id=tenant.id,
        email=DEMO_LOGIN_EMAIL,
        name="Melissa Chang",
        role="owner",
        password_hash=hash_password(DEMO_LOGIN_PASSWORD),
    )
    session.add(owner)

    facial = Service(
        tenant_id=tenant.id,
        name="Signature Facial",
        description="A 60-minute treatment with guided intake, deposit, and provider-aware availability.",
        duration_minutes=60,
        price_cents=14500,
        deposit_cents=3500,
    )
    brow = Service(
        tenant_id=tenant.id,
        name="Brow Shape and Tint",
        description="A fast repeat-booking service with clear deposit and timing context.",
        duration_minutes=45,
        price_cents=7500,
        deposit_cents=1500,
    )
    consultation = Service(
        tenant_id=tenant.id,
        name="New Client Consultation",
        description="A longer-form consultation route that will later attach richer pre-booking requirements.",
        duration_minutes=30,
        price_cents=3500,
        deposit_cents=0,
    )
    session.add_all([facial, brow, consultation])
    await session.flush()
    await _seed_brow_prep_form(session, tenant, brow)

    jordan = Provider(
        tenant_id=tenant.id,
        name="Jordan Rivera",
        email="jordan@browbeautylab.test",
    )
    ava = Provider(
        tenant_id=tenant.id,
        name="Ava Brooks",
        email="ava@browbeautylab.test",
    )
    session.add_all([jordan, ava])
    await session.flush()

    session.add_all(
        [
            ServiceLocation(tenant_id=tenant.id, service_id=facial.id, location_id=downtown.id),
            ServiceLocation(tenant_id=tenant.id, service_id=facial.id, location_id=uptown.id),
            ServiceLocation(tenant_id=tenant.id, service_id=brow.id, location_id=downtown.id),
            ServiceLocation(tenant_id=tenant.id, service_id=consultation.id, location_id=downtown.id),
            ServiceLocation(tenant_id=tenant.id, service_id=consultation.id, location_id=uptown.id),
            ProviderLocation(tenant_id=tenant.id, provider_id=jordan.id, location_id=downtown.id),
            ProviderLocation(tenant_id=tenant.id, provider_id=ava.id, location_id=downtown.id),
            ProviderLocation(tenant_id=tenant.id, provider_id=ava.id, location_id=uptown.id),
            ProviderService(tenant_id=tenant.id, provider_id=jordan.id, service_id=facial.id),
            ProviderService(tenant_id=tenant.id, provider_id=jordan.id, service_id=consultation.id),
            ProviderService(tenant_id=tenant.id, provider_id=ava.id, service_id=facial.id),
            ProviderService(tenant_id=tenant.id, provider_id=ava.id, service_id=brow.id),
            ProviderService(tenant_id=tenant.id, provider_id=ava.id, service_id=consultation.id),
        ]
    )

    weekday_window = [0, 1, 2, 3, 4]
    for weekday in weekday_window:
        session.add(
            ProviderSchedule(
                tenant_id=tenant.id,
                provider_id=jordan.id,
                location_id=downtown.id,
                weekday=weekday,
                start_time=time(hour=9, minute=0),
                end_time=time(hour=16, minute=0),
            )
        )
        session.add(
            ProviderSchedule(
                tenant_id=tenant.id,
                provider_id=ava.id,
                location_id=downtown.id,
                weekday=weekday,
                start_time=time(hour=10, minute=0),
                end_time=time(hour=18, minute=0),
            )
        )

    for weekday in [1, 2, 3, 4, 5]:
        session.add(
            ProviderSchedule(
                tenant_id=tenant.id,
                provider_id=ava.id,
                location_id=uptown.id,
                weekday=weekday,
                start_time=time(hour=11, minute=0),
                end_time=time(hour=17, minute=0),
            )
        )

    await _seed_booking_history(session, tenant)

    await session.commit()


def next_weekday(target_weekday: int) -> date:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return today + timedelta(days=days_ahead)