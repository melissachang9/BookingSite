"""Thin HTTP client for Clover. Transport only: no database, no business rules.

Every call goes through ``_http_client()``, the single seam tests replace with
an ``httpx.MockTransport`` (see tests/fakes/clover.py). Errors are mapped to
typed exceptions so callers can tell "declined" from "we don't know whether it
went through" - the second must never be treated as a failure to retry blindly.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlencode

import httpx

from app.core.config import get_settings

logger = logging.getLogger(__name__)

REQUEST_TIMEOUT_SECONDS = 15.0


class CloverError(Exception):
    """Base class. ``message`` is safe to show to staff; never contains secrets."""

    def __init__(self, message: str, *, status_code: int | None = None, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code
        self.code = code


class CloverAuthError(CloverError):
    """Clover rejected our credentials (expired/revoked token, app uninstalled)."""


class CloverDeclined(CloverError):
    """The card was declined or the request was rejected as invalid."""


class CloverOutcomeUnknown(CloverError):
    """A write timed out or got a 5xx: Clover may or may not have processed it.

    Retry only with the SAME idempotency key.
    """


class CloverRequestError(CloverError):
    """Any other failed request (unexpected status, malformed response)."""


@dataclass(frozen=True)
class CloverHosts:
    authorize: str  # browser-facing OAuth page
    platform: str  # api.clover.com: OAuth token exchange + /v3 REST API
    ecommerce: str  # scl.clover.com: /v1/charges, /v1/refunds, /pakms


_HOSTS: dict[str, CloverHosts] = {
    "sandbox": CloverHosts(
        authorize="https://sandbox.dev.clover.com",
        platform="https://apisandbox.dev.clover.com",
        ecommerce="https://scl-sandbox.dev.clover.com",
    ),
    "production": CloverHosts(
        authorize="https://www.clover.com",
        platform="https://api.clover.com",
        ecommerce="https://scl.clover.com",
    ),
    # In-process stand-in for development and end-to-end tests. Never production.
    "fake": CloverHosts(
        authorize="https://fake-clover.test",
        platform="https://api.fake-clover.test",
        ecommerce="https://scl.fake-clover.test",
    ),
}


@dataclass(frozen=True)
class CloverContext:
    """What is needed to call Clover on behalf of one business."""

    environment: str
    merchant_id: str
    access_token: str
    pakms_public_key: str | None = None
    # Bearer for ecommerce calls (/v1/charges, /v1/refunds). OAuth connections
    # use the access token; API-key connections use the merchant's private key.
    ecommerce_token: str | None = None


def clover_hosts(environment: str) -> CloverHosts:
    hosts = _HOSTS.get(environment)
    if hosts is None:
        raise CloverRequestError(f"Unknown Clover environment: {environment}")
    return hosts


def default_environment() -> str:
    """The environment new connections use. 'fake' is refused in production."""
    settings = get_settings()
    environment = settings.clover_environment
    if environment == "fake" and settings.app_env == "production":
        return "sandbox"
    return environment if environment in _HOSTS else "sandbox"


def _http_client() -> httpx.AsyncClient:
    """The one place an HTTP client is created (tests replace this)."""
    return httpx.AsyncClient(timeout=REQUEST_TIMEOUT_SECONDS)


def _error_message(payload: Any, fallback: str) -> tuple[str, str | None]:
    """Pull a human message and code out of a Clover error body, if present."""
    if isinstance(payload, dict):
        error = payload.get("error")
        if isinstance(error, dict):
            message = error.get("message")
            code = error.get("code")
            if isinstance(message, str) and message:
                return message, code if isinstance(code, str) else None
        message = payload.get("message")
        if isinstance(message, str) and message:
            return message, None
    return fallback, None


async def clover_request(
    method: str,
    base_url: str,
    path: str,
    *,
    token: str | None = None,
    json_body: dict[str, Any] | None = None,
    params: dict[str, str] | list[tuple[str, str]] | None = None,
    headers: dict[str, str] | None = None,
    idempotency_key: str | None = None,
    client_ip: str | None = None,
) -> Any:
    """Make one Clover request and return the decoded JSON body."""
    request_headers = {"Accept": "application/json", "User-Agent": "booking-platform/1.0"}
    if token:
        request_headers["Authorization"] = f"Bearer {token}"
    if idempotency_key:
        request_headers["idempotency-key"] = idempotency_key
    if client_ip:
        request_headers["x-forwarded-for"] = client_ip
    if headers:
        request_headers.update(headers)

    is_write = method.upper() in {"POST", "PUT", "PATCH", "DELETE"}
    url = f"{base_url.rstrip('/')}/{path.lstrip('/')}"
    try:
        async with _http_client() as client:
            response = await client.request(method, url, headers=request_headers, json=json_body, params=params)
    except httpx.TimeoutException as error:
        if is_write:
            raise CloverOutcomeUnknown("Clover did not answer in time.") from error
        raise CloverRequestError("Clover did not answer in time.") from error
    except httpx.HTTPError as error:
        if is_write:
            raise CloverOutcomeUnknown("Could not reach Clover.") from error
        raise CloverRequestError("Could not reach Clover.") from error

    try:
        payload = response.json() if response.content else {}
    except ValueError:
        payload = {}

    if response.is_success:
        return payload

    message, code = _error_message(payload, f"Clover returned HTTP {response.status_code}.")
    if response.status_code in {401, 403}:
        raise CloverAuthError(message, status_code=response.status_code, code=code)
    if response.status_code >= 500:
        if is_write:
            raise CloverOutcomeUnknown(message, status_code=response.status_code, code=code)
        raise CloverRequestError(message, status_code=response.status_code, code=code)
    if is_write and response.status_code in {400, 402, 409, 422}:
        raise CloverDeclined(message, status_code=response.status_code, code=code)
    raise CloverRequestError(message, status_code=response.status_code, code=code)


# ---------------------------------------------------------------------------
# OAuth (v2)
# ---------------------------------------------------------------------------


def build_authorize_url(environment: str, *, client_id: str, redirect_uri: str, state: str) -> str:
    query = urlencode({"client_id": client_id, "redirect_uri": redirect_uri, "state": state})
    return f"{clover_hosts(environment).authorize}/oauth/v2/authorize?{query}"


@dataclass(frozen=True)
class CloverTokens:
    access_token: str
    access_token_expiration: int  # unix seconds
    refresh_token: str | None
    refresh_token_expiration: int | None


def _parse_tokens(payload: Any) -> CloverTokens:
    if not isinstance(payload, dict) or not isinstance(payload.get("access_token"), str):
        raise CloverRequestError("Clover returned an unexpected token response.")
    access_exp = payload.get("access_token_expiration")
    refresh_exp = payload.get("refresh_token_expiration")
    refresh = payload.get("refresh_token")
    return CloverTokens(
        access_token=payload["access_token"],
        access_token_expiration=int(access_exp) if isinstance(access_exp, (int, float)) else 0,
        refresh_token=refresh if isinstance(refresh, str) else None,
        refresh_token_expiration=int(refresh_exp) if isinstance(refresh_exp, (int, float)) else None,
    )


async def exchange_code(environment: str, *, client_id: str, client_secret: str, code: str) -> CloverTokens:
    payload = await clover_request(
        "POST",
        clover_hosts(environment).platform,
        "/oauth/v2/token",
        json_body={"client_id": client_id, "client_secret": client_secret, "code": code},
    )
    return _parse_tokens(payload)


async def refresh_tokens(environment: str, *, client_id: str, refresh_token: str) -> CloverTokens:
    """Single use: the old refresh token is invalid as soon as this succeeds."""
    payload = await clover_request(
        "POST",
        clover_hosts(environment).platform,
        "/oauth/v2/refresh",
        json_body={"client_id": client_id, "refresh_token": refresh_token},
    )
    return _parse_tokens(payload)


async def recover_tokens(
    environment: str, *, client_id: str, client_secret: str, recovery_token: str
) -> CloverTokens:
    """For up to two weeks after a refresh token expired or its response was lost."""
    payload = await clover_request(
        "POST",
        clover_hosts(environment).platform,
        "/oauth/v2/recovery",
        json_body={"client_id": client_id, "client_secret": client_secret, "recovery_token": recovery_token},
    )
    return _parse_tokens(payload)


# ---------------------------------------------------------------------------
# Merchant + ecommerce key
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CloverMerchant:
    merchant_id: str
    name: str | None
    currency: str | None  # None when Clover did not say


async def get_merchant(ctx: CloverContext) -> CloverMerchant:
    payload = await clover_request(
        "GET",
        clover_hosts(ctx.environment).platform,
        f"/v3/merchants/{ctx.merchant_id}",
        token=ctx.access_token,
    )
    if not isinstance(payload, dict):
        raise CloverRequestError("Clover returned an unexpected merchant response.")
    currency = payload.get("defaultCurrency")
    name = payload.get("name")
    return CloverMerchant(
        merchant_id=ctx.merchant_id,
        name=name if isinstance(name, str) else None,
        currency=currency.upper() if isinstance(currency, str) and len(currency) == 3 else None,
    )


async def fetch_pakms_key(ctx: CloverContext) -> str:
    """The public key for the card form. Fetched once per merchant; it doesn't expire."""
    payload = await clover_request(
        "GET",
        clover_hosts(ctx.environment).ecommerce,
        "/pakms/apikey",
        token=ctx.access_token,
    )
    key = payload.get("apiAccessKey") if isinstance(payload, dict) else None
    if not isinstance(key, str) or not key:
        raise CloverRequestError("Clover did not return an ecommerce key for this merchant.")
    return key


