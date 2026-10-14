"""A business's connection to Clover: connect (OAuth or API keys), disconnect,
what it can do, and keeping its access token fresh.

Secrets are encrypted at rest and never returned or logged. Connecting or
disconnecting decides where a business's money is deposited, so those paths
need `payments.configure` (owner only) and write an audit event.
"""

from __future__ import annotations

import logging
from datetime import datetime, timedelta, timezone

import jwt
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.http import api_exception
from app.db.models import ProcessorConnection, Tenant, User
from app.db.session import get_session_maker
from app.schemas.payments import (
    CloverApiKeysRequest,
    CloverAuthorizeUrlResponse,
    CloverOAuthCompleteRequest,
    PaymentCapabilitiesResponse,
    PublicCloverConfig,
    PublicPaymentConfigResponse,
)
from app.services import clover_client
from app.services.audit import record_audit
from app.services.clover_client import (
    CloverAuthError,
    CloverContext,
    CloverError,
    CloverTokens,
)
from app.services.payment_processor import resolve_payment_processor
from app.services.payment_secrets import decrypt_secret, encrypt_secret
from app.services.tenants import get_tenant_by_slug, tenant_currency

logger = logging.getLogger(__name__)

PROCESSOR = "clover"
STATE_TOKEN_TYPE = "clover_oauth_state"
STATE_TTL_MINUTES = 10
# Refresh when the access token has less than this left.
REFRESH_MARGIN = timedelta(minutes=5)
# The background job (every 30 min) refreshes tokens expiring within this window,
# so a business that sits idle doesn't let its refresh token lapse.
BACKGROUND_REFRESH_WINDOW = timedelta(hours=1)
SDK_URLS = {
    "production": "https://checkout.clover.com/sdk.js",
    "sandbox": "https://checkout.sandbox.dev.clover.com/sdk.js",
    "fake": "/fake-clover-sdk.js",
}


def _aware(value: datetime) -> datetime:
    return value.replace(tzinfo=timezone.utc) if value.tzinfo is None else value.astimezone(timezone.utc)


def _from_unix(seconds: int | None) -> datetime | None:
    if not seconds:
        return None
    return datetime.fromtimestamp(seconds, tz=timezone.utc)


def _app_credentials() -> tuple[str, str]:
    settings = get_settings()
    if not settings.clover_app_id or not settings.clover_app_secret:
        raise api_exception(
            503,
            "service_unavailable",
            "Clover is not configured on the server yet (CLOVER_APP_ID / CLOVER_APP_SECRET).",
        )
    return settings.clover_app_id, settings.clover_app_secret


def _redirect_uri() -> str:
    base = get_settings().dashboard_public_base_url.rstrip("/")
    return f"{base}/settings/payments/clover/callback"


def _clover_error(error: CloverError) -> Exception:
    """Map a Clover failure to a structured API error that is safe to show."""
    return api_exception(502, "payment_processor_error", error.message)


# ---------------------------------------------------------------------------
# OAuth state
# ---------------------------------------------------------------------------


def _encode_state(tenant_id: str, user_id: str) -> str:
    now = datetime.now(timezone.utc)
    return jwt.encode(
        {
            "tokenType": STATE_TOKEN_TYPE,
            "tenantId": tenant_id,
            "userId": user_id,
            "iat": now,
            "exp": now + timedelta(minutes=STATE_TTL_MINUTES),
        },
        get_settings().token_secret_key,
        algorithm="HS256",
    )


def _verify_state(state: str, tenant_id: str, user_id: str) -> None:
    try:
        payload = jwt.decode(state, get_settings().token_secret_key, algorithms=["HS256"])
    except jwt.PyJWTError as error:
        raise api_exception(400, "bad_request", "The Clover connection link expired. Start again.") from error
    if (
        payload.get("tokenType") != STATE_TOKEN_TYPE
        or payload.get("tenantId") != tenant_id
        or payload.get("userId") != user_id
    ):
        raise api_exception(400, "bad_request", "This Clover connection did not start from this business.")


# ---------------------------------------------------------------------------
# Loading
# ---------------------------------------------------------------------------


async def _load_connection(session: AsyncSession, tenant_id: str, *, for_update: bool = False) -> ProcessorConnection | None:
    query = select(ProcessorConnection).where(
        ProcessorConnection.tenant_id == tenant_id, ProcessorConnection.processor == PROCESSOR
    )
    if for_update:
        query = query.with_for_update()
    return await session.scalar(query)


