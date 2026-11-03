"""Run Alembic migrations from application code or the command line (`python -m app.db.migrate`)."""
from __future__ import annotations

import asyncio
from pathlib import Path

from alembic import command
from alembic.config import Config

BACKEND_ROOT = Path(__file__).resolve().parents[2]


def alembic_config(database_url: str | None = None) -> Config:
    config = Config(str(BACKEND_ROOT / "alembic.ini"))
    config.set_main_option("script_location", str(BACKEND_ROOT / "alembic"))
    if database_url:
        config.set_main_option("sqlalchemy.url", database_url.replace("%", "%%"))
    return config


def upgrade_to_head(database_url: str | None = None) -> None:
    command.upgrade(alembic_config(database_url), "head")


async def upgrade_database() -> None:
    # env.py starts its own event loop, so it has to run off the application's loop.
    await asyncio.to_thread(upgrade_to_head)


if __name__ == "__main__":
    upgrade_to_head()
