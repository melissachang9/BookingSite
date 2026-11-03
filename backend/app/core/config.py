from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


DEFAULT_TOKEN_SECRET = "change-me-for-production"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        env_prefix="",
        extra="ignore",
    )

    app_name: str = "Booking Platform API"
    app_env: str = "development"
    app_port: int = 8000
    app_version: str = "1.0.0"
    api_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://booking:booking@localhost:5433/booking_platform"
    token_secret_key: str = DEFAULT_TOKEN_SECRET
    test_reset_token: Optional[str] = None
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 14
    resend_api_key: Optional[str] = None
    resend_from_email: Optional[str] = None
    resend_reply_to_email: Optional[str] = None
    resend_api_base_url: str = "https://api.resend.com"
    meta_graph_api_base_url: str = "https://graph.facebook.com/v21.0"
    stripe_secret_key: Optional[str] = None
    stripe_webhook_secret: Optional[str] = None
    stripe_webhook_tolerance_seconds: int = 300
    stripe_api_base_url: str = "https://api.stripe.com/v1"
    twilio_account_sid: Optional[str] = None
    twilio_auth_token: Optional[str] = None
    twilio_phone_number: Optional[str] = None
    storefront_public_base_url: str = "http://localhost:3001"
    dashboard_public_base_url: str = "http://localhost:5173"
    # Clover (OAuth app credentials; per-business tokens live in processor_connections).
    clover_app_id: Optional[str] = None
    clover_app_secret: Optional[str] = None
    # Behind a trusted reverse proxy, use X-Forwarded-For as the customer's IP.
    trust_proxy_headers: bool = False
    # sandbox | production | fake (fake = in-process stand-in, never in production)
    clover_environment: str = "sandbox"
    # Comma-separated Fernet keys (newest first) used to encrypt stored processor secrets.
    payment_secrets_key: Optional[str] = None
    media_root: str = "/media"
    media_base_url: str = "http://localhost:8000/api/v1/forms/files"
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001"
    )

    # Creating a business needs this value in the X-Platform-Admin-Token header (invite-only signup). Left
    # unset, signup is open in development and test, and production refuses to start.
    platform_admin_token: Optional[str] = None

    # Per-IP limits on login, signup, uploads and other public endpoints. Turn off only for local e2e runs.
    rate_limit_enabled: bool = True

    # Creates the demo business and owner login. On by default only in development and test.
    seed_demo_data: Optional[bool] = None

    @property
    def is_production(self) -> bool:
        return self.app_env.strip().lower() in ("production", "prod")

    @property
    def should_seed_demo_data(self) -> bool:
        if self.seed_demo_data is not None:
            return self.seed_demo_data
        return self.app_env.strip().lower() in ("development", "test")

    def production_problems(self) -> list[str]:
        """Settings that must not reach a live deployment. Empty outside production."""
        if not self.is_production:
            return []
        problems: list[str] = []
        if self.token_secret_key == DEFAULT_TOKEN_SECRET or len(self.token_secret_key) < 32:
            problems.append("TOKEN_SECRET_KEY must be set to a random value of at least 32 characters.")
        keys = [key.strip() for key in (self.payment_secrets_key or "").split(",") if key.strip()]
        if not keys:
            problems.append("PAYMENT_SECRETS_KEY must be set (a Fernet key) so processor secrets are stored encrypted.")
        else:
            from cryptography.fernet import Fernet

            try:
                for key in keys:
                    Fernet(key.encode())
            except (ValueError, TypeError):
                problems.append("PAYMENT_SECRETS_KEY is not a valid Fernet key.")
        if not self.platform_admin_token or len(self.platform_admin_token) < 16:
            problems.append("PLATFORM_ADMIN_TOKEN must be set (16+ characters); creating a business is invite-only.")
        if self.test_reset_token:
            problems.append("TEST_RESET_TOKEN must not be set in production.")
        if self.clover_environment == "fake":
            problems.append("CLOVER_ENVIRONMENT must not be 'fake' in production.")
        for name, value in (
            ("STOREFRONT_PUBLIC_BASE_URL", self.storefront_public_base_url),
            ("DASHBOARD_PUBLIC_BASE_URL", self.dashboard_public_base_url),
            ("MEDIA_BASE_URL", self.media_base_url),
        ):
            if "localhost" in value or "127.0.0.1" in value:
                problems.append(f"{name} still points at localhost; customer links would be broken.")
        if any("localhost" in origin or "127.0.0.1" in origin for origin in self.cors_origin_list):
            problems.append("CORS_ORIGINS still lists localhost; set it to your real dashboard and storefront origins.")
        return problems

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()