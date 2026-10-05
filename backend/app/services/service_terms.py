"""Resolve what a service costs and how long it takes with a given provider.

Providers can override a service's price, deposit and duration (set from the
provider's Services tab or the service's Staff tab). Availability, booking
drafts and booking edits all resolve terms here so the values stay consistent.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.db.models import Provider, ProviderService, Service


@dataclass(frozen=True)
class ServiceTerms:
    price_cents: int
    deposit_cents: int
    duration_minutes: int


def provider_service_link(provider: Provider, service_id: str) -> ProviderService | None:
    """The provider's link to the service; `provider.service_links` must be loaded."""
    return next((link for link in provider.service_links if link.service_id == service_id), None)


def resolve_service_terms(service: Service, link: ProviderService | None) -> ServiceTerms:
    price_cents = service.price_cents
    deposit_cents = service.deposit_cents
    duration_minutes = service.duration_minutes
    if link is not None:
        if link.price_cents_override is not None:
            price_cents = link.price_cents_override
        if link.deposit_cents_override is not None:
            deposit_cents = link.deposit_cents_override
        if link.duration_minutes_override is not None:
            duration_minutes = link.duration_minutes_override
    # A deposit can never exceed what the client pays (a provider's lower price
    # may sit under the service's base deposit).
    return ServiceTerms(
        price_cents=price_cents,
        deposit_cents=min(deposit_cents, price_cents),
        duration_minutes=duration_minutes,
    )


# What a service collects when it's booked (Services › Online booking).
BOOKING_PAYMENT_MODES = ("none", "full", "partial_flat", "partial_percent")


def resolve_booking_deposit(
    service: Service,
    link: ProviderService | None,
    total_price_cents: int,
    default_deposit_cents: int,
) -> int:
    """Amount taken at booking for this provider, capped at what the visit costs.

    `total_price_cents` is the resolved service price plus any add-ons. A
    provider-specific deposit wins; otherwise the service's payment mode:
    none -> 0, full -> the total, partial_flat -> the set amount (the studio
    default deposit when left blank), partial_percent -> that share of the
    total. Services saved before payment modes existed keep their deposit.
    """
    if link is not None and link.deposit_cents_override is not None:
        amount = link.deposit_cents_override
    else:
        mode = service.booking_payment_mode
        if mode == "none":
            amount = 0
        elif mode == "full":
            amount = total_price_cents
        elif mode == "partial_flat":
            amount = (
                service.booking_payment_value_cents
                if service.booking_payment_value_cents is not None
                else default_deposit_cents
            )
        elif mode == "partial_percent":
            amount = round(total_price_cents * (service.booking_payment_percent or 0) / 100)
        else:
            amount = service.deposit_cents
    return max(0, min(amount, total_price_cents))
