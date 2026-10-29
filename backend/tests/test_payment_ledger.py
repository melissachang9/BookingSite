import asyncio

from tests.test_booking_operations import (
    _auth_headers,
    _confirm_paid_deposit_booking,
    _create_other_tenant_owner,
)

TENANT = "brow-beauty-lab"
BASE = f"/api/v1/tenants/{TENANT}"


def _transactions(client, **params) -> dict:
    response = client.get(f"{BASE}/payments/transactions", headers=_auth_headers(client), params=params)
    assert response.status_code == 200, response.json()
    return response.json()


def _liabilities(client) -> dict:
    response = client.get(f"{BASE}/payments/liabilities", headers=_auth_headers(client))
    assert response.status_code == 200, response.json()
    return response.json()


def _complete(client, booking: dict, **extra) -> dict:
    response = client.post(
        f"{BASE}/bookings/{booking['id']}/status",
        headers=_auth_headers(client),
        json={"status": "completed", "paymentResolution": "follow_up", **extra},
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _deposit_cents(booking: dict) -> int:
    return booking["depositCents"]


# --- transactions ----------------------------------------------------------------------------


def test_deposit_shows_as_collected_money(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    rows = _transactions(client)["transactions"]
    deposit = next(r for r in rows if r["bookingId"] == booking["id"] and r["type"] == "deposit_collected")
    assert deposit["amountCents"] == _deposit_cents(booking) > 0
    assert deposit["cashCents"] == deposit["amountCents"]
    assert deposit["customerName"] == "Completion Queue Guest"


def test_completing_the_visit_redeems_the_deposit_on_the_sale(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    completed = _complete(client, booking)
    rows = _transactions(client)["transactions"]
    redeemed = next(r for r in rows if r["bookingId"] is None and r["type"] == "deposit_redeemed")
    assert redeemed["saleNumber"] == completed["saleNumber"]
    assert redeemed["amountCents"] == _deposit_cents(booking)
    assert redeemed["cashCents"] == 0  # no new money moved; it was already counted when collected
    # the original deposit row now points at the sale it was applied to
    collected = next(r for r in rows if r["bookingId"] == booking["id"] and r["type"] == "deposit_collected")
    assert collected["saleNumber"] == completed["saleNumber"]


def test_transaction_filters_and_validation(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    only_deposits = _transactions(client, type="deposit_collected")
    assert only_deposits["total"] >= 1
    assert {r["type"] for r in only_deposits["transactions"]} == {"deposit_collected"}

    assert _transactions(client, customerId="no-such-customer")["total"] == 0
    assert _transactions(client, limit=1)["transactions"].__len__() == 1

    response = client.get(
        f"{BASE}/payments/transactions", headers=_auth_headers(client), params={"type": "bogus"}
    )
    assert response.status_code == 422
    assert booking["id"]


def test_partial_refund_keeps_the_original_amount_and_adds_a_refund_row(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=headers).json()
    payment_id = detail["payments"][0]["id"]
    refund = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/{payment_id}/refund",
        headers=headers,
        json={"amountCents": 500, "reason": "Goodwill"},
    )
    assert refund.status_code == 200, refund.json()

    rows = _transactions(client)["transactions"]
    collected = next(r for r in rows if r["paymentId"] == payment_id and r["type"] == "deposit_collected")
    refunds = [r for r in rows if r["paymentId"] == payment_id and r["type"] == "refund"]
    assert collected["amountCents"] == _deposit_cents(booking)  # what was received, not what is left
    assert len(refunds) == 1
    assert refunds[0]["amountCents"] == 500
    assert refunds[0]["cashCents"] == -500

    # a second refund is another row; nothing is edited away
    second = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/{payment_id}/refund",
        headers=headers,
        json={"amountCents": 300},
    )
    assert second.status_code == 200, second.json()
    refunds = [r for r in _transactions(client)["transactions"] if r["paymentId"] == payment_id and r["type"] == "refund"]
    assert sorted(r["amountCents"] for r in refunds) == [300, 500]


def test_wallet_payment_and_its_refund_move_no_cash(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    credit = client.patch(
        f"{BASE}/customers/{booking['customerId']}", headers=headers, json={"walletAdjustmentCents": 5000}
    )
    assert credit.status_code == 200, credit.json()
    paid = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/wallet-credit", headers=headers, json={"amountCents": 2000}
    )
    assert paid.status_code == 200, paid.json()

    rows = _transactions(client, customerId=booking["customerId"])["transactions"]
    wallet_payment = next(r for r in rows if r["type"] == "payment" and r["method"] == "wallet")
    assert wallet_payment["amountCents"] == 2000
    assert wallet_payment["cashCents"] == 0  # credit already held; nothing new came in

    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=headers).json()
    wallet_payment_id = next(p["id"] for p in detail["payments"] if p["paymentMethodType"] == "wallet")
    refund = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/{wallet_payment_id}/refund", headers=headers, json={}
    )
    assert refund.status_code == 200, refund.json()
    rows = _transactions(client, customerId=booking["customerId"])["transactions"]
    returned = next(r for r in rows if r["type"] == "refund" and r["paymentId"] == wallet_payment_id)
    assert returned["amountCents"] == 2000
    assert returned["cashCents"] == 0  # went back to the wallet, not to the client


