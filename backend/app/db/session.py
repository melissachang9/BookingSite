from __future__ import annotations

from collections.abc import AsyncIterator
from functools import lru_cache

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncEngine, AsyncSession, async_sessionmaker, create_async_engine

from app.core.config import get_settings
from app.db.base import Base


def _sqlite_connect_args(database_url: str) -> dict[str, bool]:
    if database_url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


@lru_cache
def get_engine() -> AsyncEngine:
    settings = get_settings()
    return create_async_engine(
        settings.database_url,
        future=True,
        connect_args=_sqlite_connect_args(settings.database_url),
    )


@lru_cache
def get_session_maker() -> async_sessionmaker[AsyncSession]:
    return async_sessionmaker(get_engine(), expire_on_commit=False)


async def get_db_session() -> AsyncIterator[AsyncSession]:
    async with get_session_maker()() as session:
        yield session


async def _ensure_postgres_schema_compatibility() -> None:
    async with get_engine().begin() as connection:
        checkout_session_id_length = await connection.scalar(
            text(
                """
                SELECT character_maximum_length
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'payments'
                  AND column_name = 'checkout_session_id'
                """
            )
        )
        if isinstance(checkout_session_id_length, int) and checkout_session_id_length < 255:
            await connection.execute(text("ALTER TABLE payments ALTER COLUMN checkout_session_id TYPE VARCHAR(255)"))

        location_phone_exists = await connection.scalar(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'locations'
                  AND column_name = 'phone'
                """
            )
        )
        if not location_phone_exists:
            await connection.execute(text("ALTER TABLE locations ADD COLUMN phone VARCHAR(40)"))

        customer_owner_exists = await connection.scalar(
            text(
                """
                SELECT 1
                FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'customers'
                  AND column_name = 'owner_user_id'
                """
            )
        )
        if not customer_owner_exists:
            await connection.execute(text("ALTER TABLE customers ADD COLUMN owner_user_id VARCHAR(36)"))
            await connection.execute(text("CREATE INDEX IF NOT EXISTS ix_customers_owner_user_id ON customers (owner_user_id)"))

        user_phone_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'phone'
                """
            )
        )
        if not user_phone_exists:
            await connection.execute(text("ALTER TABLE users ADD COLUMN phone VARCHAR(40)"))

        user_avatar_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'avatar_url'
                """
            )
        )
        if not user_avatar_exists:
            await connection.execute(text("ALTER TABLE users ADD COLUMN avatar_url TEXT"))

        provider_bookable_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = 'is_bookable_online'
                """
            )
        )
        if not provider_bookable_exists:
            await connection.execute(
                text("ALTER TABLE providers ADD COLUMN is_bookable_online BOOLEAN NOT NULL DEFAULT TRUE")
            )


async def initialize_database() -> None:
    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    if get_engine().dialect.name == "postgresql":
        await _ensure_postgres_schema_compatibility()


async def dispose_engine() -> None:
    if get_engine.cache_info().currsize == 0:
        return
    await get_engine().dispose()


def clear_session_state() -> None:
    get_session_maker.cache_clear()
    get_engine.cache_clear()