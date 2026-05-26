from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import hmac
import json
from typing import Any
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import httpx

from app.core.config import get_settings
from app.core.http import api_exception


@dataclass(frozen=True)
class StripeCheckoutSession:
    session_id: str
    checkout_url: str
    expires_at: datetime | None = None


@dataclass(frozen=True)
class StripeCheckoutStatus:
    session_id: str
    status: str | None
    payment_status: str | None
    payment_intent_id: str | None


@dataclass(frozen=True)
class StripeRefund:
    refund_id: str
    amount_cents: int
    payment_intent_id: str | None


@dataclass(frozen=True)
class StripeWebhookEvent:
    event_id: str
    event_type: str
    created_at: datetime | None
    data_object: dict[str, Any]


def stripe_processor_configured() -> bool:
    settings = get_settings()
    return isinstance(settings.stripe_secret_key, str) and settings.stripe_secret_key.strip().startswith("sk_")


def stripe_webhook_configured() -> bool:
    settings = get_settings()
    return isinstance(settings.stripe_webhook_secret, str) and settings.stripe_webhook_secret.strip().startswith("whsec_")


def is_stripe_checkout_session_id(session_id: str | None) -> bool:
    return isinstance(session_id, str) and session_id.startswith("cs_")


def resolve_storefront_url(url: str) -> str:
    if url.startswith("https://") or url.startswith("http://"):
        return url

    settings = get_settings()
    base_url = settings.storefront_public_base_url.strip()
    if not base_url:
        raise api_exception(
            503,
            "service_unavailable",
            "Storefront public base URL must be configured before enabling the payment processor.",
        )

    normalized_path = url if url.startswith("/") else f"/{url}"
    return urljoin(f"{base_url.rstrip('/')}/", normalized_path.lstrip("/"))


def build_stripe_success_url(success_url: str) -> str:
    resolved_url = resolve_storefront_url(success_url)
    parts = urlsplit(resolved_url)
    query = dict(parse_qsl(parts.query, keep_blank_values=True))
    query.setdefault("sessionId", "{CHECKOUT_SESSION_ID}")
    encoded_query = urlencode(query).replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}")
    return urlunsplit((parts.scheme, parts.netloc, parts.path, encoded_query, parts.fragment))


def build_stripe_cancel_url(cancel_url: str) -> str:
    return resolve_storefront_url(cancel_url)


def _stripe_headers(idempotency_key: str | None = None) -> dict[str, str]:
    settings = get_settings()
    if not stripe_processor_configured():
        raise api_exception(503, "service_unavailable", "Stripe is not configured for this environment.")

    headers = {
        "Authorization": f"Bearer {settings.stripe_secret_key}",
    }
    if idempotency_key:
        headers["Idempotency-Key"] = idempotency_key
    return headers


def _stripe_api_url(path: str) -> str:
    settings = get_settings()
    return f"{settings.stripe_api_base_url.rstrip('/')}/{path.lstrip('/')}"


def _coerce_stripe_datetime(raw_value: Any) -> datetime | None:
    if isinstance(raw_value, int):
        return datetime.fromtimestamp(raw_value, tz=timezone.utc)
    if isinstance(raw_value, str) and raw_value.isdigit():
        return datetime.fromtimestamp(int(raw_value), tz=timezone.utc)
    return None


def _payment_intent_id(raw_value: Any) -> str | None:
    if isinstance(raw_value, str):
        return raw_value
    if isinstance(raw_value, dict):
        raw_id = raw_value.get("id")
        return raw_id if isinstance(raw_id, str) else None
    return None


def _stripe_webhook_secret() -> str:
    settings = get_settings()
    secret = settings.stripe_webhook_secret.strip() if isinstance(settings.stripe_webhook_secret, str) else ""
    if not secret:
        raise api_exception(503, "service_unavailable", "Stripe webhook handling is not configured for this environment.")
    return secret


