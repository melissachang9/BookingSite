"""Service add-ons: optional extras (price and extra minutes) offered with a
service, chosen by clients when booking online or by staff from the calendar,
and quick-added at checkout."""

from __future__ import annotations

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.http import api_exception
from app.db.models import Service, ServiceAddOn
from app.schemas.service_add_ons import (
    CreateServiceAddOnRequest,
    ServiceAddOnListResponse,
    ServiceAddOnResponse,
    UpdateServiceAddOnRequest,
)
from app.services.tenants import get_tenant_by_slug

MAX_ADD_ONS_PER_BOOKING = 20


def add_on_to_response(add_on: ServiceAddOn) -> ServiceAddOnResponse:
    return ServiceAddOnResponse(
        id=add_on.id,
        tenant_id=add_on.tenant_id,
        service_id=add_on.service_id,
        created_at=add_on.created_at,
        updated_at=add_on.updated_at,
        name=add_on.name,
        description=add_on.description,
        price_cents=add_on.price_cents,
        duration_minutes=add_on.duration_minutes,
        is_active=add_on.is_active,
        sort_order=add_on.sort_order,
    )


async def _load_service(session: AsyncSession, tenant_id: str, service_id: str) -> Service:
    service = await session.scalar(
        select(Service).where(Service.id == service_id, Service.tenant_id == tenant_id)
    )
    if service is None:
        raise api_exception(404, "not_found", "Service was not found for this tenant.")
    return service


async def _load_add_on(session: AsyncSession, tenant_id: str, service_id: str, add_on_id: str) -> ServiceAddOn:
    add_on = await session.scalar(
        select(ServiceAddOn).where(
            ServiceAddOn.id == add_on_id,
            ServiceAddOn.service_id == service_id,
            ServiceAddOn.tenant_id == tenant_id,
        )
    )
    if add_on is None:
        raise api_exception(404, "not_found", "Add-on was not found for this service.")
    return add_on


async def list_service_add_ons(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    *,
    include_inactive: bool,
) -> ServiceAddOnListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _load_service(session, tenant.id, service_id)
    query = select(ServiceAddOn).where(
        ServiceAddOn.tenant_id == tenant.id,
        ServiceAddOn.service_id == service_id,
    )
    if not include_inactive:
        query = query.where(ServiceAddOn.is_active.is_(True))
    rows = (await session.scalars(query.order_by(ServiceAddOn.sort_order, ServiceAddOn.created_at))).all()
    return ServiceAddOnListResponse(items=[add_on_to_response(row) for row in rows])


async def create_service_add_on(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    payload: CreateServiceAddOnRequest,
) -> ServiceAddOnResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _load_service(session, tenant.id, service_id)
    next_sort = await session.scalar(
        select(func.coalesce(func.max(ServiceAddOn.sort_order), -1) + 1).where(
            ServiceAddOn.tenant_id == tenant.id,
            ServiceAddOn.service_id == service_id,
        )
    )
    add_on = ServiceAddOn(
        tenant_id=tenant.id,
        service_id=service_id,
        name=payload.name.strip(),
        description=(payload.description or "").strip() or None,
        price_cents=payload.price_cents,
        duration_minutes=payload.duration_minutes,
        is_active=payload.is_active,
        sort_order=next_sort or 0,
    )
    if not add_on.name:
        raise api_exception(422, "validation_error", "An add-on name is required.")
    session.add(add_on)
    await session.commit()
    await session.refresh(add_on)
    return add_on_to_response(add_on)


async def update_service_add_on(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    add_on_id: str,
    payload: UpdateServiceAddOnRequest,
) -> ServiceAddOnResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    add_on = await _load_add_on(session, tenant.id, service_id, add_on_id)
    if payload.name is not None:
        name = payload.name.strip()
        if not name:
            raise api_exception(422, "validation_error", "An add-on name is required.")
        add_on.name = name
    if payload.clear_description:
        add_on.description = None
    elif payload.description is not None:
        add_on.description = payload.description.strip() or None
    if payload.price_cents is not None:
        add_on.price_cents = payload.price_cents
    if payload.duration_minutes is not None:
        add_on.duration_minutes = payload.duration_minutes
    if payload.is_active is not None:
        add_on.is_active = payload.is_active
    if payload.sort_order is not None:
        add_on.sort_order = payload.sort_order
    await session.commit()
    await session.refresh(add_on)
    return add_on_to_response(add_on)


async def delete_service_add_on(
    session: AsyncSession,
    tenant_slug: str,
    service_id: str,
    add_on_id: str,
) -> str:
    """Delete an add-on. Drafts and bookings keep their own snapshot of its
    name and price, so history is unaffected. Returns the tenant id."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    add_on = await _load_add_on(session, tenant.id, service_id, add_on_id)
    await session.delete(add_on)
    await session.commit()
    return tenant.id


async def resolve_add_ons(
    session: AsyncSession,
    tenant_id: str,
    service_id: str,
    add_on_ids: list[str] | None,
) -> list[ServiceAddOn]:
    """The requested add-ons, validated as active add-ons of this service."""
    if not add_on_ids:
        return []
    unique_ids = list(dict.fromkeys(add_on_ids))
    if len(unique_ids) > MAX_ADD_ONS_PER_BOOKING:
        raise api_exception(422, "validation_error", "Too many add-ons for one booking.")
    rows = (
        await session.scalars(
            select(ServiceAddOn).where(
                ServiceAddOn.tenant_id == tenant_id,
                ServiceAddOn.service_id == service_id,
                ServiceAddOn.id.in_(unique_ids),
                ServiceAddOn.is_active.is_(True),
            )
        )
    ).all()
    if len(rows) != len(unique_ids):
        raise api_exception(422, "validation_error", "One or more add-ons aren't available for this service.")
    by_id = {row.id: row for row in rows}
    return [by_id[add_on_id] for add_on_id in unique_ids]
