"""Staff (calendar) booking drafts: auth, lifecycle, release, expiry sweep,
and confirming a held slot with an in-person / external POS payment."""

import asyncio
from datetime import datetime, timedelta, timezone

import pytest

TENANT = "brow-beauty-lab"
OWNER_EMAIL = "owner@browbeautylab.test"
OWNER_PASSWORD = "DemoBooking123"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _login(client, email: str = OWNER_EMAIL, password: str = OWNER_PASSWORD) -> dict[str, str]:
    response = client.post("/api/v1/auth/login", json={"email": email, "password": password})
    assert response.status_code == 200, response.json()
    return {"Authorization": f"Bearer {response.json()['accessToken']}"}


def _create_staff_user(client, headers, email: str) -> None:
    response = client.post(
        f"/api/v1/tenants/{TENANT}/users",
        headers=headers,
        json={"email": email, "name": "Front Desk", "role": "staff", "initialPassword": "TempPass123"},
    )
    assert response.status_code == 201, response.json()
    user_id = response.json()["id"]
    return user_id


def _deny_permission(client, owner_headers, user_id: str, key: str) -> None:
    response = client.put(
        f"/api/v1/tenants/{TENANT}/users/{user_id}/permissions",
        headers=owner_headers,
        json={"overrides": [{"key": key, "allowed": False}]},
    )
    assert response.status_code == 200, response.json()


def _create_other_tenant_owner(client) -> dict[str, str]:
    response = client.post(
        "/api/v1/tenants",
        json={
            "name": "Other Tenant Studio",
            "slug": "other-tenant",
            "timezone": "America/New_York",
            "locationName": "Second Studio",
            "ownerName": "Taylor Rowe",
            "ownerEmail": "owner@other-tenant.test",
            "ownerPassword": "OtherTenant123",
        },
    )
    assert response.status_code == 201, response.json()
    return _login(client, "owner@other-tenant.test", "OtherTenant123")


def _next_weekday(target_weekday: int) -> str:
    today = datetime.now(timezone.utc).date()
    days_ahead = (target_weekday - today.weekday()) % 7 or 7
    return (today + timedelta(days=days_ahead)).isoformat()


def _service(client, name: str) -> dict:
    services = client.get(f"/api/v1/tenants/{TENANT}/services").json()["services"]
    return next(service for service in services if service["name"] == name)


def _slot(client, service_id: str, weekday: int = 2, index: int = 0) -> dict:
    response = client.get(
        f"/api/v1/tenants/{TENANT}/availability",
        params={"serviceId": service_id, "date": _next_weekday(weekday)},
    )
    assert response.status_code == 200, response.json()
    slots = response.json()["slots"]
    assert len(slots) > index, "expected open slots for the test day"
    return slots[index]


def _draft_body(service_id: str, slot: dict, *, staff: bool = True, **extra) -> dict:
    body = {
        "tenantSlug": TENANT,
        "serviceId": service_id,
        "providerId": slot["providerId"],
        "locationId": slot["locationId"],
        "startsAt": slot["startAt"],
        "customer": {"name": "Walk In Client", "email": "walk.in@example.com", "phone": "555-0199"},
    }
    if staff:
        body["bookingMethod"] = "staff_entered"
    body.update(extra)
    return body


def _create_staff_draft(client, headers, service_name: str = "Signature Facial", **extra) -> dict:
    service = _service(client, service_name)
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        headers=headers,
        json=_draft_body(service["id"], slot, **extra),
    )
    assert response.status_code == 200, response.json()
    return response.json()


def _run(coro_fn):
    return asyncio.run(coro_fn())


