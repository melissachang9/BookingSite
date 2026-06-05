from __future__ import annotations

from app.core.security import create_customer_manage_token
from app.db.models import Booking, BookingDraft, BookingDraftFormRequirement, BookingDraftIntakePlan, Customer, Location, Provider, Service, Tenant
from app.schemas.bookings import BookingSummaryResponse
from app.schemas.booking_drafts import BookingDraftSummaryResponse, CustomerSummaryResponse, IntakePlanResponse
from app.schemas.forms import FormRequirementResponse
from app.schemas.catalog import (
    LocationSummaryResponse,
    ProviderSummaryResponse,
    ServiceSummaryResponse,
    TenantBrandingResponse,
    TenantSettingsResponse,
    TenantSummaryResponse,
)


def _tenant_tax_rate_percent(tenant: Tenant | None) -> float:
    if tenant is None:
        return 0

    raw_value = tenant.settings_json.get("taxRatePercent", 0)
    if isinstance(raw_value, (int, float)) and raw_value >= 0:
        return float(raw_value)

    return 0


def booking_tax_cents(booking: Booking) -> int:
    return round(booking.service.price_cents * (_tenant_tax_rate_percent(booking.tenant) / 100))


def booking_total_cents(booking: Booking) -> int:
    return booking.service.price_cents + booking_tax_cents(booking)


def booking_amount_paid_cents(booking: Booking) -> int:
    return sum(payment.amount_cents for payment in booking.payments if payment.status == "succeeded")


def booking_balance_due_cents(booking: Booking) -> int:
    return max(booking_total_cents(booking) - booking_amount_paid_cents(booking), 0)


def _service_media_for(service: Service, tenant: Tenant | None) -> tuple[str | None, str | None]:
    if tenant is None:
        return None, None

    service_media = tenant.branding_json.get("serviceMedia")
    if not isinstance(service_media, dict):
        return None, None

    media = service_media.get(service.id) or service_media.get(service.name)
    if not isinstance(media, dict):
        return None, None

    image_url = media.get("imageUrl") or media.get("image_url")
    image_alt_text = media.get("imageAltText") or media.get("image_alt_text")
    return image_url if isinstance(image_url, str) else None, image_alt_text if isinstance(image_alt_text, str) else None


def _provider_profile_for(provider: Provider, tenant: Tenant | None) -> dict[str, str | None]:
    empty_profile = {
        "description": None,
        "image_url": None,
        "image_alt_text": None,
        "availability_label": None,
    }
    if tenant is None:
        return empty_profile

    provider_profiles = tenant.branding_json.get("providerProfiles")
    if not isinstance(provider_profiles, dict):
        return empty_profile

    profile = provider_profiles.get(provider.id) or provider_profiles.get(provider.name)
    if not isinstance(profile, dict):
        return empty_profile

    description = profile.get("description") or profile.get("bio")
    image_url = profile.get("imageUrl") or profile.get("image_url")
    image_alt_text = profile.get("imageAltText") or profile.get("image_alt_text")
    availability_label = profile.get("availabilityLabel") or profile.get("availability_label")
    return {
        "description": description if isinstance(description, str) else None,
        "image_url": image_url if isinstance(image_url, str) else None,
        "image_alt_text": image_alt_text if isinstance(image_alt_text, str) else None,
        "availability_label": availability_label if isinstance(availability_label, str) else None,
    }


def tenant_to_summary(tenant: Tenant) -> TenantSummaryResponse:
    return TenantSummaryResponse(
        id=tenant.id,
        tenant_id=tenant.id,
        created_at=tenant.created_at,
        updated_at=tenant.updated_at,
        slug=tenant.slug,
        name=tenant.name,
        timezone=tenant.timezone,
        default_location_id=tenant.default_location_id,
        branding=TenantBrandingResponse(**tenant.branding_json),
        settings=TenantSettingsResponse(**tenant.settings_json),
    )


def location_to_summary(location: Location) -> LocationSummaryResponse:
    return LocationSummaryResponse(
        id=location.id,
        tenant_id=location.tenant_id,
        created_at=location.created_at,
        updated_at=location.updated_at,
        name=location.name,
        time_zone=location.time_zone,
        is_active=location.is_active,
        address_line1=location.address_line1,
        address_line2=location.address_line2,
        city=location.city,
        state=location.state,
        postal_code=location.postal_code,
        phone=location.phone,
    )


def service_to_summary(service: Service, tenant: Tenant | None = None) -> ServiceSummaryResponse:
    image_url, image_alt_text = _service_media_for(service, tenant)
    return ServiceSummaryResponse(
        id=service.id,
        tenant_id=service.tenant_id,
        created_at=service.created_at,
        updated_at=service.updated_at,
        name=service.name,
        description=service.description,
        duration_minutes=service.duration_minutes,
        price_cents=service.price_cents,
        deposit_cents=service.deposit_cents,
        is_active=service.is_active,
        image_url=image_url,
        image_alt_text=image_alt_text,
        location_ids=[link.location_id for link in service.location_links],
        form_ids=[],
        category_id=service.category_id,
        sort_order=service.sort_order,
    )


def provider_to_summary(provider: Provider, tenant: Tenant | None = None) -> ProviderSummaryResponse:
    profile = _provider_profile_for(provider, tenant)
    return ProviderSummaryResponse(
        id=provider.id,
        tenant_id=provider.tenant_id,
        created_at=provider.created_at,
        updated_at=provider.updated_at,
        user_id=provider.user_id,
        name=provider.name,
        email=provider.email,
        description=profile["description"],
        image_url=profile["image_url"],
        image_alt_text=profile["image_alt_text"],
        availability_label=profile["availability_label"],
        is_active=provider.is_active,
        is_bookable_online=getattr(provider, "is_bookable_online", True),
        service_ids=[link.service_id for link in provider.service_links],
        location_ids=[link.location_id for link in provider.location_links],
    )


