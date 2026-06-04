from __future__ import annotations

from datetime import datetime

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