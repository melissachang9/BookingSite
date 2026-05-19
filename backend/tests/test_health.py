from fastapi.testclient import TestClient

from app.main import app


client = TestClient(app)


def test_root_endpoint_returns_expected_status() -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Booking Platform API is running",
        "environment": "development",
        "version": "v1",
    }


def test_health_endpoints_report_live_and_ready() -> None:
    live_response = client.get("/api/v1/health/live")
    ready_response = client.get("/api/v1/health/ready")

    assert live_response.status_code == 200
    assert ready_response.status_code == 200
    assert live_response.json()["status"] == "ok"
    assert ready_response.json()["status"] == "ok"