def _draft_row(draft_id: str) -> dict:
    async def _go():
        from sqlalchemy import select

        from app.db.models import BookingDraft, Customer, SlotHold
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            draft = await session.scalar(select(BookingDraft).where(BookingDraft.id == draft_id))
            customer = await session.get(Customer, draft.customer_id) if draft.customer_id else None
            hold = await session.scalar(select(SlotHold).where(SlotHold.booking_draft_id == draft_id))
            return {
                "status": draft.status,
                "created_by_user_id": draft.created_by_user_id,
                "notes": draft.notes,
                "customer_source_channel": customer.source_channel if customer else None,
                "has_hold": hold is not None,
            }

    return _run(_go)


def _audit_actions(entity_id: str) -> list[tuple[str, str | None, str | None]]:
    async def _go():
        from sqlalchemy import select

        from app.db.models import AuditEvent
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            rows = (
                await session.scalars(
                    select(AuditEvent).where(AuditEvent.entity_id == entity_id).order_by(AuditEvent.created_at)
                )
            ).all()
            return [(row.action, row.actor_id, row.notes) for row in rows]

    return _run(_go)


def _expire_draft(draft_id: str) -> None:
    async def _go():
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

    _run(_go)


def _payments_for_draft(draft_id: str) -> list[dict]:
    async def _go():
        from sqlalchemy import select
        from sqlalchemy.orm import selectinload

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            rows = (
                await session.scalars(
                    select(Payment).options(selectinload(Payment.events)).where(Payment.booking_draft_id == draft_id)
                )
            ).all()
            return [{"status": p.status, "events": [e.kind for e in p.events]} for p in rows]

    return _run(_go)


def _sweep() -> int:
    from app.services.slot_hold_cleanup import expire_lapsed_booking_drafts

    return asyncio.run(expire_lapsed_booking_drafts())


def _confirm(client, headers, draft_id: str, **body) -> object:
    return client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts/{draft_id}/confirm-with-payment",
        headers=headers,
        json=body,
    )


# ---------------------------------------------------------------------------
# State machine (pure)
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("status", ["slot_held", "awaiting_form", "awaiting_payment"])
def test_active_drafts_can_expire_or_be_released(status: str) -> None:
    from app.services.state_machine import guard_transition

    guard_transition("booking_draft", "d1", status, "expired")
    guard_transition("booking_draft", "d1", status, "canceled")


def test_terminal_draft_states_are_locked_down() -> None:
    from fastapi import HTTPException

    from app.services.state_machine import guard_transition

    # Only the late-payment reconcile may confirm an expired draft, and staff
    # may close it out; nothing else moves it.
    guard_transition("booking_draft", "d1", "expired", "confirmed")
    guard_transition("booking_draft", "d1", "expired", "canceled")
    for target in ("slot_held", "awaiting_payment", "awaiting_form"):
        with pytest.raises(HTTPException):
            guard_transition("booking_draft", "d1", "expired", target)
    for target in ("confirmed", "slot_held", "expired"):
        with pytest.raises(HTTPException):
            guard_transition("booking_draft", "d1", "canceled", target)


# ---------------------------------------------------------------------------
# Staff draft creation
# ---------------------------------------------------------------------------


def test_staff_draft_requires_sign_in(client) -> None:
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(f"/api/v1/tenants/{TENANT}/booking-drafts", json=_draft_body(service["id"], slot))
    assert response.status_code == 401


def test_override_is_only_allowed_for_staff_drafts(client) -> None:
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], slot, staff=False, overrideAvailability=True),
    )
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_staff_draft_needs_create_booking_permission(client) -> None:
    owner = _login(client)
    user_id = _create_staff_user(client, owner, "no.booking@browbeautylab.test")
    _deny_permission(client, owner, user_id, "calendar.create_booking")
    staff = _login(client, "no.booking@browbeautylab.test", "TempPass123")

    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts", headers=staff, json=_draft_body(service["id"], slot)
    )
    assert response.status_code == 403


def test_staff_draft_rejects_users_from_another_business(client) -> None:
    other = _create_other_tenant_owner(client)
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts", headers=other, json=_draft_body(service["id"], slot)
    )
    assert response.status_code == 403


