from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import (
    BookingDraft,
    BookingDraftFormRequirement,
    FormDefinition,
    FormResponse,
    FormVersion,
)
from app.schemas.forms import (
    BookingFormResponseEntry,
    BookingFormResponseListResponse,
    FormResponseSummaryResponse,
    SubmitFormRequirementRequest,
)
from app.services.booking_drafts import _ensure_not_expired, _load_booking, _load_booking_draft
from app.services.tenants import get_tenant_by_slug


def _validation_issues(schema: dict[str, object], answers: dict[str, object]) -> list[dict[str, str]]:
    issues: list[dict[str, str]] = []
    fields = schema.get("fields")
    if not isinstance(fields, list):
        return issues

    for field in fields:
        if not isinstance(field, dict):
            continue
        field_id = field.get("id")
        field_type = field.get("type")
        required = bool(field.get("required"))
        if not isinstance(field_id, str) or not isinstance(field_type, str):
            continue

        value = answers.get(field_id)
        if field_type in {"static_text", "section"}:
            continue

        if required and value in {None, ""}:
            issues.append({"field": field_id, "message": "This field is required.", "code": "required"})
            continue

        if value is None:
            continue

        if field_type in {"short_text", "long_text"} and not isinstance(value, str):
            issues.append({"field": field_id, "message": "Expected text input.", "code": "type_error"})
        elif field_type in {"yes_no", "checkbox"} and not isinstance(value, bool):
            issues.append({"field": field_id, "message": "Expected a yes/no response.", "code": "type_error"})

    return issues


def _form_response_to_summary(response: FormResponse) -> FormResponseSummaryResponse:
    return FormResponseSummaryResponse(
        id=response.id,
        tenant_id=response.tenant_id,
        created_at=response.created_at,
        updated_at=response.updated_at,
        form_id=response.form_id,
        form_version_id=response.form_version_id,
        customer_id=response.customer_id,
        booking_id=None,
        booking_draft_id=response.booking_draft_id,
        scope=response.scope,
        customer_prompt_timing=response.customer_prompt_timing,
        submitted_at=response.submitted_at,
        filled_by_user_id=None,
        answers=response.answers_json,
        attachments=[],
    )


async def submit_booking_form_requirement(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    requirement_id: str,
    payload: SubmitFormRequirementRequest,
) -> FormResponseSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    _ensure_not_expired(draft)

    requirement = await session.scalar(
        select(BookingDraftFormRequirement)
        .options(selectinload(BookingDraftFormRequirement.form_version))
        .where(
            BookingDraftFormRequirement.id == requirement_id,
            BookingDraftFormRequirement.booking_draft_id == booking_draft_id,
            BookingDraftFormRequirement.tenant_id == tenant.id,
        )
    )
    if requirement is None:
        raise api_exception(404, "not_found", "Form requirement was not found for this booking draft.")
    if draft.customer_id is None:
        raise api_exception(400, "bad_request", "Customer details are required before completing forms.")
    if requirement.status != "pending":
        raise api_exception(409, "conflict", "This form requirement has already been satisfied.")

    schema = requirement.form_version.schema_json if requirement.form_version is not None else {}
    issues = _validation_issues(schema if isinstance(schema, dict) else {}, payload.answers)
    if issues:
        raise api_exception(422, "validation_error", "Request validation failed.", issues)

    response = FormResponse(
        tenant_id=tenant.id,
        form_id=requirement.form_id,
        form_version_id=requirement.form_version_id,
        customer_id=draft.customer_id,
        booking_draft_id=draft.id,
        scope=requirement.scope,
        customer_prompt_timing=requirement.customer_prompt_timing,
        submitted_at=datetime.now(timezone.utc),
        answers_json=payload.answers,
    )
    session.add(response)
    await session.flush()

    requirement.status = "satisfied"
    requirement.satisfied_by_response_id = response.id

    pending_requirements = [
        item
        for item in draft.form_requirements
        if item.id != requirement.id and item.customer_prompt_timing == "pre_booking" and item.status == "pending"
    ]
    if not pending_requirements:
        draft.status = "slot_held"

    await session.commit()
    return _form_response_to_summary(response)


async def list_booking_form_responses(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
) -> BookingFormResponseListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)

    draft_ids: list[str] = []
    if booking.source_draft is not None:
        draft_ids.append(booking.source_draft.id)
    else:
        sibling_drafts = (
            await session.scalars(
                select(BookingDraft.id).where(
                    BookingDraft.tenant_id == tenant.id,
                    BookingDraft.confirmed_booking_id == booking.id,
                )
            )
        ).all()
        draft_ids.extend(sibling_drafts)

    if not draft_ids:
        return BookingFormResponseListResponse(items=[])

    responses = (
        await session.scalars(
            select(FormResponse)
            .options(
                selectinload(FormResponse.form_version).selectinload(FormVersion.form),
            )
            .where(
                FormResponse.tenant_id == tenant.id,
                FormResponse.booking_draft_id.in_(draft_ids),
            )
            .order_by(FormResponse.submitted_at.asc())
        )
    ).all()

    items: list[BookingFormResponseEntry] = []
    for response in responses:
        version = response.form_version
        form: FormDefinition | None = version.form if version is not None else None
        schema = version.schema_json if version is not None and isinstance(version.schema_json, dict) else None
        items.append(
            BookingFormResponseEntry(
                id=response.id,
                form_id=response.form_id,
                form_version_id=response.form_version_id,
                form_name=form.name if form is not None else "Form",
                form_version_number=version.version_number if version is not None else 0,
                scope=response.scope,
                customer_prompt_timing=response.customer_prompt_timing,
                submitted_at=response.submitted_at,
                answers=response.answers_json,
                schema=schema,
            )
        )

    return BookingFormResponseListResponse(items=items)