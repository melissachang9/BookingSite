"""Tax rates live on locations (one for services, one for products); services can opt out."""

from __future__ import annotations

from test_booking_operations import _auth_headers, _confirm_paid_deposit_booking

TENANT = "brow-beauty-lab"
API = f"/api/v1/tenants/{TENANT}"


def _locations(client, headers) -> list[dict]:
    return client.get(f"{API}/locations/manage", headers=headers).json()["locations"]


def _set_rates(client, headers, *, service: float | None = None, product: float | None = None) -> None:
    body = {}
    if service is not None:
        body["serviceTaxRatePercent"] = service
    if product is not None:
        body["productTaxRatePercent"] = product
    for location in _locations(client, headers):
        response = client.patch(f"{API}/locations/{location['id']}", headers=headers, json=body)
        assert response.status_code == 200, response.json()


def test_a_location_carries_a_service_and_a_product_tax_rate(client) -> None:
    headers = _auth_headers(client)
    location = _locations(client, headers)[0]
    assert (location["serviceTaxRatePercent"], location["productTaxRatePercent"]) == (0, 0)

    updated = client.patch(
        f"{API}/locations/{location['id']}", headers=headers,
        json={"serviceTaxRatePercent": 5, "productTaxRatePercent": 12.5},
    )
    assert updated.status_code == 200
    assert (updated.json()["serviceTaxRatePercent"], updated.json()["productTaxRatePercent"]) == (5, 12.5)
    listed = next(item for item in _locations(client, headers) if item["id"] == location["id"])
    assert listed["productTaxRatePercent"] == 12.5


def test_location_tax_rates_are_validated_and_new_locations_start_at_zero(client) -> None:
    headers = _auth_headers(client)
    location = _locations(client, headers)[0]
    for field in ("serviceTaxRatePercent", "productTaxRatePercent"):
        assert client.patch(f"{API}/locations/{location['id']}", headers=headers, json={field: 150}).status_code == 422
        assert client.patch(f"{API}/locations/{location['id']}", headers=headers, json={field: -1}).status_code == 422

    created = client.post(
        f"{API}/locations", headers=headers,
        json={"name": "Pop-up", "timeZone": "America/Los_Angeles", "serviceTaxRatePercent": 7},
    )
    assert created.status_code == 201, created.json()
    assert (created.json()["serviceTaxRatePercent"], created.json()["productTaxRatePercent"]) == (7, 0)


def test_the_business_wide_tax_rate_setting_is_gone(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(f"{API}/settings", headers=headers, json={"taxRatePercent": 9})
    assert response.status_code == 200
    assert "taxRatePercent" not in response.json()["settings"]


def test_services_are_taxed_at_the_service_rate_and_products_at_the_product_rate(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking_id = created["booking"]["id"]
    _set_rates(client, headers, service=10, product=20)

    booking = client.get(f"{API}/bookings/{booking_id}", headers=headers).json()
    price = booking["priceCents"]
    assert booking["taxCents"] == round(price * 0.10)

    added = client.post(
        f"{API}/bookings/{booking_id}/items", headers=headers, json={"name": "Retail serum", "priceCents": 4000}
    ).json()
    assert added["items"][0]["kind"] == "product"
    assert added["taxCents"] == round(price * 0.10) + round(4000 * 0.20)


def test_an_exempt_service_still_pays_product_tax_on_products(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking_id = created["booking"]["id"]
    service_id = created["booking"]["service"]["id"]
    _set_rates(client, headers, service=10, product=20)
    client.patch(f"{API}/services/{service_id}", headers=headers, json={"isTaxable": False})

    exempt = client.get(f"{API}/bookings/{booking_id}", headers=headers).json()
    assert exempt["taxCents"] == 0
    with_product = client.post(
        f"{API}/bookings/{booking_id}/items", headers=headers, json={"name": "Retail serum", "priceCents": 4000}
    ).json()
    assert with_product["taxCents"] == round(4000 * 0.20)


def test_add_ons_and_service_lines_use_the_service_rate(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking_id = created["booking"]["id"]
    brow = next(s for s in client.get(f"{API}/services").json()["services"] if s["name"] == "Brow Shape and Tint")
    _set_rates(client, headers, service=10, product=50)

    before = client.get(f"{API}/bookings/{booking_id}", headers=headers).json()["taxCents"]
    added = client.post(f"{API}/bookings/{booking_id}/items", headers=headers, json={"sourceServiceId": brow["id"]}).json()
    assert added["items"][0]["kind"] == "service"
    assert added["taxCents"] - before == round(added["items"][0]["priceCents"] * 0.10)


def test_a_location_cannot_be_edited_across_tenants(client) -> None:
    headers = _auth_headers(client)
    response = client.patch(f"{API}/locations/not-a-location", headers=headers, json={"serviceTaxRatePercent": 5})
    assert response.status_code == 404


def test_a_booking_exposes_the_rates_behind_its_tax(client) -> None:
    headers = _auth_headers(client)
    created = _confirm_paid_deposit_booking(client)
    booking_id = created["booking"]["id"]
    _set_rates(client, headers, service=7, product=11)

    booking = client.get(f"{API}/bookings/{booking_id}", headers=headers).json()
    assert (booking["serviceTaxRatePercent"], booking["productTaxRatePercent"]) == (7, 11)
    assert booking["serviceIsTaxable"] is True

    service_id = created["booking"]["service"]["id"]
    client.patch(f"{API}/services/{service_id}", headers=headers, json={"isTaxable": False})
    assert client.get(f"{API}/bookings/{booking_id}", headers=headers).json()["serviceIsTaxable"] is False
