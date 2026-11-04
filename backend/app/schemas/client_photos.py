from __future__ import annotations

from datetime import datetime
from pydantic import Field

from app.schemas.base import CamelModel

BUILT_IN_KINDS = ("before", "after", "other")
MAX_KIND_LENGTH = 40


class ClientPhotoResponse(CamelModel):
    id: str
    customer_id: str
    booking_id: str | None = None
    kind: str
    caption: str | None = None
    mime_type: str
    file_size_bytes: int
    original_file_name: str | None = None
    uploaded_by_name: str | None = None
    created_at: datetime


class ClientPhotoListResponse(CamelModel):
    items: list[ClientPhotoResponse] = Field(default_factory=list)


class UpdateClientPhotoRequest(CamelModel):
    kind: str | None = Field(default=None, min_length=1, max_length=MAX_KIND_LENGTH)
    # An empty string clears the caption.
    caption: str | None = Field(default=None, max_length=1000)


class ClientPhotoCategoriesResponse(CamelModel):
    """Categories the business has made up, beyond Before / After / Other."""

    custom: list[str] = Field(default_factory=list)
