"""Invite-only business signup: creating a business needs the platform's invite code."""

from __future__ import annotations

import hmac
from typing import Annotated, Optional

from fastapi import Depends, Header

from app.core.config import Settings, get_settings
from app.core.http import api_exception


def require_signup_access(
    x_platform_admin_token: Annotated[Optional[str], Header(alias="X-Platform-Admin-Token")] = None,
    settings: Settings = Depends(get_settings),
) -> None:
    expected = settings.platform_admin_token
    if not expected:
        # Open only where no code is configured and this is not production (production refuses to start
        # without one), so local setup and the e2e suite need nothing extra.
        if settings.is_production:
            raise api_exception(403, "forbidden", "Creating a business needs an invite code.")
        return
    if not x_platform_admin_token or not hmac.compare_digest(x_platform_admin_token, expected):
        raise api_exception(403, "forbidden", "Creating a business needs a valid invite code.")
