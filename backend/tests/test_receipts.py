import asyncio

import pytest

from tests.test_booking_operations import _auth_headers, _confirm_paid_deposit_booking, _create_other_tenant_owner

TENANT = "brow-beauty-lab"
BASE = f"/api/v1/tenants/{TENANT}"


def _complete(client, booking: dict) -> dict:
    response = client.post(
        f"{BASE}/bookings/{booking['id']}/status",
        headers=_auth_headers(client),
        json={"status": "completed", "paymentResolution": "follow_up"},
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _checked_out_sale(client) -> tuple[dict, dict]:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    return booking, _complete(client, booking)


def _receipt(client, sale_id: str) -> dict:
    response = client.get(f"{BASE}/sales/{sale_id}/receipt", headers=_auth_headers(client))
    assert response.status_code == 200, response.json()
    return response.json()


def _audit(entity_id: str, action: str) -> list[dict]:
    async def _go():
        from sqlalchemy import select

        from app.db.models import AuditEvent
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            rows = (
                await session.scalars(
                    select(AuditEvent).where(AuditEvent.entity_id == entity_id, AuditEvent.action == action)
                )
            ).all()
            return [{"actor": r.actor_id, "changes": r.changes_json} for r in rows]

    return asyncio.run(_go())


# --- receipt ---------------------------------------------------------------------------------


def test_receipt_shows_lines_totals_and_the_deposit_already_paid(client) -> None:
    booking, completed = _checked_out_sale(client)
    receipt = _receipt(client, completed["saleId"])

    assert receipt["saleNumber"] == completed["saleNumber"]
    assert receipt["business"]["name"] == "Brow Beauty Lab"
    assert receipt["customer"]["name"] == "Completion Queue Guest"
    assert receipt["lines"][0]["kind"] == "service"
    assert receipt["subtotalCents"] == completed["priceCents"]
    assert receipt["totalCents"] == completed["priceCents"] + completed["taxCents"]
    assert sum(line["taxCents"] for line in receipt["lines"]) == receipt["taxCents"]

    [deposit] = receipt["payments"]
    assert deposit["method"] == "deposit"
    assert deposit["netCents"] == booking["depositCents"]
    assert receipt["paidCents"] == booking["depositCents"]
    # what is still owed = total minus the deposit already paid
    assert receipt["balanceDueCents"] == receipt["totalCents"] - booking["depositCents"]
    assert receipt["balanceDueCents"] == completed["balanceDueCents"]


def test_receipt_reflects_a_balance_collected_after_checkout(client) -> None:
    booking, completed = _checked_out_sale(client)
    paid = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/manual",
        headers=_auth_headers(client),
        json={"amountCents": completed["balanceDueCents"], "paymentMethodType": "cash"},
    )
    assert paid.status_code == 200, paid.json()
    receipt = _receipt(client, completed["saleId"])
    assert receipt["balanceDueCents"] == 0
    assert {p["method"] for p in receipt["payments"]} == {"deposit", "cash"}


def test_receipt_shows_a_refund_against_the_payment_it_came_from(client) -> None:
    booking, completed = _checked_out_sale(client)
    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=_auth_headers(client)).json()
    payment_id = detail["payments"][0]["id"]
    refund = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/{payment_id}/refund",
        headers=_auth_headers(client),
        json={"amountCents": 500},
    )
    assert refund.status_code == 200, refund.json()
    [payment] = _receipt(client, completed["saleId"])["payments"]
    assert payment["receivedCents"] == booking["depositCents"]
    assert payment["refundedCents"] == 500
    assert payment["netCents"] == booking["depositCents"] - 500


def test_unknown_sale_is_not_found(client) -> None:
    response = client.get(f"{BASE}/sales/no-such-sale/receipt", headers=_auth_headers(client))
    assert response.status_code == 404


# --- listing ---------------------------------------------------------------------------------


def test_sales_list_filters_by_client_newest_first(client) -> None:
    _, first = _checked_out_sale(client)
    booking, second = _checked_out_sale(client)
    headers = _auth_headers(client)

    response = client.get(f"{BASE}/sales", headers=headers, params={"customerId": booking["customerId"]})
    assert response.status_code == 200, response.json()
    body = response.json()
    numbers = [row["saleNumber"] for row in body["sales"]]
    assert numbers == sorted(numbers, reverse=True)
    assert {first["saleNumber"], second["saleNumber"]} <= set(numbers)
    row = next(r for r in body["sales"] if r["saleNumber"] == second["saleNumber"])
    assert row["totalCents"] == second["priceCents"] + second["taxCents"]
    assert row["balanceDueCents"] == second["balanceDueCents"]
    assert row["customerName"] == "Completion Queue Guest"

    assert client.get(f"{BASE}/sales", headers=headers, params={"customerId": "nobody"}).json()["total"] == 0
    page = client.get(f"{BASE}/sales", headers=headers, params={"limit": 1}).json()
    assert len(page["sales"]) == 1 and page["total"] >= 2


