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
