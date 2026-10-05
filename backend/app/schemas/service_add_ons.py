from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class ServiceAddOnResponse(CamelModel):
    id: str
    tenant_id: str
    service_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    description: str | None = None
    price_cents: int
    duration_minutes: int
    is_active: bool
    sort_order: int


class ServiceAddOnListResponse(CamelModel):
    items: list[ServiceAddOnResponse]


class CreateServiceAddOnRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    price_cents: int = Field(ge=0, le=500_000)
    duration_minutes: int = Field(default=0, ge=0, le=240)
    is_active: bool = True


class UpdateServiceAddOnRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    description: str | None = Field(default=None, max_length=2000)
    clear_description: bool = False
    price_cents: int | None = Field(default=None, ge=0, le=500_000)
    duration_minutes: int | None = Field(default=None, ge=0, le=240)
    is_active: bool | None = None
    sort_order: int | None = Field(default=None, ge=0, le=10_000)
