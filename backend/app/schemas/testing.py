from __future__ import annotations

from app.db.seed import DEMO_TENANT_SLUG
from app.schemas.base import CamelModel


class ResetE2EDataRequest(CamelModel):
    tenant_slug: str = DEMO_TENANT_SLUG


class ResetE2EDataResponse(CamelModel):
    tenant_slug: str
    slot_holds_deleted: int
    booking_drafts_deleted: int
    customers_deleted: int