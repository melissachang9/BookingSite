import asyncio


def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={
            "email": email,
            "password": password,
        },
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _first_location(client, tenant_slug: str = "brow-beauty-lab") -> dict[str, str]:
    response = client.get(f"/api/v1/tenants/{tenant_slug}/locations")
    assert response.status_code == 200
    return response.json()["locations"][0]


def _create_secondary_tenant_with_location() -> dict[str, str]:
    async def _run() -> dict[str, str]:
        from app.db.models import Location, Tenant
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = Tenant(
                slug="other-tenant",
                name="Other Tenant",
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
            session.add(tenant)
            await session.flush()

            location = Location(
                tenant_id=tenant.id,
                name="Second Studio",
                time_zone=tenant.timezone,
                is_active=True,
            )
            session.add(location)
            await session.commit()
            return {"tenant_id": tenant.id, "location_id": location.id}

    return asyncio.run(_run())


def _create_user(role: str, email: str, password: str, tenant_slug: str = "brow-beauty-lab") -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.core.security import hash_password
        from app.db.models import Tenant, User
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
            assert tenant is not None
            session.add(
                User(
                    tenant_id=tenant.id,
                    email=email,
                    name=f"{role.title()} User",
                    role=role,
                    password_hash=hash_password(password),
                    is_active=True,
                )
            )
            await session.commit()

    asyncio.run(_run())


def test_create_service_returns_new_service(client) -> None:
    location = _first_location(client)
    headers = _auth_headers(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "LED Recovery Facial",
            "description": "Post-treatment recovery support with LED and hydration.",
            "durationMinutes": 75,
            "priceCents": 18500,
            "depositCents": 5000,
            "locationIds": [location["id"]],
        },
        headers=headers,
    )

    assert response.status_code == 201
    payload = response.json()
    assert payload["name"] == "LED Recovery Facial"
    assert payload["priceCents"] == 18500
    assert payload["depositCents"] == 5000
    assert payload["locationIds"] == [location["id"]]
    assert payload["tenantId"]


def test_create_service_requires_authentication(client) -> None:
    location = _first_location(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Unauthorized Service",
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2500,
            "locationIds": [location["id"]],
        },
    )

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_create_service_rejects_user_without_manage_permission(client) -> None:
    staff_email = "staff@browbeautylab.test"
    staff_password = "StaffAccess123"
    _create_user("staff", staff_email, staff_password)
    headers = _auth_headers(client, email=staff_email, password=staff_password)
    location = _first_location(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Staff Blocked Service",
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2500,
            "locationIds": [location["id"]],
        },
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_create_service_rejects_cross_tenant_actor(client) -> None:
    tenant_slug = "cross-tenant-studio"
    owner_email = "owner@crosstenant.test"
    owner_password = "OwnerAccess123"
    create_tenant_response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Cross Tenant Studio",
            "slug": tenant_slug,
            "timezone": "America/New_York",
            "locationName": "Cross Tenant Suite",
            "ownerName": "Taylor Rowe",
            "ownerEmail": owner_email,
            "ownerPassword": owner_password,
        },
    )
    assert create_tenant_response.status_code == 201
    headers = _auth_headers(client, email=owner_email, password=owner_password)
    location = _first_location(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Cross Tenant Actor Service",
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2500,
            "locationIds": [location["id"]],
        },
        headers=headers,
    )

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_create_service_rejects_invalid_deposit_amount(client) -> None:
    location = _first_location(client)
    headers = _auth_headers(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Deposit Error Demo",
            "durationMinutes": 60,
            "priceCents": 4000,
            "depositCents": 5000,
            "locationIds": [location["id"]],
        },
        headers=headers,
    )

    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_create_service_rejects_location_from_other_tenant(client) -> None:
    other_tenant = _create_secondary_tenant_with_location()
    headers = _auth_headers(client)

    response = client.post(
        "/api/v1/tenants/brow-beauty-lab/services",
        json={
            "name": "Cross Tenant Service",
            "durationMinutes": 60,
            "priceCents": 12000,
            "depositCents": 2500,
            "locationIds": [other_tenant["location_id"]],
        },
        headers=headers,
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "not_found"