def _parse_stripe_signature(signature_header: str) -> tuple[int, list[str]]:
    timestamp: int | None = None
    signatures: list[str] = []
    for part in signature_header.split(","):
        key, _, value = part.partition("=")
        if key == "t" and value.isdigit():
            timestamp = int(value)
        elif key == "v1" and value:
            signatures.append(value)
    if timestamp is None or not signatures:
        raise api_exception(400, "bad_request", "Stripe signature header was invalid.")
    return timestamp, signatures


def verify_and_parse_stripe_webhook_event(payload: bytes, signature_header: str | None) -> StripeWebhookEvent:
    if not signature_header:
        raise api_exception(400, "bad_request", "Stripe signature header is required.")

    timestamp, signatures = _parse_stripe_signature(signature_header)
    settings = get_settings()
    tolerance_seconds = max(settings.stripe_webhook_tolerance_seconds, 0)
    current_timestamp = int(datetime.now(timezone.utc).timestamp())
    if tolerance_seconds and abs(current_timestamp - timestamp) > tolerance_seconds:
        raise api_exception(400, "bad_request", "Stripe webhook signature timestamp is outside the allowed tolerance.")

    signed_payload = f"{timestamp}.".encode("utf-8") + payload
    expected_signature = hmac.new(
        _stripe_webhook_secret().encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    if not any(hmac.compare_digest(expected_signature, candidate) for candidate in signatures):
        raise api_exception(400, "bad_request", "Stripe webhook signature verification failed.")

    try:
        raw_event = json.loads(payload.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise api_exception(400, "bad_request", "Stripe webhook payload was not valid JSON.") from error

    if not isinstance(raw_event, dict):
        raise api_exception(400, "bad_request", "Stripe webhook payload was malformed.")

    event_id = raw_event.get("id")
    event_type = raw_event.get("type")
    raw_created_at = raw_event.get("created")
    data = raw_event.get("data")
    data_object = data.get("object") if isinstance(data, dict) else None
    if not isinstance(event_id, str) or not isinstance(event_type, str) or not isinstance(data_object, dict):
        raise api_exception(400, "bad_request", "Stripe webhook payload was incomplete.")

    return StripeWebhookEvent(
        event_id=event_id,
        event_type=event_type,
        created_at=_coerce_stripe_datetime(raw_created_at),
        data_object=data_object,
    )


async def _stripe_request(
    method: str,
    path: str,
    *,
    data: list[tuple[str, str]] | None = None,
    params: list[tuple[str, str]] | None = None,
    idempotency_key: str | None = None,
) -> dict[str, Any]:
    try:
        headers = _stripe_headers(idempotency_key)
        content = None
        if data is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            content = urlencode(data)

        async with httpx.AsyncClient(timeout=15.0) as client:
            response = await client.request(
                method,
                _stripe_api_url(path),
                headers=headers,
                content=content,
                params=params,
            )
    except httpx.HTTPError as error:
        raise api_exception(503, "service_unavailable", "Stripe is unavailable right now.") from error

    payload = response.json()
    if response.is_success:
        return payload

    error_detail = payload.get("error") if isinstance(payload, dict) else None
    error_message = error_detail.get("message") if isinstance(error_detail, dict) else None
    raise api_exception(
        502,
        "payment_processor_error",
        error_message or "Stripe request failed.",
    )


async def create_stripe_deposit_checkout_session(
    *,
    tenant_slug: str,
    booking_draft_id: str,
    service_name: str,
    amount_cents: int,
    customer_email: str | None,
    success_url: str,
    cancel_url: str,
    expires_at: datetime | None,
) -> StripeCheckoutSession:
    data = [
        ("mode", "payment"),
        ("success_url", build_stripe_success_url(success_url)),
        ("cancel_url", build_stripe_cancel_url(cancel_url)),
        ("payment_method_types[0]", "card"),
        ("line_items[0][quantity]", "1"),
        ("line_items[0][price_data][currency]", "usd"),
        ("line_items[0][price_data][unit_amount]", str(amount_cents)),
        ("line_items[0][price_data][product_data][name]", f"{service_name} deposit"),
        ("client_reference_id", booking_draft_id),
        ("metadata[tenant_slug]", tenant_slug),
        ("metadata[booking_draft_id]", booking_draft_id),
        ("metadata[payment_kind]", "deposit"),
    ]
    if customer_email:
        data.append(("customer_email", customer_email))
    if expires_at is not None:
        data.append(("expires_at", str(int(expires_at.timestamp()))))

    payload = await _stripe_request(
        "POST",
        "checkout/sessions",
        data=data,
        idempotency_key=f"deposit-checkout-{tenant_slug}-{booking_draft_id}-{amount_cents}",
    )
    session_id = payload.get("id")
    checkout_url = payload.get("url")
    if not isinstance(session_id, str) or not isinstance(checkout_url, str):
        raise api_exception(502, "payment_processor_error", "Stripe checkout session response was incomplete.")

    return StripeCheckoutSession(
        session_id=session_id,
        checkout_url=checkout_url,
        expires_at=_coerce_stripe_datetime(payload.get("expires_at")),
    )


async def create_stripe_booking_balance_checkout_session(
    *,
    tenant_slug: str,
    booking_id: str,
    service_name: str,
    amount_cents: int,
    customer_email: str | None,
    success_url: str,
    cancel_url: str,
    expires_at: datetime | None,
) -> StripeCheckoutSession:
    data = [
        ("mode", "payment"),
        ("success_url", build_stripe_success_url(success_url)),
        ("cancel_url", build_stripe_cancel_url(cancel_url)),
        ("payment_method_types[0]", "card"),
        ("line_items[0][quantity]", "1"),
        ("line_items[0][price_data][currency]", "usd"),
        ("line_items[0][price_data][unit_amount]", str(amount_cents)),
        ("line_items[0][price_data][product_data][name]", f"{service_name} remaining balance"),
        ("client_reference_id", booking_id),
        ("metadata[tenant_slug]", tenant_slug),
        ("metadata[booking_id]", booking_id),
        ("metadata[payment_kind]", "booking_balance"),
    ]
    if customer_email:
        data.append(("customer_email", customer_email))
    if expires_at is not None:
        data.append(("expires_at", str(int(expires_at.timestamp()))))

    payload = await _stripe_request(
        "POST",
        "checkout/sessions",
        data=data,
        idempotency_key=f"booking-balance-checkout-{tenant_slug}-{booking_id}-{amount_cents}",
    )
    session_id = payload.get("id")
    checkout_url = payload.get("url")
    if not isinstance(session_id, str) or not isinstance(checkout_url, str):
        raise api_exception(502, "payment_processor_error", "Stripe checkout session response was incomplete.")

    return StripeCheckoutSession(
        session_id=session_id,
        checkout_url=checkout_url,
        expires_at=_coerce_stripe_datetime(payload.get("expires_at")),
    )


async def get_stripe_checkout_session(session_id: str) -> StripeCheckoutStatus:
    payload = await _stripe_request(
        "GET",
        f"checkout/sessions/{session_id}",
        params=[("expand[]", "payment_intent")],
    )
    return StripeCheckoutStatus(
        session_id=session_id,
        status=payload.get("status") if isinstance(payload.get("status"), str) else None,
        payment_status=payload.get("payment_status") if isinstance(payload.get("payment_status"), str) else None,
        payment_intent_id=_payment_intent_id(payload.get("payment_intent")),
    )


async def create_stripe_refund(
    session_id: str,
    *,
    amount_cents: int,
    idempotency_key: str,
) -> StripeRefund:
    checkout_session = await get_stripe_checkout_session(session_id)
    if checkout_session.payment_intent_id is None:
        raise api_exception(409, "conflict", "Stripe checkout session has no captured payment intent to refund.")

    payload = await _stripe_request(
        "POST",
        "refunds",
        data=[
            ("payment_intent", checkout_session.payment_intent_id),
            ("amount", str(amount_cents)),
            ("reason", "requested_by_customer"),
        ],
        idempotency_key=idempotency_key,
    )
    refund_id = payload.get("id")
    if not isinstance(refund_id, str):
        raise api_exception(502, "payment_processor_error", "Stripe refund response was incomplete.")

    return StripeRefund(
        refund_id=refund_id,
        amount_cents=int(payload.get("amount") or amount_cents),
        payment_intent_id=checkout_session.payment_intent_id,
    )