def test_staff_draft_records_creator_notes_and_source(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner, notes="  Prefers the quiet room  ")

    assert draft["bookingMethod"] == "staff_entered"
    # Staff notes are private: never in the (public) draft response.
    assert "notes" not in draft
    row = _draft_row(draft["id"])
    assert row["notes"] == "Prefers the quiet room"
    assert row["created_by_user_id"] is not None
    assert row["customer_source_channel"] == "staff_entered"
    assert any(action == "created_by_staff" for action, _, _ in _audit_actions(draft["id"]))


def test_online_draft_stays_anonymous(client) -> None:
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], slot, staff=False, notes="should be ignored"),
    )
    assert response.status_code == 200, response.json()
    assert response.json()["bookingMethod"] == "public_online"
    row = _draft_row(response.json()["id"])
    assert row["notes"] is None
    assert row["created_by_user_id"] is None


def test_draft_summary_includes_tax_and_full_amount(client) -> None:
    owner = _login(client)
    client.patch(f"/api/v1/tenants/{TENANT}/settings", headers=owner, json={"taxRatePercent": 13})
    draft = _create_staff_draft(client, owner)
    subtotal = draft["priceCents"] + draft["addOnsTotalCents"]
    assert draft["taxCents"] == round(subtotal * 0.13)
    assert draft["fullAmountCents"] == subtotal + draft["taxCents"]


# ---------------------------------------------------------------------------
# Release + expiry sweep
# ---------------------------------------------------------------------------


def test_release_frees_the_slot_and_is_attributed(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    assert _draft_row(draft["id"])["has_hold"] is True

    response = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/release",
        headers=owner,
        json={"reason": "Client changed their mind"},
    )
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "canceled"
    row = _draft_row(draft["id"])
    assert row["status"] == "canceled"
    assert row["has_hold"] is False
    audits = _audit_actions(draft["id"])
    released = [a for a in audits if a[0] == "released_by_staff"]
    assert released and released[0][1] is not None and released[0][2] == "Client changed their mind"

    # Releasing again is a no-op; confirming a released hold is refused.
    again = client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/release", headers=owner, json={})
    assert again.status_code == 200
    confirm = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert confirm.status_code == 409


def test_release_rejects_other_business_and_confirmed_drafts(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    other = _create_other_tenant_owner(client)
    cross = client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/release", headers=other, json={})
    assert cross.status_code == 403

    confirmed = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert confirmed.status_code == 200, confirmed.json()
    response = client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft['id']}/release", headers=owner, json={})
    assert response.status_code == 409


def test_sweeper_expires_lapsed_drafts_and_cancels_open_payments(client) -> None:
    service = _service(client, "Signature Facial")
    lapsed_slot = _slot(client, service["id"], index=0)
    slots = client.get(
        f"/api/v1/tenants/{TENANT}/availability",
        params={"serviceId": service["id"], "date": _next_weekday(2)},
    ).json()["slots"]
    # A second slot that doesn't overlap the first hold.
    active_slot = next(
        slot for slot in slots
        if slot["startAt"] >= lapsed_slot["endAt"] or slot["providerId"] != lapsed_slot["providerId"]
    )
    lapsed = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], lapsed_slot, staff=False),
    ).json()
    active = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], active_slot, staff=False),
    ).json()
    checkout = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions",
        json={
            "tenantSlug": TENANT,
            "bookingDraftId": lapsed["id"],
            "kind": "deposit",
            "successUrl": f"/{TENANT}/book/{lapsed['id']}/success",
            "cancelUrl": f"/{TENANT}/book/{lapsed['id']}",
        },
    )
    assert checkout.status_code == 200, checkout.json()
    _expire_draft(lapsed["id"])

    assert _sweep() == 1
    assert _draft_row(lapsed["id"])["status"] == "expired"
    assert _draft_row(active["id"])["status"] == "slot_held"
    payments = _payments_for_draft(lapsed["id"])
    assert payments and payments[0]["status"] == "canceled"
    assert "checkout_expired" in payments[0]["events"]

    # Idempotent: a second sweep changes nothing.
    assert _sweep() == 0
    assert _payments_for_draft(lapsed["id"])[0]["events"].count("checkout_expired") == 1

    # The expired draft can't be paid or confirmed any more.
    late = client.post(
        f"/api/v1/tenants/{TENANT}/payments/checkout-sessions/{checkout.json()['sessionId']}/complete",
        json={"tenantSlug": TENANT},
    )
    assert late.status_code in (404, 409)


