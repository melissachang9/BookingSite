"""Server-side conversion reporting to ad platforms (Meta Conversions API).

Browser pixels miss visitors with ad blockers or strict privacy settings. When a business has stored a Meta
access token, every confirmed online booking is queued here in the booking's own transaction, then sent
by a background loop with retries. The event carries the booking ID as `event_id`, the same ID the browser
pixel sends, so Meta counts a booking once even when both arrive.
"""

from __future__ import annotations

import hashlib
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.http import api_exception
from app.db.models import AdPlatformCredential, Booking, ConversionEvent, Customer, Tenant, User
from app.db.session import get_session_maker
from app.schemas.catalog import AdTrackingStatusResponse, UpdateMetaConversionsRequest
from app.services.audit import record_audit
from app.services.payment_secrets import decrypt_secret, encrypt_secret
from app.services.tenants import get_tenant_by_slug

logger = logging.getLogger(__name__)

MAX_ATTEMPTS = 5
RETRY_BASE_MINUTES = 5
BATCH_SIZE = 50

# Regions where ad cookies need an opt-in. Mirrors apps/storefront/app/lib/ad-tracking.ts.
CONSENT_REQUIRED_COUNTRIES = frozenset(
    "AT BE BG HR CY CZ DK EE FI FR DE GR HU IE IT LV LT LU MT NL PL PT RO SK SI ES SE IS LI NO GB CH".split()
)


def consent_required(country: str | None) -> bool:
    return (country or "").upper() in CONSENT_REQUIRED_COUNTRIES


def _hash(value: str | None) -> str | None:
    cleaned = (value or "").strip().lower()
    return hashlib.sha256(cleaned.encode()).hexdigest() if cleaned else None


def _hash_phone(value: str | None) -> str | None:
    digits = "".join(ch for ch in (value or "") if ch.isdigit())
    return hashlib.sha256(digits.encode()).hexdigest() if digits else None


async def get_meta_credential(session: AsyncSession, tenant_id: str) -> AdPlatformCredential | None:
    return await session.scalar(
        select(AdPlatformCredential).where(
            AdPlatformCredential.tenant_id == tenant_id, AdPlatformCredential.platform == "meta"
        )
    )


async def queue_conversion_events(session: AsyncSession, booking: Booking) -> None:
    """Queue a Meta "Schedule" event for a newly confirmed online booking. The caller commits.

    Skipped for staff-entered bookings (no visitor behind them), for businesses without a stored token or
    Pixel ID, and, in regions that require consent, when the visitor did not accept ad cookies.
    """
    if booking.booking_method != "public_online":
        return
    tenant = await session.get(Tenant, booking.tenant_id)
    if tenant is None:
        return
    settings_json = tenant.settings_json or {}
    if not settings_json.get("metaPixelId"):
        return
    if consent_required(settings_json.get("country")) and booking.ad_consent is not True:
        return
    if await get_meta_credential(session, tenant.id) is None:
        return
    now = datetime.now(timezone.utc)
    session.add(
        ConversionEvent(
            tenant_id=tenant.id,
            booking_id=booking.id,
            platform="meta",
            event_name="Schedule",
            event_id=booking.id,
            event_time=now,
            value_cents=booking.price_cents or 0,
            currency=str(settings_json.get("currency") or "USD").upper(),
            status="pending",
            next_attempt_at=now,
        )
    )


def _meta_user_data(booking: Booking, customer: Customer | None) -> dict[str, Any]:
    user: dict[str, Any] = {}
    if customer is not None:
        if email := _hash(customer.email):
            user["em"] = [email]
        if phone := _hash_phone(customer.phone):
            user["ph"] = [phone]
        if customer.name and customer.name.strip():
            parts = customer.name.strip().split()
            user["fn"] = [_hash(parts[0])]
            if len(parts) > 1:
                user["ln"] = [_hash(parts[-1])]
        user["external_id"] = [_hash(customer.id)]
    if booking.fbclid:
        # Meta's click-ID cookie format: fb.<subdomain index>.<click time in ms>.<fbclid>.
        created = booking.created_at or datetime.now(timezone.utc)
        user["fbc"] = f"fb.1.{int(created.timestamp() * 1000)}.{booking.fbclid}"
    return user


async def _post_to_meta(url: str, body: dict[str, Any]) -> httpx.Response:
    async with httpx.AsyncClient(timeout=15.0) as client:
        return await client.post(url, json=body)


