"""Matching payments taken on the Clover Flex to bookings."""

import asyncio

import pytest

from tests.test_clover_connection import BASE, _connect_via_oauth, _set_currency, _tenant_id
from tests.test_staff_booking_drafts import (
    TENANT,
    _audit_actions,
    _create_other_tenant_owner,
    _create_staff_draft,
    _create_staff_user,
    _deny_permission,
    _draft_row,
    _expire_draft,
    _login,
)


@pytest.fixture()
def clover_studio(client, fake_clover):
    """A business connected to Clover (CAD), plus its owner's auth headers."""
    from app.services.clover_payments import clear_device_payment_cache

    clear_device_payment_cache()
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    response = _connect_via_oauth(client, owner, fake_clover)
    assert response.status_code == 200, response.json()
    return owner


def _list(client, owner, **params):
    from app.services.clover_payments import clear_device_payment_cache

    clear_device_payment_cache()
    return client.get(f"{BASE}/clover/device-payments", headers=owner, params=params)


def _confirm(client, owner, draft_id: str, clover_payment_id: str, mode: str = "deposit", **extra):
    return client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts/{draft_id}/confirm-with-clover-payment",
        headers=owner,
        json={"cloverPaymentId": clover_payment_id, "amountMode": mode, **extra},
    )


def _payments_linked(clover_payment_id: str) -> int:
    async def _go():
        from sqlalchemy import func, select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            return await session.scalar(
                select(func.count()).select_from(Payment).where(Payment.processor_payment_id == clover_payment_id)
            )

    return asyncio.run(_go())


# ---------------------------------------------------------------------------
# Listing
# ---------------------------------------------------------------------------


