from __future__ import annotations

from datetime import datetime, timezone
from html import escape
from urllib.parse import urljoin

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import get_settings
from app.core.http import api_exception
from app.core.security import create_customer_manage_token
from app.db.models import (
    Booking,
    BookingDraft,
    BookingDraftFormRequirement,
    Customer,
    FormDefinition,
    FormResponse,
    FormVersion,
    User,
)
from app.schemas.forms import (
    BookingFormResponseEntry,
    BookingFormResponseListResponse,
    FormResponseSummaryResponse,
    SendFormReminderResponse,
    SubmitFormRequirementRequest,
)
from app.services.booking_drafts import _ensure_aware, _ensure_not_expired, _load_booking, _load_booking_draft
from app.services.notifications import send_transactional_email
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
        booking_id=response.booking_id,
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


async def list_booking_form_requirements_by_token(
    session: AsyncSession,
    token: str,
) -> list[dict[str, object]]:
    """List pending form requirements for a confirmed booking, identified by manage token."""
    from app.services.booking_drafts import _load_manage_booking_context

    booking, tenant = await _load_manage_booking_context(session, token)

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
        return []

    requirements = (
        await session.scalars(
            select(BookingDraftFormRequirement)
            .options(
                selectinload(BookingDraftFormRequirement.form_version).selectinload(FormVersion.form),
            )
            .where(
                BookingDraftFormRequirement.tenant_id == tenant.id,
                BookingDraftFormRequirement.booking_draft_id.in_(draft_ids),
                BookingDraftFormRequirement.status == "pending",
            )
            .order_by(BookingDraftFormRequirement.created_at.asc())
        )
    ).all()

    result: list[dict[str, object]] = []
    for req in requirements:
        version = req.form_version
        form = version.form if version is not None else None
        schema = version.schema_json if version is not None and isinstance(version.schema_json, dict) else None
        result.append({
            "id": req.id,
            "formId": req.form_id,
            "formName": form.name if form is not None else "Form",
            "formDescription": form.description if form is not None and hasattr(form, "description") else None,
            "scope": req.scope,
            "customerPromptTiming": req.customer_prompt_timing,
            "status": req.status,
            "schema": schema,
        })

    return result


async def submit_booking_form_requirement_by_token(
    session: AsyncSession,
    token: str,
    requirement_id: str,
    payload: SubmitFormRequirementRequest,
) -> FormResponseSummaryResponse:
    """Submit a form requirement for a confirmed booking, identified by manage token."""
    from app.services.booking_drafts import _load_manage_booking_context

    booking, tenant = await _load_manage_booking_context(session, token)

    requirement = await session.scalar(
        select(BookingDraftFormRequirement)
            .options(selectinload(BookingDraftFormRequirement.form_version))
            .where(
                BookingDraftFormRequirement.id == requirement_id,
                BookingDraftFormRequirement.tenant_id == tenant.id,
            )
    )
    if requirement is None:
        raise api_exception(404, "not_found", "Form requirement was not found.")
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
        customer_id=booking.customer_id,
        booking_draft_id=requirement.booking_draft_id,
        booking_id=booking.id,
        scope=requirement.scope,
        customer_prompt_timing=requirement.customer_prompt_timing,
        submitted_at=datetime.now(timezone.utc),
        answers_json=payload.answers,
    )
    session.add(response)
    await session.flush()

    requirement.status = "satisfied"
    requirement.satisfied_by_response_id = response.id
    await session.commit()

    return _form_response_to_summary(response)


def _format_visit_start(starts_at: datetime) -> str:
    return _ensure_aware(starts_at).strftime("%a, %b %d at %I:%M %p %Z")


