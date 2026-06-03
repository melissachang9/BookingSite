import asyncio


def _auth_headers(client, email: str = "owner@browbeautylab.test", password: str = "DemoBooking123") -> dict[str, str]:
    response = client.post(
        "/api/v1/auth/login",
        json={"email": email, "password": password},
    )
    assert response.status_code == 200
    token = response.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def _create_user_and_link_provider(
    email: str,
    password: str,
    provider_email: str,
    role: str = "provider",
    tenant_slug: str = "brow-beauty-lab",
) -> tuple[str, str]:
    """Create a User with `role`, link it to the seeded Provider with `provider_email`.

    Returns (user_id, provider_id).
    """

    async def _run() -> tuple[str, str]:
        from sqlalchemy import select

        from app.core.security import hash_password
        from app.db.models import Provider, Tenant, User
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == tenant_slug))
            assert tenant is not None
            user = User(
                tenant_id=tenant.id,
                email=email,
                name=f"{role.title()} User",
                role=role,
                password_hash=hash_password(password),
                is_active=True,
            )
            session.add(user)
            await session.flush()
            provider = await session.scalar(
                select(Provider).where(Provider.tenant_id == tenant.id, Provider.email == provider_email)
            )
            assert provider is not None
            provider.user_id = user.id
            await session.commit()
            return user.id, provider.id

    return asyncio.run(_run())


def _next_weekday(offset: int) -> str:
    from datetime import date, timedelta

    target = date.today() + timedelta(days=offset)
    while target.weekday() >= 5:
        target += timedelta(days=1)
    return target.isoformat()


def _service_by_name(client, name: str) -> dict[str, object]:
    response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    return next(s for s in response.json()["services"] if s["name"] == name)


def _create_public_booking_draft(client, provider_id: str | None = None, customer: dict | None = None) -> dict:
    service = _service_by_name(client, "Signature Facial")
    avail = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": _next_weekday(3)},
    ).json()
    slots = avail["slots"]
    if provider_id is not None:
        slot = next(s for s in slots if s["providerId"] == provider_id)
    else:
        slot = slots[0]

    create = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": slot["providerId"],
            "locationId": slot["locationId"],
            "startsAt": slot["startAt"],
            "customer": customer,
        },
    )
    assert create.status_code in (200, 201), create.json()
    return create.json()


def test_tenant_settings_expose_client_ownership_defaults(client) -> None:
    body = client.get("/api/v1/tenants/brow-beauty-lab").json()
    settings = body["settings"]
    assert settings["clientOwnershipEnabled"] is False
    assert settings["onlineBookingOwnerAssignmentEnabled"] is False


def test_patch_client_ownership_updates_settings(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True, "onlineBookingOwnerAssignmentEnabled": True},
        headers=headers,
    )
    assert response.status_code == 200, response.json()
    settings = response.json()["settings"]
    assert settings["clientOwnershipEnabled"] is True
    assert settings["onlineBookingOwnerAssignmentEnabled"] is True


def test_patch_client_ownership_requires_auth(client) -> None:
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True},
    )
    assert response.status_code == 401


def test_patch_client_ownership_partial(client) -> None:
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True, "onlineBookingOwnerAssignmentEnabled": True},
        headers=headers,
    )
    response = client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"onlineBookingOwnerAssignmentEnabled": False},
        headers=headers,
    )
    settings = response.json()["settings"]
    assert settings["clientOwnershipEnabled"] is True
    assert settings["onlineBookingOwnerAssignmentEnabled"] is False


def test_public_booking_assigns_owner_when_flag_on(client) -> None:
    user_id, jordan_id = _create_user_and_link_provider(
        email="jordan-user@browbeautylab.test",
        password="DemoBooking123",
        provider_email="jordan@browbeautylab.test",
    )
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True, "onlineBookingOwnerAssignmentEnabled": True},
        headers=headers,
    )

    draft = _create_public_booking_draft(
        client,
        provider_id=jordan_id,
        customer={
            "name": "New Owned Guest",
            "email": "new-owned@example.com",
            "phone": "555-0901",
        },
    )
    assert draft["customer"]["ownerUserId"] == user_id


