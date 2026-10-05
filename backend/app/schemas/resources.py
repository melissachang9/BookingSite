from __future__ import annotations

from datetime import datetime

from pydantic import Field

from app.schemas.base import CamelModel


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
