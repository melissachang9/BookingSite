import asyncio

from tests.test_booking_operations import (
    _auth_headers,
    _confirm_paid_deposit_booking,
)

TENANT = "brow-beauty-lab"


def _status_url(booking_id: str) -> str:
    return f"/api/v1/tenants/{TENANT}/bookings/{booking_id}/status"


def _complete(client, booking: dict, **extra) -> dict:
    response = client.post(
        _status_url(booking["id"]),
        headers=_auth_headers(client),
        json={"status": "completed", "paymentResolution": "follow_up", **extra},
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _sale_rows(sale_id: str) -> dict:
    async def _go():
        from sqlalchemy import select

        from app.db.models import Sale, SaleLine, SaleTip
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            sale = await session.get(Sale, sale_id)
            lines = (await session.scalars(select(SaleLine).where(SaleLine.sale_id == sale_id))).all()
            tips = (await session.scalars(select(SaleTip).where(SaleTip.sale_id == sale_id))).all()
            return {
                "sale": {
                    "number": sale.sale_number,
                    "tenant_id": sale.tenant_id,
                    "subtotal": sale.subtotal_cents,
                    "discount": sale.discount_cents,
                    "tax": sale.tax_cents,
                    "tip": sale.tip_cents,
                    "total": sale.total_cents,
                    "status": sale.status,
                },
                "lines": [(l.kind, l.name, l.quantity, l.unit_price_cents, l.tax_cents) for l in lines],
                "tips": [(t.provider_id, t.amount_cents) for t in tips],
            }

    return asyncio.run(_go())


def test_open_booking_has_no_sale_number(client) -> None:
    created = _confirm_paid_deposit_booking(client)
    assert created["booking"].get("saleNumber") is None


def test_completing_a_visit_assigns_the_next_sale_number(client) -> None:
    first = _complete(client, _confirm_paid_deposit_booking(client)["booking"])
    assert first["saleNumber"] == 1
    assert first["saleId"]

    second = _complete(client, _confirm_paid_deposit_booking(client)["booking"])
    assert second["saleNumber"] == 2


def test_completing_again_does_not_create_another_sale(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    first = _complete(client, booking)
    again = _complete(client, booking)
    assert again["saleNumber"] == first["saleNumber"]
    assert again["saleId"] == first["saleId"]

    other = _complete(client, _confirm_paid_deposit_booking(client)["booking"])
    assert other["saleNumber"] == first["saleNumber"] + 1


def test_no_show_and_cancellation_do_not_create_sales(client) -> None:
    no_show = _confirm_paid_deposit_booking(client)["booking"]
    response = client.post(_status_url(no_show["id"]), headers=_auth_headers(client), json={"status": "no_show"})
    assert response.status_code == 200
    assert response.json().get("saleNumber") is None

    completed = _complete(client, _confirm_paid_deposit_booking(client)["booking"])
    assert completed["saleNumber"] == 1  # the no-show did not use a number


def test_sale_snapshots_lines_tax_and_total(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    completed = _complete(client, booking)
    rows = _sale_rows(completed["saleId"])

    assert rows["sale"]["status"] == "completed"
    assert rows["sale"]["number"] == completed["saleNumber"]
    assert rows["sale"]["subtotal"] == completed["priceCents"]
    assert rows["sale"]["tax"] == completed["taxCents"]
    assert rows["sale"]["total"] == completed["priceCents"] + completed["taxCents"]
    assert rows["lines"][0][0] == "service"
    assert sum(line[4] for line in rows["lines"]) == completed["taxCents"]


def test_discount_is_recorded_on_the_sale(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    completed = _complete(client, booking, discountCents=500, discountType="amount")
    rows = _sale_rows(completed["saleId"])
    assert rows["sale"]["discount"] == 500
    assert rows["sale"]["total"] == completed["priceCents"] - 500 + completed["taxCents"]


def test_tip_on_the_visit_is_shared_to_the_provider_on_the_sale(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    paid = client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/manual",
        headers=_auth_headers(client),
        json={"amountCents": booking["balanceDueCents"] + 700, "tipCents": 700, "paymentMethodType": "cash"},
    )
    assert paid.status_code == 200, paid.json()
    completed = client.post(
        _status_url(booking["id"]), headers=_auth_headers(client), json={"status": "completed"}
    ).json()
    rows = _sale_rows(completed["saleId"])
    assert rows["sale"]["tip"] == 700
    assert rows["tips"] == [(booking["providerId"], 700)]


def test_sale_numbers_are_per_business(client) -> None:
    from app.db.session import get_session_maker
    from app.services.sales import allocate_sale_number

    async def _numbers():
        async with get_session_maker()() as session:
            a = [await allocate_sale_number(session, "tenant-a") for _ in range(2)]
            b = await allocate_sale_number(session, "tenant-b")
            a_again = await allocate_sale_number(session, "tenant-a")
            await session.commit()
            return a, b, a_again

    a, b, a_again = asyncio.run(_numbers())
    assert a == [1, 2]
    assert b == 1  # another business starts at 1 and never sees tenant-a's numbers
    assert a_again == 3


def test_tax_is_spread_over_lines_without_losing_a_cent() -> None:
    from app.services.sales import _allocate_proportionally

    assert sum(_allocate_proportionally(100, [1, 1, 1])) == 100
    assert _allocate_proportionally(0, [5, 5]) == [0, 0]
    assert _allocate_proportionally(10, [0, 0]) == [0, 0]
    assert _allocate_proportionally(10, [3, 0]) == [10, 0]


def _wide_range() -> dict[str, str]:
    from datetime import date, timedelta

    today = date.today()
    return {"from": (today - timedelta(days=30)).isoformat(), "to": (today + timedelta(days=400)).isoformat()}


def test_tax_report_reads_tax_from_sales(client) -> None:
    completed = _complete(client, _confirm_paid_deposit_booking(client)["booking"])
    headers = _auth_headers(client)
    params = _wide_range()
    response = client.get(f"/api/v1/tenants/{TENANT}/reports/tax", headers=headers, params=params)
    assert response.status_code == 200, response.json()
    body = response.json()
    assert body["salesCount"] >= 1
    assert body["taxCollectedCents"] >= completed["taxCents"]
    assert sum(row["taxCents"] for row in body["byKind"]) == body["taxCollectedCents"]
    assert sum(row["taxCents"] for row in body["byLocation"]) == body["taxCollectedCents"]


def test_tax_report_needs_permission_and_a_valid_filter(client) -> None:
    params = _wide_range()
    assert client.get(f"/api/v1/tenants/{TENANT}/reports/tax", params=params).status_code in (401, 403)
    headers = _auth_headers(client)
    bad = client.get(
        f"/api/v1/tenants/{TENANT}/reports/tax", headers=headers, params={**params, "locationId": "nope"}
    )
    assert bad.status_code == 404
    csv = client.get(f"/api/v1/tenants/{TENANT}/reports/tax", headers=headers, params={**params, "format": "csv"})
    assert csv.status_code == 422
