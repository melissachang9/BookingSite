"""Encryption for processor secrets stored in the database.

Uses Fernet (AES-128-CBC + HMAC). ``PAYMENT_SECRETS_KEY`` holds one or more
comma-separated keys, newest first: new data is encrypted with the first key and
any listed key can decrypt, so keys can be rotated without downtime.
Generate one with: ``python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"``.
"""

from __future__ import annotations

from cryptography.fernet import Fernet, InvalidToken, MultiFernet

from app.core.config import get_settings
from app.core.http import api_exception


def _fernet() -> MultiFernet:
    raw = get_settings().payment_secrets_key
    keys = [key.strip() for key in (raw or "").split(",") if key.strip()]
    if not keys:
        raise api_exception(
            503,
            "service_unavailable",
            "Payment secrets are not configured on the server (PAYMENT_SECRETS_KEY).",
        )
    try:
        return MultiFernet([Fernet(key.encode()) for key in keys])
    except (ValueError, TypeError) as error:
        raise api_exception(
            503, "service_unavailable", "PAYMENT_SECRETS_KEY is not a valid Fernet key."
        ) from error


def encrypt_secret(plaintext: str) -> str:
    return _fernet().encrypt(plaintext.encode()).decode()


def decrypt_secret(ciphertext: str) -> str:
    try:
        return _fernet().decrypt(ciphertext.encode()).decode()
    except InvalidToken as error:
        raise api_exception(
            503,
            "service_unavailable",
            "Stored payment credentials could not be read. Reconnect the processor in Settings.",
        ) from error
