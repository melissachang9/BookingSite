from __future__ import annotations

from app.schemas.base import CamelModel
from app.schemas.booking_drafts import CustomerSummaryResponse
from app.schemas.bookings import PaginationMetaResponse


class CustomerLookupResponse(CamelModel):
    items: list[CustomerSummaryResponse]
    meta: PaginationMetaResponse