# --- email -----------------------------------------------------------------------------------


@pytest.fixture
def sent_emails(monkeypatch) -> list[dict]:
    sent: list[dict] = []

    async def fake_send(**kwargs):
        sent.append(kwargs)

    monkeypatch.setattr("app.services.receipts.send_transactional_email", fake_send)
    return sent


def test_email_receipt_goes_to_the_client_and_is_audited(client, sent_emails) -> None:
    _, completed = _checked_out_sale(client)
    response = client.post(f"{BASE}/sales/{completed['saleId']}/receipt/email", headers=_auth_headers(client), json={})
    assert response.status_code == 200, response.json()
    assert response.json()["recipientEmail"] == "completion-queue@example.com"

    [mail] = sent_emails
    assert mail["recipient_email"] == "completion-queue@example.com"
    assert f"#{completed['saleNumber']}" in mail["subject"]
    assert "Brow Beauty Lab" in mail["text_body"]
    assert "Signature Facial" in mail["text_body"]
    assert "Balance due" in mail["text_body"]
    audits = _audit(completed["saleId"], "receipt_emailed")
    assert len(audits) == 1 and audits[0]["actor"]


def test_email_receipt_can_go_to_another_address_and_validates_it(client, sent_emails) -> None:
    _, completed = _checked_out_sale(client)
    url = f"{BASE}/sales/{completed['saleId']}/receipt/email"
    headers = _auth_headers(client)
    assert client.post(url, headers=headers, json={"email": "not-an-email"}).status_code == 422
    assert sent_emails == []
    ok = client.post(url, headers=headers, json={"email": "accounts@example.com"})
    assert ok.status_code == 200
    assert sent_emails[0]["recipient_email"] == "accounts@example.com"


def test_email_receipt_needs_payments_manage_and_stays_in_its_tenant(client, sent_emails) -> None:
    _, completed = _checked_out_sale(client)
    url = f"{BASE}/sales/{completed['saleId']}/receipt/email"
    assert client.post(url, json={}).status_code in (401, 403)

    other_email, other_password = _create_other_tenant_owner(client)
    other = _auth_headers(client, other_email, other_password)
    # the other owner can't use this business's route...
    assert client.post(url, headers=other, json={}).status_code in (403, 404)
    # ...and can't reach this sale through their own business either
    leak = client.post(
        f"/api/v1/tenants/other-tenant/sales/{completed['saleId']}/receipt/email", headers=other, json={"email": "x@example.com"}
    )
    assert leak.status_code == 404
    assert client.get(f"/api/v1/tenants/other-tenant/sales/{completed['saleId']}/receipt", headers=other).status_code == 404
    assert sent_emails == []


def test_receipt_routes_need_sign_in(client) -> None:
    _, completed = _checked_out_sale(client)
    assert client.get(f"{BASE}/sales").status_code in (401, 403)
    assert client.get(f"{BASE}/sales/{completed['saleId']}/receipt").status_code in (401, 403)


# --- wallet history --------------------------------------------------------------------------


def test_wallet_history_lists_adjustments_and_the_balance(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    url = f"{BASE}/customers/{booking['customerId']}/wallet"
    assert client.get(url, headers=headers).json() == {
        "customerId": booking["customerId"],
        "balanceCents": 0,
        "transactions": [],
    }

    adjust = client.patch(
        f"{BASE}/customers/{booking['customerId']}",
        headers=headers,
        json={"walletAdjustmentCents": 2500, "walletAdjustmentNote": "Goodwill"},
    )
    assert adjust.status_code == 200, adjust.json()
    body = client.get(url, headers=headers).json()
    assert body["balanceCents"] == 2500
    [row] = body["transactions"]
    assert row["amountCents"] == 2500 and row["kind"] == "staff_adjustment" and row["notes"] == "Goodwill"
    assert row["actorName"]


def test_wallet_history_is_tenant_scoped(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    other_email, other_password = _create_other_tenant_owner(client)
    other = _auth_headers(client, other_email, other_password)
    assert client.get(f"{BASE}/customers/{booking['customerId']}/wallet", headers=other).status_code in (403, 404)
    assert (
        client.get(f"/api/v1/tenants/other-tenant/customers/{booking['customerId']}/wallet", headers=other).status_code == 404
    )
    assert client.get(f"{BASE}/customers/{booking['customerId']}/wallet").status_code in (401, 403)
