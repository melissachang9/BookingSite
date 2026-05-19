from __future__ import annotations

from datetime import datetime, timedelta, timezone
from zoneinfo import ZoneInfo

from sqlalchemy import delete, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.http import api_exception
from app.db.models import BookingDraft, Customer, Provider, Service, SlotHold
from app.schemas.booking_drafts import BookingDraftSummaryResponse, CreateBookingDraftRequest, UpdateBookingDraftRequest
from app.services.availability import list_availability
from app.services.presenters import booking_draft_to_summary
from app.services.tenants import get_tenant_by_slug


def _ensure_aware(value: datetime) -> datetime:
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _ensure_not_expired(draft: BookingDraft) -> None:
    if _ensure_aware(draft.expires_at) <= datetime.now(timezone.utc):
        raise api_exception(409, "conflict", "Booking draft has expired.")


async def _upsert_customer(
    session: AsyncSession,
    tenant_id: str,
    payload: dict[str, str | None],
) -> Customer:
    email = payload.get("email")
    phone = payload.get("phone")
    query = select(Customer).where(Customer.tenant_id == tenant_id)
    if email:
        query = query.where(Customer.email == email)
    elif phone:
        query = query.where(Customer.phone == phone)
    else:
        query = query.where(Customer.id == "")
    customer = await session.scalar(query)
    if customer is None:
        customer = Customer(
            tenant_id=tenant_id,
            name=payload["name"] or "Guest",
            email=email,
            phone=phone,
        )
        session.add(customer)
        await session.flush()
        return customer

    customer.name = payload["name"] or customer.name
    customer.email = email or customer.email
    customer.phone = phone or customer.phone
    await session.flush()
    return customer


async def _load_booking_draft(
    session: AsyncSession,
    booking_draft_id: str,
    tenant_id: str | None = None,
) -> BookingDraft:
    filters = [BookingDraft.id == booking_draft_id]
    if tenant_id is not None:
        filters.append(BookingDraft.tenant_id == tenant_id)

    draft = await session.scalar(
        select(BookingDraft)
        .options(
            selectinload(BookingDraft.service).selectinload(Service.location_links),
            selectinload(BookingDraft.provider).selectinload(Provider.location_links),
            selectinload(BookingDraft.provider).selectinload(Provider.service_links),
            selectinload(BookingDraft.customer),
            selectinload(BookingDraft.hold),
        )
        .where(*filters)
    )
    if draft is None:
        raise api_exception(404, "not_found", "Booking draft was not found.")
    return draft


async def create_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    payload: CreateBookingDraftRequest,
) -> BookingDraftSummaryResponse:
    if payload.tenant_slug != tenant_slug:
        raise api_exception(400, "bad_request", "Tenant slug in the request body must match the route.")

    tenant = await get_tenant_by_slug(session, tenant_slug)
    service = await session.scalar(
        select(Service)
        .options(selectinload(Service.location_links))
        .where(Service.id == payload.service_id, Service.tenant_id == tenant.id, Service.is_active.is_(True))
    )
    if service is None:
        raise api_exception(404, "not_found", "Service was not found for this tenant.")

    provider = await session.scalar(
        select(Provider)
        .options(selectinload(Provider.location_links), selectinload(Provider.service_links))
        .where(Provider.id == payload.provider_id, Provider.tenant_id == tenant.id, Provider.is_active.is_(True))
    )
    if provider is None:
        raise api_exception(404, "not_found", "Provider was not found for this tenant.")

    start_at = _ensure_aware(payload.starts_at)
    requested_date_text = start_at.astimezone(ZoneInfo(tenant.timezone)).date().isoformat()
    availability = await list_availability(
        session=session,
        tenant_slug=tenant_slug,
        service_id=payload.service_id,
        provider_id=payload.provider_id,
        location_id=payload.location_id,
        requested_date_text=requested_date_text,
    )
    matching_slot = next(
        (
            slot
            for slot in availability.slots
            if slot.start_at == start_at
            and slot.provider_id == payload.provider_id
            and (payload.location_id is None or slot.location_id == payload.location_id)
        ),
        None,
    )
    if matching_slot is None:
        raise api_exception(409, "conflict", "The selected slot is no longer available.")

    customer = None
    if payload.customer is not None:
        customer = await _upsert_customer(session, tenant.id, payload.customer.model_dump())

    draft = BookingDraft(
        tenant_id=tenant.id,
        customer_id=customer.id if customer is not None else None,
        service_id=service.id,
        provider_id=provider.id,
        location_id=matching_slot.location_id,
        status="slot_held",
        booking_method=payload.booking_method or "public_online",
        starts_at=matching_slot.start_at,
        ends_at=matching_slot.end_at,
        expires_at=datetime.now(timezone.utc) + timedelta(minutes=15),
        price_cents=service.price_cents,
        deposit_cents=service.deposit_cents,
        duration_minutes=service.duration_minutes,
    )
    session.add(draft)
    await session.flush()

    await session.execute(
        delete(SlotHold).where(
            SlotHold.provider_id == provider.id,
            SlotHold.starts_at == draft.starts_at,
            SlotHold.ends_at == draft.ends_at,
            SlotHold.expires_at <= datetime.now(timezone.utc),
        )
    )

    session.add(
        SlotHold(
            tenant_id=tenant.id,
            provider_id=provider.id,
            starts_at=draft.starts_at,
            ends_at=draft.ends_at,
            expires_at=draft.expires_at,
            booking_draft_id=draft.id,
        )
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise api_exception(409, "conflict", "The selected slot is no longer available.") from error

    hydrated_draft = await _load_booking_draft(session, draft.id, tenant.id)
    return booking_draft_to_summary(hydrated_draft)


async def get_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
) -> BookingDraftSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    _ensure_not_expired(draft)
    return booking_draft_to_summary(draft)


async def update_booking_draft(
    session: AsyncSession,
    tenant_slug: str,
    booking_draft_id: str,
    payload: UpdateBookingDraftRequest,
) -> BookingDraftSummaryResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    _ensure_not_expired(draft)

    if payload.customer_id is not None:
        customer = await session.scalar(
            select(Customer).where(Customer.id == payload.customer_id, Customer.tenant_id == draft.tenant_id)
        )
        if customer is None:
            raise api_exception(404, "not_found", "Customer was not found for this tenant.")
        draft.customer_id = customer.id
        draft.customer = customer

    if payload.customer is not None:
        customer = await _upsert_customer(session, draft.tenant_id, payload.customer.model_dump())
        draft.customer_id = customer.id
        draft.customer = customer

    await session.commit()
    hydrated_draft = await _load_booking_draft(session, booking_draft_id, tenant.id)
    return booking_draft_to_summary(hydrated_draft)