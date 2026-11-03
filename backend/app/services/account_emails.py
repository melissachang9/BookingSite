"""Emails that let someone set a password: forgotten-password links and staff invitations.

Both carry the same kind of single-use token (see core/security.create_password_token). They are sent
from the platform's address, since the person may not belong to any business with its own domain yet.
"""

from __future__ import annotations

import logging
from html import escape
from urllib.parse import urlencode

from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.security import create_password_token
from app.db.models import Tenant, User
from app.services.notifications import send_transactional_email

logger = logging.getLogger(__name__)


def _link(token: str, purpose: str) -> str:
    base = get_settings().dashboard_public_base_url.rstrip("/")
    query = {"token": token}
    if purpose == "invite":
        query["invite"] = "1"
    return f"{base}/reset-password?{urlencode(query)}"


async def send_password_link(session: AsyncSession, user: User, purpose: str, *, invited_by: str | None = None) -> bool:
    """Email `user` a link to set their password. Returns whether the email was handed to the provider.

    A failure is logged and reported as False, never raised: callers either answer the same way
    regardless (forgot-password, so nobody can probe which emails exist) or tell the owner the invite
    did not go out.
    """
    tenant = await session.get(Tenant, user.tenant_id)
    business = tenant.name if tenant is not None else "your business"
    token, _ = create_password_token(user.id, user.password_hash, purpose)
    link = _link(token, purpose)
    name = user.name or "there"

    if purpose == "invite":
        subject = f"You're invited to {business}"
        lead = (
            f"{invited_by} added you to {business}." if invited_by else f"You've been added to {business}."
        ) + " Set a password to sign in."
        expiry = "This link works for 7 days and can be used once."
    else:
        subject = "Reset your password"
        lead = f"We got a request to reset the password for your {business} account."
        expiry = "This link works for 1 hour and can be used once. If you didn't ask for it, you can ignore this email."

    text_body = "\n".join([f"Hi {name},", "", lead, "", link, "", expiry])
    html_body = "".join(
        [
            f"<p>Hi {escape(name)},</p>",
            f"<p>{escape(lead)}</p>",
            f'<p><a href="{escape(link)}">Set your password</a></p>',
            f"<p>{escape(expiry)}</p>",
        ]
    )
    try:
        await send_transactional_email(
            recipient_email=user.email, subject=subject, text_body=text_body, html_body=html_body
        )
    except Exception:  # noqa: BLE001 - see docstring
        logger.exception("Could not send %s email to user %s", purpose, user.id)
        return False
    return True