def _is_connected(connection: ProcessorConnection | None) -> bool:
    return connection is not None and connection.status == "connected"


# ---------------------------------------------------------------------------
# Connect
# ---------------------------------------------------------------------------


async def get_authorize_url(session: AsyncSession, tenant_slug: str, actor: User) -> CloverAuthorizeUrlResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    client_id, _ = _app_credentials()
    environment = clover_client.default_environment()
    url = clover_client.build_authorize_url(
        environment,
        client_id=client_id,
        redirect_uri=_redirect_uri(),
        state=_encode_state(tenant.id, actor.id),
    )
    return CloverAuthorizeUrlResponse(authorize_url=url)


async def _check_merchant_not_linked_elsewhere(
    session: AsyncSession, *, tenant_id: str, environment: str, merchant_id: str
) -> None:
    other = await session.scalar(
        select(ProcessorConnection.id).where(
            ProcessorConnection.processor == PROCESSOR,
            ProcessorConnection.environment == environment,
            ProcessorConnection.merchant_id == merchant_id,
            ProcessorConnection.status != "disconnected",
            ProcessorConnection.tenant_id != tenant_id,
        )
    )
    if other is not None:
        raise api_exception(
            409,
            "conflict",
            "This Clover account is already connected to another business.",
        )


async def _save_connection(
    session: AsyncSession,
    *,
    tenant: Tenant,
    actor: User,
    environment: str,
    auth_mode: str,
    merchant_id: str,
    merchant_name: str | None,
    merchant_currency: str | None,
    tokens: CloverTokens | None,
    pakms_public_key: str | None,
    ecommerce_private_key: str | None,
    access_token_for_api_keys: str | None,
) -> ProcessorConnection:
    now = datetime.now(timezone.utc)
    connection = await _load_connection(session, tenant.id, for_update=True)
    if connection is None:
        connection = ProcessorConnection(tenant_id=tenant.id, processor=PROCESSOR, environment=environment, auth_mode=auth_mode, status="connected")
        session.add(connection)

    connection.environment = environment
    connection.auth_mode = auth_mode
    connection.merchant_id = merchant_id
    connection.merchant_name = merchant_name
    connection.merchant_currency = merchant_currency
    connection.status = "connected"
    connection.last_error = None
    connection.pakms_public_key = pakms_public_key
    connection.connected_by_user_id = actor.id
    connection.connected_at = now
    connection.disconnected_by_user_id = None
    connection.disconnected_at = None
    connection.last_refreshed_at = now
    if tokens is not None:
        connection.access_token_enc = encrypt_secret(tokens.access_token)
        connection.access_token_expires_at = _from_unix(tokens.access_token_expiration)
        connection.refresh_token_enc = encrypt_secret(tokens.refresh_token) if tokens.refresh_token else None
        connection.refresh_token_expires_at = _from_unix(tokens.refresh_token_expiration)
    else:
        connection.access_token_enc = encrypt_secret(access_token_for_api_keys or "")
        connection.access_token_expires_at = None
        connection.refresh_token_enc = None
        connection.refresh_token_expires_at = None
    connection.ecommerce_private_key_enc = encrypt_secret(ecommerce_private_key) if ecommerce_private_key else None

    settings_json = dict(tenant.settings_json or {})
    settings_json["paymentProcessor"] = PROCESSOR
    tenant.settings_json = settings_json
    return connection


