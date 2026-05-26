import asyncio
from datetime import datetime, timedelta, timezone


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 1
    return (today + timedelta(days=days_ahead)).isoformat()


def _service_by_name(client, name: str) -> dict[str, str]:
    services_response = client.get("/api/v1/tenants/brow-beauty-lab/services")
    assert services_response.status_code == 200
    return next(service for service in services_response.json()["services"] if service["name"] == name)


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


def _expire_checkout_session(booking_draft_id: str) -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(
                select(Payment)
                .where(Payment.booking_draft_id == booking_draft_id, Payment.checkout_session_kind == "deposit")
                .order_by(Payment.created_at.desc())
            )
            assert payment is not None
            payment.checkout_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
            await session.commit()

    asyncio.run(_run())


def _create_other_tenant_owner(client) -> tuple[str, str]:
    owner_email = "owner@other-tenant.test"
    owner_password = "OtherTenant123"
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Other Tenant Studio",
            "slug": "other-tenant",
            "timezone": "America/New_York",
            "locationName": "Second Studio",
            "ownerName": "Taylor Rowe",
            "ownerEmail": owner_email,
            "ownerPassword": owner_password,
        },
    )
    assert response.status_code == 201
    return owner_email, owner_password


def _create_awaiting_payment_draft(client) -> dict[str, str]:
    service = _service_by_name(client, "Signature Facial")
    date_text = _next_weekday(3)
    availability_response = client.get(
        "/api/v1/tenants/brow-beauty-lab/availability",
        params={"serviceId": service["id"], "date": date_text},
    )
    assert availability_response.status_code == 200
    first_slot = availability_response.json()["slots"][0]

    create_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/booking-drafts",
        json={
            "tenantSlug": "brow-beauty-lab",
            "serviceId": service["id"],
            "providerId": first_slot["providerId"],
            "locationId": first_slot["locationId"],
            "startsAt": first_slot["startAt"],
        },
    )
    assert create_response.status_code == 200
    booking_draft_id = create_response.json()["id"]

    update_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/booking-drafts/{booking_draft_id}",
        json={
            "customer": {
                "name": "Deposit Follow Up Guest",
                "email": "follow-up@example.com",
                "phone": "555-0700",
            },
            "intakeCompletionTiming": "before_visit",
        },
    )
    assert update_response.status_code == 200

    checkout_response = client.post(
        "/api/v1/tenants/brow-beauty-lab/payments/checkout-sessions",
        json={
            "tenantSlug": "brow-beauty-lab",
            "bookingDraftId": booking_draft_id,
            "kind": "deposit",
            "successUrl": f"http://127.0.0.1:3001/brow-beauty-lab/book/{booking_draft_id}/success",
            "cancelUrl": f"http://127.0.0.1:3001/brow-beauty-lab/book/{booking_draft_id}",
        },
    )
    assert checkout_response.status_code == 200

    return {
        "booking_draft_id": booking_draft_id,
        "checkout_url": checkout_response.json()["checkoutUrl"],
        "session_id": checkout_response.json()["sessionId"],
    }


def test_list_payment_follow_up_returns_open_deposit_work(client) -> None:
    draft = _create_awaiting_payment_draft(client)
    headers = _auth_headers(client)

    response = client.get("/api/v1/tenants/brow-beauty-lab/payments/follow-up", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    item = next(entry for entry in payload["items"] if entry["bookingDraft"]["id"] == draft["booking_draft_id"])
    assert item["bookingDraft"]["status"] == "awaiting_payment"
    assert item["bookingDraft"]["customer"]["email"] == "follow-up@example.com"
    assert item["linkState"] == "open"
    assert item["checkoutUrl"] == draft["checkout_url"]
    assert item["checkoutSessionId"] == draft["session_id"]


def test_list_payment_follow_up_marks_expired_links(client) -> None:
    draft = _create_awaiting_payment_draft(client)
    _expire_checkout_session(draft["booking_draft_id"])
    headers = _auth_headers(client)

    response = client.get("/api/v1/tenants/brow-beauty-lab/payments/follow-up", headers=headers)

    assert response.status_code == 200
    payload = response.json()
    item = next(entry for entry in payload["items"] if entry["bookingDraft"]["id"] == draft["booking_draft_id"])
    assert item["linkState"] == "expired"


def test_list_payment_follow_up_requires_authentication(client) -> None:
    response = client.get("/api/v1/tenants/brow-beauty-lab/payments/follow-up")

    assert response.status_code == 401
    assert response.json()["error"]["code"] == "unauthorized"


def test_list_payment_follow_up_rejects_user_without_view_permission(client) -> None:
    provider_email = "provider@browbeautylab.test"
    provider_password = "ProviderAccess123"
    _create_user("provider", provider_email, provider_password)
    headers = _auth_headers(client, email=provider_email, password=provider_password)

    response = client.get("/api/v1/tenants/brow-beauty-lab/payments/follow-up", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"


def test_list_payment_follow_up_rejects_cross_tenant_actor(client) -> None:
    owner_email, owner_password = _create_other_tenant_owner(client)
    headers = _auth_headers(client, email=owner_email, password=owner_password)

    response = client.get("/api/v1/tenants/brow-beauty-lab/payments/follow-up", headers=headers)

    assert response.status_code == 403
    assert response.json()["error"]["code"] == "forbidden"