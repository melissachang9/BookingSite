from __future__ import annotations

from fastapi import APIRouter, Depends, Query, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.db.session import get_db_session
from app.schemas.availability import AvailabilityResponse
from app.schemas.catalog import (
    CreateLocationRequest,
    CreateProviderRequest,
    CreateServiceRequest,
    CreateStaffRequest,
    CreateStaffResponse,
    CreateTenantRequest,
    CreateTenantResponse,
    CreateTenantUserRequest,
    EmailDnsResponse,
    LocationListResponse,
    LocationSummaryResponse,
    ProviderListResponse,
    ProviderSummaryResponse,
    ResetTenantUserPasswordRequest,
    ServiceListResponse,
    ServiceSummaryResponse,
    TenantSummaryResponse,
    TenantUserListResponse,
    TenantUserSummaryResponse,
    UpdateLocationRequest,
    UpdateProviderRequest,
    UpdateTenantBrandingRequest,
    UpdateTenantBusinessHoursRequest,
    UpdateTenantBusinessRequest,
    UpdateTenantClientOwnershipRequest,
    UpdateTenantCustomEmailRequest,
    UpdateTenantSettingsRequest,
    UpdateTenantUserRequest,
    UpdateTenantWalletMembershipRequest,
)
from app.services.availability import list_availability
from app.services.tenants import (
    create_tenant_account,
    create_tenant_location,
    create_tenant_provider,
    create_tenant_service,
    create_tenant_staff,
    create_tenant_user,
    deactivate_tenant_location,
    deactivate_tenant_provider,
    get_tenant_summary,
    list_service_providers,
    list_tenant_locations,
    list_tenant_locations_admin,
    list_tenant_providers_admin,
    list_tenant_services,
    list_tenant_users,
    reset_tenant_user_password,
    update_tenant_business,
    update_tenant_branding,
    update_tenant_business_hours,
    update_tenant_client_ownership,
    update_tenant_custom_email,
    update_tenant_provider,
    update_tenant_user,
    update_tenant_wallet_membership,
    get_tenant_email_dns,
    update_tenant_location,
    update_tenant_settings,
)


router = APIRouter(prefix="/tenants", tags=["tenants"])


@router.post("", response_model=CreateTenantResponse, status_code=status.HTTP_201_CREATED, summary="Create a tenant")
async def create_tenant(
    payload: CreateTenantRequest,
    session: AsyncSession = Depends(get_db_session),
) -> CreateTenantResponse:
    return await create_tenant_account(session, payload)