async def _finish_connect(
    session: AsyncSession,
    *,
    tenant: Tenant,
    actor: User,
    ctx: CloverContext,
    auth_mode: str,
    tokens: CloverTokens | None,
    pakms_public_key: str | None,
    ecommerce_private_key: str | None,
    access_token_for_api_keys: str | None,
) -> PaymentCapabilitiesResponse:
    try:
        merchant = await clover_client.get_merchant(ctx)
    except CloverError as error:
        raise _clover_error(error) from error

    expected_currency = tenant_currency(tenant)
    if merchant.currency is not None and merchant.currency != expected_currency:
        raise api_exception(
            409,
            "currency_mismatch",
            f"This Clover account takes payments in {merchant.currency}, but this business is set to "
            f"{expected_currency}. Change the business currency or connect a different Clover account.",
        )

    await _check_merchant_not_linked_elsewhere(
        session, tenant_id=tenant.id, environment=ctx.environment, merchant_id=ctx.merchant_id
    )
    connection = await _save_connection(
        session,
        tenant=tenant,
        actor=actor,
        environment=ctx.environment,
        auth_mode=auth_mode,
        merchant_id=ctx.merchant_id,
        merchant_name=merchant.name,
        merchant_currency=merchant.currency,
        tokens=tokens,
        pakms_public_key=pakms_public_key,
        ecommerce_private_key=ecommerce_private_key,
        access_token_for_api_keys=access_token_for_api_keys,
    )
    # Tokens and keys are never written to the audit trail.
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="processor_connection",
        entity_id=tenant.id,
        action="connected",
        actor=actor,
        changes={
            "processor": PROCESSOR,
            "environment": ctx.environment,
            "authMode": auth_mode,
            "merchantId": ctx.merchant_id,
            "merchantName": merchant.name,
            "cardPaymentsEnabled": pakms_public_key is not None,
        },
    )
    try:
        await session.commit()
    except IntegrityError as error:
        await session.rollback()
        raise api_exception(409, "conflict", "This Clover account is already connected to another business.") from error
    await session.refresh(connection)
    return _capabilities_from(tenant, connection)


async def complete_clover_oauth(
    session: AsyncSession, tenant_slug: str, actor: User, payload: CloverOAuthCompleteRequest
) -> PaymentCapabilitiesResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    _verify_state(payload.state, tenant.id, actor.id)
    client_id, client_secret = _app_credentials()
    environment = clover_client.default_environment()

    try:
        tokens = await clover_client.exchange_code(
            environment, client_id=client_id, client_secret=client_secret, code=payload.code
        )
    except CloverError as error:
        raise _clover_error(error) from error

    ctx = CloverContext(
        environment=environment, merchant_id=payload.merchant_id, access_token=tokens.access_token
    )
    pakms_key: str | None = None
    try:
        pakms_key = await clover_client.fetch_pakms_key(ctx)
    except CloverError:
        # Online card payments aren't enabled for this merchant. The connection
        # still works for matching payments taken on the Clover device.
        logger.info("Clover ecommerce key unavailable for merchant %s", payload.merchant_id)
    return await _finish_connect(
        session,
        tenant=tenant,
        actor=actor,
        ctx=ctx,
        auth_mode="oauth",
        tokens=tokens,
        pakms_public_key=pakms_key,
        ecommerce_private_key=None,
        access_token_for_api_keys=None,
    )


async def connect_clover_with_api_keys(
    session: AsyncSession, tenant_slug: str, actor: User, payload: CloverApiKeysRequest
) -> PaymentCapabilitiesResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    ctx = CloverContext(
        environment=payload.environment,
        merchant_id=payload.merchant_id.strip(),
        access_token=payload.platform_api_token.strip(),
        pakms_public_key=payload.ecommerce_public_key.strip(),
        ecommerce_token=payload.ecommerce_private_key.strip(),
    )
    return await _finish_connect(
        session,
        tenant=tenant,
        actor=actor,
        ctx=ctx,
        auth_mode="api_keys",
        tokens=None,
        pakms_public_key=payload.ecommerce_public_key.strip(),
        ecommerce_private_key=payload.ecommerce_private_key.strip(),
        access_token_for_api_keys=payload.platform_api_token.strip(),
    )


async def disconnect_clover(session: AsyncSession, tenant_slug: str, actor: User) -> PaymentCapabilitiesResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    connection = await _load_connection(session, tenant.id, for_update=True)
    if connection is None or connection.status == "disconnected":
        raise api_exception(409, "conflict", "Clover is not connected for this business.")

    connection.status = "disconnected"
    connection.access_token_enc = None
    connection.access_token_expires_at = None
    connection.refresh_token_enc = None
    connection.refresh_token_expires_at = None
    connection.ecommerce_private_key_enc = None
    connection.pakms_public_key = None
    connection.disconnected_by_user_id = actor.id
    connection.disconnected_at = datetime.now(timezone.utc)

    settings_json = dict(tenant.settings_json or {})
    settings_json["paymentProcessor"] = "none"
    tenant.settings_json = settings_json
    await record_audit(
        session,
        tenant_id=tenant.id,
        entity_type="processor_connection",
        entity_id=tenant.id,
        action="disconnected",
        actor=actor,
        changes={"processor": PROCESSOR, "merchantId": connection.merchant_id},
    )
    await session.commit()
    await session.refresh(connection)
    return _capabilities_from(tenant, connection)


