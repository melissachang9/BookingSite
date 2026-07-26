from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone

import httpx

from app.core.config import get_settings
from app.core.http import api_exception


@dataclass(frozen=True)
class EmailDeliveryResult:
    provider: str
    recipient_email: str
    provider_message_id: str
    sent_at: datetime


@dataclass(frozen=True)
class SmsDeliveryResult:
    provider: str
    recipient_phone: str
    provider_message_id: str
    sent_at: datetime


def _twilio_configured() -> bool:
    settings = get_settings()
    return (
        isinstance(settings.twilio_account_sid, str) and settings.twilio_account_sid.strip().startswith("AC")
        and isinstance(settings.twilio_auth_token, str) and bool(settings.twilio_auth_token.strip())
        and isinstance(settings.twilio_phone_number, str) and settings.twilio_phone_number.strip().startswith("+")
    )


async def send_transactional_email(
    *,
    recipient_email: str,
    subject: str,
    text_body: str,
    html_body: str,
) -> EmailDeliveryResult:
    settings = get_settings()
    if not settings.resend_api_key or not settings.resend_from_email:
        raise api_exception(503, "service_unavailable", "Email reminder delivery is not configured.")

    payload: dict[str, object] = {
        "from": settings.resend_from_email,
        "to": [recipient_email],
        "subject": subject,
        "text": text_body,
        "html": html_body,
    }
    if settings.resend_reply_to_email:
        payload["reply_to"] = settings.resend_reply_to_email

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"{settings.resend_api_base_url.rstrip('/')}/emails",
            headers={
                "Authorization": f"Bearer {settings.resend_api_key}",
                "Content-Type": "application/json",
            },
            json=payload,
        )

    if response.status_code >= 400:
        provider_message = "Email provider request failed."
        try:
            payload = response.json()
        except ValueError:
            payload = None
        if isinstance(payload, dict):
            message = payload.get("message") or payload.get("error")
            if isinstance(message, str) and message:
                provider_message = message
        raise api_exception(502, "bad_gateway", provider_message)

    try:
        provider_payload = response.json()
    except ValueError as error:
        raise api_exception(502, "bad_gateway", "Email provider returned an invalid response.") from error

    provider_message_id = provider_payload.get("id") if isinstance(provider_payload, dict) else None
    if not isinstance(provider_message_id, str) or not provider_message_id:
        raise api_exception(502, "bad_gateway", "Email provider did not return a message id.")

    return EmailDeliveryResult(
        provider="resend",
        recipient_email=recipient_email,
        provider_message_id=provider_message_id,
        sent_at=datetime.now(timezone.utc),
    )


async def send_transactional_sms(
    *,
    recipient_phone: str,
    body: str,
) -> SmsDeliveryResult:
    """Send an SMS via Twilio.  Raises 503 if Twilio is not configured."""
    settings = get_settings()
    if not _twilio_configured():
        raise api_exception(503, "service_unavailable", "SMS delivery is not configured.")

    from urllib.parse import urlencode

    async with httpx.AsyncClient(timeout=15.0) as client:
        response = await client.post(
            f"https://api.twilio.com/2010-04-01/Accounts/{settings.twilio_account_sid}/Messages.json",
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            content=urlencode({
                "From": settings.twilio_phone_number,
                "To": recipient_phone,
                "Body": body,
            }),
            auth=(settings.twilio_account_sid, settings.twilio_auth_token),
        )

    if response.status_code >= 400:
        provider_message = "SMS provider request failed."
        try:
            error_payload = response.json()
        except ValueError:
            error_payload = None
        if isinstance(error_payload, dict):
            message = error_payload.get("message")
            if isinstance(message, str) and message:
                provider_message = message
        raise api_exception(502, "bad_gateway", provider_message)

    try:
        provider_payload = response.json()
    except ValueError as error:
        raise api_exception(502, "bad_gateway", "SMS provider returned an invalid response.") from error

    provider_message_id = provider_payload.get("sid") if isinstance(provider_payload, dict) else None
    if not isinstance(provider_message_id, str) or not provider_message_id:
        raise api_exception(502, "bad_gateway", "SMS provider did not return a message id.")

    return SmsDeliveryResult(
        provider="twilio",
        recipient_phone=recipient_phone,
        provider_message_id=provider_message_id,
        sent_at=datetime.now(timezone.utc),
    )