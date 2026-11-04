"""Internal forms: notes and records staff fill in about a client, never shown to the client.

They share the field system and versioning with customer forms. A submitted response is never edited or
removed; it keeps the form version it was answered against.
"""
from __future__ import annotations

from datetime import datetime, timezone

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import Booking, Customer, FormDefinition, FormResponse, FormVersion, User
from app.schemas.forms import (
    InternalFormOption,
    InternalFormOptionListResponse,
    InternalFormResponseEntry,
    InternalFormResponseListResponse,
    SubmitInternalFormRequest,
)
from app.services.audit import ActorRef, record_audit
from app.services.booking_forms import _extract_attachments, _validation_issues
from app.services.tenants import get_tenant_by_slug

INTERNAL_SCOPE = "internal"
LIST_LIMIT = 100


async def _load_customer(session: AsyncSession, tenant_id: str, customer_id: str) -> Customer:
    customer = await session.scalar(select(Customer).where(Customer.tenant_id == tenant_id, Customer.id == customer_id))
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")
    return customer


async def _latest_version(session: AsyncSession, form_id: str) -> FormVersion | None:
    return await session.scalar(
        select(FormVersion).where(FormVersion.form_id == form_id).order_by(FormVersion.version_number.desc()).limit(1)
    )


async def list_internal_forms(session: AsyncSession, tenant_slug: str) -> InternalFormOptionListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    forms = (
        await session.scalars(
            select(FormDefinition)
            .where(
                FormDefinition.tenant_id == tenant.id,
                FormDefinition.scope == INTERNAL_SCOPE,
                FormDefinition.is_active.is_(True),
            )
            .order_by(FormDefinition.name.asc())
        )
    ).all()
    items: list[InternalFormOption] = []
    for form in forms:
        version = await _latest_version(session, form.id)
        if version is None or not isinstance(version.schema_json, dict):
            continue
        description = version.schema_json.get("description")
        items.append(
            InternalFormOption(
                id=form.id,
                name=form.name,
                description=description if isinstance(description, str) else None,
                form_version_id=version.id,
                version_number=version.version_number,
                schema=version.schema_json,
            )
        )
    return InternalFormOptionListResponse(items=items)


def _entry(response: FormResponse) -> InternalFormResponseEntry:
    version = response.form_version
    form = version.form if version is not None else None
    schema = version.schema_json if version is not None and isinstance(version.schema_json, dict) else None
    return InternalFormResponseEntry(
        id=response.id,
        form_id=response.form_id,
        form_version_id=response.form_version_id,
        form_name=form.name if form is not None else "Form",
        form_version_number=version.version_number if version is not None else 0,
        scope=response.scope,
        customer_prompt_timing=None,
        submitted_at=response.submitted_at,
        answers=response.answers_json,
        schema=schema,
        attachments=_extract_attachments(response.answers_json),
        booking_id=response.booking_id,
        submitted_by_name=response.submitted_by_name,
    )


async def list_customer_internal_responses(
    session: AsyncSession, tenant_slug: str, customer_id: str
) -> InternalFormResponseListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _load_customer(session, tenant.id, customer_id)
    responses = (
        await session.scalars(
            select(FormResponse)
            .options(selectinload(FormResponse.form_version).selectinload(FormVersion.form))
            .where(
                FormResponse.tenant_id == tenant.id,
                FormResponse.customer_id == customer_id,
                FormResponse.scope == INTERNAL_SCOPE,
            )
            .order_by(FormResponse.submitted_at.desc())
            .limit(LIST_LIMIT)
        )
    ).all()
    return InternalFormResponseListResponse(items=[_entry(response) for response in responses])


async def submit_internal_form(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
    form_id: str,
    payload: SubmitInternalFormRequest,
    actor: User,
) -> InternalFormResponseEntry:
    actor_ref = ActorRef.from_user(actor)
    tenant = await get_tenant_by_slug(session, tenant_slug)
    tenant_id = tenant.id
    await _load_customer(session, tenant_id, customer_id)

    form = await session.scalar(
        select(FormDefinition).where(
            FormDefinition.tenant_id == tenant_id,
            FormDefinition.id == form_id,
            FormDefinition.scope == INTERNAL_SCOPE,
        )
    )
    if form is None:
        raise api_exception(404, "not_found", "Internal form was not found for this tenant.")
    if not form.is_active:
        raise api_exception(409, "conflict", "This form is not active.")
    version = await _latest_version(session, form.id)
    if version is None or not isinstance(version.schema_json, dict):
        raise api_exception(409, "conflict", "This form has no questions yet.")

    schema = version.schema_json
    known_fields = {
        field["id"]
        for field in schema.get("fields", [])
        if isinstance(field, dict) and isinstance(field.get("id"), str)
    }
    unknown = sorted(set(payload.answers) - known_fields)
    if unknown:
        raise api_exception(
            422,
            "validation_error",
            "Request validation failed.",
            [{"field": name, "message": "This question is not on the form.", "code": "unknown_field"} for name in unknown],
        )
    issues = _validation_issues(schema, payload.answers)
    if issues:
        raise api_exception(422, "validation_error", "Request validation failed.", issues)

    booking_id: str | None = None
    if payload.booking_id is not None:
        booking = await session.scalar(
            select(Booking).where(
                Booking.tenant_id == tenant_id,
                Booking.id == payload.booking_id,
                Booking.customer_id == customer_id,
            )
        )
        if booking is None:
            raise api_exception(404, "not_found", "Booking was not found for this client.")
        booking_id = booking.id

    response = FormResponse(
        tenant_id=tenant_id,
        form_id=form.id,
        form_version_id=version.id,
        customer_id=customer_id,
        booking_id=booking_id,
        scope=INTERNAL_SCOPE,
        customer_prompt_timing=None,
        submitted_at=datetime.now(timezone.utc),
        answers_json=payload.answers,
        submitted_by_user_id=actor_ref.id,
        submitted_by_name=actor_ref.name,
    )
    session.add(response)
    await session.flush()
    await record_audit(
        session,
        tenant_id=tenant_id,
        entity_type="form_response",
        entity_id=response.id,
        action="submit_internal",
        actor=actor_ref,
        notes=f"{form.name} v{version.version_number} for customer {customer_id}",
    )
    response_id = response.id
    await session.commit()

    saved = await session.scalar(
        select(FormResponse)
        .options(selectinload(FormResponse.form_version).selectinload(FormVersion.form))
        .where(FormResponse.id == response_id)
    )
    assert saved is not None
    return _entry(saved)