def test_list_shows_only_usable_unlinked_payments_and_flags_matches(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    deposit, full = draft["depositCents"], draft["fullAmountCents"]
    match = fake_clover.add_device_payment(amount=deposit, tip=300)
    full_match = fake_clover.add_device_payment(amount=full, last4="1111")
    other = fake_clover.add_device_payment(amount=deposit + 777)
    fake_clover.add_device_payment(amount=deposit, result="FAIL")
    fake_clover.add_device_payment(amount=deposit, result="VOIDED")
    fake_clover.add_device_payment(amount=deposit, refunded=deposit)
    fake_clover.add_device_payment(amount=deposit, age_minutes=600)  # older than the window

    body = _list(client, owner, bookingDraftId=draft["id"], sinceMinutes=60).json()
    by_id = {item["id"]: item for item in body["items"]}
    assert set(by_id) == {match, full_match, other}
    assert by_id[match]["matches"] == "deposit" and by_id[match]["tipCents"] == 300
    assert by_id[match]["totalCents"] == deposit + 300
    assert by_id[match]["cardBrand"] == "VISA" and by_id[match]["cardLast4"] == "4242"
    assert by_id[full_match]["matches"] == "full"
    assert by_id[other]["matches"] is None

    # Once linked to a booking, a payment stops being offered.
    assert _confirm(client, owner, draft["id"], match).status_code == 200
    again = _list(client, owner, sinceMinutes=60).json()
    assert match not in {item["id"] for item in again["items"]}


def test_list_requires_permission_tenant_and_a_connection(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    user_id = _create_staff_user(client, owner, "no.collect@browbeautylab.test")
    _deny_permission(client, owner, user_id, "bookings.collect_payment")
    staff = _login(client, "no.collect@browbeautylab.test", "TempPass123")
    assert _list(client, staff).status_code == 403
    assert _list(client, _create_other_tenant_owner(client)).status_code == 403
    assert client.get(f"{BASE}/clover/device-payments").status_code == 401

    client.post(f"{BASE}/clover/disconnect", headers=owner)
    not_connected = _list(client, owner)
    assert not_connected.status_code == 409
    assert not_connected.json()["error"]["code"] == "processor_not_connected"


def test_list_polling_is_cached_briefly(client, fake_clover, clover_studio) -> None:
    from app.services.clover_payments import clear_device_payment_cache

    clear_device_payment_cache()
    fake_clover.add_device_payment(amount=5000)
    fake_clover.requests.clear()
    for _ in range(3):
        assert client.get(f"{BASE}/clover/device-payments", headers=clover_studio).status_code == 200
    assert len(fake_clover.calls(f"/v3/merchants/MERCHANT1/payments")) == 1


# ---------------------------------------------------------------------------
# Confirming a held draft
# ---------------------------------------------------------------------------


def test_confirm_with_clover_payment_links_it_and_records_the_tip(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner, notes="Paid on the Flex")
    pid = fake_clover.add_device_payment(amount=draft["depositCents"], tip=500, auth_code="AUTH99")

    response = _confirm(client, owner, draft["id"], pid, notes="front desk")
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed"
    assert booking["depositStatus"] == "paid"
    assert booking["amountPaidCents"] == draft["depositCents"]  # the tip isn't part of the visit
    payment = booking["payments"][-1]
    assert payment["processor"] == "clover" and payment["processorChannel"] == "device"
    assert payment["cardBrand"] == "VISA" and payment["cardLast4"] == "4242"
    assert payment["tipCents"] == 500 and payment["amountCents"] == draft["depositCents"] + 500
    assert payment["externalReference"] == "AUTH99"
    assert payment["paymentMethodType"] == "card"
    assert payment["checkoutSessionKind"] == "deposit_in_person"
    assert booking["notes"] == "Paid on the Flex"
    assert any(action == "confirmation_skipped" or action == "confirmation_sent" for action, _, _ in _audit_actions(booking["id"]))

    # Repeating the request returns the same booking and never double-links.
    replay = _confirm(client, owner, draft["id"], pid)
    assert replay.status_code == 200 and replay.json()["id"] == booking["id"]
    assert _payments_linked(pid) == 1


def test_confirm_in_full_mode_collects_the_visit(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["fullAmountCents"], tip=1000)
    response = _confirm(client, owner, draft["id"], pid, mode="full")
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["paymentResolution"] == "collected" and booking["depositStatus"] == "paid_in_full"
    assert booking["balanceDueCents"] == 0


@pytest.mark.parametrize(
    ("kwargs", "expected_status", "needle"),
    [
        ({"amount_delta": 1}, 409, "exactly"),
        ({"amount_delta": -1}, 409, "exactly"),
        ({"result": "FAIL"}, 409, "did not go through"),
        ({"result": "VOIDED"}, 409, "did not go through"),
        ({"refunded": 100}, 409, "refunded"),
    ],
)
def test_confirm_rejects_payments_that_dont_match(client, fake_clover, clover_studio, kwargs, expected_status, needle) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    kwargs = dict(kwargs)
    delta = kwargs.pop("amount_delta", 0)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"] + delta, **kwargs)
    response = _confirm(client, owner, draft["id"], pid)
    assert response.status_code == expected_status, response.json()
    assert needle in response.json()["error"]["message"]
    assert _draft_row(draft["id"])["status"] != "confirmed"
    assert _payments_linked(pid) == 0


def test_confirm_rejects_unknown_foreign_and_reused_payments(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    assert _confirm(client, owner, draft["id"], "NOPE").status_code == 404

    # A payment from a different Clover merchant is not visible to this business.
    fake_clover.add_merchant("OTHERMERCHANT")
    foreign = fake_clover.add_device_payment("OTHERMERCHANT", amount=draft["depositCents"])
    assert _confirm(client, owner, draft["id"], foreign).status_code == 404

    # One Clover payment can pay for only one booking.
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])
    assert _confirm(client, owner, draft["id"], pid).status_code == 200
    second = _create_staff_draft(client, owner, service_name="Signature Facial")
    reused = _confirm(client, owner, second["id"], pid)
    assert reused.status_code == 409
    assert "already linked" in reused.json()["error"]["message"]


def test_confirm_requires_an_active_hold_permission_and_tenant(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])

    user_id = _create_staff_user(client, owner, "cant.collect@browbeautylab.test")
    _deny_permission(client, owner, user_id, "bookings.collect_payment")
    staff = _login(client, "cant.collect@browbeautylab.test", "TempPass123")
    assert _confirm(client, staff, draft["id"], pid).status_code == 403
    assert _confirm(client, _create_other_tenant_owner(client), draft["id"], pid).status_code == 403

    _expire_draft(draft["id"])
    expired = _confirm(client, owner, draft["id"], pid)
    assert expired.status_code == 409
    assert _payments_linked(pid) == 0


def test_a_tip_on_the_flex_is_not_a_deposit_underpayment(client, fake_clover, clover_studio) -> None:
    """The amount before tip must match; the tip just rides on top."""
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    # Total looks like more than the deposit, but the visit part is exactly the deposit.
    pid = fake_clover.add_device_payment(amount=draft["depositCents"], tip=2500)
    assert _confirm(client, owner, draft["id"], pid).status_code == 200


# ---------------------------------------------------------------------------
# Balance at checkout
# ---------------------------------------------------------------------------


def _confirmed_booking_with_balance(client, fake_clover, owner) -> dict:
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])
    response = _confirm(client, owner, draft["id"], pid)
    assert response.status_code == 200, response.json()
    assert response.json()["balanceDueCents"] > 0
    return response.json()


def _link_balance(client, owner, booking_id: str, clover_payment_id: str):
    return client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking_id}/payments/clover-device",
        headers=owner,
        json={"cloverPaymentId": clover_payment_id},
    )