def test_post_visit_forms_do_not_hold_up_a_draft(client) -> None:
    owner = _login(client)
    form = client.post(
        f"/api/v1/tenants/{TENANT}/forms",
        headers=owner,
        json={
            "name": "Aftercare check-in",
            "scope": "customer",
            "customerPromptTiming": "post_visit",
            "appliesToAllServices": True,
            "isActive": True,
            "schema": {"title": "Aftercare", "fields": [{"id": "ok", "type": "yes_no", "label": "All good?", "required": False}]},
        },
    )
    assert form.status_code == 201, form.json()
    service = _service(client, "Signature Facial")
    slot = _slot(client, service["id"])
    draft = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        json=_draft_body(service["id"], slot, staff=False),
    )
    assert draft.status_code == 200, draft.json()
    body = draft.json()
    assert any(req["customerPromptTiming"] == "post_visit" for req in body["formRequirements"])
    assert body["status"] == "slot_held"


# ---------------------------------------------------------------------------
# Walk-in: confirm with an in-person / external POS payment
# ---------------------------------------------------------------------------


def test_walk_in_deposit_on_external_pos_confirms_booking(client) -> None:
    owner = _login(client)
    client.patch(f"/api/v1/tenants/{TENANT}/business", headers=owner, json={"currency": "CAD"})
    draft = _create_staff_draft(client, owner, notes="Paid at front desk")

    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="external_pos",
        amountMode="deposit",
        amountCents=draft["depositCents"],
        externalReference="  APPR 004512 ",
    )
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed"
    assert booking["depositStatus"] == "paid"
    assert booking["paymentResolution"] == "pending"
    assert booking["notes"] == "Paid at front desk"
    payment = booking["payments"][-1]
    assert payment["paymentMethodType"] == "external_pos"
    assert payment["externalReference"] == "APPR 004512"
    assert payment["checkoutSessionKind"] == "deposit_in_person"
    assert booking["amountPaidCents"] == draft["depositCents"]

    async def _currency():
        from sqlalchemy import select

        from app.db.models import Payment
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            return await session.scalar(select(Payment.currency).where(Payment.id == payment["id"]))

    assert _run(_currency) == "CAD"

    # Replaying the same request returns the same booking (no double charge).
    replay = _confirm(
        client, owner, draft["id"],
        paymentMethodType="external_pos", amountMode="deposit",
        amountCents=draft["depositCents"], externalReference="APPR 004512",
    )
    assert replay.status_code == 200
    assert replay.json()["id"] == booking["id"]
    assert len(replay.json()["payments"]) == 1


def test_walk_in_full_payment_with_tip_marks_booking_collected(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    tip = 1500
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="external_pos",
        amountMode="full",
        amountCents=draft["fullAmountCents"] + tip,
        tipCents=tip,
        externalReference="4242",
    )
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["paymentResolution"] == "collected"
    assert booking["depositStatus"] == "paid_in_full"
    assert booking["balanceDueCents"] == 0
    assert booking["payments"][-1]["tipCents"] == tip


