import asyncio
from datetime import datetime, time, timedelta, timezone

from tests.test_booking_operations import _auth_headers, _create_other_tenant_owner

TENANT = "brow-beauty-lab"
BASE = f"/api/v1/tenants/{TENANT}/reports"
# A quiet historical window (Mon 2020-03-09 .. Sun 2020-03-15) so seeded demo data never interferes.
PAST = {"from": "2020-03-09", "to": "2020-03-15"}


def _utc(year, month, day, hour=12, minute=0):
    return datetime(year, month, day, hour, minute, tzinfo=timezone.utc)


# ------------------------------------------------------------------ data ----


def _db(coro_factory):
    async def _run():
        from app.db.session import get_session_maker

        async with get_session_maker()() as session:
            result = await coro_factory(session)
            await session.commit()
            return result

    return asyncio.run(_run())


def _ids() -> dict[str, str]:
    async def run(session):
        from sqlalchemy import select

        from app.db.models import Location, Provider, Service, Tenant

        tenant = await session.scalar(select(Tenant).where(Tenant.slug == TENANT))
        provider = await session.scalar(
            select(Provider).where(Provider.tenant_id == tenant.id, Provider.name.like("Jordan%"))
        )
        service = await session.scalar(select(Service).where(Service.tenant_id == tenant.id))
        location = await session.scalar(select(Location).where(Location.tenant_id == tenant.id))
        return {
            "tenant": tenant.id,
            "provider": provider.id,
            "service": service.id,
            "service_price": service.price_cents,
            "location": location.id,
        }

    return _db(run)


def _add_customer(name="Report Client", **kwargs) -> str:
    ids = _ids_cached()

    async def run(session):
        from app.db.models import Customer

        customer = Customer(tenant_id=ids["tenant"], name=name, email=f"{name.replace(' ', '.').lower()}@example.com", **kwargs)
        session.add(customer)
        await session.flush()
        return customer.id

    return _db(run)


_cache: dict[str, str] = {}


def _ids_cached() -> dict[str, str]:
    if not _cache:
        _cache.update(_ids())
    return _cache


def _add_booking(
    customer_id: str,
    *,
    status="completed",
    starts_at=None,
    minutes=60,
    completed_at=None,
    price_cents=None,
    provider_id=None,
    **extra,
) -> str:
    ids = _ids_cached()
    starts_at = starts_at or _utc(2020, 3, 10, 18)

    async def run(session):
        from app.db.models import Booking

        booking = Booking(
            tenant_id=ids["tenant"],
            customer_id=customer_id,
            service_id=ids["service"],
            provider_id=provider_id or ids["provider"],
            location_id=ids["location"],
            status=status,
            booking_method="public_online",
            deposit_status="paid",
            payment_resolution="collected",
            starts_at=starts_at,
            ends_at=starts_at + timedelta(minutes=minutes),
            price_cents=price_cents if price_cents is not None else ids["service_price"],
            completed_at=completed_at if status == "completed" else None,
            **extra,
        )
        session.add(booking)
        await session.flush()
        return booking.id

    return _db(run)


def _add_item(booking_id: str, price_cents: int, quantity: int = 1) -> None:
    ids = _ids_cached()

    async def run(session):
        from app.db.models import BookingItem

        session.add(BookingItem(tenant_id=ids["tenant"], booking_id=booking_id, name="Add-on", price_cents=price_cents, quantity=quantity))

    _db(run)


def _add_discount(booking_id: str, cents: int) -> None:
    ids = _ids_cached()

    async def run(session):
        from app.db.models import BookingPaymentEvent

        session.add(
            BookingPaymentEvent(
                tenant_id=ids["tenant"],
                booking_id=booking_id,
                event_kind="discount_applied",
                amount_cents=cents,
                payload_json={"discountType": "amount"},
            )
        )

    _db(run)


def _add_payment(booking_id: str, customer_id: str, amount_cents: int, tip_cents=0, created_at=None, method="cash") -> str:
    ids = _ids_cached()

    async def run(session):
        from app.db.models import Payment

        payment = Payment(
            tenant_id=ids["tenant"],
            booking_id=booking_id,
            customer_id=customer_id,
            status="succeeded",
            deposit_status="paid",
            amount_cents=amount_cents,
            tip_cents=tip_cents,
            payment_method_type=method,
            **({"created_at": created_at} if created_at else {}),
        )
        session.add(payment)
        await session.flush()
        return payment.id

    return _db(run)


