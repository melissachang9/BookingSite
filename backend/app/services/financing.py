from __future__ import annotations

from app.db.models import Service, Tenant
from app.schemas.catalog import ServiceFinancingResponse
from app.services.service_terms import loaded_category

DEFAULT_FINANCING_BUTTON_TEXT = "See financing options"


def effective_financing(service: Service, tenant: Tenant | None) -> ServiceFinancingResponse | None:
    """What the booking site shows beside a service's price, or None when it shows no financing.

    Financing is opt-in. The studio setting holds the link, button text and months, and is the master
    switch. A service then shows it when it turns it on ("on", or "custom" with its own link), hides it
    ("off"), or follows its category, whose own toggle is off unless set. The monthly figure is the
    service price spread over the studio's months.
    """
    if tenant is None or service.financing_mode == "off":
        return None
    category = loaded_category(service)
    follows_category = service.financing_mode is None
    if follows_category and (category is None or category.financing_mode != "on"):
        return None
    studio = (tenant.branding_json or {}).get("financing")
    if not isinstance(studio, dict) or not studio.get("enabled"):
        return None
    months = studio.get("months")
    link_url = service.financing_url if service.financing_mode == "custom" else studio.get("linkUrl")
    if not isinstance(months, int) or months < 2 or not link_url or service.price_cents <= 0:
        return None
    monthly_cents = (service.price_cents + months // 2) // months
    if monthly_cents <= 0:
        return None
    button_text = studio.get("buttonText")
    return ServiceFinancingResponse(
        button_text=button_text.strip() if isinstance(button_text, str) and button_text.strip() else DEFAULT_FINANCING_BUTTON_TEXT,
        link_url=link_url,
        months=months,
        monthly_cents=monthly_cents,
    )