# --- money held ------------------------------------------------------------------------------


def test_deposit_is_held_until_checkout_then_redeemed(client) -> None:
    before = _liabilities(client)["deposits"]
    booking = _confirm_paid_deposit_booking(client)["booking"]
    deposit = _deposit_cents(booking)

    held = _liabilities(client)["deposits"]
    assert held["closingCents"] == before["closingCents"] + deposit
    assert held["collectedCents"] == before["collectedCents"] + deposit

    _complete(client, booking)
    after = _liabilities(client)["deposits"]
    assert after["redeemedCents"] == before["redeemedCents"] + deposit
    assert after["closingCents"] == before["closingCents"]  # held money used up at checkout


def test_liability_period_has_opening_and_closing_balance(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    deposit = _deposit_cents(booking)
    response = client.get(
        f"{BASE}/payments/liabilities",
        headers=_auth_headers(client),
        params={"occurredFrom": "2999-01-01T00:00:00Z"},
    )
    body = response.json()["deposits"]
    assert body["openingCents"] >= deposit  # everything collected before the period is carried in
    assert body["collectedCents"] == 0
    assert body["closingCents"] == body["openingCents"]


def test_cancelled_booking_deposit_moves_out_of_held_money(client) -> None:
    before = _liabilities(client)["deposits"]
    booking = _confirm_paid_deposit_booking(client)["booking"]
    cancel = client.post(f"{BASE}/bookings/{booking['id']}/cancel", headers=_auth_headers(client), json={"reason": "x"})
    assert cancel.status_code == 200, cancel.json()
    after = _liabilities(client)["deposits"]
    left_held = (
        after["refundedCents"] - before["refundedCents"]
        + after["movedToWalletCents"] - before["movedToWalletCents"]
        + after["forfeitedCents"] - before["forfeitedCents"]
    )
    assert left_held == _deposit_cents(booking)
    assert after["closingCents"] == before["closingCents"]


# --- money owed ------------------------------------------------------------------------------


def test_completed_visit_with_balance_is_listed_as_money_owed(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    completed = _complete(client, booking)
    response = client.get(f"{BASE}/payments/money-owed", headers=_auth_headers(client))
    assert response.status_code == 200, response.json()
    body = response.json()
    item = next(b for b in body["balancesOwed"] if b["bookingId"] == booking["id"])
    assert item["saleNumber"] == completed["saleNumber"]
    assert item["balanceDueCents"] == completed["balanceDueCents"] > 0
    assert body["balancesOwedTotalCents"] >= item["balanceDueCents"]


# --- permissions and tenant isolation --------------------------------------------------------


def test_ledger_routes_require_sign_in_and_stay_in_their_tenant(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    for path in ("transactions", "liabilities", "money-owed"):
        assert client.get(f"{BASE}/payments/{path}").status_code in (401, 403)

    other_email, other_password = _create_other_tenant_owner(client)
    other = _auth_headers(client, other_email, other_password)
    for path in ("transactions", "liabilities", "money-owed"):
        assert client.get(f"{BASE}/payments/{path}", headers=other).status_code in (403, 404)

    assert booking['id']


# --- group checkout --------------------------------------------------------------------------


def test_group_checkout_makes_one_sale_for_two_visits(client) -> None:
    first = _confirm_paid_deposit_booking(client)["booking"]
    second = _confirm_paid_deposit_booking(client)["booking"]
    response = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=_auth_headers(client),
        json={
            "items": [
                {"bookingId": first["id"], "paymentResolution": "follow_up"},
                {"bookingId": second["id"], "paymentResolution": "follow_up"},
            ]
        },
    )
    assert response.status_code == 200, response.json()
    body = response.json()
    assert len(body["bookings"]) == 2
    assert {b["saleNumber"] for b in body["bookings"]} == {body["saleNumber"]}
    assert {b["status"] for b in body["bookings"]} == {"completed"}

    rows = _sale_rows(body["saleId"])
    assert len(rows["lines"]) == 2
    assert rows["sale"]["subtotal"] == first["priceCents"] + second["priceCents"]
    assert len(rows["tenders"]) == 2
    assert {t[0] for t in rows["tenders"]} == {"deposit"}


def test_group_checkout_is_all_or_nothing(client) -> None:
    first = _confirm_paid_deposit_booking(client)["booking"]
    second = _confirm_paid_deposit_booking(client)["booking"]
    client.post(f"{BASE}/bookings/{second['id']}/cancel", headers=_auth_headers(client), json={"reason": "x"})
    response = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=_auth_headers(client),
        json={"items": [{"bookingId": first["id"], "paymentResolution": "follow_up"}, {"bookingId": second["id"]}]},
    )
    assert response.status_code == 409
    untouched = client.get(f"{BASE}/bookings/{first['id']}", headers=_auth_headers(client)).json()
    assert untouched["status"] == "confirmed"
    assert untouched.get("saleNumber") is None


def test_group_checkout_rejects_duplicates_and_bad_tip_split(client) -> None:
    first = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    duplicate = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=headers,
        json={"items": [{"bookingId": first["id"]}, {"bookingId": first["id"]}]},
    )
    assert duplicate.status_code == 409