@pytest.mark.parametrize(
    ("body", "status"),
    [
        ({"paymentMethodType": "external_pos", "amountMode": "deposit"}, 422),  # no reference
        ({"paymentMethodType": "card", "amountMode": "deposit", "externalReference": "1"}, 422),
        ({"paymentMethodType": "bitcoin", "amountMode": "deposit", "externalReference": "1"}, 422),
        ({"paymentMethodType": "cash", "amountMode": "deposit", "tipCents": 100}, 422),
    ],
)
def test_walk_in_payment_validation(client, body: dict, status: int) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    amount = draft["depositCents"] + body.get("tipCents", 0)
    response = _confirm(client, owner, draft["id"], amountCents=amount, **body)
    assert response.status_code == status, response.json()
    assert _draft_row(draft["id"])["status"] != "confirmed"


def test_walk_in_payment_must_be_the_exact_amount(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    for amount in (draft["depositCents"] - 1, draft["depositCents"] + 1):
        response = _confirm(
            client, owner, draft["id"],
            paymentMethodType="external_pos", amountMode="deposit",
            amountCents=amount, externalReference="7788",
        )
        assert response.status_code == 409
        assert "exactly" in response.json()["error"]["message"]


def test_walk_in_defers_pre_booking_forms_to_before_the_visit(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner, service_name="Brow Shape and Tint")
    assert draft["status"] == "awaiting_form"
    amount_mode = "deposit" if draft["depositCents"] > 0 else "full"
    amount = draft["depositCents"] if amount_mode == "deposit" else draft["fullAmountCents"]
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode=amount_mode, amountCents=amount,
    )
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed"
    assert booking["intakePlan"]["completionTiming"] == "before_visit"


