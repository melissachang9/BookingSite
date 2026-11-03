from __future__ import annotations

from alembic.autogenerate import compare_metadata
from alembic.migration import MigrationContext
from sqlalchemy import create_engine, inspect

from app.db.base import Base
from app.db.migrate import upgrade_to_head
import app.db.models  # noqa: F401


def test_migrations_build_the_same_schema_as_the_models(tmp_path):
    path = tmp_path / "migrated.db"
    upgrade_to_head(f"sqlite+aiosqlite:///{path}")

    engine = create_engine(f"sqlite:///{path}")
    with engine.connect() as connection:
        tables = set(inspect(connection).get_table_names())
        assert {"tenants", "bookings", "payments", "audit_events", "alembic_version"} <= tables
        diff = compare_metadata(MigrationContext.configure(connection), Base.metadata)
    engine.dispose()

    # A model change without a matching migration would leave production behind the code.
    assert diff == [], f"models and migrations disagree; run `alembic revision --autogenerate`: {diff}"


def test_ready_check_reports_database_outage(monkeypatch):
    import asyncio

    from app.api.routes import health

    class BrokenEngine:
        def connect(self):
            raise ConnectionError("db down")

    monkeypatch.setattr(health, "get_engine", lambda: BrokenEngine())
    response = asyncio.run(health.ready_health())
    assert response.status_code == 503