# ---------------------------------------------------------------------------
# What the business can do
# ---------------------------------------------------------------------------


def _capabilities_from(tenant: Tenant, connection: ProcessorConnection | None) -> PaymentCapabilitiesResponse:
    processor = resolve_payment_processor(tenant)
    # Until Clover is connected, a business on the simulated checkout (development only) or on
    # Stripe's hosted checkout can still send a payment link. Both give the client a ready-made URL.
    simulated_link = processor in {"simulated", "stripe"}
    if connection is None or connection.status == "disconnected":
        return PaymentCapabilitiesResponse(
            processor=processor,
            status=connection.status if connection else None,
            can_send_payment_link=simulated_link,
        )

    connected = connection.status == "connected"
    card_ready = connected and bool(connection.pakms_public_key)
    expected = tenant_currency(tenant)
    mismatch = connection.merchant_currency is not None and connection.merchant_currency != expected
    return PaymentCapabilitiesResponse(
        processor=processor,
        environment=connection.environment,
        status=connection.status,
        auth_mode=connection.auth_mode,
        merchant_name=connection.merchant_name,
        can_link_device_payments=connected and not mismatch,
        can_charge_cards=card_ready and not mismatch,
        can_send_payment_link=(card_ready and not mismatch) or simulated_link,
        can_refund_cards=card_ready and not mismatch,
        currency_mismatch=mismatch,
        needs_reauth=connection.status == "needs_reauth",
        connected_at=connection.connected_at,
    )


async def get_payment_capabilities(session: AsyncSession, tenant_slug: str) -> PaymentCapabilitiesResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    return _capabilities_from(tenant, await _load_connection(session, tenant.id))


async def get_public_payment_config(session: AsyncSession, tenant_slug: str) -> PublicPaymentConfigResponse:
    """Only what the browser card form needs: merchant id and the public key."""
    tenant = await get_tenant_by_slug(session, tenant_slug)
    processor = resolve_payment_processor(tenant)
    clover_config: PublicCloverConfig | None = None
    if processor == "clover":
        connection = await _load_connection(session, tenant.id)
        if _is_connected(connection) and connection.pakms_public_key and connection.merchant_id:
            clover_config = PublicCloverConfig(
                merchant_id=connection.merchant_id,
                public_key=connection.pakms_public_key,
                sdk_url=SDK_URLS.get(connection.environment, SDK_URLS["production"]),
                environment=connection.environment,
            )
    return PublicPaymentConfigResponse(processor=processor, currency=tenant_currency(tenant), clover=clover_config)


# ---------------------------------------------------------------------------
# Tokens
# ---------------------------------------------------------------------------


async def _mark_needs_reauth(connection: ProcessorConnection, session: AsyncSession, reason: str) -> None:
    connection.status = "needs_reauth"
    connection.last_error = reason[:500]
    await record_audit(
        session,
        tenant_id=connection.tenant_id,
        entity_type="processor_connection",
        entity_id=connection.tenant_id,
        action="needs_reauth",
        notes=reason[:500],
    )


async def _refresh_connection(session: AsyncSession, connection: ProcessorConnection) -> None:
    """Rotate the OAuth token pair. The caller holds the row lock.

    Refresh tokens work once, so this must never run concurrently for one
    business. If the refresh is rejected, try Clover's recovery window; if that
    also fails the owner has to reconnect.
    """
    client_id, client_secret = _app_credentials()
    refresh = decrypt_secret(connection.refresh_token_enc) if connection.refresh_token_enc else None
    if not refresh:
        await _mark_needs_reauth(connection, session, "No refresh token is stored.")
        await session.commit()
        raise api_exception(503, "service_unavailable", "Clover needs to be reconnected in Settings → Payments.")

    try:
        tokens = await clover_client.refresh_tokens(connection.environment, client_id=client_id, refresh_token=refresh)
    except CloverAuthError:
        try:
            tokens = await clover_client.recover_tokens(
                connection.environment, client_id=client_id, client_secret=client_secret, recovery_token=refresh
            )
        except CloverError as recovery_error:
            await _mark_needs_reauth(connection, session, recovery_error.message)
            await session.commit()
            raise api_exception(
                503, "service_unavailable", "Clover needs to be reconnected in Settings → Payments."
            ) from recovery_error
    except CloverError as error:
        # Clover unreachable or erroring: keep the connection, fail this call.
        raise api_exception(503, "service_unavailable", "Clover is not reachable right now. Try again shortly.") from error

    connection.access_token_enc = encrypt_secret(tokens.access_token)
    connection.access_token_expires_at = _from_unix(tokens.access_token_expiration)
    if tokens.refresh_token:
        connection.refresh_token_enc = encrypt_secret(tokens.refresh_token)
        connection.refresh_token_expires_at = _from_unix(tokens.refresh_token_expiration)
    connection.last_refreshed_at = datetime.now(timezone.utc)
    connection.last_error = None
    await session.commit()


