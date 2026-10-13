"""Card payments through Clover's card form: online deposits and balances,
staff phone orders, payment links, late payments and refunds."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from tests.test_clover_connection import BASE, _connect_via_oauth, _set_currency, _tenant_id
from tests.test_staff_booking_drafts import (
    TENANT,
    _audit_actions,
    _create_other_tenant_owner,
    _create_staff_draft,
    _create_staff_user,
    _deny_permission,
    _draft_body,
    _draft_row,
    _expire_draft,
    _login,
    _service,
    _slot,
)

TOKEN = "clv_good_card"


@pytest.fixture()
def studio(client, fake_clover):
    owner = _login(client)
    _set_currency(client, owner, "CAD")
    response = _connect_via_oauth(client, owner, fake_clover)
    assert response.status_code == 200, response.json()
    return owner


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _public_draft(client, email: str = "online.guest@example.com") -> dict:
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], slot, staff=False, customer={"name": "Online Guest", "email": email, "phone": "555-0111"}),
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _start_session(client, draft_id: str) -> dict:
    response = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions",
        json={
            "tenantSlug": TENANT,
            "bookingDraftId": draft_id,
            "kind": "deposit",
            "successUrl": f"/{TENANT}/book/{draft_id}/success",
            "cancelUrl": f"/{TENANT}/book/{draft_id}",
        },
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _charge(client, session_id: str, token: str = TOKEN, attempt: str = "attempt-0001"):
    return client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session_id}/card-charge",
        json={"sourceToken": token, "attemptId": attempt},
    )


def _payment_state(draft_id: str | None = None, payment_id: str | None = None) -> dict:
    async def _go():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment

        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            query = select(Payment).options(selectinload(Payment.events))
            if draft_id:
                query = query.where(Payment.booking_draft_id == draft_id)
            if payment_id:
                query = query.where(Payment.id == payment_id)
            payments = (await session.scalars(query.order_by(Payment.created_at))).all()
            payment = payments[-1]
            return {
                "id": payment.id,
                "status": payment.status,
                "kind": payment.checkout_session_kind,
                "processor": payment.processor,
                "channel": payment.processor_channel,
                "merchant": payment.processor_merchant_id,
                "charge_id": payment.processor_payment_id,
                "brand": payment.card_brand,
                "last4": payment.card_last4,
                "amount": payment.amount_cents,
                "tip": payment.tip_cents,
                "currency": payment.currency,
                "events": [event.kind for event in payment.events],
                "count": len(payments),
            }

    return asyncio.run(_go())


async def _expire_draft_now(draft_id: str) -> None:
    """Async twin of _expire_draft, for hooks that run inside the app's event loop."""
    from sqlalchemy import select

    from app.db.models import BookingDraft, SlotHold
    from app.db.session import get_session_maker

    past = datetime.now(timezone.utc) - timedelta(minutes=1)
    async with get_session_maker()() as session:
        draft = await session.scalar(select(BookingDraft).where(BookingDraft.id == draft_id))
        draft.expires_at = past
        hold = await session.scalar(select(SlotHold).where(SlotHold.booking_draft_id == draft_id))
        if hold is not None:
            hold.expires_at = past
        await session.commit()


async def _release_now(draft_id: str) -> None:
    from sqlalchemy import select

    from app.db.models import User
    from app.db.session import get_session_maker
    from app.schemas.booking_drafts import ReleaseBookingDraftRequest
    from app.services.booking_drafts import release_booking_draft

    async with get_session_maker()() as session:
        owner = await session.scalar(select(User).where(User.email == "owner@browbeautylab.test"))
        await release_booking_draft(session, TENANT, draft_id, ReleaseBookingDraftRequest(), owner)


def _charge_requests(fake):
    return fake.calls("/v1/charges")


# ---------------------------------------------------------------------------
# Online deposit
# ---------------------------------------------------------------------------