def _build_form_reminder_content(
    booking: Booking,
    pending_count: int,
    manage_url: str,
) -> tuple[str, str, str]:
    customer_name = booking.customer.name if booking.customer is not None else "there"
    service_name = booking.service.name if booking.service is not None else "your appointment"
    appointment_label = _format_visit_start(booking.starts_at)
    forms_word = "form" if pending_count == 1 else "forms"
    subject = f"Action needed: complete your {forms_word} before {service_name}"
    text_body = "\n".join(
        [
            f"Hi {customer_name},",
            "",
            f"You have {pending_count} pending {forms_word} to complete before your {service_name} appointment on {appointment_label}.",
            "",
            f"Complete your {forms_word} here: {manage_url}",
            "",
            "Reply to this email if you have any questions before your visit.",
        ]
    )
    html_body = "".join(
        [
            f"<p>Hi {escape(customer_name)},</p>",
            (
                f"<p>You have <strong>{pending_count} pending {forms_word}</strong> to complete before your "
                f"<strong>{escape(service_name)}</strong> appointment on <strong>{escape(appointment_label)}</strong>.</p>"
            ),
            f'<p><a href="{escape(manage_url)}">Complete your {forms_word}</a></p>',
            "<p>Reply to this email if you have any questions before your visit.</p>",
        ]
    )
    return subject, text_body, html_body


def _build_form_manage_url(token: str) -> str:
    settings = get_settings()
    base_url = settings.storefront_public_base_url.strip() if settings.storefront_public_base_url else ""
    if not base_url:
        raise api_exception(
            503,
            "service_unavailable",
            "Storefront public base URL must be configured before sending form reminders.",
        )
    return urljoin(f"{base_url.rstrip('/')}/", f"forms/{token}")


async def send_booking_form_reminder(
    session: AsyncSession,
    tenant_slug: str,
    booking_id: str,
    actor: User,
) -> SendFormReminderResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    booking = await _load_booking(session, booking_id, tenant.id)

    if booking.status != "confirmed":
        raise api_exception(409, "conflict", "Only confirmed bookings can receive form reminders.")
    if booking.customer is None or not booking.customer.email:
        raise api_exception(400, "bad_request", "Customer email is required before sending a form reminder.")

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

    pending_count = 0
    if draft_ids:
        pending_total = (
            await session.scalars(
                select(BookingDraftFormRequirement).where(
                    BookingDraftFormRequirement.tenant_id == tenant.id,
                    BookingDraftFormRequirement.booking_draft_id.in_(draft_ids),
                    BookingDraftFormRequirement.status == "pending",
                )
            )
        ).all()
        pending_count = len(pending_total)

    if pending_count == 0:
        raise api_exception(409, "conflict", "This booking has no pending forms.")

    token, _ = create_customer_manage_token({"bookingId": booking.id, "tenantId": booking.tenant_id})
    manage_url = _build_form_manage_url(token)

    subject, text_body, html_body = _build_form_reminder_content(booking, pending_count, manage_url)
    delivery = await send_transactional_email(
        recipient_email=booking.customer.email,
        subject=subject,
        text_body=text_body,
        html_body=html_body,
    )

    return SendFormReminderResponse(
        booking_id=booking.id,
        pending_requirement_count=pending_count,
        recipient_email=delivery.recipient_email,
        provider=delivery.provider,
        provider_message_id=delivery.provider_message_id,
        sent_at=delivery.sent_at,
        manage_url=manage_url,
    )


async def list_customer_form_responses(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
) -> BookingFormResponseListResponse:
    """List all submitted form responses for a customer (operator-facing)."""
    tenant = await get_tenant_by_slug(session, tenant_slug)

    customer = await session.scalar(
        select(Customer).where(Customer.tenant_id == tenant.id, Customer.id == customer_id)
    )
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")

    responses = (
        await session.scalars(
            select(FormResponse)
            .options(
                selectinload(FormResponse.form_version).selectinload(FormVersion.form),
            )
            .where(
                FormResponse.tenant_id == tenant.id,
                FormResponse.customer_id == customer_id,
            )
            .order_by(FormResponse.submitted_at.desc())
            .limit(50)
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