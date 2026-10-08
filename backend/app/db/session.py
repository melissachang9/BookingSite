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

        # Provider compensation columns
        for comp_column, comp_type in [
            ("compensation_mode", "VARCHAR(32)"),
            ("compensation_service_percent_bp", "INTEGER"),
            ("compensation_product_percent_bp", "INTEGER"),
            ("compensation_hourly_cents", "INTEGER"),
            ("compensation_sliding_scale", "JSON"),
        ]:
            exists = await connection.scalar(
                text(
                    f"""
                    SELECT 1 FROM information_schema.columns
                    WHERE table_schema = 'public' AND table_name = 'providers' AND column_name = '{comp_column}'
                    """
                )
            )
            if not exists:
                await connection.execute(
                    text(f"ALTER TABLE providers ADD COLUMN {comp_column} {comp_type}")
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
            "online_booking_description": "TEXT",
            "require_card_on_file": "BOOLEAN NOT NULL DEFAULT FALSE",
            "booking_payment_mode": "VARCHAR(32)",
            "booking_payment_value_cents": "INTEGER",
            "booking_payment_percent": "INTEGER",
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

        # Work hours: provider_schedules nullable location_id + is_active
        for col_name, col_type in [
            ("is_active", "BOOLEAN NOT NULL DEFAULT TRUE"),
        ]:
            exists = await connection.scalar(
                text(
                    f"SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_schedules' AND column_name = '{col_name}'"
                )
            )
            if not exists:
                await connection.execute(text(f"ALTER TABLE provider_schedules ADD COLUMN {col_name} {col_type}"))

        # Make location_id nullable
        await connection.execute(
            text("ALTER TABLE provider_schedules ALTER COLUMN location_id DROP NOT NULL")
        )

        # Work hours: provider_time_off new columns
        for col_name, col_type in [
            ("location_id", "VARCHAR(36)"),
            ("override_type", "VARCHAR(32) NOT NULL DEFAULT 'closed'"),
            ("start_time", "TIME"),
            ("end_time", "TIME"),
            ("blocked_service_ids", "JSON"),
        ]:
            exists = await connection.scalar(
                text(
                    f"SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_time_off' AND column_name = '{col_name}'"
                )
            )
            if not exists:
                await connection.execute(text(f"ALTER TABLE provider_time_off ADD COLUMN {col_name} {col_type}"))

        # Work hours: provider_schedules blocked_service_ids
        for col_name, col_type in [
            ("blocked_service_ids", "JSON"),
        ]:
            exists = await connection.scalar(
                text(
                    f"SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'provider_schedules' AND column_name = '{col_name}'"
                )
            )
            if not exists:
                await connection.execute(text(f"ALTER TABLE provider_schedules ADD COLUMN {col_name} {col_type}"))

        draft_answers_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'booking_draft_form_requirements'
                  AND column_name = 'draft_answers_json'
                """
            )
        )
        if not draft_answers_exists:
            await connection.execute(
                text("ALTER TABLE booking_draft_form_requirements ADD COLUMN draft_answers_json JSONB")
            )

        applies_all_services_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'forms'
                  AND column_name = 'applies_to_all_services'
                """
            )
        )
        if not applies_all_services_exists:
            await connection.execute(
                text("ALTER TABLE forms ADD COLUMN applies_to_all_services BOOLEAN NOT NULL DEFAULT FALSE")
            )

        form_category_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'forms'
                  AND column_name = 'category'
                """
            )
        )
        if not form_category_exists:
            await connection.execute(
                text("ALTER TABLE forms ADD COLUMN category VARCHAR(100)")
            )

        # Backfill: forms with no service attachments should be "applies to all"
        # This runs every startup (idempotent) to catch forms configured before the column existed
        await connection.execute(
            text(
                """
                UPDATE forms SET applies_to_all_services = TRUE
                WHERE id NOT IN (
                    SELECT DISTINCT form_id FROM service_form_attachments
                )
                """
            )
        )

        audit_events_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'audit_events'
                  AND column_name = 'entity_type'
                """
            )
        )
        if not audit_events_exists:
            await connection.execute(
                text(
                    """
                    CREATE TABLE audit_events (
                        id VARCHAR(36) PRIMARY KEY,
                        tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id),
                        entity_type VARCHAR(64) NOT NULL,
                        entity_id VARCHAR(36) NOT NULL,
                        action VARCHAR(32) NOT NULL,
                        actor_type VARCHAR(32) NOT NULL,
                        actor_id VARCHAR(36),
                        actor_name VARCHAR(255),
                        changes_json JSONB,
                        notes TEXT,
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_audit_events_tenant_id ON audit_events (tenant_id)")
            )
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_audit_events_entity ON audit_events (entity_type, entity_id)")
            )

        wallet_tx_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'wallet_transactions'
                  AND column_name = 'kind'
                """
            )
        )
        if not wallet_tx_exists:
            await connection.execute(
                text(
                    """
                    CREATE TABLE wallet_transactions (
                        id VARCHAR(36) PRIMARY KEY,
                        tenant_id VARCHAR(36) NOT NULL REFERENCES tenants(id),
                        customer_id VARCHAR(36) NOT NULL REFERENCES customers(id),
                        amount_cents INTEGER NOT NULL,
                        kind VARCHAR(32) NOT NULL,
                        actor_type VARCHAR(32) NOT NULL,
                        actor_id VARCHAR(36),
                        actor_name VARCHAR(255),
                        notes TEXT,
                        booking_id VARCHAR(36) REFERENCES bookings(id),
                        payment_id VARCHAR(36) REFERENCES payments(id),
                        created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
                        updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
                    )
                    """
                )
            )
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_wallet_transactions_customer ON wallet_transactions (customer_id)")
            )
            await connection.execute(
                text("CREATE INDEX IF NOT EXISTS ix_wallet_transactions_tenant ON wallet_transactions (tenant_id)")
            )

        sms_reminder_sent_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'booking_draft_intake_plans'
                  AND column_name = 'sms_reminder_sent_at'
                """
            )
        )
        if not sms_reminder_sent_exists:
            await connection.execute(
                text("ALTER TABLE booking_draft_intake_plans ADD COLUMN sms_reminder_sent_at TIMESTAMP WITH TIME ZONE")
            )

        stripe_customer_id_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'customers'
                  AND column_name = 'stripe_customer_id'
                """
            )
        )
        if not stripe_customer_id_exists:
            await connection.execute(
                text("ALTER TABLE customers ADD COLUMN stripe_customer_id VARCHAR(255)")
            )

        payment_tip_cents_exists = await connection.scalar(
            text(
                """
                SELECT 1 FROM information_schema.columns
                WHERE table_schema = 'public'
                  AND table_name = 'payments'
                  AND column_name = 'tip_cents'
                """
            )
        )
        if not payment_tip_cents_exists:
            await connection.execute(
                text("ALTER TABLE payments ADD COLUMN tip_cents INTEGER NOT NULL DEFAULT 0")
            )


