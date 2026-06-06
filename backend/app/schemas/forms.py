from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import Field

from app.schemas.base import CamelModel


class FormFieldOptionSchema(CamelModel):
    label: str
    value: str
    help_text: str | None = None


class FormFieldSchema(CamelModel):
    id: str
    type: str
    label: str
    required: bool = False
    help_text: str | None = None
    placeholder: str | None = None
    options: list[FormFieldOptionSchema] = Field(default_factory=list)
    content: str | None = None


class FormSchemaPayload(CamelModel):
    title: str = ""
    description: str | None = None
    fields: list[FormFieldSchema] = Field(default_factory=list)


class FormSummaryResponse(CamelModel):
    id: str
    tenant_id: str
    created_at: datetime
    updated_at: datetime
    name: str
    scope: str
    customer_prompt_timing: str | None = None
    is_active: bool
    current_version_id: str | None = None
    current_version_number: int | None = None
    schema: FormSchemaPayload | None = None


class FormListResponse(CamelModel):
    items: list[FormSummaryResponse]


class CreateFormRequest(CamelModel):
    name: str = Field(min_length=1, max_length=255)
    scope: str = Field(default="customer")
    customer_prompt_timing: str | None = None
    schema: FormSchemaPayload = Field(default_factory=FormSchemaPayload)


class UpdateFormRequest(CamelModel):
    name: str | None = Field(default=None, min_length=1, max_length=255)
    scope: str | None = None
    customer_prompt_timing: str | None = None
    is_active: bool | None = None
    schema: FormSchemaPayload | None = None


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


class BookingFormResponseEntry(CamelModel):
    id: str
    form_id: str
    form_version_id: str
    form_name: str
    form_version_number: int
    scope: str
    customer_prompt_timing: str | None = None
    submitted_at: datetime
    answers: dict[str, Any]
    schema: dict[str, Any] | None = None


class BookingFormResponseListResponse(CamelModel):
    items: list[BookingFormResponseEntry] = Field(default_factory=list)