def test_online_deposit_charges_clover_and_confirms_the_booking(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    assert f"/{TENANT}/book/{draft['id']}/payment?sessionId={session['sessionId']}" in session["checkoutUrl"]

    view = client.get(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session['sessionId']}")
    assert view.status_code == 200
    body = view.json()
    assert body["processor"] == "clover" and body["status"] == "pending" and body["kind"] == "deposit"
    assert body["amountCents"] == draft["depositCents"] and body["currency"] == "CAD"
    assert body["serviceName"] == "Signature Facial"
    assert "customer" not in str(body).lower() and "email" not in str(body).lower()

    response = _charge(client, session["sessionId"])
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed" and booking["depositStatus"] == "paid"
    assert booking["amountPaidCents"] == draft["depositCents"]

    # What we asked Clover for: exact amount, CAD, customer-keyed, idempotent, with the buyer's IP.
    request = _charge_requests(fake_clover)[0]
    assert request.body["amount"] == draft["depositCents"]
    assert request.body["currency"] == "cad"
    assert request.body["ecomind"] == "ecom"
    assert request.body["source"] == TOKEN
    assert request.headers["idempotency-key"].endswith(":attempt-0001")
    assert request.headers["x-forwarded-for"]
    assert request.body["metadata"]["tenant"] == TENANT

    state = _payment_state(draft_id=draft["id"])
    assert state["status"] == "succeeded"
    assert (state["processor"], state["channel"], state["merchant"]) == ("clover", "ecom", "MERCHANT1")
    assert state["charge_id"].startswith("CHG") and (state["brand"], state["last4"]) == ("VISA", "4242")
    assert state["currency"] == "CAD"
    assert {"charge_attempted", "charge_succeeded", "checkout_completed"} <= set(state["events"])

    # Paying again (double-click, back button) returns the booking and never charges twice.
    again = _charge(client, session["sessionId"])
    assert again.status_code == 200 and again.json()["id"] == booking["id"]
    assert len(fake_clover.charges) == 1

    # The page now reads as paid.
    assert client.get(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session['sessionId']}").json()["status"] == "succeeded"


def test_a_decline_can_be_retried_with_another_card(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])

    declined = _charge(client, session["sessionId"], token="clv_decline", attempt="attempt-0001")
    assert declined.status_code == 402
    assert declined.json()["error"]["code"] == "card_declined"
    state = _payment_state(draft_id=draft["id"])
    assert state["status"] == "pending" and "charge_declined" in state["events"]
    assert _draft_row(draft["id"])["status"] == "awaiting_payment"

    ok = _charge(client, session["sessionId"], attempt="attempt-0002")
    assert ok.status_code == 200, ok.json()
    assert len(fake_clover.charges) == 1