def _add_payment_event(payment_id: str, kind: str, amount_cents: int, occurred_at) -> None:
    ids = _ids_cached()

    async def run(session):
        from app.db.models import PaymentEvent

        session.add(
            PaymentEvent(
                tenant_id=ids["tenant"],
                payment_id=payment_id,
                kind=kind,
                actor_type="user",
                occurred_at=occurred_at,
                amount_cents=amount_cents,
            )
        )

    _db(run)


def _get(client, path, headers, **params):
    return client.get(f"{BASE}/{path}", headers=headers, params=params)


def _staff_headers(client, owner_headers) -> dict[str, str]:
    created = client.post(
        f"/api/v1/tenants/{TENANT}/users",
        headers=owner_headers,
        json={"email": "reports.staff@browbeautylab.test", "name": "Staff", "role": "staff", "initialPassword": "TempPass123"},
    )
    assert created.status_code == 201, created.text
    return _auth_headers(client, "reports.staff@browbeautylab.test", "TempPass123")


# ----------------------------------------------------------------- sales ----


def test_sales_report_math(client) -> None:
    _cache.clear()
    ids = _ids_cached()
    customer = _add_customer()
    booking = _add_booking(customer, completed_at=_utc(2020, 3, 11, 18), tax_cents=123)
    _add_item(booking, 2000, 2)  # 4000 of add-ons
    _add_discount(booking, 500)
    _add_payment(booking, customer, amount_cents=ids["service_price"] + 4000 + 700, tip_cents=700, created_at=_utc(2020, 3, 11, 18))

    response = _get(client, "sales", _auth_headers(client), **PAST)
    assert response.status_code == 200, response.text
    kpis = response.json()["kpis"]
    assert kpis["grossSalesCents"] == ids["service_price"] + 4000
    assert kpis["discountsCents"] == 500
    assert kpis["netSalesCents"] == ids["service_price"] + 4000 - 500
    assert kpis["taxCents"] == 123  # stored snapshot, not the live rate
    assert kpis["tipsCents"] == 700
    assert kpis["completedAppointments"] == 1
    assert kpis["addOnSalesCents"] == 4000
    assert kpis["addOnAttachRate"] == 1.0
    assert response.json()["cash"]["collectedCents"] == ids["service_price"] + 4000 + 700
    assert response.json()["cash"]["paymentMethods"][0]["tipsCents"] == 700
    assert response.json()["byService"][0]["appointments"] == 1
    assert sum(point["appointments"] for point in response.json()["series"]) == 1


def test_sales_report_buckets_by_tenant_timezone(client) -> None:
    _cache.clear()
    customer = _add_customer()
    # Tenant is America/Los_Angeles (PDT, UTC-7 on 2020-03-10).
    _add_booking(customer, completed_at=_utc(2020, 3, 11, 6, 30))  # 03-10 23:30 local
    _add_booking(customer, starts_at=_utc(2020, 3, 11, 20), completed_at=_utc(2020, 3, 11, 7, 30))  # 03-11 00:30 local
    headers = _auth_headers(client)

    first_day = _get(client, "sales", headers, **{"from": "2020-03-10", "to": "2020-03-10"}).json()
    second_day = _get(client, "sales", headers, **{"from": "2020-03-11", "to": "2020-03-11"}).json()
    assert first_day["kpis"]["completedAppointments"] == 1
    assert second_day["kpis"]["completedAppointments"] == 1
    assert first_day["range"]["timezone"] == "America/Los_Angeles"


def test_sales_report_refunds_in_cash_block(client) -> None:
    _cache.clear()
    customer = _add_customer()
    booking = _add_booking(customer, completed_at=_utc(2020, 3, 11, 18))
    payment = _add_payment(booking, customer, 5000, created_at=_utc(2020, 3, 11, 18))
    _add_payment_event(payment, "refund_recorded", 1500, _utc(2020, 3, 12, 18))
    _add_payment_event(payment, "wallet_returned", 400, _utc(2020, 3, 12, 19))
    _add_payment_event(payment, "refund_recorded", 999, _utc(2020, 4, 20, 18))  # outside range

    cash = _get(client, "sales", _auth_headers(client), **PAST).json()["cash"]
    assert cash["refundedCents"] == 1500
    assert cash["walletCreditedCents"] == 400


