"""A live deployment must refuse to start with unsafe settings, and must not create demo data."""

from __future__ import annotations

from pathlib import Path

import pytest
from cryptography.fernet import Fernet
from fastapi.testclient import TestClient

from app.core.config import DEFAULT_TOKEN_SECRET, Settings

GOOD = dict(
    app_env="production",
    token_secret_key="x" * 40,
    payment_secrets_key=Fernet.generate_key().decode(),
    platform_admin_token="p" * 24,
    storefront_public_base_url="https://book.example.com",
    dashboard_public_base_url="https://app.example.com",
    media_base_url="https://api.example.com/api/v1/forms/files",
    cors_origins="https://app.example.com,https://book.example.com",
)


@pytest.fixture(autouse=True)
def _clean_environment(monkeypatch: pytest.MonkeyPatch) -> None:
    """Settings read the real environment too; start from one with none of these set."""
    for name in (
        "TEST_RESET_TOKEN", "CLOVER_ENVIRONMENT", "SEED_DEMO_DATA", "APP_ENV", "TOKEN_SECRET_KEY",
        "PAYMENT_SECRETS_KEY", "STOREFRONT_PUBLIC_BASE_URL", "DASHBOARD_PUBLIC_BASE_URL", "MEDIA_BASE_URL", "CORS_ORIGINS",
    ):
        monkeypatch.delenv(name, raising=False)


def _settings(**overrides) -> Settings:
    return Settings(_env_file=None, **{**GOOD, **overrides})


def test_a_correct_production_configuration_has_no_problems() -> None:
    assert _settings().production_problems() == []


def test_development_and_test_are_never_blocked() -> None:
    for env in ("development", "test"):
        assert Settings(_env_file=None, app_env=env).production_problems() == []


@pytest.mark.parametrize(
    "overrides, fragment",
    [
        ({"token_secret_key": DEFAULT_TOKEN_SECRET}, "TOKEN_SECRET_KEY"),
        ({"token_secret_key": "too-short"}, "TOKEN_SECRET_KEY"),
        ({"payment_secrets_key": None}, "PAYMENT_SECRETS_KEY must be set"),
        ({"payment_secrets_key": "not-a-fernet-key"}, "not a valid Fernet key"),
        ({"test_reset_token": "local-e2e-reset"}, "TEST_RESET_TOKEN"),
        ({"clover_environment": "fake"}, "CLOVER_ENVIRONMENT"),
        ({"storefront_public_base_url": "http://localhost:3001"}, "STOREFRONT_PUBLIC_BASE_URL"),
        ({"dashboard_public_base_url": "http://127.0.0.1:5173"}, "DASHBOARD_PUBLIC_BASE_URL"),
        ({"media_base_url": "http://localhost:8000/x"}, "MEDIA_BASE_URL"),
        ({"cors_origins": "https://app.example.com,http://localhost:5173"}, "CORS_ORIGINS"),
    ],
)
def test_each_unsafe_production_setting_is_reported(overrides, fragment) -> None:
    problems = _settings(**overrides).production_problems()
    assert any(fragment in problem for problem in problems), problems


def test_demo_data_is_seeded_only_where_it_is_meant_to_be() -> None:
    assert Settings(_env_file=None, app_env="development").should_seed_demo_data is True
    assert Settings(_env_file=None, app_env="test").should_seed_demo_data is True
    assert _settings().should_seed_demo_data is False
    assert _settings(seed_demo_data=True).should_seed_demo_data is True
    assert Settings(_env_file=None, app_env="development", seed_demo_data=False).should_seed_demo_data is False


def _boot(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, **env: str) -> TestClient:
    from app.core.config import get_settings
    from app.db.session import clear_session_state
    from app.main import create_application

    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{tmp_path / 'prod.db'}")
    for name, value in env.items():
        monkeypatch.setenv(name, value)
    get_settings.cache_clear()
    clear_session_state()
    return TestClient(create_application())


def test_the_app_refuses_to_start_in_production_with_the_default_secret(tmp_path, monkeypatch) -> None:
    app_client = _boot(tmp_path, monkeypatch, APP_ENV="production", TOKEN_SECRET_KEY=DEFAULT_TOKEN_SECRET)
    with pytest.raises(RuntimeError, match="TOKEN_SECRET_KEY"):
        with app_client:
            pass


def test_a_safe_production_boot_creates_no_demo_business(tmp_path, monkeypatch) -> None:
    from app.core.config import get_settings
    from app.db.session import clear_session_state

    env = {name.upper(): str(value) for name, value in GOOD.items()}
    app_client = _boot(tmp_path, monkeypatch, **env)
    try:
        with app_client as running:
            assert running.get("/api/v1/tenants/brow-beauty-lab").status_code == 404
            assert running.post(
                "/api/v1/auth/login", json={"email": "owner@browbeautylab.test", "password": "DemoBooking123"}
            ).status_code in (401, 404)
            # The testing endpoints do not exist in production.
            assert running.post("/api/v1/testing/e2e/reset").status_code == 404
    finally:
        get_settings.cache_clear()
        clear_session_state()