def _needs_refresh(connection: ProcessorConnection) -> bool:
    if connection.auth_mode != "oauth" or connection.access_token_expires_at is None:
        return False
    return _aware(connection.access_token_expires_at) - datetime.now(timezone.utc) < REFRESH_MARGIN


def _context_from(connection: ProcessorConnection) -> CloverContext:
    if not connection.merchant_id or not connection.access_token_enc:
        raise api_exception(409, "processor_not_connected", "Clover is not connected for this business.")
    access = decrypt_secret(connection.access_token_enc)
    ecommerce = decrypt_secret(connection.ecommerce_private_key_enc) if connection.ecommerce_private_key_enc else None
    return CloverContext(
        environment=connection.environment,
        merchant_id=connection.merchant_id,
        access_token=access,
        pakms_public_key=connection.pakms_public_key,
        ecommerce_token=ecommerce or access,
    )


async def get_clover_context(tenant_id: str) -> CloverContext:
    """Credentials for one business, refreshed if close to expiry.

    Uses its own database sessions so a refresh (which holds a row lock while
    it calls Clover) never sits inside a caller's open transaction.
    """
    async with get_session_maker()() as session:
        connection = await _load_connection(session, tenant_id)
        if connection is None or connection.status == "disconnected":
            raise api_exception(409, "processor_not_connected", "Clover is not connected for this business.")
        if connection.status == "needs_reauth":
            raise api_exception(503, "service_unavailable", "Clover needs to be reconnected in Settings → Payments.")
        if not _needs_refresh(connection):
            return _context_from(connection)

    async with get_session_maker()() as session:
        connection = await _load_connection(session, tenant_id, for_update=True)
        if connection is None or connection.status != "connected":
            raise api_exception(503, "service_unavailable", "Clover needs to be reconnected in Settings → Payments.")
        # Another request may have refreshed while we waited for the lock.
        if _needs_refresh(connection):
            await _refresh_connection(session, connection)
            await session.refresh(connection)
        return _context_from(connection)


async def mark_connection_needs_reauth(tenant_id: str, reason: str) -> None:
    """Called when Clover rejects our token mid-request (revoked or uninstalled)."""
    async with get_session_maker()() as session:
        connection = await _load_connection(session, tenant_id, for_update=True)
        if connection is not None and connection.status == "connected":
            await _mark_needs_reauth(connection, session, reason)
            await session.commit()


async def refresh_expiring_processor_tokens() -> int:
    """Background job: refresh OAuth tokens that expire soon so idle businesses
    don't drift past their refresh token's lifetime. Returns how many refreshed."""
    cutoff = datetime.now(timezone.utc) + BACKGROUND_REFRESH_WINDOW
    async with get_session_maker()() as session:
        tenant_ids = (
            await session.scalars(
                select(ProcessorConnection.tenant_id).where(
                    ProcessorConnection.processor == PROCESSOR,
                    ProcessorConnection.status == "connected",
                    ProcessorConnection.auth_mode == "oauth",
                    ProcessorConnection.access_token_expires_at.is_not(None),
                    ProcessorConnection.access_token_expires_at < cutoff,
                )
            )
        ).all()

    refreshed = 0
    for tenant_id in tenant_ids:
        try:
            async with get_session_maker()() as session:
                connection = await _load_connection(session, tenant_id, for_update=True)
                if connection is None or connection.status != "connected":
                    continue
                if connection.access_token_expires_at is not None and (
                    _aware(connection.access_token_expires_at) - datetime.now(timezone.utc) < BACKGROUND_REFRESH_WINDOW
                ):
                    await _refresh_connection(session, connection)
                    refreshed += 1
        except Exception:  # noqa: BLE001 - one business must not stop the rest
            logger.exception("Clover token refresh failed for tenant %s", tenant_id)
    return refreshed