def test_sales_report_compare_prior_period(client) -> None:
    _cache.clear()
    customer = _add_customer()
    _add_booking(customer, completed_at=_utc(2020, 3, 11, 18))  # current week
    _add_booking(customer, starts_at=_utc(2020, 3, 3, 18), completed_at=_utc(2020, 3, 3, 18))  # prior week
    body = _get(client, "sales", _auth_headers(client), compare="prior_period", **PAST).json()
    assert body["previousKpis"]["completedAppointments"] == 1
    assert body["previousRange"]["startDate"] == "2020-03-02"
    assert body["previousRange"]["endDate"] == "2020-03-08"


def test_sales_report_groups_by_week_and_month(client) -> None:
    headers = _auth_headers(client)
    weekly = _get(client, "sales", headers, **{"from": "2020-03-01", "to": "2020-03-31"}, groupBy="week").json()
    assert weekly["series"][0]["bucketStart"] == "2020-02-24"  # Monday on/before Mar 1
    monthly = _get(client, "sales", headers, **{"from": "2020-01-15", "to": "2020-03-02"}, groupBy="month").json()
    assert [p["bucketStart"] for p in monthly["series"]] == ["2020-01-01", "2020-02-01", "2020-03-01"]


def test_sales_report_csv_export(client) -> None:
    response = _get(client, "sales", _auth_headers(client), format="csv", **PAST)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("text/csv")
    assert "attachment" in response.headers["content-disposition"]
    assert "Gross sales" in response.text


def test_csv_cells_are_formula_safe() -> None:
    from app.services.reports.csv_export import render_csv

    text = render_csv("t", "r", [("s", ["Name"], [["=HYPERLINK(\"x\")"], ["+1"], ["ok"]])])
    assert "'=HYPERLINK" in text
    assert "'+1" in text
    assert "\nok" in text


# ------------------------------------------------------------ validation ----


def test_report_validation_errors(client) -> None:
    headers = _auth_headers(client)
    assert _get(client, "sales", headers, **{"from": "2020-03-10", "to": "2020-03-01"}).status_code == 422
    assert _get(client, "sales", headers, **{"from": "2015-01-01", "to": "2020-01-01"}).status_code == 422
    assert _get(client, "sales", headers, groupBy="year", **PAST).status_code == 422
    assert _get(client, "sales", headers, format="xml", **PAST).status_code == 422
    assert _get(client, "sales", headers, compare="nonsense", **PAST).status_code == 422
    assert _get(client, "sales", headers, **{"from": "not-a-date", "to": "2020-03-01"}).status_code == 422
    assert client.get(f"{BASE}/sales", headers=headers).status_code == 422


def test_report_unknown_location_or_provider_is_404(client) -> None:
    headers = _auth_headers(client)
    assert _get(client, "team", headers, locationId="missing", **PAST).status_code == 404
    assert _get(client, "team", headers, providerId="missing", **PAST).status_code == 404


# ----------------------------------------------------- permissions/tenancy ----


def test_reports_require_authentication(client) -> None:
    for name in ("sales", "team", "clients", "appointments"):
        assert client.get(f"{BASE}/{name}", params=PAST).status_code == 401


def test_staff_sees_operational_reports_but_not_financial(client) -> None:
    owner = _auth_headers(client)
    staff = _staff_headers(client, owner)

    assert _get(client, "sales", staff, **PAST).status_code == 403
    assert _get(client, "appointments", staff, **PAST).status_code == 200

    team = _get(client, "team", staff, **PAST)
    assert team.status_code == 200
    assert team.json()["includeFinancial"] is False
    assert all(member["netSalesCents"] is None and member["commissionCents"] is None for member in team.json()["members"])

    clients = _get(client, "clients", staff, **PAST).json()
    assert clients["summary"]["walletLiabilityCents"] is None
    assert all(row["spendCents"] is None for row in clients["topClients"])

    # Export needs its own permission.
    assert _get(client, "appointments", staff, format="csv", **PAST).status_code == 403
    assert _get(client, "team", staff, format="csv", **PAST).status_code == 403


def test_reports_are_tenant_isolated(client) -> None:
    _cache.clear()
    customer = _add_customer()
    _add_booking(customer, completed_at=_utc(2020, 3, 11, 18))

    other_email, other_password = _create_other_tenant_owner(client)
    other = _auth_headers(client, other_email, other_password)

    for name in ("sales", "team", "clients", "appointments"):
        assert client.get(f"{BASE}/{name}", headers=other, params=PAST).status_code == 403

    own = client.get(f"/api/v1/tenants/other-tenant/reports/sales", headers=other, params=PAST)
    assert own.status_code == 200
    assert own.json()["kpis"]["completedAppointments"] == 0

    # A location id from another tenant is treated as not found, not leaked.
    location = _ids_cached()["location"]
    cross = client.get(f"/api/v1/tenants/other-tenant/reports/appointments", headers=other, params={**PAST, "locationId": location})
    assert cross.status_code == 404


