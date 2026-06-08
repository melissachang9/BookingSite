from __future__ import annotations

from copy import deepcopy
from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import (
    FormDefinition,
    FormVersion,
    Location,
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
                customer_prompt_timing="pre_booking",
            )
        )


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

    await session.commit()


def next_weekday(target_weekday: int) -> date:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return today + timedelta(days=days_ahead)