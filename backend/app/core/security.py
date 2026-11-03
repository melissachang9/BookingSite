from __future__ import annotations

from datetime import datetime, timedelta, timezone
from hashlib import pbkdf2_hmac, sha256
import hmac
from os import urandom
from typing import Any

import jwt

from app.core.config import get_settings


PASSWORD_HASH_ITERATIONS = 120_000
CUSTOMER_MANAGE_TOKEN_TTL_DAYS = 30
PASSWORD_TOKEN_TTL = {"reset": timedelta(hours=1), "invite": timedelta(days=7)}


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def hash_password(password: str) -> str:
    salt = urandom(16)
    derived_key = pbkdf2_hmac("sha256", password.encode("utf-8"), salt, PASSWORD_HASH_ITERATIONS)
    return "pbkdf2_sha256${iterations}${salt}${digest}".format(
        iterations=PASSWORD_HASH_ITERATIONS,
        salt=salt.hex(),
        digest=derived_key.hex(),
    )


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        algorithm, iteration_count, salt_hex, digest_hex = stored_hash.split("$", 3)
    except ValueError:
        return False

    if algorithm != "pbkdf2_sha256":
        return False

    derived_key = pbkdf2_hmac(
        "sha256",
        password.encode("utf-8"),
        bytes.fromhex(salt_hex),
        int(iteration_count),
    )
    return hmac.compare_digest(derived_key.hex(), digest_hex)


def create_access_token(payload: dict[str, Any]) -> tuple[str, datetime]:
    settings = get_settings()
    expires_at = _utcnow() + timedelta(minutes=settings.access_token_ttl_minutes)
    token = jwt.encode(
        {**payload, "exp": expires_at, "iat": _utcnow(), "tokenType": "access"},
        settings.token_secret_key,
        algorithm="HS256",
    )
    return token, expires_at


def create_refresh_token(payload: dict[str, Any]) -> tuple[str, datetime]:
    settings = get_settings()
    expires_at = _utcnow() + timedelta(days=settings.refresh_token_ttl_days)
    token = jwt.encode(
        {**payload, "exp": expires_at, "iat": _utcnow(), "tokenType": "refresh"},
        settings.token_secret_key,
        algorithm="HS256",
    )
    return token, expires_at


def create_customer_manage_token(payload: dict[str, Any]) -> tuple[str, datetime]:
    settings = get_settings()
    expires_at = _utcnow() + timedelta(days=CUSTOMER_MANAGE_TOKEN_TTL_DAYS)
    token = jwt.encode(
        {**payload, "exp": expires_at, "iat": _utcnow(), "tokenType": "customer_manage"},
        settings.token_secret_key,
        algorithm="HS256",
    )
    return token, expires_at


def decode_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    return jwt.decode(token, settings.token_secret_key, algorithms=["HS256"])


def unusable_password_hash() -> str:
    """A stored value no password can match, for a staff member who has been invited but not yet set one."""
    return f"!unset${urandom(16).hex()}"


def password_fingerprint(stored_hash: str) -> str:
    return sha256(stored_hash.encode("utf-8")).hexdigest()[:24]


def create_password_token(user_id: str, stored_hash: str, purpose: str) -> tuple[str, datetime]:
    """A link token for setting a password: "reset" lasts an hour, "invite" a week.

    It carries a fingerprint of the password hash the user has now, so it stops working the moment the
    password changes. That makes each link single-use without storing anything.
    """
    expires_at = _utcnow() + PASSWORD_TOKEN_TTL[purpose]
    token = jwt.encode(
        {
            "sub": user_id,
            "pw": password_fingerprint(stored_hash),
            "purpose": purpose,
            "exp": expires_at,
            "iat": _utcnow(),
            "tokenType": "password",
        },
        get_settings().token_secret_key,
        algorithm="HS256",
    )
    return token, expires_at