def customer_to_summary(customer: Customer) -> CustomerSummaryResponse:
    return CustomerSummaryResponse(
        id=customer.id,
        tenant_id=customer.tenant_id,
        created_at=customer.created_at,
        updated_at=customer.updated_at,
        name=customer.name,
        email=customer.email,
        phone=customer.phone,
        notes=customer.notes,
        owner_user_id=customer.owner_user_id,
        acquired_at=None,
        source_channel=None,
    )


def intake_plan_to_summary(plan: BookingDraftIntakePlan, reminder_hours_before: int) -> IntakePlanResponse:
    reminder_channels = []
    if plan.email_reminder_scheduled_at is not None:
        reminder_channels.append("email")
    if plan.sms_reminder_scheduled_at is not None:
        reminder_channels.append("sms")

    return IntakePlanResponse(
        completion_timing=plan.completion_timing,
        status=plan.status,
        due_at=plan.due_at,
        email_reminder_scheduled_at=plan.email_reminder_scheduled_at,
        sms_reminder_scheduled_at=plan.sms_reminder_scheduled_at,
        reminder_channels=reminder_channels,
        reminder_hours_before=reminder_hours_before,
    )


def form_requirement_to_summary(requirement: BookingDraftFormRequirement) -> FormRequirementResponse:
    schema = requirement.form_version.schema_json if requirement.form_version is not None else None
    title = schema.get("title") if isinstance(schema, dict) else None
    description = schema.get("description") if isinstance(schema, dict) else None
    return FormRequirementResponse(
        id=requirement.id,
        booking_id=None,
        booking_draft_id=requirement.booking_draft_id,
        form_id=requirement.form_id,
        form_version_id=requirement.form_version_id,
        scope=requirement.scope,
        customer_prompt_timing=requirement.customer_prompt_timing,
        status=requirement.status,
        satisfied_by_response_id=requirement.satisfied_by_response_id,
        form_title=title if isinstance(title, str) else None,
        form_description=description if isinstance(description, str) else None,
        schema=schema if isinstance(schema, dict) else None,
    )


def booking_draft_to_summary(draft: BookingDraft) -> BookingDraftSummaryResponse:
    tenant = draft.tenant if isinstance(draft.tenant, Tenant) else None
    reminder_hours_before = 24
    if tenant is not None:
        raw_hours = tenant.settings_json.get("reminderHoursBefore", 24)
        reminder_hours_before = raw_hours if isinstance(raw_hours, int) else 24

    return BookingDraftSummaryResponse(
        id=draft.id,
        tenant_id=draft.tenant_id,
        created_at=draft.created_at,
        updated_at=draft.updated_at,
        customer_id=draft.customer_id,
        service_id=draft.service_id,
        provider_id=draft.provider_id,
        location_id=draft.location_id,
        status=draft.status,
        booking_method=draft.booking_method,
        starts_at=draft.starts_at,
        ends_at=draft.ends_at,
        expires_at=draft.expires_at,
        price_cents=draft.price_cents,
        deposit_cents=draft.deposit_cents,
        duration_minutes=draft.duration_minutes,
        service=service_to_summary(draft.service, tenant),
        provider=provider_to_summary(draft.provider, tenant),
        customer=customer_to_summary(draft.customer) if draft.customer is not None else None,
        intake_plan=intake_plan_to_summary(draft.intake_plan, reminder_hours_before) if draft.intake_plan is not None else None,
        form_requirements=[form_requirement_to_summary(requirement) for requirement in draft.form_requirements],
    )


def booking_to_summary(booking: Booking) -> BookingSummaryResponse:
    tenant = booking.tenant if isinstance(booking.tenant, Tenant) else None
    reminder_hours_before = 24
    if tenant is not None:
        raw_hours = tenant.settings_json.get("reminderHoursBefore", 24)
        reminder_hours_before = raw_hours if isinstance(raw_hours, int) else 24

    amount_paid_cents = booking_amount_paid_cents(booking)
    balance_due_cents = booking_balance_due_cents(booking)

    source_draft = booking.source_draft if isinstance(booking.source_draft, BookingDraft) else None
    customer_manage_token, _ = create_customer_manage_token(
        {
            "bookingId": booking.id,
            "tenantId": booking.tenant_id,
        }
    )

    return BookingSummaryResponse(
        id=booking.id,
        tenant_id=booking.tenant_id,
        created_at=booking.created_at,
        updated_at=booking.updated_at,
        customer_id=booking.customer_id,
        service_id=booking.service_id,
        provider_id=booking.provider_id,
        location_id=booking.location_id,
        status=booking.status,
        booking_method=booking.booking_method,
        deposit_status=booking.deposit_status,
        payment_resolution=booking.payment_resolution,
        starts_at=booking.starts_at,
        ends_at=booking.ends_at,
        completed_at=booking.completed_at,
        canceled_at=booking.canceled_at,
        notes=booking.notes,
        amount_paid_cents=amount_paid_cents,
        balance_due_cents=balance_due_cents,
        customer_manage_token=customer_manage_token,
        service=service_to_summary(booking.service, tenant),
        provider=provider_to_summary(booking.provider, tenant),
        customer=customer_to_summary(booking.customer),
        intake_plan=(
            intake_plan_to_summary(source_draft.intake_plan, reminder_hours_before)
            if source_draft is not None and source_draft.intake_plan is not None
            else None
        ),
    )