def test_login_returns_session_tokens(client, demo_credentials) -> None:
    response = client.post("/api/v1/auth/login", json=demo_credentials)

    assert response.status_code == 200
    payload = response.json()
    assert payload["accessToken"]
    assert payload["refreshToken"]
    assert payload["user"]["email"] == demo_credentials["email"]
    assert payload["user"]["role"] == "owner"
    assert any(grant["key"] == "calendar.create_booking" and grant["allowed"] for grant in payload["user"]["permissions"])


def test_login_rejects_invalid_credentials(client, demo_credentials) -> None:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": demo_credentials["email"], "password": "wrong-password"},
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_refresh_returns_new_session(client, demo_credentials) -> None:
    login_response = client.post("/api/v1/auth/login", json=demo_credentials)
    refresh_response = client.post(
        "/api/v1/auth/refresh",
        json={"refreshToken": login_response.json()["refreshToken"]},
    )

    assert refresh_response.status_code == 200
    assert refresh_response.json()["user"]["email"] == demo_credentials["email"]