def test_public_booking_does_not_assign_owner_when_flag_off(client) -> None:
    _create_user_and_link_provider(
        email="jordan-user2@browbeautylab.test",
        password="DemoBooking123",
        provider_email="jordan@browbeautylab.test",
    )
    draft = _create_public_booking_draft(
        client,
        customer={
            "name": "Unowned Guest",
            "email": "unowned@example.com",
            "phone": "555-0902",
        },
    )
    assert draft["customer"]["ownerUserId"] is None


def test_public_booking_does_not_overwrite_existing_owner(client) -> None:
    # Pre-seed a customer with NO owner via a booking while flag is off.
    first = _create_public_booking_draft(
        client,
        customer={
            "name": "Returning Guest",
            "email": "returning@example.com",
            "phone": "555-0903",
        },
    )
    assert first["customer"]["ownerUserId"] is None

    # Now turn the flag on and re-book with same email — owner must stay None.
    _create_user_and_link_provider(
        email="jordan-user3@browbeautylab.test",
        password="DemoBooking123",
        provider_email="jordan@browbeautylab.test",
    )
    headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True, "onlineBookingOwnerAssignmentEnabled": True},
        headers=headers,
    )
    second = _create_public_booking_draft(
        client,
        customer={
            "name": "Returning Guest",
            "email": "returning@example.com",
            "phone": "555-0903",
        },
    )
    assert second["customer"]["ownerUserId"] is None


def test_customer_lookup_scoped_for_provider_when_ownership_enabled(client) -> None:
    jordan_user_id, jordan_id = _create_user_and_link_provider(
        email="jordan-user4@browbeautylab.test",
        password="DemoBooking123",
        provider_email="jordan@browbeautylab.test",
    )
    _ava_user_id, ava_id = _create_user_and_link_provider(
        email="ava-user@browbeautylab.test",
        password="DemoBooking123",
        provider_email="ava@browbeautylab.test",
    )
    owner_headers = _auth_headers(client)
    client.patch(
        "/api/v1/tenants/brow-beauty-lab/client-ownership",
        json={"clientOwnershipEnabled": True, "onlineBookingOwnerAssignmentEnabled": True},
        headers=owner_headers,
    )

    _create_public_booking_draft(
        client,
        provider_id=jordan_id,
        customer={"name": "Jordan Client", "email": "jordan-client@example.com", "phone": "555-1001"},
    )
    _create_public_booking_draft(
        client,
        provider_id=ava_id,
        customer={"name": "Ava Client", "email": "ava-client@example.com", "phone": "555-1002"},
    )

    # Provider role lookup — should only see Jordan's client.
    jordan_headers = _auth_headers(
        client, email="jordan-user4@browbeautylab.test", password="DemoBooking123"
    )
    listing = client.get("/api/v1/customers", params={"search": "Client"}, headers=jordan_headers).json()
    emails = {item["email"] for item in listing["items"]}
    assert "jordan-client@example.com" in emails
    assert "ava-client@example.com" not in emails

    # Owner sees both.
    owner_listing = client.get(
        "/api/v1/customers", params={"search": "Client"}, headers=owner_headers
    ).json()
    owner_emails = {item["email"] for item in owner_listing["items"]}
    assert "jordan-client@example.com" in owner_emails
    assert "ava-client@example.com" in owner_emails

    # Sanity: returned ownership matches.
    jordan_item = next(i for i in owner_listing["items"] if i["email"] == "jordan-client@example.com")
    assert jordan_item["ownerUserId"] == jordan_user_id


def test_customer_lookup_unscoped_when_ownership_disabled(client) -> None:
    _create_user_and_link_provider(
        email="jordan-user5@browbeautylab.test",
        password="DemoBooking123",
        provider_email="jordan@browbeautylab.test",
    )
    # Flag off (default). Create a customer via public booking.
    _create_public_booking_draft(
        client,
        customer={"name": "Shared Client", "email": "shared@example.com", "phone": "555-1003"},
    )
    jordan_headers = _auth_headers(
        client, email="jordan-user5@browbeautylab.test", password="DemoBooking123"
    )
    listing = client.get(
        "/api/v1/customers", params={"search": "Shared"}, headers=jordan_headers
    ).json()
    emails = {item["email"] for item in listing["items"]}
    assert "shared@example.com" in emails
