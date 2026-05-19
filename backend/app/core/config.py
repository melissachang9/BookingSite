from functools import lru_cache

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
    api_prefix: str = "/api/v1"
    database_url: str = "postgresql+asyncpg://booking:booking@localhost:5433/booking_platform"


@lru_cache
def get_settings() -> Settings:
    return Settings()