@router.get("/{tenant_slug}", response_model=TenantSummaryResponse, summary="Get tenant storefront context")
async def get_tenant(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await get_tenant_summary(session, tenant_slug)


@router.patch(
    "/{tenant_slug}/settings",
    response_model=TenantSummaryResponse,
    summary="Update tenant settings",
)
async def patch_tenant_settings(
    tenant_slug: str,
    payload: UpdateTenantSettingsRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_settings(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/business",
    response_model=TenantSummaryResponse,
    summary="Update tenant business identity (name, website, country, currency, sms phone)",
)
async def patch_tenant_business(
    tenant_slug: str,
    payload: UpdateTenantBusinessRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_business(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/hours",
    response_model=TenantSummaryResponse,
    summary="Update tenant business hours and provider restriction toggle",
)
async def patch_tenant_business_hours(
    tenant_slug: str,
    payload: UpdateTenantBusinessHoursRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_business_hours(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/branding",
    response_model=TenantSummaryResponse,
    summary="Update tenant branding (logo, favicon, colors, gallery)",
)
async def patch_tenant_branding(
    tenant_slug: str,
    payload: UpdateTenantBrandingRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_branding(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/client-ownership",
    response_model=TenantSummaryResponse,
    summary="Update tenant client-ownership toggles",
)
async def patch_tenant_client_ownership(
    tenant_slug: str,
    payload: UpdateTenantClientOwnershipRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_client_ownership(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/custom-email",
    response_model=TenantSummaryResponse,
    summary="Update tenant custom-email from-address and domain",
)
async def patch_tenant_custom_email(
    tenant_slug: str,
    payload: UpdateTenantCustomEmailRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_custom_email(session, tenant_slug, payload)


@router.get(
    "/{tenant_slug}/email-dns",
    response_model=EmailDnsResponse,
    summary="Get computed DNS records for the tenant's custom email domain",
)
async def get_tenant_email_dns_route(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> EmailDnsResponse:
    data = await get_tenant_email_dns(session, tenant_slug)
    return EmailDnsResponse(**data)


@router.patch(
    "/{tenant_slug}/wallet-membership",
    response_model=TenantSummaryResponse,
    summary="Update tenant wallet and membership toggles",
)
async def patch_tenant_wallet_membership(
    tenant_slug: str,
    payload: UpdateTenantWalletMembershipRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantSummaryResponse:
    return await update_tenant_wallet_membership(session, tenant_slug, payload)


@router.get(
    "/{tenant_slug}/users",
    response_model=TenantUserListResponse,
    summary="List tenant users (read-only roster)",
)
async def get_tenant_users(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantUserListResponse:
    return await list_tenant_users(session, tenant_slug)


@router.post(
    "/{tenant_slug}/users",
    response_model=TenantUserSummaryResponse,
    status_code=201,
    summary="Create a tenant user",
)
async def post_tenant_user(
    tenant_slug: str,
    payload: CreateTenantUserRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantUserSummaryResponse:
    return await create_tenant_user(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/users/{user_id}",
    response_model=TenantUserSummaryResponse,
    summary="Update a tenant user (name, role, active)",
)
async def patch_tenant_user(
    tenant_slug: str,
    user_id: str,
    payload: UpdateTenantUserRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantUserSummaryResponse:
    return await update_tenant_user(session, tenant_slug, user_id, payload)


@router.post(
    "/{tenant_slug}/users/{user_id}/password",
    response_model=TenantUserSummaryResponse,
    summary="Reset a tenant user's password",
)
async def post_tenant_user_password(
    tenant_slug: str,
    user_id: str,
    payload: ResetTenantUserPasswordRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> TenantUserSummaryResponse:
    return await reset_tenant_user_password(session, tenant_slug, user_id, payload)


@router.get(
    "/{tenant_slug}/services",
    response_model=ServiceListResponse,
    summary="List active services for a tenant",
)
async def list_services(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> ServiceListResponse:
    return await list_tenant_services(session, tenant_slug)


@router.get(
    "/{tenant_slug}/c/{category_slug}",
    summary="Public category landing page payload",
)
async def get_public_category(
    tenant_slug: str,
    category_slug: str,
    session: AsyncSession = Depends(get_db_session),
):
    from app.services.tenants import get_public_category_by_slug

    return await get_public_category_by_slug(session, tenant_slug, category_slug)


@router.post(
    "/{tenant_slug}/services",
    response_model=ServiceSummaryResponse,
    status_code=201,
    summary="Create a tenant-scoped service",
)
async def create_service(
    tenant_slug: str,
    payload: CreateServiceRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceSummaryResponse:
    return await create_tenant_service(session, tenant_slug, payload)


@router.get(
    "/{tenant_slug}/locations",
    response_model=LocationListResponse,
    summary="List active locations for a tenant storefront",
)
async def list_locations(
    tenant_slug: str,
    session: AsyncSession = Depends(get_db_session),
) -> LocationListResponse:
    return await list_tenant_locations(session, tenant_slug)


@router.get(
    "/{tenant_slug}/locations/manage",
    response_model=LocationListResponse,
    summary="List all locations (including inactive) for settings management",
)
async def list_locations_admin(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> LocationListResponse:
    return await list_tenant_locations_admin(session, tenant_slug)


@router.post(
    "/{tenant_slug}/locations",
    response_model=LocationSummaryResponse,
    status_code=201,
    summary="Create a tenant location",
)
async def create_location(
    tenant_slug: str,
    payload: CreateLocationRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> LocationSummaryResponse:
    return await create_tenant_location(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/locations/{location_id}",
    response_model=LocationSummaryResponse,
    summary="Update a tenant location",
)
async def patch_location(
    tenant_slug: str,
    location_id: str,
    payload: UpdateLocationRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> LocationSummaryResponse:
    return await update_tenant_location(session, tenant_slug, location_id, payload)


@router.delete(
    "/{tenant_slug}/locations/{location_id}",
    response_model=LocationSummaryResponse,
    summary="Deactivate (soft-delete) a tenant location",
)
async def delete_location(
    tenant_slug: str,
    location_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> LocationSummaryResponse:
    return await deactivate_tenant_location(session, tenant_slug, location_id)


@router.get(
    "/{tenant_slug}/services/{service_id}/providers",
    response_model=ProviderListResponse,
    summary="List active providers for a tenant service",
)
async def list_providers_for_service(
    tenant_slug: str,
    service_id: str,
    location_id: str | None = Query(None, alias="locationId"),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderListResponse:
    return await list_service_providers(session, tenant_slug, service_id, location_id)


@router.get(
    "/{tenant_slug}/availability",
    response_model=AvailabilityResponse,
    summary="List availability for a tenant service route",
)
async def get_availability(
    tenant_slug: str,
    service_id: str = Query(..., alias="serviceId"),
    provider_id: str | None = Query(None, alias="providerId"),
    location_id: str | None = Query(None, alias="locationId"),
    date: str = Query(...),
    window_days: int = Query(7, alias="windowDays", ge=1, le=62),
    session: AsyncSession = Depends(get_db_session),
) -> AvailabilityResponse:
    return await list_availability(
        session=session,
        tenant_slug=tenant_slug,
        service_id=service_id,
        provider_id=provider_id,
        location_id=location_id,
        requested_date_text=date,
        window_days=window_days,
    )


@router.get(
    "/{tenant_slug}/providers/manage",
    response_model=ProviderListResponse,
    summary="List all providers (including inactive) for staff management",
)
async def list_providers_admin(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderListResponse:
    return await list_tenant_providers_admin(session, tenant_slug)


@router.post(
    "/{tenant_slug}/providers",
    response_model=ProviderSummaryResponse,
    status_code=201,
    summary="Create a tenant provider",
)
async def post_tenant_provider(
    tenant_slug: str,
    payload: CreateProviderRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderSummaryResponse:
    return await create_tenant_provider(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/providers/{provider_id}",
    response_model=ProviderSummaryResponse,
    summary="Update a tenant provider",
)
async def patch_tenant_provider(
    tenant_slug: str,
    provider_id: str,
    payload: UpdateProviderRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderSummaryResponse:
    return await update_tenant_provider(session, tenant_slug, provider_id, payload)


@router.delete(
    "/{tenant_slug}/providers/{provider_id}",
    response_model=ProviderSummaryResponse,
    summary="Deactivate a tenant provider",
)
async def delete_tenant_provider(
    tenant_slug: str,
    provider_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderSummaryResponse:
    return await deactivate_tenant_provider(session, tenant_slug, provider_id)


@router.post(
    "/{tenant_slug}/staff",
    response_model=CreateStaffResponse,
    status_code=201,
    summary="Create a tenant user with an optional linked provider in one transaction",
)
async def post_tenant_staff(
    tenant_slug: str,
    payload: CreateStaffRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> CreateStaffResponse:
    return await create_tenant_staff(session, tenant_slug, payload)

# === Phase C: Provider weekly schedule ===

from app.schemas.catalog import (
    ProviderScheduleResponse,
    ReplaceProviderScheduleRequest,
)
from app.services.tenants import (
    get_tenant_provider_schedule,
    replace_tenant_provider_schedule,
)


@router.get(
    "/{tenant_slug}/providers/{provider_id}/schedule",
    response_model=ProviderScheduleResponse,
    summary="Get a provider's weekly schedule",
)
async def get_provider_schedule(
    tenant_slug: str,
    provider_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderScheduleResponse:
    return await get_tenant_provider_schedule(session, tenant_slug, provider_id)


@router.put(
    "/{tenant_slug}/providers/{provider_id}/schedule",
    response_model=ProviderScheduleResponse,
    summary="Replace a provider's weekly schedule",
)
async def put_provider_schedule(
    tenant_slug: str,
    provider_id: str,
    payload: ReplaceProviderScheduleRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderScheduleResponse:
    return await replace_tenant_provider_schedule(session, tenant_slug, provider_id, payload)


# === Phase D: Provider time off ===

from app.schemas.catalog import (
    CreateProviderTimeOffRequest,
    ProviderTimeOffListResponse,
    ProviderTimeOffResponse,
)
from app.services.tenants import (
    create_tenant_provider_time_off,
    delete_tenant_provider_time_off,
    list_tenant_provider_time_off,
)


@router.get(
    "/{tenant_slug}/providers/{provider_id}/time-off",
    response_model=ProviderTimeOffListResponse,
    summary="List a provider's time off",
)
async def list_provider_time_off(
    tenant_slug: str,
    provider_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderTimeOffListResponse:
    return await list_tenant_provider_time_off(session, tenant_slug, provider_id)


@router.post(
    "/{tenant_slug}/providers/{provider_id}/time-off",
    response_model=ProviderTimeOffResponse,
    status_code=201,
    summary="Create a time off entry for a provider",
)
async def create_provider_time_off(
    tenant_slug: str,
    provider_id: str,
    payload: CreateProviderTimeOffRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderTimeOffResponse:
    return await create_tenant_provider_time_off(session, tenant_slug, provider_id, payload)


@router.delete(
    "/{tenant_slug}/providers/{provider_id}/time-off/{time_off_id}",
    status_code=204,
    response_class=Response,
    summary="Delete a provider time off entry",
)
async def delete_provider_time_off(
    tenant_slug: str,
    provider_id: str,
    time_off_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    await delete_tenant_provider_time_off(session, tenant_slug, provider_id, time_off_id)
    return Response(status_code=204)


# === Phase E: Per-user permission overrides ===

from app.schemas.auth import (
    ReplaceUserPermissionsRequest,
    UserPermissionsResponse,
)
from app.services.tenants import (
    get_tenant_user_permissions,
    replace_tenant_user_permissions,
)


@router.get(
    "/{tenant_slug}/users/{user_id}/permissions",
    response_model=UserPermissionsResponse,
    summary="Get a user's effective permissions and overrides",
)
async def get_user_permissions(
    tenant_slug: str,
    user_id: str,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> UserPermissionsResponse:
    return await get_tenant_user_permissions(session, tenant_slug, user_id)


@router.put(
    "/{tenant_slug}/users/{user_id}/permissions",
    response_model=UserPermissionsResponse,
    summary="Replace a user's permission overrides",
)
async def put_user_permissions(
    tenant_slug: str,
    user_id: str,
    payload: ReplaceUserPermissionsRequest,
    _: object = Depends(require_tenant_permission("settings.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> UserPermissionsResponse:
    return await replace_tenant_user_permissions(session, tenant_slug, user_id, payload)


# === Phase G: Service categories, reorder, duplicate, variants, update ===

from app.schemas.catalog import (
    CreateServiceCategoryRequest,
    ProviderServiceVariantListResponse,
    ReorderRequest,
    ReplaceProviderServiceVariantsRequest,
    ServiceCategoryListResponse,
    ServiceCategorySummaryResponse,
    UpdateServiceCategoryRequest,
    UpdateServiceRequest,
)
from app.services.tenants import (
    create_tenant_service_category,
    delete_tenant_service_category,
    duplicate_tenant_service,
    list_tenant_service_categories,
    list_tenant_service_provider_variants,
    reorder_tenant_service_categories,
    reorder_tenant_services,
    replace_tenant_service_provider_variants,
    update_tenant_service,
    update_tenant_service_category,
)


@router.get(
    "/{tenant_slug}/service-categories",
    response_model=ServiceCategoryListResponse,
    summary="List service categories",
)
async def list_service_categories(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("services.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceCategoryListResponse:
    return await list_tenant_service_categories(session, tenant_slug)


@router.post(
    "/{tenant_slug}/service-categories",
    response_model=ServiceCategorySummaryResponse,
    status_code=201,
    summary="Create a service category",
)
async def create_service_category(
    tenant_slug: str,
    payload: CreateServiceCategoryRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceCategorySummaryResponse:
    return await create_tenant_service_category(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/service-categories/{category_id}",
    response_model=ServiceCategorySummaryResponse,
    summary="Update a service category",
)
async def patch_service_category(
    tenant_slug: str,
    category_id: str,
    payload: UpdateServiceCategoryRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceCategorySummaryResponse:
    return await update_tenant_service_category(session, tenant_slug, category_id, payload)


@router.delete(
    "/{tenant_slug}/service-categories/{category_id}",
    status_code=204,
    response_class=Response,
    summary="Delete a service category",
)
async def delete_service_category(
    tenant_slug: str,
    category_id: str,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    await delete_tenant_service_category(session, tenant_slug, category_id)
    return Response(status_code=204)


@router.put(
    "/{tenant_slug}/service-categories/reorder",
    response_model=ServiceCategoryListResponse,
    summary="Reorder service categories",
)
async def put_service_categories_reorder(
    tenant_slug: str,
    payload: ReorderRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceCategoryListResponse:
    return await reorder_tenant_service_categories(session, tenant_slug, payload)


@router.put(
    "/{tenant_slug}/services/reorder",
    response_model=ServiceListResponse,
    summary="Reorder services",
)
async def put_services_reorder(
    tenant_slug: str,
    payload: ReorderRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceListResponse:
    return await reorder_tenant_services(session, tenant_slug, payload)


@router.patch(
    "/{tenant_slug}/services/{service_id}",
    response_model=ServiceSummaryResponse,
    summary="Update a service",
)
async def patch_service(
    tenant_slug: str,
    service_id: str,
    payload: UpdateServiceRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceSummaryResponse:
    return await update_tenant_service(session, tenant_slug, service_id, payload)


@router.post(
    "/{tenant_slug}/services/{service_id}/duplicate",
    response_model=ServiceSummaryResponse,
    status_code=201,
    summary="Duplicate a service",
)
async def post_service_duplicate(
    tenant_slug: str,
    service_id: str,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ServiceSummaryResponse:
    return await duplicate_tenant_service(session, tenant_slug, service_id)


@router.get(
    "/{tenant_slug}/services/{service_id}/provider-variants",
    response_model=ProviderServiceVariantListResponse,
    summary="List per-provider variants for a service",
)
async def get_service_provider_variants(
    tenant_slug: str,
    service_id: str,
    _: object = Depends(require_tenant_permission("services.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderServiceVariantListResponse:
    return await list_tenant_service_provider_variants(session, tenant_slug, service_id)


@router.put(
    "/{tenant_slug}/services/{service_id}/provider-variants",
    response_model=ProviderServiceVariantListResponse,
    summary="Replace per-provider variants for a service",
)
async def put_service_provider_variants(
    tenant_slug: str,
    service_id: str,
    payload: ReplaceProviderServiceVariantsRequest,
    _: object = Depends(require_tenant_permission("services.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ProviderServiceVariantListResponse:
    return await replace_tenant_service_provider_variants(
        session, tenant_slug, service_id, payload
    )