async def _send_one(session: AsyncSession, event: ConversionEvent) -> None:
    now = datetime.now(timezone.utc)
    event.attempts += 1
    try:
        tenant = await session.get(Tenant, event.tenant_id)
        credential = await get_meta_credential(session, event.tenant_id)
        pixel_id = (tenant.settings_json or {}).get("metaPixelId") if tenant else None
        if credential is None or not pixel_id:
            raise RuntimeError("Meta is no longer connected for this business.")
        booking = await session.get(Booking, event.booking_id)
        if booking is None:
            raise RuntimeError("Booking not found.")
        customer = await session.get(Customer, booking.customer_id) if booking.customer_id else None
        base = get_settings().meta_graph_api_base_url.rstrip("/")
        storefront = get_settings().storefront_public_base_url.rstrip("/")
        body: dict[str, Any] = {
            "access_token": decrypt_secret(credential.access_token_enc),
            "data": [
                {
                    "event_name": event.event_name,
                    "event_time": int(event.event_time.timestamp()),
                    "event_id": event.event_id,
                    "action_source": "website",
                    "event_source_url": f"{storefront}/{tenant.slug}",
                    "user_data": _meta_user_data(booking, customer),
                    "custom_data": {"value": round(event.value_cents / 100, 2), "currency": event.currency},
                }
            ],
        }
        if credential.test_event_code:
            body["test_event_code"] = credential.test_event_code
        response = await _post_to_meta(f"{base}/{pixel_id}/events", body)
        if response.status_code >= 400:
            message = "Meta rejected the event."
            try:
                detail = response.json().get("error", {})
                message = str(detail.get("message") or message)
            except (ValueError, AttributeError):
                pass
            raise RuntimeError(f"Meta {response.status_code}: {message}")
        event.status = "sent"
        event.sent_at = now
        event.last_error = None
        event.next_attempt_at = None
    except Exception as error:  # noqa: BLE001 - recorded on the row, never raised to the loop
        # The error text comes from Meta or our own checks; the token is never part of it.
        event.last_error = str(error)[:500]
        if event.attempts >= MAX_ATTEMPTS:
            event.status = "failed"
            event.next_attempt_at = None
        else:
            event.status = "pending"
            event.next_attempt_at = now + timedelta(minutes=RETRY_BASE_MINUTES * event.attempts)
        logger.warning("Conversion event %s attempt %s failed: %s", event.id, event.attempts, event.last_error)


async def send_pending_conversions() -> int:
    """Send due events. Returns how many were attempted."""
    now = datetime.now(timezone.utc)
    async with get_session_maker()() as session:
        due = (
            await session.scalars(
                select(ConversionEvent)
                .where(
                    ConversionEvent.status == "pending",
                    or_(ConversionEvent.next_attempt_at.is_(None), ConversionEvent.next_attempt_at <= now),
                )
                .order_by(ConversionEvent.created_at)
                .limit(BATCH_SIZE)
            )
        ).all()
        for event in due:
            await _send_one(session, event)
        await session.commit()
        return len(due)


# ---------- settings API ----------


async def ad_tracking_status(session: AsyncSession, tenant_slug: str) -> AdTrackingStatusResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    credential = await get_meta_credential(session, tenant.id)

    async def count(status: str) -> int:
        return int(
            await session.scalar(
                select(func.count()).select_from(ConversionEvent).where(
                    ConversionEvent.tenant_id == tenant.id,
                    ConversionEvent.platform == "meta",
                    ConversionEvent.status == status,
                )
            )
            or 0
        )

    last_sent = await session.scalar(
        select(func.max(ConversionEvent.sent_at)).where(
            ConversionEvent.tenant_id == tenant.id, ConversionEvent.platform == "meta"
        )
    )
    last_error = await session.scalar(
        select(ConversionEvent.last_error)
        .where(
            ConversionEvent.tenant_id == tenant.id,
            ConversionEvent.platform == "meta",
            ConversionEvent.last_error.is_not(None),
        )
        .order_by(ConversionEvent.updated_at.desc())
        .limit(1)
    )
    return AdTrackingStatusResponse(
        meta_connected=credential is not None,
        meta_test_mode=bool(credential and credential.test_event_code),
        meta_sent_count=await count("sent"),
        meta_pending_count=await count("pending"),
        meta_failed_count=await count("failed"),
        meta_last_sent_at=last_sent,
        meta_last_error=last_error,
    )


async def connect_meta_conversions(
    session: AsyncSession, tenant_slug: str, payload: UpdateMetaConversionsRequest, actor: User
) -> AdTrackingStatusResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    if not (tenant.settings_json or {}).get("metaPixelId"):
        raise api_exception(422, "validation_error", "Save your Meta Pixel ID before adding the access token.")
    token = encrypt_secret(payload.access_token)
    test_code = payload.test_event_code or None
    credential = await get_meta_credential(session, tenant.id)
    if credential is None:
        credential = AdPlatformCredential(
            tenant_id=tenant.id,
            platform="meta",
            access_token_enc=token,
            test_event_code=test_code,
            updated_by_user_id=actor.id,
        )
        session.add(credential)
        await session.flush()
    else:
        credential.access_token_enc = token
        credential.test_event_code = test_code
        credential.updated_by_user_id = actor.id
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="ad_platform_credential",
        entity_id=credential.id,
        action="connect_meta_conversions",
        actor=actor,
        changes={"testMode": bool(test_code)},
    )
    await session.commit()
    return await ad_tracking_status(session, tenant_slug)


async def disconnect_meta_conversions(session: AsyncSession, tenant_slug: str, actor: User) -> AdTrackingStatusResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    credential = await get_meta_credential(session, tenant.id)
    if credential is not None:
        await record_audit(
            session,
            tenant_id=tenant.id,
            entity_type="ad_platform_credential",
            entity_id=credential.id,
            action="disconnect_meta_conversions",
            actor=actor,
        )
        await session.delete(credential)
        await session.commit()
    return await ad_tracking_status(session, tenant_slug)