def test_five_declines_lock_the_payment(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    for index in range(5):
        assert _charge(client, session["sessionId"], token="clv_decline", attempt=f"attempt-000{index}").status_code == 402
    locked = _charge(client, session["sessionId"], attempt="attempt-0009")
    assert locked.status_code == 429
    assert locked.json()["error"]["code"] == "too_many_attempts"
    assert _payment_state(draft_id=draft["id"])["status"] == "canceled"
    assert len(fake_clover.charges) == 0


def test_a_timeout_is_retried_safely_without_double_charging(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    fake_clover.lose_next_charge_response = True  # Clover took the money; we never heard back

    first = _charge(client, session["sessionId"])
    assert first.status_code == 503
    assert first.json()["error"]["code"] == "payment_outcome_unknown"
    assert _payment_state(draft_id=draft["id"])["status"] == "processing"
    assert len(fake_clover.charges) == 1

    # A different attempt can't start while this one is unresolved.
    other = _charge(client, session["sessionId"], attempt="attempt-0002")
    assert other.status_code == 409 and other.json()["error"]["code"] == "payment_in_progress"

    # Retrying the SAME attempt replays the original charge: no second charge.
    retry = _charge(client, session["sessionId"])
    assert retry.status_code == 200, retry.json()
    assert retry.json()["status"] == "confirmed"
    assert len(fake_clover.charges) == 1
    assert len({r.headers["idempotency-key"] for r in _charge_requests(fake_clover)}) == 1


def test_a_server_error_from_clover_is_also_treated_as_unknown(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    fake_clover.charge_failures = ["server_error"]
    assert _charge(client, session["sessionId"]).status_code == 503
    assert _charge(client, session["sessionId"]).status_code == 200
    assert len(fake_clover.charges) == 1


def test_an_expired_hold_never_reaches_clover(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    _expire_draft(draft["id"])
    response = _charge(client, session["sessionId"])
    assert response.status_code == 409
    assert _charge_requests(fake_clover) == []
    view = client.get(f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session['sessionId']}").json()
    assert view["status"] == "expired"


def test_clover_must_be_connected_to_charge(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    client.post(f"{BASE}/clover/disconnect", headers=studio)
    response = _charge(client, session["sessionId"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "processor_not_connected"
    assert _payment_state(draft_id=draft["id"])["status"] == "pending"


def test_checkout_sessions_are_tenant_scoped(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    _create_other_tenant_owner(client)
    assert client.get(f"/api/v1/tenants/other-tenant/payments/checkout-sessions/{session['sessionId']}").status_code == 404
    assert (
        client.post(
            f"/api/v1/tenants/other-tenant/payments/checkout-sessions/{session['sessionId']}/card-charge",
            json={"sourceToken": TOKEN, "attemptId": "attempt-0001"},
        ).status_code
        == 404
    )
    assert len(fake_clover.charges) == 0


def test_the_card_form_endpoint_validates_its_input(client, fake_clover, studio) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    for body in (
        {"sourceToken": "", "attemptId": "attempt-0001"},
        {"sourceToken": TOKEN, "attemptId": "short"},
        {"sourceToken": TOKEN, "attemptId": "bad id with spaces!"},
        {"sourceToken": TOKEN},
    ):
        response = client.post(
            f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{session['sessionId']}/card-charge", json=body
        )
        assert response.status_code == 422, body


# ---------------------------------------------------------------------------
# Late payments
# ---------------------------------------------------------------------------


def test_payment_that_lands_just_past_the_hold_is_still_honoured(client, fake_clover, studio, monkeypatch) -> None:
    """The hold's time ran out while Clover was processing, but nothing else
    took the slot and the sweeper hasn't run: the client who paid gets the booking."""
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    from app.services import clover_charges

    original = clover_charges.clover_client.create_charge

    async def charge_then_run_out_of_time(*args, **kwargs):
        result = await original(*args, **kwargs)
        await _expire_draft_now(draft["id"])
        return result

    monkeypatch.setattr(clover_charges.clover_client, "create_charge", charge_then_run_out_of_time)
    response = _charge(client, session["sessionId"])
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "confirmed"
    assert len(fake_clover.refunds) == 0


def test_payment_after_the_sweeper_expired_the_draft_confirms_if_free(client, fake_clover, studio, monkeypatch) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    from app.services import clover_charges
    from app.services.slot_hold_cleanup import expire_lapsed_booking_drafts

    original = clover_charges.clover_client.create_charge

    async def charge_then_sweep(*args, **kwargs):
        result = await original(*args, **kwargs)
        await _expire_draft_now(draft["id"])
        assert await expire_lapsed_booking_drafts() == 1  # the sweeper wins the race
        return result

    monkeypatch.setattr(clover_charges.clover_client, "create_charge", charge_then_sweep)
    response = _charge(client, session["sessionId"])
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "confirmed"
    assert "late_payment_confirmed" in _payment_state(draft_id=draft["id"])["events"]
    assert len(fake_clover.refunds) == 0


def test_payment_after_expiry_is_refunded_when_the_slot_was_taken(client, fake_clover, studio, monkeypatch) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    from app.services import clover_charges
    from app.services.slot_hold_cleanup import expire_lapsed_booking_drafts

    original = clover_charges.clover_client.create_charge

    async def charge_then_sweep(*args, **kwargs):
        result = await original(*args, **kwargs)
        await _expire_draft_now(draft["id"])
        await expire_lapsed_booking_drafts()
        return result

    async def slot_taken(*_args, **_kwargs):
        return False

    monkeypatch.setattr(clover_charges.clover_client, "create_charge", charge_then_sweep)
    monkeypatch.setattr(clover_charges, "_reclaim_expired_slot", slot_taken)
    response = _charge(client, session["sessionId"])
    assert response.status_code == 409
    assert response.json()["error"]["code"] == "payment_refunded"
    assert "refunded" in response.json()["error"]["message"]

    state = _payment_state(draft_id=draft["id"])
    assert state["status"] == "refunded" and "late_payment_refunded" in state["events"]
    assert len(fake_clover.refunds) == 1 and fake_clover.refunds[0]["amount"] == draft["depositCents"]
    assert _draft_row(draft["id"])["status"] == "expired"  # never became a booking


def test_payment_for_a_released_hold_is_refunded(client, fake_clover, studio, monkeypatch) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    from app.services import clover_charges

    original = clover_charges.clover_client.create_charge

    async def charge_then_release(*args, **kwargs):
        result = await original(*args, **kwargs)
        await _release_now(draft["id"])
        return result

    monkeypatch.setattr(clover_charges.clover_client, "create_charge", charge_then_release)
    response = _charge(client, session["sessionId"])
    assert response.status_code == 409 and response.json()["error"]["code"] == "payment_refunded"
    assert len(fake_clover.refunds) == 1


def test_a_failed_automatic_refund_is_flagged_not_hidden(client, fake_clover, studio, monkeypatch) -> None:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    from app.services import clover_charges

    original = clover_charges.clover_client.create_charge

    async def charge_then_release(*args, **kwargs):
        result = await original(*args, **kwargs)
        await _release_now(draft["id"])
        return result

    monkeypatch.setattr(clover_charges.clover_client, "create_charge", charge_then_release)
    fake_clover.refund_fails = True
    response = _charge(client, session["sessionId"])
    assert response.status_code == 502
    assert "alerted" in response.json()["error"]["message"]
    state = _payment_state(draft_id=draft["id"])
    assert state["status"] == "processing" and "refund_failed" in state["events"]
    assert state["charge_id"]  # we still know exactly which charge needs refunding


# ---------------------------------------------------------------------------
# Staff phone orders
# ---------------------------------------------------------------------------


def _staff_charge(client, headers, draft_id: str, **body):
    payload = {"sourceToken": TOKEN, "attemptId": "staff-attempt-1", "amountMode": "deposit", **body}
    return client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft_id}/card-charge", headers=headers, json=payload)


def test_staff_take_a_card_over_the_phone_for_the_deposit(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio, notes="Phone booking")
    response = _staff_charge(client, studio, draft["id"])
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed" and booking["depositStatus"] == "paid"
    assert booking["notes"] == "Phone booking"

    request = _charge_requests(fake_clover)[0]
    assert request.body["ecomind"] == "moto" and request.body["amount"] == draft["depositCents"]
    state = _payment_state(draft_id=draft["id"])
    assert (state["processor"], state["channel"], state["status"]) == ("clover", "moto", "succeeded")
    assert state["kind"] == "deposit_in_person"
    assert {"charge_attempted", "charge_succeeded", "payment_recorded"} <= set(state["events"])

    replay = _staff_charge(client, studio, draft["id"])
    assert replay.status_code == 200 and replay.json()["id"] == booking["id"]
    assert len(fake_clover.charges) == 1


def test_staff_can_charge_the_full_amount_with_a_tip(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio)
    response = _staff_charge(client, studio, draft["id"], amountMode="full", tipCents=700)
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["paymentResolution"] == "collected" and booking["balanceDueCents"] == 0
    assert _charge_requests(fake_clover)[0].body["amount"] == draft["fullAmountCents"] + 700
    payment = booking["payments"][-1]
    assert payment["tipCents"] == 700 and payment["processorChannel"] == "moto"


def test_staff_card_validation_and_permissions(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio)
    assert _staff_charge(client, studio, draft["id"], tipCents=100).status_code == 422  # tip only on the full amount
    assert _staff_charge(client, studio, draft["id"], tipCents=-5).status_code == 422

    user_id = _create_staff_user(client, studio, "no.cards@browbeautylab.test")
    _deny_permission(client, studio, user_id, "bookings.collect_payment")
    staff = _login(client, "no.cards@browbeautylab.test", "TempPass123")
    assert _staff_charge(client, staff, draft["id"]).status_code == 403
    assert _staff_charge(client, _create_other_tenant_owner(client), draft["id"]).status_code == 403
    assert client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/card-charge", json={}).status_code == 401
    assert _charge_requests(fake_clover) == []


def test_staff_card_decline_keeps_the_hold(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio)
    declined = _staff_charge(client, studio, draft["id"], sourceToken="clv_decline")
    assert declined.status_code == 402
    assert _draft_row(draft["id"])["status"] == "slot_held"
    ok = _staff_charge(client, studio, draft["id"], attemptId="staff-attempt-2")
    assert ok.status_code == 200
    assert _payment_state(draft_id=draft["id"])["count"] == 1  # one row, however many tries


def test_staff_card_refuses_an_expired_hold_without_calling_clover(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio)
    _expire_draft(draft["id"])
    assert _staff_charge(client, studio, draft["id"]).status_code == 409
    assert _charge_requests(fake_clover) == []


def test_staff_settle_a_balance_by_card(client, fake_clover, studio) -> None:
    draft = _create_staff_draft(client, studio)
    booking = _staff_charge(client, studio, draft["id"]).json()
    assert booking["balanceDueCents"] > 0

    path = f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/card-charge"
    response = client.post(path, headers=studio, json={"sourceToken": TOKEN, "attemptId": "balance-attempt-1", "tipCents": 300})
    assert response.status_code == 200, response.json()
    paid = response.json()
    assert paid["balanceDueCents"] == 0 and paid["paymentResolution"] == "collected"
    request = _charge_requests(fake_clover)[-1]
    assert request.body["amount"] == booking["balanceDueCents"] + 300 and request.body["ecomind"] == "moto"

    nothing_left = client.post(path, headers=studio, json={"sourceToken": TOKEN, "attemptId": "balance-attempt-2"})
    assert nothing_left.status_code == 409
    assert _create_other_tenant_owner(client) and client.post(
        path, headers=_login(client, "owner@other-tenant.test", "OtherTenant123"), json={"sourceToken": TOKEN, "attemptId": "balance-attempt-3"}
    ).status_code == 403


# ---------------------------------------------------------------------------
# Payment link
# ---------------------------------------------------------------------------


@pytest.fixture()
def email_sent(monkeypatch):
    from app.services import booking_notifications
    from app.services.notifications import EmailDeliveryResult

    sent: list[dict] = []

    async def fake_send(**kwargs):
        sent.append(kwargs)
        return EmailDeliveryResult("resend", kwargs["recipient_email"], f"msg_{len(sent)}", datetime.now(timezone.utc))

    monkeypatch.setattr(booking_notifications, "_email_configured", lambda: True)
    monkeypatch.setattr(booking_notifications, "send_transactional_email", fake_send)
    return sent


def _send_link(client, headers, draft_id: str, **body):
    return client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft_id}/payment-link", headers=headers, json=body)


def test_payment_link_holds_the_slot_and_emails_the_client(client, fake_clover, studio, email_sent) -> None:
    draft = _create_staff_draft(client, studio)
    response = _send_link(client, studio, draft["id"], channels=["email"])
    assert response.status_code == 200, response.json()
    body = response.json()

    assert f"/{TENANT}/book/{draft['id']}/payment?sessionId=" in body["paymentUrl"]
    hold_expires = datetime.fromisoformat(body["holdExpiresAt"])
    minutes_left = (hold_expires - datetime.now(timezone.utc)).total_seconds() / 60
    assert 28 <= minutes_left <= 31  # paymentLinkExpiryMinutes defaults to 30
    assert body["bookingDraft"]["status"] == "awaiting_payment"
    assert [(d["channel"], d["status"]) for d in body["deliveries"]] == [("email", "sent")]

    assert len(email_sent) == 1
    assert email_sent[0]["recipient_email"] == "walk.in@example.com"
    assert body["paymentUrl"] in email_sent[0]["text_body"]
    assert f"${draft['depositCents'] / 100:,.2f}" in email_sent[0]["text_body"]
    assert any(action == "payment_link_sent" for action, _, _ in _audit_actions(draft["id"]))
    assert "payment_link_sent" in _payment_state(draft_id=draft["id"])["events"]

    # Resending reuses the same link and never extends the hold.
    again = _send_link(client, studio, draft["id"], channels=["email"])
    assert again.status_code == 200
    assert again.json()["paymentUrl"] == body["paymentUrl"]
    assert again.json()["holdExpiresAt"] == body["holdExpiresAt"]
    assert len(email_sent) == 2


def test_the_client_pays_through_the_link_and_forms_are_deferred(client, fake_clover, studio, email_sent) -> None:
    draft = _create_staff_draft(client, studio, service_name="Brow Shape and Tint")
    assert draft["status"] == "awaiting_form"  # has a pre-booking form
    link = _send_link(client, studio, draft["id"], channels=["email"])
    assert link.status_code == 200, link.json()
    session_id = link.json()["paymentUrl"].split("sessionId=")[1]

    response = _charge(client, session_id)
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed" and booking["bookingMethod"] == "staff_entered"
    assert booking["intakePlan"]["completionTiming"] == "before_visit"
    assert _payment_state(draft_id=draft["id"])["channel"] == "ecom"


def test_texting_needs_the_clients_ok(client, fake_clover, studio, email_sent) -> None:
    draft = _create_staff_draft(client, studio)
    refused = _send_link(client, studio, draft["id"], channels=["sms"])
    assert refused.status_code == 409 and "Texts need the client's OK" in refused.json()["error"]["message"]
    assert _draft_row(draft["id"])["status"] == "slot_held"

    # Staff confirm the client asked for it: recorded, and the text is attempted
    # (SMS isn't configured in tests, so it's reported as skipped, not silently dropped).
    ok = _send_link(client, studio, draft["id"], channels=["sms", "email"], smsConsentConfirmed=True)
    assert ok.status_code == 200, ok.json()
    results = {d["channel"]: d for d in ok.json()["deliveries"]}
    assert results["email"]["status"] == "sent"
    assert results["sms"]["status"] == "skipped" and "not configured" in results["sms"]["error"]
    assert any(action == "sms_consent_recorded" for action, _, _ in _audit_actions(ok.json()["bookingDraft"]["customerId"]))


def test_a_failing_channel_does_not_block_the_link(client, fake_clover, studio, monkeypatch) -> None:
    from app.core.http import api_exception
    from app.services import booking_notifications

    async def boom(**_kwargs):
        raise api_exception(502, "bad_gateway", "Email provider is down.")

    monkeypatch.setattr(booking_notifications, "_email_configured", lambda: True)
    monkeypatch.setattr(booking_notifications, "send_transactional_email", boom)
    draft = _create_staff_draft(client, studio)
    response = _send_link(client, studio, draft["id"], channels=["email"])
    assert response.status_code == 200
    assert response.json()["deliveries"][0] == {"channel": "email", "status": "failed", "recipient": "walk.in@example.com", "error": "Email provider is down."}
    assert response.json()["paymentUrl"]  # staff can still copy the link


def test_copy_only_link_sends_nothing(client, fake_clover, studio, email_sent) -> None:
    draft = _create_staff_draft(client, studio)
    response = _send_link(client, studio, draft["id"], channels=[])
    assert response.status_code == 200 and response.json()["deliveries"] == []
    assert email_sent == []


def test_payment_link_rules(client, fake_clover, studio, email_sent) -> None:
    draft = _create_staff_draft(client, studio)
    user_id = _create_staff_user(client, studio, "no.links@browbeautylab.test")
    _deny_permission(client, studio, user_id, "bookings.collect_payment")
    staff = _login(client, "no.links@browbeautylab.test", "TempPass123")
    assert _send_link(client, staff, draft["id"], channels=["email"]).status_code == 403
    assert _send_link(client, _create_other_tenant_owner(client), draft["id"], channels=["email"]).status_code == 403
    assert client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/payment-link", json={}).status_code == 401

    _expire_draft(draft["id"])
    assert _send_link(client, studio, draft["id"], channels=["email"]).status_code == 409
    assert email_sent == []


def test_no_payment_link_for_a_service_without_a_deposit(client, fake_clover, studio, email_sent) -> None:
    service = _service(client, "Signature Facial")
    client.patch(f"/api/v1/tenants/{TENANT}/services/{service['id']}", headers=studio, json={"bookingPaymentMode": "none"})
    draft = _create_staff_draft(client, studio)
    response = _send_link(client, studio, draft["id"], channels=["email"])
    assert response.status_code == 409 and "no deposit" in response.json()["error"]["message"]


def test_the_hold_follows_the_payment_link_setting(client, fake_clover, studio, email_sent) -> None:
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=studio, json={"paymentLinkExpiryMinutes": 90})
    draft = _create_staff_draft(client, studio)
    body = _send_link(client, studio, draft["id"], channels=[]).json()
    minutes_left = (datetime.fromisoformat(body["holdExpiresAt"]) - datetime.now(timezone.utc)).total_seconds() / 60
    assert 88 <= minutes_left <= 91


# ---------------------------------------------------------------------------
# Calendar list of held slots
# ---------------------------------------------------------------------------


def _list_drafts(client, headers, start: str = "2000-01-01T00:00:00Z", end: str = "2100-01-01T00:00:00Z"):
    return client.get(f"/api/v1/tenants/{TENANT}/booking-drafts", headers=headers, params={"startsAtGte": start, "startsAtLte": end})


def test_calendar_lists_staff_holds_and_awaiting_payment_drafts(client, fake_clover, studio) -> None:
    staff_draft = _create_staff_draft(client, studio)
    online_browsing = _public_draft(client, email="browsing@example.com")
    online_paying = _public_draft(client, email="paying@example.com")  # different slot? same service/slot -> conflict avoided below
    del online_paying

    ids = {item["id"] for item in _list_drafts(client, studio).json()["items"]}
    assert staff_draft["id"] in ids
    assert online_browsing["id"] not in ids  # still filling in the form: not shown

    _start_session(client, online_browsing["id"])  # now at the payment page
    ids = {item["id"] for item in _list_drafts(client, studio).json()["items"]}
    assert {staff_draft["id"], online_browsing["id"]} <= ids

    item = next(i for i in _list_drafts(client, studio).json()["items"] if i["id"] == staff_draft["id"])
    assert item["customer"]["name"] == "Walk In Client" and item["depositCents"] > 0


def test_calendar_list_hides_finished_expired_and_out_of_range_drafts(client, fake_clover, studio) -> None:
    confirmed = _create_staff_draft(client, studio)
    _staff_charge(client, studio, confirmed["id"])
    released = _create_staff_draft(client, studio, service_name="Brow Shape and Tint")
    client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{released['id']}/release", headers=studio, json={})
    lapsed = _create_staff_draft(client, studio, service_name="Signature Facial")
    _expire_draft(lapsed["id"])

    ids = {item["id"] for item in _list_drafts(client, studio).json()["items"]}
    assert not ({confirmed["id"], released["id"], lapsed["id"]} & ids)

    live = _create_staff_draft(client, studio, service_name="Brow Shape and Tint")
    assert live["id"] in {i["id"] for i in _list_drafts(client, studio).json()["items"]}
    assert _list_drafts(client, studio, start="2000-01-01T00:00:00Z", end="2000-01-02T00:00:00Z").json()["items"] == []


def test_calendar_list_permissions_and_tenant(client, fake_clover, studio) -> None:
    assert _list_drafts(client, studio).status_code == 200
    assert client.get(f"/api/v1/tenants/{TENANT}/booking-drafts", params={"startsAtGte": "2000-01-01T00:00:00Z", "startsAtLte": "2100-01-01T00:00:00Z"}).status_code == 401
    assert _list_drafts(client, _create_other_tenant_owner(client)).status_code == 403
    assert client.get(f"/api/v1/tenants/{TENANT}/booking-drafts", headers=studio).status_code == 422  # range required


# ---------------------------------------------------------------------------
# Refunds
# ---------------------------------------------------------------------------


def _paid_online_booking(client) -> dict:
    draft = _public_draft(client)
    session = _start_session(client, draft["id"])
    response = _charge(client, session["sessionId"])
    assert response.status_code == 200, response.json()
    return response.json()


def test_canceling_refunds_the_card_through_clover(client, fake_clover, studio) -> None:
    booking = _paid_online_booking(client)
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=studio, json={"refundInsideWindow": True})
    response = client.post(f"/api/v1/bookings/manage/{booking['customerManageToken']}/cancel", json={"reason": "Plans changed"})
    assert response.status_code == 200, response.json()
    assert response.json()["booking"]["status"] == "canceled"
    assert response.json()["booking"]["depositStatus"] == "refunded"

    assert len(fake_clover.refunds) == 1
    refund_request = fake_clover.calls("/v1/refunds")[0]
    assert refund_request.body["charge"].startswith("CHG") and refund_request.body["amount"] == booking["amountPaidCents"]
    state = _payment_state(payment_id=booking["payments"][-1]["id"])
    assert state["status"] == "refunded" and "refund_processed" in state["events"]
    assert response.json()["booking"]["customer"]["walletBalanceCents"] == 0  # not wallet credit


def test_a_clover_refund_error_aborts_the_cancellation(client, fake_clover, studio) -> None:
    booking = _paid_online_booking(client)
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=studio, json={"refundInsideWindow": True})
    fake_clover.refund_fails = True
    response = client.post(f"/api/v1/bookings/manage/{booking['customerManageToken']}/cancel", json={})
    assert response.status_code == 502
    after = client.get(f"/api/v1/bookings/manage/{booking['customerManageToken']}").json()
    assert after["booking"]["status"] == "confirmed"  # still booked: nothing was half-done
    assert after["booking"]["customer"]["walletBalanceCents"] == 0


def test_staff_refund_goes_through_clover_and_needs_the_refund_permission(client, fake_clover, studio) -> None:
    booking = _paid_online_booking(client)
    payment_id = booking["payments"][-1]["id"]
    path = f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/{payment_id}/refund"

    user_id = _create_staff_user(client, studio, "collect.only@browbeautylab.test")
    _deny_permission(client, studio, user_id, "payments.manage")
    collector = _login(client, "collect.only@browbeautylab.test", "TempPass123")
    assert client.post(path, headers=collector, json={}).status_code == 403
    assert fake_clover.refunds == []

    partial = client.post(path, headers=studio, json={"amountCents": 1000, "reason": "Goodwill"})
    assert partial.status_code == 200, partial.json()
    assert fake_clover.calls("/v1/refunds")[0].body["amount"] == 1000
    state = _payment_state(payment_id=payment_id)
    assert state["status"] == "succeeded" and "refund_processed" in state["events"]  # partial: payment stays

    full = client.post(path, headers=studio, json={})
    assert full.status_code == 200
    assert _payment_state(payment_id=payment_id)["status"] == "refunded"


def test_a_refund_for_another_clover_account_is_refused(client, fake_clover, studio) -> None:
    booking = _paid_online_booking(client)
    payment_id = booking["payments"][-1]["id"]

    async def _change_merchant():
        from sqlalchemy import select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            payment = await session.scalar(select(Payment).where(Payment.id == payment_id))
            payment.processor_merchant_id = "SOME_OTHER_MERCHANT"
            await session.commit()

    asyncio.run(_change_merchant())
    response = client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/{payment_id}/refund", headers=studio, json={}
    )
    assert response.status_code == 409
    assert "different Clover account" in response.json()["error"]["message"]
    assert fake_clover.refunds == []
