"""Reminders run from the app's own background loop, one failing sender never blocks the rest."""

from __future__ import annotations

import asyncio

from app.services import background_jobs


def test_every_reminder_sender_is_scheduled() -> None:
    names = [name for name, _ in background_jobs.REMINDER_JOBS]
    assert names == ["appointment reminders", "form reminders", "intake reminders"]
    assert background_jobs.REMINDER_INTERVAL_SECONDS <= 15 * 60


def test_a_cycle_runs_all_senders_and_isolates_a_failing_one(client, monkeypatch) -> None:
    calls: list[str] = []

    def make(name: str, *, fail: bool = False):
        async def job(session):
            calls.append(name)
            if fail:
                raise RuntimeError("provider down")
            return {"sent": 1}

        return job

    monkeypatch.setattr(
        background_jobs,
        "REMINDER_JOBS",
        (("appointment reminders", make("a", fail=True)), ("form reminders", make("f")), ("intake reminders", make("i"))),
    )
    results = asyncio.run(background_jobs.run_reminder_cycle())
    assert calls == ["a", "f", "i"]
    assert results == {"appointment reminders": None, "form reminders": {"sent": 1}, "intake reminders": {"sent": 1}}


def test_the_real_senders_run_cleanly_against_an_empty_schedule(client) -> None:
    results = asyncio.run(background_jobs.run_reminder_cycle())
    assert set(results) == {"appointment reminders", "form reminders", "intake reminders"}
    assert all(value is not None for value in results.values()), results


def test_appointment_times_in_reminders_use_the_business_timezone() -> None:
    from datetime import datetime, timezone

    from app.services.timezones import LocalTimeLookup, as_utc

    lookup = LocalTimeLookup({"t1": "America/Los_Angeles"}, {"loc-toronto": "America/Toronto", "loc-bad": "Not/AZone"})
    starts = datetime(2026, 11, 3, 18, 30, tzinfo=timezone.utc)  # 13:30 Toronto, 10:30 Los Angeles
    assert lookup.label("t1", "loc-toronto", starts) == "Tue, Nov 03 at 01:30 PM EST"
    assert lookup.label("t1", None, starts) == "Tue, Nov 03 at 10:30 AM PST"
    assert lookup.label("t1", "loc-bad", starts) == "Tue, Nov 03 at 10:30 AM PST"  # bad location zone falls back
    # SQLite returns stored UTC times without a zone; they are still read as UTC.
    assert lookup.label("t1", None, starts.replace(tzinfo=None)) == "Tue, Nov 03 at 10:30 AM PST"
    assert as_utc(datetime(2026, 1, 1, 12)).tzinfo is not None


def test_a_due_appointment_reminder_is_emailed_with_local_time(client, monkeypatch) -> None:
    from datetime import datetime, timedelta, timezone

    from sqlalchemy import select

    from app.db.models import Booking, Location, Tenant
    from app.db.session import get_session_maker
    from app.services import appointment_reminders

    sent: list[dict] = []

    async def fake_email(**kwargs):
        sent.append(kwargs)

        class Result:
            provider_message_id = "fake"

        return Result()

    monkeypatch.setattr(appointment_reminders, "send_transactional_email", fake_email)

    async def _arrange_and_run() -> str:
        async with get_session_maker()() as session:
            tenant = await session.scalar(select(Tenant).where(Tenant.slug == "brow-beauty-lab"))
            booking = await session.scalar(select(Booking).where(Booking.tenant_id == tenant.id, Booking.status == "confirmed"))
            starts = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(hours=3)
            booking.starts_at = starts
            booking.last_appointment_reminder_sent_at = None
            location = await session.get(Location, booking.location_id) if booking.location_id else None
            if location is not None:
                location.time_zone = "Pacific/Honolulu"
            await session.commit()
            await appointment_reminders.send_due_appointment_reminders(session)
            return starts.astimezone(__import__("zoneinfo").ZoneInfo("Pacific/Honolulu")).strftime("%I:%M %p")

    expected_clock = asyncio.run(_arrange_and_run())
    assert sent, "a reminder should have been emailed"
    body = " ".join(str(value) for value in sent[0].values())
    assert "HST" in body and expected_clock in body and "UTC" not in body