def test_balance_payment_from_the_flex_settles_the_booking(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    booking = _confirmed_booking_with_balance(client, fake_clover, owner)
    pid = fake_clover.add_device_payment(amount=booking["balanceDueCents"], tip=400, last4="9999")

    listed = _list(client, owner, bookingId=booking["id"]).json()["items"]
    assert [item["matches"] for item in listed if item["id"] == pid] == ["balance"]

    response = _link_balance(client, owner, booking["id"], pid)
    assert response.status_code == 200, response.json()
    paid = response.json()
    assert paid["balanceDueCents"] == 0 and paid["paymentResolution"] == "collected"
    assert any(p["cardLast4"] == "9999" and p["tipCents"] == 400 for p in paid["payments"])

    # Repeating is harmless; the payment is not linked twice.
    assert _link_balance(client, owner, booking["id"], pid).status_code == 200
    assert _payments_linked(pid) == 1


def test_balance_payment_must_match_exactly(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    booking = _confirmed_booking_with_balance(client, fake_clover, owner)
    short = fake_clover.add_device_payment(amount=booking["balanceDueCents"] - 100)
    over = fake_clover.add_device_payment(amount=booking["balanceDueCents"] + 100)
    for pid in (short, over):
        response = _link_balance(client, owner, booking["id"], pid)
        assert response.status_code == 409
        assert "balance is exactly" in response.json()["error"]["message"]
    other = _create_other_tenant_owner(client)
    assert _link_balance(client, other, booking["id"], short).status_code == 403


# ---------------------------------------------------------------------------
# Refunds done on the device
# ---------------------------------------------------------------------------


def _record_refund(client, owner, booking_id: str, payment_id: str):
    return client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking_id}/payments/{payment_id}/record-clover-refund",
        headers=owner,
    )


def test_recording_a_device_refund_is_exact_and_idempotent(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])
    booking = _confirm(client, owner, draft["id"], pid).json()
    payment_id = booking["payments"][-1]["id"]

    # Nothing refunded on Clover yet.
    refused = _record_refund(client, owner, booking["id"], payment_id)
    assert refused.status_code == 409
    assert "Refund it on the Clover device first" in refused.json()["error"]["message"]

    fake_clover.refund_device_payment(pid, draft["depositCents"])
    done = _record_refund(client, owner, booking["id"], payment_id)
    assert done.status_code == 200, done.json()
    assert done.json()["payments"] == [] or all(p["status"] == "refunded" for p in done.json()["payments"])

    again = _record_refund(client, owner, booking["id"], payment_id)
    assert again.status_code == 200  # up to date: no second refund recorded

    async def _refund_events():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(select(Payment).options(selectinload(Payment.events)).where(Payment.id == payment_id))
            return [event.kind for event in payment.events].count("refund_recorded")

    assert asyncio.run(_refund_events()) == 1


def test_recording_a_refund_needs_payments_manage(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])
    booking = _confirm(client, owner, draft["id"], pid).json()
    payment_id = booking["payments"][-1]["id"]
    user_id = _create_staff_user(client, owner, "no.refunds@browbeautylab.test")
    _deny_permission(client, owner, user_id, "payments.manage")
    staff = _login(client, "no.refunds@browbeautylab.test", "TempPass123")
    assert _record_refund(client, staff, booking["id"], payment_id).status_code == 403
    assert _record_refund(client, _create_other_tenant_owner(client), booking["id"], payment_id).status_code == 403


def test_canceling_a_device_paid_booking_flags_a_refund_instead_of_crediting_a_wallet(client, fake_clover, clover_studio) -> None:
    owner = clover_studio
    draft = _create_staff_draft(client, owner)
    pid = fake_clover.add_device_payment(amount=draft["depositCents"])
    booking = _confirm(client, owner, draft["id"], pid).json()

    # Move the cancellation outside the penalty window so the deposit is refundable.
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=owner, json={"refundInsideWindow": True})
    canceled = client.post(f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/cancel", headers=owner, json={})
    assert canceled.status_code == 200, canceled.json()
    body = canceled.json()
    assert body["status"] == "canceled"
    assert body["depositStatus"] == "follow_up" and body["paymentResolution"] == "follow_up"
    assert body["payments"][-1]["status"] == "succeeded"  # money is still with the studio
    assert body["customer"]["walletBalanceCents"] == 0

    async def _event_kinds():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(select(Payment).options(selectinload(Payment.events)).where(Payment.processor_payment_id == pid))
            return [event.kind for event in payment.events]

    assert "refund_owed" in asyncio.run(_event_kinds())

    # Staff refund it on the Flex, then record it.
    fake_clover.refund_device_payment(pid, draft["depositCents"])
    recorded = _record_refund(client, owner, booking["id"], body["payments"][-1]["id"])
    assert recorded.status_code == 200, recorded.json()
