def test_root_endpoint_returns_expected_status(client) -> None:
    response = client.get("/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Booking Platform API is running",
        "environment": "test",
        "version": "v1",
    }


def test_api_root_endpoint_returns_expected_status(client) -> None:
    response = client.get("/api/v1/")

    assert response.status_code == 200
    assert response.json() == {
        "message": "Booking Platform API is running",
        "environment": "test",
        "version": "v1",
    }


def test_health_endpoints_report_live_and_ready(client) -> None:
    live_response = client.get("/api/v1/health/live")
    ready_response = client.get("/api/v1/health/ready")

    assert live_response.status_code == 200
    assert ready_response.status_code == 200
    assert live_response.json()["status"] == "ok"
    assert ready_response.json()["status"] == "ok"