# ---------------------------------------------------------------------------
# Payments (Platform REST API) - used to match payments taken on the device
# ---------------------------------------------------------------------------

# Clover's payment `amount` is what was paid for the visit; `tipAmount` is the
# tip on top. Kept in one place because both assumptions must be confirmed
# against a real Clover sandbox account before going live.
CLOVER_AMOUNT_INCLUDES_TIP = False


@dataclass(frozen=True)
class CloverPayment:
    id: str
    visit_cents: int  # amount for the visit, before tip
    tip_cents: int
    result: str  # SUCCESS | FAIL | VOIDED | AUTH | PENDING ...
    created_at: datetime
    card_brand: str | None
    last4: str | None
    auth_code: str | None
    employee_id: str | None
    refunded_cents: int

    @property
    def total_cents(self) -> int:
        return self.visit_cents + self.tip_cents

    @property
    def is_paid(self) -> bool:
        return self.result == "SUCCESS" and self.refunded_cents < self.total_cents


def _parse_payment(raw: Any) -> CloverPayment:
    if not isinstance(raw, dict) or not isinstance(raw.get("id"), str):
        raise CloverRequestError("Clover returned an unexpected payment.")
    amount = int(raw.get("amount") or 0)
    tip = int(raw.get("tipAmount") or 0)
    visit = amount - tip if CLOVER_AMOUNT_INCLUDES_TIP else amount
    card = raw.get("cardTransaction") if isinstance(raw.get("cardTransaction"), dict) else {}
    employee = raw.get("employee") if isinstance(raw.get("employee"), dict) else {}
    refunds = raw.get("refunds")
    elements = refunds.get("elements") if isinstance(refunds, dict) else refunds
    refunded = sum(int(item.get("amount") or 0) for item in (elements or []) if isinstance(item, dict))
    created_ms = raw.get("createdTime")
    created = (
        datetime.fromtimestamp(int(created_ms) / 1000, tz=timezone.utc)
        if isinstance(created_ms, (int, float))
        else datetime.now(timezone.utc)
    )
    last4 = card.get("last4")
    brand = card.get("cardType")
    auth = card.get("authCode")
    return CloverPayment(
        id=raw["id"],
        visit_cents=visit,
        tip_cents=tip,
        result=str(raw.get("result") or "UNKNOWN"),
        created_at=created,
        card_brand=brand if isinstance(brand, str) else None,
        last4=last4 if isinstance(last4, str) else None,
        auth_code=auth if isinstance(auth, str) else None,
        employee_id=employee.get("id") if isinstance(employee.get("id"), str) else None,
        refunded_cents=refunded,
    )