def test_group_checkout_splits_the_tip_between_providers(client) -> None:
    first = _confirm_paid_deposit_booking(client)["booking"]
    second = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    # tip left with the payment on the first visit
    paid = client.post(
        f"{BASE}/bookings/{first['id']}/payments/manual",
        headers=headers,
        json={"amountCents": first["balanceDueCents"] + 1000, "tipCents": 1000, "paymentMethodType": "cash"},
    )
    assert paid.status_code == 200, paid.json()
    provider_a, provider_b = first["providerId"], second["providerId"]
    items = [
        {"bookingId": first["id"]},  # paid in full with the tip
        {"bookingId": second["id"], "paymentResolution": "follow_up"},
    ]

    wrong_total = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=headers,
        json={"items": items, "tipSplit": [{"providerId": provider_a, "amountCents": 100}]},
    )
    assert wrong_total.status_code == 409
    stranger = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=headers,
        json={"items": items, "tipSplit": [{"providerId": "not-on-this-sale", "amountCents": 1000}]},
    )
    assert stranger.status_code == 409

    ok = client.post(
        f"{BASE}/bookings/group-checkout",
        headers=headers,
        json={"items": items, "tipSplit": [{"providerId": provider_a, "amountCents": 1000}]},
    )
    assert ok.status_code == 200, ok.json()
    rows = _sale_rows(ok.json()["saleId"])
    assert rows["sale"]["tip"] == 1000
    assert rows["tips"] == [(provider_a, 1000)]
    assert provider_b  # second provider exists on the sale but received no share