def test_walk_in_payment_refuses_an_expired_hold(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    _expire_draft(draft["id"])
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert response.status_code == 409


def test_walk_in_payment_needs_collect_payment_permission(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    user_id = _create_staff_user(client, owner, "no.payments@browbeautylab.test")
    _deny_permission(client, owner, user_id, "bookings.collect_payment")
    staff = _login(client, "no.payments@browbeautylab.test", "TempPass123")
    response = _confirm(
        client, staff, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert response.status_code == 403

    other = _create_other_tenant_owner(client)
    cross = _confirm(
        client, other, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert cross.status_code == 403


def test_confirmation_message_is_sent_and_recorded(client, monkeypatch) -> None:
    from app.services import booking_notifications
    from app.services.notifications import EmailDeliveryResult

    sent: list[dict] = []

    async def _fake_send(**kwargs):
        sent.append(kwargs)
        return EmailDeliveryResult(
            provider="resend",
            recipient_email=kwargs["recipient_email"],
            provider_message_id="msg_123",
            sent_at=datetime.now(timezone.utc),
        )

    monkeypatch.setattr(booking_notifications, "_email_configured", lambda: True)
    monkeypatch.setattr(booking_notifications, "send_transactional_email", _fake_send)

    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert response.status_code == 200, response.json()
    assert len(sent) == 1
    assert sent[0]["recipient_email"] == "walk.in@example.com"
    assert "confirmed" in sent[0]["subject"].lower()
    actions = [a for a, _, _ in _audit_actions(response.json()["id"])]
    assert "confirmation_sent" in actions
    assert "confirmation_skipped" in actions  # SMS: no consent on file


def test_confirmation_failure_does_not_undo_the_booking(client, monkeypatch) -> None:
    from app.core.http import api_exception
    from app.services import booking_notifications

    async def _boom(**kwargs):
        raise api_exception(502, "bad_gateway", "Email provider is down.")

    monkeypatch.setattr(booking_notifications, "_email_configured", lambda: True)
    monkeypatch.setattr(booking_notifications, "send_transactional_email", _boom)

    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert response.status_code == 200, response.json()
    assert response.json()["status"] == "confirmed"
    failed = [a for a in _audit_actions(response.json()["id"]) if a[0] == "confirmation_failed"]
    assert failed and failed[0][2] == "Email provider is down."


# ---------------------------------------------------------------------------
# Checkout: external POS balance must match exactly and carry a reference
# ---------------------------------------------------------------------------


def _confirmed_walk_in(client, owner) -> dict:
    draft = _create_staff_draft(client, owner)
    response = _confirm(
        client, owner, draft["id"],
        paymentMethodType="cash", amountMode="deposit", amountCents=draft["depositCents"],
    )
    assert response.status_code == 200, response.json()
    return response.json()


def test_checkout_external_pos_requires_reference(client) -> None:
    owner = _login(client)
    booking = _confirmed_walk_in(client, owner)
    response = client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/manual",
        headers=owner,
        json={"amountCents": booking["balanceDueCents"], "paymentMethodType": "external_pos"},
    )
    assert response.status_code == 422


def test_checkout_rejects_overpayment(client) -> None:
    owner = _login(client)
    booking = _confirmed_walk_in(client, owner)
    response = client.post(
        f"/api/v1/tenants/{TENANT}/bookings/{booking['id']}/payments/manual",
        headers=owner,
        json={
            "amountCents": booking["balanceDueCents"] + 100,
            "paymentMethodType": "external_pos",
            "externalReference": "9911",
        },
    )
    assert response.status_code == 409


# ---------------------------------------------------------------------------
# Services with no deposit: confirm without payment
# ---------------------------------------------------------------------------


def _no_deposit_service(client, owner) -> dict:
    """An existing bookable service switched to take no payment at booking."""
    service = _service(client, "Signature Facial")
    response = client.patch(
        f"/api/v1/tenants/{TENANT}/services/{service['id']}",
        headers=owner,
        json={"bookingPaymentMode": "none"},
    )
    assert response.status_code == 200, response.json()
    return service


def _confirm_without_payment(client, headers, draft_id: str):
    return client.post(f"/api/v1/tenants/{TENANT}/booking-drafts/{draft_id}/confirm-without-payment", headers=headers)


def test_no_deposit_service_confirms_without_payment_and_balance_stays_due(client) -> None:
    owner = _login(client)
    service = _no_deposit_service(client, owner)
    slot = _slot(client, service["id"])
    draft = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts",
        headers=owner,
        json=_draft_body(service["id"], slot),
    )
    assert draft.status_code == 200, draft.json()
    assert draft.json()["depositCents"] == 0

    response = _confirm_without_payment(client, owner, draft.json()["id"])
    assert response.status_code == 200, response.json()
    booking = response.json()
    assert booking["status"] == "confirmed"
    assert booking["depositStatus"] == "not_required"
    assert booking["paymentResolution"] == "pending"  # still paid for at checkout
    assert booking["balanceDueCents"] > 0 and booking["payments"] == []

    replay = _confirm_without_payment(client, owner, draft.json()["id"])
    assert replay.status_code == 200 and replay.json()["id"] == booking["id"]


def test_deposit_services_cannot_skip_payment(client) -> None:
    owner = _login(client)
    draft = _create_staff_draft(client, owner)
    assert draft["depositCents"] > 0
    response = _confirm_without_payment(client, owner, draft["id"])
    assert response.status_code == 409
    assert "requires a deposit" in response.json()["error"]["message"]
    assert _draft_row(draft["id"])["status"] != "confirmed"


def test_confirm_without_payment_needs_permission_and_tenant(client) -> None:
    owner = _login(client)
    service = _no_deposit_service(client, owner)
    slot = _slot(client, service["id"])
    draft = client.post(
        f"/api/v1/tenants/{TENANT}/booking-drafts", headers=owner, json=_draft_body(service["id"], slot)
    ).json()
    user_id = _create_staff_user(client, owner, "no.confirm@browbeautylab.test")
    _deny_permission(client, owner, user_id, "calendar.create_booking")
    staff = _login(client, "no.confirm@browbeautylab.test", "TempPass123")
    assert _confirm_without_payment(client, staff, draft["id"]).status_code == 403
    assert _confirm_without_payment(client, _create_other_tenant_owner(client), draft["id"]).status_code == 403
    assert _confirm_without_payment(client, owner, draft["id"]).status_code == 200
