from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import FormDefinition, FormVersion, Service, ServiceFormAttachment
from app.schemas.forms import (
    CreateFormRequest,
    FormListResponse,
    FormSchemaPayload,
    FormSummaryResponse,
    UpdateFormRequest,
)
from app.services.tenants import get_tenant_by_slug


async def list_tenant_forms(
    session: AsyncSession,
    tenant_slug: str,
) -> FormListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    forms = (
        await session.scalars(
            select(FormDefinition)
            .options(selectinload(FormDefinition.service_attachments))
            .where(FormDefinition.tenant_id == tenant.id)
            .order_by(FormDefinition.name.asc())
        )
    ).all()

    items: list[FormSummaryResponse] = []
    for form in forms:
        latest_version = await _get_latest_version(session, form.id)
        items.append(_form_to_summary(form, latest_version))

    return FormListResponse(items=items)


async def create_tenant_form(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateFormRequest,
) -> FormSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    form = FormDefinition(
        tenant_id=tenant.id,
        name=payload.name.strip(),
        scope=payload.scope,
        customer_prompt_timing=payload.customer_prompt_timing,
        review_required=payload.review_required,
        is_active=True,
    )
    session.add(form)
    await session.flush()

    version = FormVersion(
        tenant_id=tenant.id,
        form_id=form.id,
        version_number=1,
        schema_json=payload.schema.model_dump() if payload.schema else {},
    )
    session.add(version)
    await session.flush()

    # Attach to services
    service_ids: list[str] = []
    if payload.service_ids:
        await _sync_service_attachments(session, tenant.id, form.id, version.id, payload.service_ids)
        service_ids = payload.service_ids

    await session.commit()
    return _form_to_summary(form, version, service_ids)


async def update_tenant_form(
    session: AsyncSession,
    tenant_slug: str,
    form_id: str,
    payload: UpdateFormRequest,
) -> FormSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    form = await session.scalar(
        select(FormDefinition).where(
            FormDefinition.tenant_id == tenant.id,
            FormDefinition.id == form_id,
        )
    )
    if form is None:
        raise api_exception(404, "not_found", "Form was not found for this tenant.")

    if payload.name is not None:
        form.name = payload.name.strip()
    if payload.scope is not None:
        form.scope = payload.scope
    if payload.customer_prompt_timing is not None:
        form.customer_prompt_timing = payload.customer_prompt_timing
    if payload.review_required is not None:
        form.review_required = payload.review_required
    if payload.is_active is not None:
        form.is_active = payload.is_active

    latest_version = await _get_latest_version(session, form.id)

    if payload.schema is not None:
        new_version = FormVersion(
            tenant_id=tenant.id,
            form_id=form.id,
            version_number=(latest_version.version_number + 1) if latest_version else 1,
            schema_json=payload.schema.model_dump(),
        )
        session.add(new_version)
        await session.flush()
        latest_version = new_version

    # Sync service attachments
    service_ids: list[str] | None = None
    if payload.service_ids is not None and latest_version is not None:
        await _sync_service_attachments(session, tenant.id, form.id, latest_version.id, payload.service_ids)
        service_ids = payload.service_ids

    await session.commit()
    return _form_to_summary(form, latest_version, service_ids)


async def _get_latest_version(
    session: AsyncSession,
    form_id: str,
) -> FormVersion | None:
    return await session.scalar(
        select(FormVersion)
        .where(FormVersion.form_id == form_id)
        .order_by(FormVersion.version_number.desc())
        .limit(1)
    )


def _form_to_summary(
    form: FormDefinition,
    version: FormVersion | None,
    service_ids: list[str] | None = None,
) -> FormSummaryResponse:
    schema = None
    if version is not None and version.schema_json:
        try:
            schema = FormSchemaPayload(**version.schema_json)
        except Exception:
            schema = None

    return FormSummaryResponse(
        id=form.id,
        tenant_id=form.tenant_id,
        created_at=form.created_at,
        updated_at=form.updated_at,
        name=form.name,
        scope=form.scope,
        customer_prompt_timing=form.customer_prompt_timing,
        review_required=form.review_required,
        is_active=form.is_active,
        current_version_id=version.id if version else None,
        current_version_number=version.version_number if version else None,
        schema=schema,
        service_ids=service_ids if service_ids is not None else [],
    )


async def _sync_service_attachments(
    session: AsyncSession,
    tenant_id: str,
    form_id: str,
    version_id: str,
    service_ids: list[str],
) -> None:
    """Replace all service attachments for a form with the given service IDs."""
    # Delete existing attachments
    existing = (
        await session.scalars(
            select(ServiceFormAttachment).where(
                ServiceFormAttachment.tenant_id == tenant_id,
                ServiceFormAttachment.form_id == form_id,
            )
        )
    ).all()
    for att in existing:
        await session.delete(att)

    # Create new attachments
    for service_id in service_ids:
        att = ServiceFormAttachment(
            tenant_id=tenant_id,
            service_id=service_id,
            form_id=form_id,
            form_version_id=version_id,
            customer_prompt_timing="pre_booking",  # default; can be refined later
        )
        session.add(att)


async def delete_tenant_form(
    session: AsyncSession,
    tenant_slug: str,
    form_id: str,
) -> None:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    form = await session.scalar(
        select(FormDefinition).where(
            FormDefinition.tenant_id == tenant.id,
            FormDefinition.id == form_id,
        )
    )
    if form is None:
        raise api_exception(404, "not_found", "Form was not found for this tenant.")

    # Delete service attachments first (FK constraint)
    attachments = await session.scalars(
        select(ServiceFormAttachment).where(
            ServiceFormAttachment.tenant_id == tenant.id,
            ServiceFormAttachment.form_id == form_id,
        )
    )
    for att in attachments:
        await session.delete(att)

    # Delete all versions
    versions = await session.scalars(
        select(FormVersion).where(FormVersion.form_id == form_id)
    )
    for version in versions:
        await session.delete(version)

    await session.delete(form)
    await session.commit()