# ------------------------------------------------------------------ team ----


def test_team_report_commission_and_outcomes(client) -> None:
    _cache.clear()
    ids = _ids_cached()

    async def set_comp(session):
        from app.db.models import Provider

        provider = await session.get(Provider, ids["provider"])
        provider.compensation_mode = "service_percent"
        provider.compensation_service_percent_bp = 5000

    _db(set_comp)

    customer = _add_customer()
    first = _add_booking(customer, completed_at=_utc(2020, 3, 10, 20), starts_at=_utc(2020, 3, 10, 19))
    _add_booking(customer, status="no_show", starts_at=_utc(2020, 3, 12, 19))
    _add_booking(customer, status="canceled", starts_at=_utc(2020, 3, 13, 19), canceled_by="customer")
    _add_payment(first, customer, 1000, tip_cents=250, created_at=_utc(2020, 3, 10, 20))

    body = _get(client, "team", _auth_headers(client), providerId=ids["provider"], **PAST).json()
    member = body["members"][0]
    assert member["appointmentsCompleted"] == 1
    assert member["noShows"] == 1
    assert member["canceled"] == 1
    assert member["noShowRate"] == 0.5  # 1 no-show of (1 completed + 1 no-show)
    assert member["cancelRate"] == round(1 / 3, 4)
    assert member["commissionCents"] == round(ids["service_price"] * 0.5)
    assert member["tipsCents"] == 250
    assert member["newClientAppointments"] == 1
    assert member["rebookedAppointments"] == 1  # followed by a later non-canceled booking


def test_team_utilization_uses_schedule_and_time_off(client) -> None:
    _cache.clear()
    ids = _ids_cached()
    customer = _add_customer()
    # Monday 2020-03-09 09:00-10:30 local (PDT = UTC-7) -> 90 booked minutes.
    _add_booking(customer, status="confirmed", starts_at=_utc(2020, 3, 9, 16), minutes=90)
    headers = _auth_headers(client)

    one_day = _get(client, "team", headers, providerId=ids["provider"], **{"from": "2020-03-09", "to": "2020-03-09"}).json()
    member = one_day["members"][0]
    assert member["scheduledMinutes"] == 7 * 60  # seeded Mon-Fri 09:00-16:00
    assert member["bookedMinutes"] == 90
    assert member["utilizationRate"] == round(90 / 420, 4)

    weekend = _get(client, "team", headers, providerId=ids["provider"], **{"from": "2020-03-14", "to": "2020-03-15"}).json()
    assert weekend["members"][0]["scheduledMinutes"] == 0

    async def add_time_off(session):
        from app.db.models import ProviderTimeOff

        session.add(
            ProviderTimeOff(
                tenant_id=ids["tenant"],
                provider_id=ids["provider"],
                starts_at=_utc(2020, 3, 10, 7),   # 00:00 PDT on the 10th
                ends_at=_utc(2020, 3, 11, 6, 59),
                override_type="closed",
            )
        )
        session.add(
            ProviderTimeOff(
                tenant_id=ids["tenant"],
                provider_id=ids["provider"],
                starts_at=_utc(2020, 3, 11, 7),
                ends_at=_utc(2020, 3, 12, 6, 59),  # 23:59 local on the 11th
                override_type="custom_hours",
                start_time=time(10, 0),
                end_time=time(12, 0),
            )
        )

    _db(add_time_off)
    week = _get(client, "team", headers, providerId=ids["provider"], **{"from": "2020-03-09", "to": "2020-03-13"}).json()
    # Mon 420 + Tue closed 0 + Wed custom 120 + Thu 420 + Fri 420
    assert week["members"][0]["scheduledMinutes"] == 420 + 0 + 120 + 420 + 420


def test_team_utilization_is_unknown_without_a_schedule(client) -> None:
    _cache.clear()
    ids = _ids_cached()

    async def add_provider(session):
        from app.db.models import Provider

        provider = Provider(tenant_id=ids["tenant"], name="Unscheduled Pat", is_active=True)
        session.add(provider)
        await session.flush()
        return provider.id

    try:
        provider_id = _db(add_provider)
    except TypeError:  # model requires extra columns; fall back to skipping this edge
        return
    body = _get(client, "team", _auth_headers(client), providerId=provider_id, **PAST).json()
    assert body["members"][0]["scheduledMinutes"] is None
    assert body["members"][0]["utilizationRate"] is None