async def list_payments(ctx: CloverContext, *, since: datetime, limit: int = 100) -> list[CloverPayment]:
    """Payments created since `since`, newest first."""
    payload = await clover_request(
        "GET",
        clover_hosts(ctx.environment).platform,
        f"/v3/merchants/{ctx.merchant_id}/payments",
        token=ctx.access_token,
        params=[
            ("filter", f"createdTime>={int(since.timestamp() * 1000)}"),
            ("expand", "cardTransaction,tender,refunds"),
            ("orderBy", "createdTime DESC"),
            ("limit", str(limit)),
        ],
    )
    elements = payload.get("elements") if isinstance(payload, dict) else None
    return [_parse_payment(item) for item in (elements or [])]


async def get_payment(ctx: CloverContext, payment_id: str) -> CloverPayment | None:
    """One payment from THIS merchant, or None if Clover doesn't know it."""
    try:
        payload = await clover_request(
            "GET",
            clover_hosts(ctx.environment).platform,
            f"/v3/merchants/{ctx.merchant_id}/payments/{payment_id}",
            token=ctx.access_token,
            params=[("expand", "cardTransaction,tender,refunds")],
        )
    except CloverRequestError as error:
        if error.status_code == 404:
            return None
        raise
    return _parse_payment(payload)


# ---------------------------------------------------------------------------
# Card-not-present charges and refunds (Ecommerce API)
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class CloverCharge:
    id: str
    amount_cents: int
    card_brand: str | None
    last4: str | None


