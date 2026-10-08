"""Provider payout calculation shared by the earnings summary and the team report.

Payout is computed from the provider's *current* compensation settings (no
payout ledger exists yet), so changing a rate changes what historical ranges
show. Sliding-scale tiers are evaluated on the revenue of the range being
reported, which matches the monthly meaning only for month-long ranges.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.db.models import Provider


@dataclass(frozen=True)
class CompletedService:
    service_id: str
    price_cents: int
    minutes: int


@dataclass(frozen=True)
class PayoutResult:
    treatment_revenue_cents: int
    override_bookings_count: int
    service_payout_cents: int


def sliding_scale_percent_bp(tiers: list[dict], revenue_cents: int) -> int:
    """Pick the bracket percentage for a revenue total. Tiers are evaluated in
    ascending `up_to_amount_cents` order; revenue above every threshold falls
    into the last (highest) tier."""
    if not tiers:
        return 0
    ordered = sorted(tiers, key=lambda t: t.get("up_to_amount_cents") or t.get("upToAmountCents") or 0)
    for tier in ordered:
        up_to = tier.get("up_to_amount_cents")
        if up_to is None:
            up_to = tier.get("upToAmountCents", 0)
        if revenue_cents <= up_to:
            return tier.get("percent_bp") or tier.get("percentBp") or 0
    last = ordered[-1]
    return last.get("percent_bp") or last.get("percentBp") or 0


def compute_service_payout(provider: Provider, services: list[CompletedService]) -> PayoutResult:
    """Payout for a provider's completed services under their compensation mode,
    honouring per-service commission overrides. `provider.service_links` must be loaded."""
    overrides_by_service = {
        link.service_id: link
        for link in provider.service_links
        if link.commission_basis_points is not None or link.commission_flat_cents is not None
    }

    treatment_revenue_cents = 0
    override_bookings_count = 0
    override_payout_cents = 0
    non_override_revenue_cents = 0
    non_override_minutes = 0

    for entry in services:
        treatment_revenue_cents += entry.price_cents
        override = overrides_by_service.get(entry.service_id)
        if override is not None:
            override_bookings_count += 1
            if override.commission_basis_points is not None:
                override_payout_cents += round(entry.price_cents * override.commission_basis_points / 10_000)
            elif override.commission_flat_cents is not None:
                override_payout_cents += override.commission_flat_cents
        else:
            non_override_revenue_cents += entry.price_cents
            non_override_minutes += entry.minutes

    mode = provider.compensation_mode
    non_override_payout_cents = 0
    if mode == "service_percent" and provider.compensation_service_percent_bp:
        non_override_payout_cents = round(non_override_revenue_cents * provider.compensation_service_percent_bp / 10_000)
    elif mode == "sliding_scale":
        percent_bp = sliding_scale_percent_bp(provider.compensation_sliding_scale or [], non_override_revenue_cents)
        non_override_payout_cents = round(non_override_revenue_cents * percent_bp / 10_000)
    elif mode == "flat_per_booking" and provider.compensation_flat_cents:
        non_override_payout_cents = provider.compensation_flat_cents * (len(services) - override_bookings_count)
    elif mode == "hourly" and provider.compensation_hourly_cents:
        non_override_payout_cents = round((non_override_minutes / 60) * provider.compensation_hourly_cents)

    return PayoutResult(
        treatment_revenue_cents=treatment_revenue_cents,
        override_bookings_count=override_bookings_count,
        service_payout_cents=override_payout_cents + non_override_payout_cents,
    )
