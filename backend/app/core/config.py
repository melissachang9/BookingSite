from functools import lru_cache
from typing import Optional

from pydantic_settings import BaseSettings, SettingsConfigDict


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
    token_secret_key: str = "change-me-for-production"
    test_reset_token: Optional[str] = None
    access_token_ttl_minutes: int = 60
    refresh_token_ttl_days: int = 14
    cors_origins: str = (
        "http://localhost:5173,http://127.0.0.1:5173,"
        "http://localhost:3000,http://127.0.0.1:3000,"
        "http://localhost:3001,http://127.0.0.1:3001"
    )

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()