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

        booking_last_reminder_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'bookings'
                  AND column_name = 'last_form_reminder_sent_at'
                """
            )
        )
        if not booking_last_reminder_exists:
            await connection.execute(
                text("ALTER TABLE bookings ADD COLUMN last_form_reminder_sent_at TIMESTAMP WITH TIME ZONE")
            )

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

        service_category_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'category_id'
                """
            )
        )
        if not service_category_exists:
            await connection.execute(text("ALTER TABLE services ADD COLUMN category_id VARCHAR(36)"))
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_services_category_id ON services (category_id)")
            )

        service_sort_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'services' AND column_name = 'sort_order'
                """
            )
        )
        if not service_sort_exists:
            await connection.execute(
                text("ALTER TABLE services ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0")
            )

        for override_column in ("price_cents_override", "duration_minutes_override", "deposit_cents_override"):
            exists = await connection.scalar(
                text(
                    f"""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'provider_services' AND column_name = '{override_column}'
                    """
                )
            )
            if not exists:
                await connection.execute(
                    text(f"ALTER TABLE provider_services ADD COLUMN {override_column} INTEGER")
                )

        for commission_column in ("commission_flat_cents", "commission_basis_points"):
            exists = await connection.scalar(
                text(
                    f"""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'provider_services' AND column_name = '{commission_column}'
                    """
                )
            )
            if not exists:
                await connection.execute(
                    text(f"ALTER TABLE provider_services ADD COLUMN {commission_column} INTEGER")
                )

        # Phase I: service category merchandising columns
        category_columns = {
            "slug": "VARCHAR(255)",
            "outcome_headline": "VARCHAR(255)",
            "subheadline": "TEXT",
            "hero_image_url": "TEXT",
            "hero_image_alt": "VARCHAR(255)",
            "value_stack": "JSON",
            "bonuses": "JSON",
            "guarantee_text": "TEXT",
            "social_proof": "JSON",
            "scarcity_hint": "VARCHAR(255)",
            "featured_label": "VARCHAR(32)",
            "meta_description": "TEXT",
            "faqs": "JSON",
        }
        for column_name, column_type in category_columns.items():
            exists = await connection.scalar(
                text(
                    f"""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'service_categories' AND column_name = '{column_name}'
                    """
                )
            )
            if not exists:
                await connection.execute(
                    text(f"ALTER TABLE service_categories ADD COLUMN {column_name} {column_type}")
                )
        slug_index_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'ix_service_categories_slug'
                """
            )
        )
        if not slug_index_exists:
            await connection.execute(
                text(
                    "CREATE INDEX IF NOT EXISTS ix_service_categories_slug ON service_categories (slug)"
                )
            )
        slug_unique_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'uq_service_categories_tenant_slug'
                """
            )
        )
        if not slug_unique_exists:
            await connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_service_categories_tenant_slug "
                    "ON service_categories (tenant_id, slug) WHERE slug IS NOT NULL"
                )
            )

        # Phase J: service merchandising columns
        service_columns = {
            "slug": "VARCHAR(255)",
            "outcome_headline": "VARCHAR(255)",
            "subheadline": "TEXT",
            "compare_at_price_cents": "INTEGER",
            "featured_label": "VARCHAR(32)",
            "value_stack": "JSON",
            "bonuses": "JSON",
            "guarantee_text": "TEXT",
            "social_proof": "JSON",
            "scarcity_hint": "VARCHAR(255)",
            "image_url": "TEXT",
            "image_alt_text": "VARCHAR(255)",
            "before_image_url": "TEXT",
            "before_image_alt": "VARCHAR(255)",
            "after_image_url": "TEXT",
            "after_image_alt": "VARCHAR(255)",
            "meta_description": "TEXT",
        }
        for column_name, column_type in service_columns.items():
            exists = await connection.scalar(
                text(
                    f"""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'services' AND column_name = '{column_name}'
                    """
                )
            )
            if not exists:
                await connection.execute(
                    text(f"ALTER TABLE services ADD COLUMN {column_name} {column_type}")
                )
        service_slug_index_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'ix_services_slug'
                """
            )
        )
        if not service_slug_index_exists:
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_services_slug ON services (slug)")
            )
        service_slug_unique_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM pg_indexes
                WHERE schemaname = 'public' AND indexname = 'uq_services_tenant_slug'
                """
            )
        )
        if not service_slug_unique_exists:
            await connection.execute(
                text(
                    "CREATE UNIQUE INDEX IF NOT EXISTS uq_services_tenant_slug "
                    "ON services (tenant_id, slug) WHERE slug IS NOT NULL"
                )
            )

        # Wallet balance on customers
        wallet_balance_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public' AND table_name = 'customers' AND column_name = 'wallet_balance_cents'
                """
            )
        )
        if not wallet_balance_exists:
            await connection.execute(
                text("ALTER TABLE customers ADD COLUMN wallet_balance_cents INTEGER NOT NULL DEFAULT 0")
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