def _ecommerce_token(ctx: CloverContext) -> str:
    return ctx.ecommerce_token or ctx.access_token


async def create_charge(
    ctx: CloverContext,
    *,
    amount_cents: int,
    currency: str,
    source_token: str,
    ecomind: str,  # "ecom" (customer typed it) | "moto" (staff typed it)
    idempotency_key: str,
    client_ip: str | None,
    metadata: dict[str, str],
) -> CloverCharge:
    """Charge a tokenized card. Replaying the same idempotency key must not charge twice.

    Raises CloverDeclined for a declined/invalid card and CloverOutcomeUnknown
    when we can't tell whether it went through (retry with the SAME key).
    """
    payload = await clover_request(
        "POST",
        clover_hosts(ctx.environment).ecommerce,
        "/v1/charges",
        token=_ecommerce_token(ctx),
        json_body={
            "amount": amount_cents,
            "currency": currency.lower(),
            "source": source_token,
            "ecomind": ecomind,
            "capture": True,
            "metadata": metadata,
        },
        idempotency_key=idempotency_key,
        client_ip=client_ip,
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("id"), str):
        raise CloverOutcomeUnknown("Clover returned an unreadable charge response.")
    status = payload.get("status")
    if status not in {"succeeded", None} or payload.get("captured") is False:
        message, code = _error_message(payload, "The card was declined.")
        raise CloverDeclined(message, code=code)
    source = payload.get("source") if isinstance(payload.get("source"), dict) else {}
    last4 = source.get("last4")
    brand = source.get("brand")
    return CloverCharge(
        id=payload["id"],
        amount_cents=int(payload.get("amount") or amount_cents),
        card_brand=brand if isinstance(brand, str) else None,
        last4=last4 if isinstance(last4, str) else None,
    )


@dataclass(frozen=True)
class CloverRefund:
    id: str
    amount_cents: int


async def create_refund(
    ctx: CloverContext, *, charge_id: str, amount_cents: int, idempotency_key: str
) -> CloverRefund:
    payload = await clover_request(
        "POST",
        clover_hosts(ctx.environment).ecommerce,
        "/v1/refunds",
        token=_ecommerce_token(ctx),
        json_body={"charge": charge_id, "amount": amount_cents},
        idempotency_key=idempotency_key,
    )
    if not isinstance(payload, dict) or not isinstance(payload.get("id"), str) or payload.get("status") == "failed":
        raise CloverRequestError("Clover did not complete the refund.")
    return CloverRefund(id=payload["id"], amount_cents=int(payload.get("amount") or amount_cents))
