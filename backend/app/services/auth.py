from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.core.security import create_access_token, create_refresh_token, decode_token, verify_password
from app.db.models import User
from app.schemas.auth import AuthenticatedUserResponse, PermissionGrantResponse, SessionResponse


# ---------------------------------------------------------------------------
# Permission catalog (Phase B groundwork)
#
# This module is the single source of truth for what permission keys exist in
# the system, what they mean, and which user roles get them by default. The
# catalog is intentionally structured (category + label + description) so the
# upcoming per-user permission override UI can render grouped toggles without
# additional plumbing, and so the catalog can later be lifted into a database
# table without renaming keys or changing call sites.
#
# Enforcement today is still role-based via ROLE_PERMISSION_ALLOWLIST, but
# every gate already goes through require_tenant_permission(key), so when
# user-level overrides land the resolver swap is the only change needed.
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class PermissionDefinition:
    key: str
    category: str
    label: str
    description: str


PERMISSION_CATALOG: list[PermissionDefinition] = [
    # Dashboard & calendar
    PermissionDefinition("dashboard.view", "Dashboard", "View dashboard", "See the operator home dashboard and KPI summary."),
    PermissionDefinition("calendar.view", "Calendar", "View calendar", "Open the calendar and see scheduled visits."),
    PermissionDefinition("calendar.create_booking", "Calendar", "Create bookings from calendar", "Add a booking by selecting a calendar slot."),

    # Bookings lifecycle
    PermissionDefinition("bookings.view", "Bookings", "View bookings", "List, search, and open bookings."),
    PermissionDefinition("bookings.manage", "Bookings", "Edit bookings", "Update booking details, reschedule, change services."),
    PermissionDefinition("bookings.complete", "Bookings", "Mark bookings complete", "Close out completed visits."),
    PermissionDefinition("bookings.cancel", "Bookings", "Cancel bookings", "Cancel bookings and apply policy refunds."),
    PermissionDefinition("bookings.collect_payment", "Bookings", "Collect payment at checkout", "Run point-of-sale checkout and collect balances."),

    # Payments
    PermissionDefinition("payments.view", "Payments", "View payments", "Browse payment history and balances."),
    PermissionDefinition("payments.manage", "Payments", "Issue refunds and adjustments", "Refund, void, or apply compensating payment events."),

    # Customers
    PermissionDefinition("customers.view", "Customers", "View customers", "Open customer profiles and visit history."),
    PermissionDefinition("customers.manage", "Customers", "Edit customers", "Update customer details, notes, contact info."),

    # Forms
    PermissionDefinition("forms.view", "Forms", "View forms", "Read form definitions and submitted responses."),
    PermissionDefinition("forms.manage", "Forms", "Build and edit forms", "Create, version, and configure forms."),

    # Catalog: services, providers, locations
    PermissionDefinition("services.view", "Services", "View services", "Browse the service catalog."),
    PermissionDefinition("services.manage", "Services", "Edit services", "Create or update services, prices, deposits, durations."),
    PermissionDefinition("providers.view", "Providers", "View providers", "See provider roster and availability."),
    PermissionDefinition("providers.manage", "Providers", "Edit providers", "Link users to providers, set bookable services and locations."),
    PermissionDefinition("locations.view", "Locations", "View locations", "Browse tenant locations."),
    PermissionDefinition("locations.manage", "Locations", "Edit locations", "Add or update locations, hours, and rooms."),

    # Reports (future - keys reserved so role defaults can already include or exclude them)
    PermissionDefinition("reports.view", "Reports", "View reports", "Read operational and financial reports."),
    PermissionDefinition("reports.financial", "Reports", "View financial reports", "Read revenue, refund, and tax breakdown reports."),
    PermissionDefinition("reports.export", "Reports", "Export reports", "Download report data as CSV or PDF."),

    # Settings
    PermissionDefinition("settings.view", "Settings", "View settings", "Open tenant settings screens."),
    PermissionDefinition("settings.manage", "Settings", "Edit settings", "Change business settings, policies, hours, and team."),
]


PERMISSION_DEFINITIONS_BY_KEY: dict[str, PermissionDefinition] = {
    definition.key: definition for definition in PERMISSION_CATALOG
}


ALL_PERMISSION_KEYS: list[str] = [definition.key for definition in PERMISSION_CATALOG]


# Role defaults. Owners get everything. Other roles are templates today; per-user
# overrides will layer on top once Phase E (permission overrides) lands.
ROLE_PERMISSION_ALLOWLIST: dict[str, set[str]] = {
    "owner": set(ALL_PERMISSION_KEYS),
    "manager": {
        key
        for key in ALL_PERMISSION_KEYS
        # Managers get everything by default in the role template.
    },
    "staff": {
        "dashboard.view",
        "calendar.view",
        "calendar.create_booking",
        "bookings.view",
        "bookings.manage",
        "bookings.complete",
        "bookings.cancel",
        "bookings.collect_payment",
        "payments.view",
        "payments.manage",
        "customers.view",
        "customers.manage",
        "forms.view",
        "services.view",
        "providers.view",
        "locations.view",
        "reports.view",
    },
    "provider": {
        "dashboard.view",
        "calendar.view",
        "calendar.create_booking",
        "bookings.view",
        "bookings.manage",
        "bookings.complete",
        "bookings.cancel",
        "bookings.collect_payment",
        "customers.view",
        "customers.manage",
        "forms.view",
        "services.view",
        "providers.view",
        "locations.view",
    },
}


def _permission_grants(role: str) -> list[PermissionGrantResponse]:
    allowlist = ROLE_PERMISSION_ALLOWLIST.get(role, set())
    return [PermissionGrantResponse(key=key, allowed=key in allowlist) for key in ALL_PERMISSION_KEYS]


def _session_response_for_user(user: User) -> SessionResponse:
    tenant_slug = user.tenant.slug if user.tenant is not None else None
    if tenant_slug is None:
        raise api_exception(401, "unauthorized", "User session is no longer active.")

    payload = {
        "sub": user.id,
        "tenantId": user.tenant_id,
        "tenantSlug": tenant_slug,
        "email": user.email,
        "role": user.role,
    }
    access_token, expires_at = create_access_token(payload)
    refresh_token, _ = create_refresh_token(payload)
    return SessionResponse(
        access_token=access_token,
        refresh_token=refresh_token,
        expires_at=expires_at,
        user=AuthenticatedUserResponse(
            id=user.id,
            tenant_id=user.tenant_id,
            tenant_slug=tenant_slug,
            email=user.email,
            name=user.name,
            role=user.role,
            permissions=_permission_grants(user.role),
        ),
    )


async def login_user(session: AsyncSession, email: str, password: str) -> SessionResponse:
    user = await session.scalar(select(User).options(selectinload(User.tenant)).where(User.email == email.strip().lower()))
    if user is None or not user.is_active or not verify_password(password, user.password_hash):
        raise api_exception(401, "unauthorized", "Invalid email or password.")
    return _session_response_for_user(user)


async def refresh_user_session(session: AsyncSession, refresh_token: str) -> SessionResponse:
    try:
        payload = decode_token(refresh_token)
    except Exception as error:  # noqa: BLE001
        raise api_exception(401, "unauthorized", "Refresh token is invalid or expired.") from error

    if payload.get("tokenType") != "refresh":
        raise api_exception(401, "unauthorized", "Refresh token is invalid or expired.")

    user = await session.scalar(select(User).options(selectinload(User.tenant)).where(User.id == payload.get("sub")))
    if user is None or not user.is_active:
        raise api_exception(401, "unauthorized", "User session is no longer active.")
    return _session_response_for_user(user)