# Columns added after their tables first shipped. create_all() only creates
# missing tables, so existing Postgres databases get these via ALTER TABLE.
_ADDED_COLUMNS: tuple[tuple[str, str, str], ...] = (
    ("providers", "compensation_product_flat_cents", "INTEGER"),
    ("provider_services", "offered_location_ids", "JSON"),
    ("bookings", "price_cents", "INTEGER"),
    ("bookings", "deposit_cents", "INTEGER"),
    ("resources", "quantity", "INTEGER NOT NULL DEFAULT 1"),
    ("booking_items", "source_add_on_id", "VARCHAR(36)"),
    ("customers", "birthday", "DATE"),
    ("bookings", "source_channel", "VARCHAR(32)"),
    ("bookings", "canceled_by", "VARCHAR(16)"),
    ("bookings", "cancel_reason", "TEXT"),
    ("bookings", "no_show_at", "TIMESTAMP WITH TIME ZONE"),
    ("bookings", "rescheduled_from_starts_at", "TIMESTAMP WITH TIME ZONE"),
    ("bookings", "reschedule_count", "INTEGER NOT NULL DEFAULT 0"),
    ("bookings", "checked_in_at", "TIMESTAMP WITH TIME ZONE"),
    ("bookings", "service_started_at", "TIMESTAMP WITH TIME ZONE"),
    ("bookings", "tax_cents", "INTEGER"),
)

# Reporting indexes for databases created before they were declared on the models.
_ADDED_INDEXES: tuple[str, ...] = (
    "CREATE INDEX IF NOT EXISTS ix_bookings_tenant_starts_at ON bookings (tenant_id, starts_at)",
    "CREATE INDEX IF NOT EXISTS ix_bookings_tenant_status_completed_at ON bookings (tenant_id, status, completed_at)",
    "CREATE INDEX IF NOT EXISTS ix_bookings_tenant_provider_starts_at ON bookings (tenant_id, provider_id, starts_at)",
    "CREATE INDEX IF NOT EXISTS ix_payments_tenant_status_created_at ON payments (tenant_id, status, created_at)",
    "CREATE INDEX IF NOT EXISTS ix_payments_booking_id ON payments (booking_id)",
    "CREATE INDEX IF NOT EXISTS ix_payment_events_tenant_kind_occurred_at ON payment_events (tenant_id, kind, occurred_at)",
)


async def _ensure_added_columns() -> None:
    async with get_engine().begin() as connection:
        for table, column, column_type in _ADDED_COLUMNS:
            exists = await connection.scalar(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_schema = 'public' AND table_name = :table AND column_name = :column"
                ),
                {"table": table, "column": column},
            )
            if not exists:
                await connection.execute(text(f"ALTER TABLE {table} ADD COLUMN {column} {column_type}"))
        for statement in _ADDED_INDEXES:
            await connection.execute(text(statement))


async def initialize_database() -> None:
    async with get_engine().begin() as connection:
        await connection.run_sync(Base.metadata.create_all)
    if get_engine().dialect.name == "postgresql":
        await _ensure_postgres_schema_compatibility()
        await _ensure_added_columns()


async def dispose_engine() -> None:
    if get_engine.cache_info().currsize == 0:
        return
    await get_engine().dispose()


def clear_session_state() -> None:
    get_session_maker.cache_clear()
    get_engine.cache_clear()