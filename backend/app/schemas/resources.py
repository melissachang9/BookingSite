from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


class ResourceServiceUse(CamelModel):
    service_id: str
    service_name: str
    is_active: bool
    quantity: int  # units one booking of the service uses


class ResourceSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    kind: str
    is_active: bool
    location_id: str | None = None
    notes: str | None = None
    quantity: int = 1  # units the studio owns
    used_by: list[ResourceServiceUse] = Field(default_factory=list)


class ResourceListResponse(CamelModel):
    items: list[ResourceSummaryResponse]


class CreateResourceRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    kind: str = "room"
    location_id: str | None = None
    notes: str | None = None
    quantity: int = Field(default=1, ge=1, le=100)


class UpdateResourceRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    kind: str | None = None
    is_active: bool | None = None
    location_id: str | None = None
    notes: str | None = None
    quantity: int | None = Field(default=None, ge=1, le=100)


class ResourceBlockConflict(CamelModel):
    """A confirmed booking that already holds the resource during a block."""

    booking_id: str
    starts_at: datetime
    ends_at: datetime
    customer_name: str
    service_name: str


class ResourceBlockResponse(CamelModel):
    id: str
    resource_id: str
    starts_at: datetime
    ends_at: datetime
    reason: str | None = None
    created_by_name: str | None = None
    created_at: datetime
    conflicts: list[ResourceBlockConflict] = Field(default_factory=list)


class ResourceBlockListResponse(CamelModel):
    items: list[ResourceBlockResponse]


class CreateResourceBlockRequest(CamelModel):
    starts_at: datetime
    ends_at: datetime
    reason: str | None = Field(default=None, max_length=255)
