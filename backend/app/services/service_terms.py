"""Resolve what a service costs and how long it takes with a given provider.

Providers can override a service's price, deposit and duration (set from the
provider's Services tab or the service's Staff tab). Availability, booking
drafts and booking edits all resolve terms here so the values stay consistent.
"""

from __future__ import annotations

from dataclasses import dataclass

from sqlalchemy import inspect as sa_inspect

from app.db.models import Provider, ProviderService, Service, ServiceCategory


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
PROVIDER_SELECTION_MODES = ("client_choice", "auto_assign", "hide")
DEFAULT_PROVIDER_SELECTION_MODE = "client_choice"

_UNSET = object()


def loaded_category(service: Service) -> ServiceCategory | None:
    """The service's category if it is already loaded; never triggers a lazy load (async-safe)."""
    inspected = sa_inspect(service)
    if inspected is None or "category" in inspected.unloaded:
        return None
    return service.category


@dataclass(frozen=True)
class EffectiveOnlineBooking:
    """Online booking rules after inheritance: service setting, else its category's, else the default."""

    payment_mode: str | None  # None only for legacy services that predate payment modes
    payment_value_cents: int | None
    payment_percent: int | None
    payment_source: str  # "service" | "category" | "legacy" | "none"
    require_card_on_file: bool
    require_card_source: str  # "service" | "category" | "default"
    provider_selection_mode: str
    provider_selection_source: str  # "service" | "category" | "default"


def effective_online_booking(service: Service, category: object = _UNSET) -> EffectiveOnlineBooking:
    resolved = loaded_category(service) if category is _UNSET else category
    if service.booking_payment_mode:
        pay_source, pay_from = "service", service
    elif resolved is not None and resolved.booking_payment_mode:
        pay_source, pay_from = "category", resolved
    else:
        pay_source, pay_from = ("legacy" if service.deposit_cents > 0 else "none"), None

    if service.require_card_on_file is not None:
        card, card_source = service.require_card_on_file, "service"
    elif resolved is not None and resolved.require_card_on_file is not None:
        card, card_source = resolved.require_card_on_file, "category"
    else:
        card, card_source = False, "default"

    if service.provider_selection_mode:
        selection, selection_source = service.provider_selection_mode, "service"
    elif resolved is not None and resolved.provider_selection_mode:
        selection, selection_source = resolved.provider_selection_mode, "category"
    else:
        selection, selection_source = DEFAULT_PROVIDER_SELECTION_MODE, "default"

    return EffectiveOnlineBooking(
        payment_mode=pay_from.booking_payment_mode if pay_from is not None else None,
        payment_value_cents=pay_from.booking_payment_value_cents if pay_from is not None else None,
        payment_percent=pay_from.booking_payment_percent if pay_from is not None else None,
        payment_source=pay_source,
        require_card_on_file=card,
        require_card_source=card_source,
        provider_selection_mode=selection,
        provider_selection_source=selection_source,
    )


def effective_taxable(service: Service, category: object = _UNSET) -> tuple[bool, str]:
    """Whether the business tax rate applies to this service, and where that comes from.

    The service's own setting wins, then its category's; with neither set it is taxable.
    """
    resolved = loaded_category(service) if category is _UNSET else category
    if service.is_taxable is not None:
        return service.is_taxable, "service"
    if resolved is not None and resolved.is_taxable is not None:
        return resolved.is_taxable, "category"
    return True, "default"


def resolve_booking_deposit(
    service: Service,
    link: ProviderService | None,
    total_price_cents: int,
) -> int:
    """Amount taken at booking for this provider, capped at what the visit costs.

    `total_price_cents` is the resolved service price plus any add-ons. A
    provider-specific deposit wins; otherwise the payment rule (the service's own,
    else its category's): none -> 0, full -> the total, partial_flat -> the set
    amount, partial_percent -> that share of the total. With no rule anywhere, a
    service saved before payment modes existed keeps its plain deposit, and anything
    else takes no deposit.
    """
    if link is not None and link.deposit_cents_override is not None:
        amount = link.deposit_cents_override
    else:
        rule = effective_online_booking(service)
        mode = rule.payment_mode
        if mode == "none":
            amount = 0
        elif mode == "full":
            amount = total_price_cents
        elif mode == "partial_flat":
            amount = rule.payment_value_cents or 0
        elif mode == "partial_percent":
            amount = round(total_price_cents * (rule.payment_percent or 0) / 100)
        else:
            amount = service.deposit_cents
    return max(0, min(amount, total_price_cents))
