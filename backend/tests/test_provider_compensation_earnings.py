import asyncio

from test_booking_operations import (
    _auth_headers,
    _confirm_paid_deposit_booking,
    _create_other_tenant_owner,
)


def _complete_booking(client, headers, booking_id: str) -> dict[str, object]:
    response = client.post(
        f"/api/v1/tenants/brow-beauty-lab/bookings/{booking_id}/status",
        headers=headers,
        json={"status": "completed", "paymentResolution": "follow_up"},
    )
    assert response.status_code == 200
    return response.json()


def _set_commission_override(provider_id: str, service_id: str, basis_points: int) -> None:
    async def _run() -> None:
        from sqlalchemy import select

        from app.db.models import ProviderService
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            link = await session.scalar(
                select(ProviderService).where(
                    ProviderService.provider_id == provider_id,
                    ProviderService.service_id == service_id,
                )
            )
            assert link is not None
            link.commission_basis_points = basis_points
            await session.commit()

    asyncio.run(_run())



def _earnings(client, headers, provider_id: str) -> dict[str, object]:
    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/compensation/earnings-summary",
        headers=headers,
    )
    assert response.status_code == 200
    return response.json()


def test_earnings_summary_service_percent_mode(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking = created["booking"]
    provider_id = booking["providerId"]
    price_cents = created["service"]["priceCents"]

    compensation_response = client.patch(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/compensation",
        headers=headers,
        json={"compensationMode": "service_percent", "compensationServicePercentBp": 4000},
    )
    assert compensation_response.status_code == 200

    # Seeded demo data may already include other completed bookings for this
    # provider this month, so compare before/after the delta this test causes
    # rather than asserting an absolute total.
    baseline = _earnings(client, headers, provider_id)

    _complete_booking(client, headers, booking["id"])

    payload = _earnings(client, headers, provider_id)

    assert payload["treatmentRevenueCents"] - baseline["treatmentRevenueCents"] == price_cents
    assert payload["retailRevenueCents"] == 0
    assert payload["productPayoutCents"] == 0
    assert payload["overrideBookingsCount"] == baseline["overrideBookingsCount"]
    expected_payout_delta = round(price_cents * 0.40)
    assert payload["servicePayoutCents"] - baseline["servicePayoutCents"] == expected_payout_delta
    assert payload["totalPayoutCents"] - baseline["totalPayoutCents"] == expected_payout_delta
    assert payload["monthLabel"]


def test_earnings_summary_counts_per_service_override(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking = created["booking"]
    provider_id = booking["providerId"]
    service_id = booking["serviceId"]
    price_cents = created["service"]["priceCents"]

    baseline = _earnings(client, headers, provider_id)

    _complete_booking(client, headers, booking["id"])
    _set_commission_override(provider_id, service_id, 5000)

    payload = _earnings(client, headers, provider_id)
    assert payload["treatmentRevenueCents"] - baseline["treatmentRevenueCents"] == price_cents
    assert payload["overrideBookingsCount"] - baseline["overrideBookingsCount"] == 1
    expected_payout_delta = round(price_cents * 0.50)
    assert payload["servicePayoutCents"] - baseline["servicePayoutCents"] == expected_payout_delta
    assert payload["totalPayoutCents"] - baseline["totalPayoutCents"] == expected_payout_delta


def test_earnings_summary_requires_permission(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    provider_id = created["booking"]["providerId"]

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/compensation/earnings-summary",
    )
    assert response.status_code == 401


def test_earnings_summary_is_tenant_isolated(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    provider_id = created["booking"]["providerId"]

    other_email, other_password = _create_other_tenant_owner(client)
    other_headers = _auth_headers(client, other_email, other_password)

    response = client.get(
        f"/api/v1/tenants/brow-beauty-lab/providers/{provider_id}/compensation/earnings-summary",
        headers=other_headers,
    )
    assert response.status_code == 403
