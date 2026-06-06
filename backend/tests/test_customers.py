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


def _seed_customer_form_responses() -> dict[str, str]:
    async def _run() -> dict[str, str]:
        from datetime import datetime, timezone

        from sqlalchemy import select

        from app.db.models import (
            Customer,
            FormDefinition,
            FormResponse,
            FormVersion,
            Tenant,
        )
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == "brow-beauty-lab"))
            assert tenant is not None

            other_tenant = Tenant(
                slug="form-responses-other-tenant",
                name="Form Responses Other Tenant",
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

            customer = Customer(tenant_id=tenant.id, name="Form Guest", email="formguest@example.com")
            other_customer = Customer(
                tenant_id=other_tenant.id,
                name="Other Guest",
                email="otherguest@example.com",
            )
            session.add_all([customer, other_customer])
            await session.flush()

            form = FormDefinition(
                tenant_id=tenant.id,
                name="Intake Consent",
                scope="customer",
                customer_prompt_timing="pre_visit",
            )
            session.add(form)
            await session.flush()

            schema = {"fields": [{"key": "allergies", "label": "Allergies", "type": "text"}]}
            version = FormVersion(
                tenant_id=tenant.id,
                form_id=form.id,
                version_number=2,
                schema_json=schema,
            )
            session.add(version)
            await session.flush()

            response = FormResponse(
                tenant_id=tenant.id,
                form_id=form.id,
                form_version_id=version.id,
                customer_id=customer.id,
                scope="customer",
                customer_prompt_timing="pre_visit",
                submitted_at=datetime(2024, 6, 1, 15, 0, tzinfo=timezone.utc),
                answers_json={"allergies": "None"},
            )
            # A response for a different tenant/customer that must never leak.
            other_form = FormDefinition(
                tenant_id=other_tenant.id,
                name="Other Intake",
                scope="customer",
                customer_prompt_timing="pre_visit",
            )
            session.add(other_form)
            await session.flush()
            other_version = FormVersion(
                tenant_id=other_tenant.id,
                form_id=other_form.id,
                version_number=1,
                schema_json=schema,
            )
            session.add(other_version)
            await session.flush()
            other_response = FormResponse(
                tenant_id=other_tenant.id,
                form_id=other_form.id,
                form_version_id=other_version.id,
                customer_id=other_customer.id,
                scope="customer",
                customer_prompt_timing="pre_visit",
                submitted_at=datetime(2024, 6, 2, 15, 0, tzinfo=timezone.utc),
                answers_json={"allergies": "Latex"},
            )
            session.add_all([response, other_response])
            await session.commit()

            return {
                "tenant_slug": tenant.slug,
                "customer_id": customer.id,
                "other_tenant_slug": other_tenant.slug,
                "other_customer_id": other_customer.id,
            }

    return asyncio.run(_run())


def test_list_customer_form_responses_returns_customer_responses(client, demo_credentials) -> None:
    seeded = _seed_customer_form_responses()

    response = client.get(
        f"/api/v1/tenants/{seeded['tenant_slug']}/customers/{seeded['customer_id']}/form-responses",
        headers=_auth_headers(client, demo_credentials),
    )

    assert response.status_code == 200
    payload = response.json()
    assert len(payload["items"]) == 1
    entry = payload["items"][0]
    assert entry["formName"] == "Intake Consent"
    assert entry["formVersionNumber"] == 2
    assert entry["scope"] == "customer"
    assert entry["customerPromptTiming"] == "pre_visit"
    assert entry["answers"] == {"allergies": "None"}
    assert entry["schema"] == {"fields": [{"key": "allergies", "label": "Allergies", "type": "text"}]}


def test_list_customer_form_responses_is_tenant_isolated(client, demo_credentials) -> None:
    seeded = _seed_customer_form_responses()

    response = client.get(
        f"/api/v1/tenants/{seeded['tenant_slug']}/customers/{seeded['other_customer_id']}/form-responses",
        headers=_auth_headers(client, demo_credentials),
    )

    assert response.status_code == 404


def test_list_customer_form_responses_requires_authentication(client) -> None:
    response = client.get(
        "/api/v1/tenants/brow-beauty-lab/customers/missing/form-responses",
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"