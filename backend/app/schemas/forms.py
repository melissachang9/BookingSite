from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas.base import CamelModel


class FormRequirementResponse(CamelModel):
    id: str
    booking_id: str | None = None
    booking_draft_id: str | None = None
    form_id: str
    form_version_id: str
    scope: str
    customer_prompt_timing: str | None = None
    status: str
    satisfied_by_response_id: str | None = None
    form_title: str | None = None
    form_description: str | None = None
    schema: dict[str, Any] | None = None


class SubmitFormRequirementRequest(CamelModel):
    answers: dict[str, Any] = Field(default_factory=dict)


class FormResponseSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    form_id: str
    form_version_id: str
    customer_id: str
    booking_id: str | None = None
    booking_draft_id: str | None = None
    scope: str
    customer_prompt_timing: str | None = None
    submitted_at: datetime
    filled_by_user_id: str | None = None
    answers: dict[str, Any]
    attachments: list[dict[str, Any]] = Field(default_factory=list)