from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class LoginRequest(CamelModel):
    email: str
    password: str


class RefreshSessionRequest(CamelModel):
    refresh_token: str


class PermissionGrantResponse(CamelModel):
    key: str
    allowed: bool


class PermissionDefinitionResponse(CamelModel):
    key: str
    category: str
    label: str
    description: str


class PermissionCatalogResponse(CamelModel):
    permissions: list[PermissionDefinitionResponse]
    role_defaults: dict[str, list[str]]


class AuthenticatedUserResponse(CamelModel):
    id: str
    tenant_id: str
    tenant_slug: str
    email: str
    name: str
    role: str
    permissions: list[PermissionGrantResponse]


class SessionResponse(CamelModel):
    access_token: str
    refresh_token: str | None = None
    expires_at: datetime
    user: AuthenticatedUserResponse

# ---------------------------------------------------------------------------
# Per-user permission overrides (Phase E)
# ---------------------------------------------------------------------------


class UserPermissionOverrideEntry(CamelModel):
    key: str
    allowed: bool


class UserPermissionsResponse(CamelModel):
    user_id: str
    role: str
    role_defaults: list[str]
    overrides: list[UserPermissionOverrideEntry]
    effective: list[PermissionGrantResponse]


class ReplaceUserPermissionsRequest(CamelModel):
    overrides: list[UserPermissionOverrideEntry]


class ForgotPasswordRequest(CamelModel):
    email: str = Field(min_length=3, max_length=255)


class ResetPasswordRequest(CamelModel):
    token: str = Field(min_length=20, max_length=2000)
    new_password: str = Field(min_length=8, max_length=255)


class OkResponse(CamelModel):
    ok: bool = True
