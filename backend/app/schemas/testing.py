from __future__ import annotations

from datetime import datetime

from app.db.seed import DEMO_TENANT_SLUG
from app.schemas.base import CamelModel


class ResetE2EDataRequest(CamelModel):
    tenant_slug: str = DEMO_TENANT_SLUG


class ResetE2EDataResponse(CamelModel):
    tenant_slug: str
    slot_holds_deleted: int
    booking_drafts_deleted: int
    bookings_deleted: int
    customers_deleted: int


class MoveBookingStartRequest(CamelModel):
    starts_at: datetime
    tenant_slug: str = DEMO_TENANT_SLUG


class MoveBookingStartResponse(CamelModel):
    tenant_slug: str
    booking_id: str
    starts_at: datetime
    ends_at: datetime