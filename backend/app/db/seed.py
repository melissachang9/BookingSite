from __future__ import annotations

from datetime import date, datetime, time, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.security import hash_password
from app.db.models import (
    Location,
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


async def seed_demo_data(session: AsyncSession) -> None:
    existing_tenant = await session.scalar(select(Tenant).where(Tenant.slug == DEMO_TENANT_SLUG))
    if existing_tenant is not None:
        return

    tenant = Tenant(
        slug=DEMO_TENANT_SLUG,
        name="Brow Beauty Lab",
        timezone="America/Los_Angeles",
        branding_json={
            "primaryColor": "#9f5323",
            "accentColor": "#7a3c13",
            "homepageUrl": "https://browbeautylab.example.com",
            "serviceCatalogMode": "flat",
            "serviceCategories": ["Brows", "Facials", "Consultations"],
        },
        settings_json={
            "cancellationWindowHours": 24,
            "refundInsideWindow": False,
            "reminderHoursBefore": 24,
            "minLeadTimeMinutes": 60,
            "maxAdvanceBookingDays": 45,
            "defaultDepositCents": 2500,
            "noShowFeeCents": 5000,
            "autoChargeNoShowFee": False,
        },
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