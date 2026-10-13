import asyncio
from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient


BACKEND_ROOT = Path(__file__).resolve().parents[1]

if str(BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(BACKEND_ROOT))


@pytest.fixture()
def client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> TestClient:
    database_path = tmp_path / "booking_platform_test.db"
    monkeypatch.setenv("DATABASE_URL", f"sqlite+aiosqlite:///{database_path}")
    monkeypatch.setenv("APP_ENV", "test")
    monkeypatch.setenv("TOKEN_SECRET_KEY", "test-secret-key")
    monkeypatch.delenv("TEST_RESET_TOKEN", raising=False)
    monkeypatch.delenv("STRIPE_SECRET_KEY", raising=False)
    monkeypatch.delenv("STRIPE_WEBHOOK_SECRET", raising=False)
    monkeypatch.delenv("RESEND_API_KEY", raising=False)
    monkeypatch.delenv("RESEND_FROM_EMAIL", raising=False)
    monkeypatch.delenv("RESEND_REPLY_TO_EMAIL", raising=False)
    for name in ("CLOVER_APP_ID", "CLOVER_APP_SECRET", "CLOVER_ENVIRONMENT"):
        monkeypatch.delenv(name, raising=False)
    # A fixed test-only key so processor secrets can be encrypted in tests.
    monkeypatch.setenv("PAYMENT_SECRETS_KEY", "Zm9yLXRlc3RzLW9ubHktbm90LWEtcmVhbC1rZXk9PT0=")

    from app.core.config import get_settings
    from app.db.session import clear_session_state
    from app.main import create_application

    get_settings.cache_clear()
    clear_session_state()
    application = create_application()

    with TestClient(application) as test_client:
        yield test_client

    get_settings.cache_clear()
    clear_session_state()


@pytest.fixture()
def demo_credentials() -> dict[str, str]:
    return {
        "email": "owner@browbeautylab.test",
        "password": "DemoBooking123",
    }


@pytest.fixture()
def fake_clover(client: TestClient, monkeypatch: pytest.MonkeyPatch):
    """Clover app credentials plus an in-memory Clover behind the HTTP seam."""
    from app.core.config import get_settings
    from tests.fakes.clover import FakeClover

    monkeypatch.setenv("CLOVER_APP_ID", "test-clover-app")
    monkeypatch.setenv("CLOVER_APP_SECRET", "test-clover-secret")
    monkeypatch.setenv("CLOVER_ENVIRONMENT", "sandbox")
    get_settings.cache_clear()

    fake = FakeClover()
    monkeypatch.setattr("app.services.clover_client._http_client", fake.client)
    yield fake
    get_settings.cache_clear()
