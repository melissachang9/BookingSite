import asyncio


def _auth_headers(client, demo_credentials) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json=demo_credentials)
    assert response.status_code == 200
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _seed_lookup_customers() -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.db.models import Customer, Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == "brow-beauty-lab"))
            assert tenant is not None
            other_tenant = Tenant(
                slug="lookup-other-tenant",
                name="Lookup Other Tenant",
                timezone="America/New_York",
                branding_json={},
                settings_json={
                    "cancellationWindowHours": 24,
                    "refundInsideWindow": False,
                    "reminderHoursBefore": 24,
                    "minLeadTimeMinutes": 60,
                    "maxAdvanceBookingDays": 45,
                    "defaultDepositCents": 2500,
                    "noShowFeeCents": 5000,
                    "autoChargeNoShowFee": False,
                },
            )
            session.add(other_tenant)
            await session.flush()
            session.add_all(
                [
                    Customer(
                        tenant_id=tenant.id,
                        name="Taylor Guest",
                        email="taylor@example.com",
                        phone="555-0100",
                    ),
                    Customer(
                        tenant_id=other_tenant.id,
                        name="Taylor Other",
                        email="other@example.com",
                        phone="555-0199",
                    ),
                ]
            )
            await session.commit()

    asyncio.run(_run())


def test_lookup_customers_returns_matching_tenant_customers(client, demo_credentials) -> None:
    _seed_lookup_customers()

    response = client.get(
        "/api/v1/customers",
        params={"search": "taylor"},
        headers=_auth_headers(client, demo_credentials),
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["meta"]["total"] == 1
    assert payload["items"][0]["name"] == "Taylor Guest"
    assert payload["items"][0]["email"] == "taylor@example.com"
    assert payload["items"][0]["phone"] == "555-0100"
    assert all(item["name"] != "Taylor Other" for item in payload["items"])


def test_lookup_customers_requires_search_query(client, demo_credentials) -> None:
    response = client.get(
        "/api/v1/customers",
        headers=_auth_headers(client, demo_credentials),
    )

    assert response.status_code == 422


def test_lookup_customers_requires_authentication(client) -> None:
    response = client.get("/api/v1/customers", params={"search": "Taylor"})

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"