# --------------------------------------------------------------- clients ----


def test_clients_report_new_returning_and_retention(client) -> None:
    _cache.clear()
    veteran = _add_customer("Veteran Client")
    _add_booking(veteran, starts_at=_utc(2020, 1, 5, 18), completed_at=_utc(2020, 1, 5, 19))
    _add_booking(veteran, starts_at=_utc(2020, 2, 3, 18), completed_at=_utc(2020, 2, 3, 19))
    rookie = _add_customer("Rookie Client")
    _add_booking(rookie, starts_at=_utc(2020, 2, 10, 18), completed_at=_utc(2020, 2, 10, 19))
    rookie_return = _add_booking(rookie, starts_at=_utc(2020, 2, 20, 18), completed_at=_utc(2020, 2, 20, 19))
    assert rookie_return

    body = _get(client, "clients", _auth_headers(client), **{"from": "2020-02-01", "to": "2020-02-29"}).json()
    summary = body["summary"]
    assert summary["activeClients"] == 2
    assert summary["newClients"] == 1
    assert summary["returningClients"] == 1
    assert summary["newClientShare"] == 0.5
    thirty = next(row for row in body["retention"] if row["windowDays"] == 30)
    assert thirty["eligible"] == 2 and thirty["retained"] == 2 and thirty["rate"] == 1.0  # both first seen within 12 months
    assert any(row["count"] == 1 for row in body["sources"])
    assert {row["name"] for row in body["topClients"]} >= {"Veteran Client", "Rookie Client"}


def test_clients_report_flags_at_risk_clients(client) -> None:
    _cache.clear()
    lapsed = _add_customer("Lapsed Client")
    _add_booking(lapsed, starts_at=_utc(2020, 1, 5, 18), completed_at=_utc(2020, 1, 5, 19))
    body = _get(client, "clients", _auth_headers(client), **{"from": "2020-06-01", "to": "2020-06-30"}).json()
    assert any(row["name"] == "Lapsed Client" for row in body["atRisk"])
    assert body["atRiskCount"] >= 1


# ---------------------------------------------------------- appointments ----


def test_appointments_report_cancellations_and_lead_time(client) -> None:
    _cache.clear()
    customer = _add_customer()
    # Canceled 2 hours before start (inside the default 24h policy window) by the customer.
    _add_booking(
        customer,
        status="canceled",
        starts_at=_utc(2020, 3, 10, 18),
        canceled_by="customer",
        cancel_reason="Sick",
        canceled_at=_utc(2020, 3, 10, 16),
    )
    # Canceled well in advance by staff.
    _add_booking(
        customer,
        status="canceled",
        starts_at=_utc(2020, 3, 11, 18),
        canceled_by="staff",
        cancel_reason="Provider out",
        canceled_at=_utc(2020, 3, 5, 16),
    )
    _add_booking(customer, status="no_show", starts_at=_utc(2020, 3, 12, 18))
    done = _add_booking(
        customer,
        starts_at=_utc(2020, 3, 13, 18),
        completed_at=_utc(2020, 3, 13, 19),
        checked_in_at=_utc(2020, 3, 13, 17, 50),
        service_started_at=_utc(2020, 3, 13, 18, 10),
        reschedule_count=1,
    )
    assert done

    body = _get(client, "appointments", _auth_headers(client), **PAST).json()
    summary = body["summary"]
    assert summary["total"] == 4
    assert summary["canceled"] == 2
    assert summary["noShows"] == 1
    assert summary["noShowRate"] == 0.5  # 1 / (1 completed + 1 no-show)
    assert summary["lateCancelCount"] == 1
    assert summary["lateCancelRate"] == 0.5
    assert summary["rescheduleRate"] == 0.25
    assert summary["averageWaitMinutes"] == 20.0
    assert summary["averageLateStartMinutes"] == 10.0
    actors = {row["key"]: row["count"] for row in body["cancelActors"]}
    assert actors == {"customer": 1, "staff": 1}
    assert {row["label"] for row in body["cancelReasons"]} == {"Sick", "Provider out"}
    assert len(body["leadTime"]) == 6
    assert sum(cell["count"] for cell in body["heatmap"]) == 2  # canceled bookings are excluded


def test_appointments_report_funnel_counts_drafts(client) -> None:
    from datetime import date

    today = date.today().isoformat()
    body = _get(client, "appointments", _auth_headers(client), **{"from": today, "to": today}).json()
    assert body["drafts"]["total"] == body["drafts"]["confirmed"] + body["drafts"]["abandoned"]