def _sale_rows(sale_id: str) -> dict:
    async def _go():
        from sqlalchemy import select

        from app.db.models import Sale, SaleLine, SaleTender, SaleTip
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            sale = await session.get(Sale, sale_id)
            lines = (await session.scalars(select(SaleLine).where(SaleLine.sale_id == sale_id))).all()
            tenders = (await session.scalars(select(SaleTender).where(SaleTender.sale_id == sale_id))).all()
            tips = (await session.scalars(select(SaleTip).where(SaleTip.sale_id == sale_id))).all()
            return {
                "sale": {"subtotal": sale.subtotal_cents, "tip": sale.tip_cents, "total": sale.total_cents},
                "lines": [(l.kind, l.booking_id) for l in lines],
                "tenders": [(t.kind, t.amount_cents) for t in tenders],
                "tips": [(t.provider_id, t.amount_cents) for t in tips],
            }

    return asyncio.run(_go())


def test_staff_wallet_adjustment_is_recorded_against_the_staff_member(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    before = _liabilities(client)["wallet"]
    response = client.patch(
        f"{BASE}/customers/{booking['customerId']}",
        headers=_auth_headers(client),
        json={"walletAdjustmentCents": 1500, "walletAdjustmentNote": "Goodwill credit"},
    )
    assert response.status_code == 200, response.json()
    assert response.json()["customer"]["walletBalanceCents"] == 1500

    after = _liabilities(client)["wallet"]
    assert after["addedCents"] == before["addedCents"] + 1500
    assert after["closingCents"] == before["closingCents"] + 1500


# --- the details column ----------------------------------------------------------------------


def _set_card(payment_id: str, brand: str, last4: str) -> None:
    async def _go():
        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.get(Payment, payment_id)
            payment.card_brand, payment.card_last4 = brand, last4
            await session.commit()

    asyncio.run(_go())


def _row(client, payment_id: str, type_: str) -> dict:
    rows = _transactions(client, limit=200)["transactions"]
    return next(r for r in rows if r["paymentId"] == payment_id and r["type"] == type_)


def test_online_deposit_details_say_paid_online_with_the_card(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=_auth_headers(client)).json()
    payment_id = detail["payments"][0]["id"]
    assert _row(client, payment_id, "deposit_collected")["notes"] == "Paid online"

    _set_card(payment_id, "Visa", "4242")
    assert _row(client, payment_id, "deposit_collected")["notes"] == "Visa ending 4242 · Paid online"


def test_manual_payment_details_show_the_note_reference_and_who_recorded_it(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    paid = client.post(
        f"{BASE}/bookings/{booking['id']}/payments/manual",
        headers=headers,
        json={
            "amountCents": booking["balanceDueCents"],
            "paymentMethodType": "external_pos",
            "externalReference": "POS-1042",
            "notes": "Paid at front desk",
        },
    )
    assert paid.status_code == 200, paid.json()
    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=headers).json()
    manual_id = next(p["id"] for p in detail["payments"] if p["paymentMethodType"] == "external_pos")
    notes = _row(client, manual_id, "payment")["notes"]
    assert "Paid at front desk" in notes
    assert notes.count("POS-1042") == 1  # the reference is shown once, not repeated
    assert "Recorded by" in notes


def test_wallet_payment_details_say_wallet_credit(client) -> None:
    booking = _confirm_paid_deposit_booking(client)["booking"]
    headers = _auth_headers(client)
    client.patch(f"{BASE}/customers/{booking['customerId']}", headers=headers, json={"walletAdjustmentCents": 5000})
    client.post(f"{BASE}/bookings/{booking['id']}/payments/wallet-credit", headers=headers, json={"amountCents": 1000})
    detail = client.get(f"{BASE}/bookings/{booking['id']}", headers=headers).json()
    wallet_id = next(p["id"] for p in detail["payments"] if p["paymentMethodType"] == "wallet")
    assert "wallet" in (_row(client, wallet_id, "payment")["notes"] or "").lower()
