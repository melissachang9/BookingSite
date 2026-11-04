"""Client photos: private before/after photos on a client's profile."""
from __future__ import annotations

from tests.test_booking_operations import _auth_headers, _confirm_paid_deposit_booking, _create_other_tenant_owner

BASE = "/api/v1/tenants/brow-beauty-lab"
PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
JPEG = b"\xff\xd8\xff\xe0" + b"\x00" * 64
PDF = b"%PDF-1.4\n" + b"\x00" * 64


def _customer_and_booking(client) -> tuple[str, str]:
    booking_id = _confirm_paid_deposit_booking(client)["booking"]["id"]
    return client.get(f"{BASE}/bookings/{booking_id}").json()["customerId"], booking_id


def _upload(client, headers, customer_id: str, data: bytes = PNG, name: str = "before.png", **form):
    return client.post(
        f"{BASE}/customers/{customer_id}/photos",
        headers=headers,
        files={"file": (name, data, "application/octet-stream")},
        data={"kind": "before", **form},
    )


def _limited_headers(client, owner, email: str, denied: list[str]) -> dict[str, str]:
    user_id = client.post(
        f"{BASE}/users",
        headers=owner,
        json={"email": email, "name": "Limited", "role": "staff", "initialPassword": "TempPass123"},
    ).json()["id"]
    client.put(
        f"{BASE}/users/{user_id}/permissions",
        headers=owner,
        json={"overrides": [{"key": key, "allowed": False} for key in denied]},
    )
    return _auth_headers(client, email, "TempPass123")


def test_upload_list_and_download_a_photo(client) -> None:
    owner = _auth_headers(client)
    customer_id, booking_id = _customer_and_booking(client)

    created = _upload(client, owner, customer_id, caption="  Day one  ", bookingId=booking_id)
    assert created.status_code == 201, created.text
    photo = created.json()
    assert photo["kind"] == "before"
    assert photo["caption"] == "Day one"
    assert photo["bookingId"] == booking_id
    assert photo["mimeType"] == "image/png"
    assert photo["uploadedByName"]
    assert "storedName" not in photo

    listed = client.get(f"{BASE}/customers/{customer_id}/photos", headers=owner).json()["items"]
    assert [item["id"] for item in listed] == [photo["id"]]

    file_response = client.get(f"{BASE}/customers/{customer_id}/photos/{photo['id']}/file", headers=owner)
    assert file_response.status_code == 200
    assert file_response.content == PNG
    assert file_response.headers["content-type"] == "image/png"
    assert file_response.headers["cache-control"] == "private, no-store"
    assert file_response.headers["x-content-type-options"] == "nosniff"


def test_only_photos_are_accepted_and_type_comes_from_the_bytes(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)

    assert _upload(client, owner, customer_id, data=PDF, name="scan.pdf").status_code == 400
    assert _upload(client, owner, customer_id, data=b"<script>alert(1)</script>", name="x.png").status_code == 400
    assert _upload(client, owner, customer_id, data=b"", name="empty.png").status_code == 400
    # A real JPEG named .png is stored as what it is.
    jpeg = _upload(client, owner, customer_id, data=JPEG, name="actually-a-jpeg.png")
    assert jpeg.status_code == 201
    assert jpeg.json()["mimeType"] == "image/jpeg"


def test_large_files_and_bad_fields_are_rejected(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)

    # Phone-sized originals are fine; only files past 25 MB are refused, with a message that names the limit.
    assert _upload(client, owner, customer_id, data=PNG + b"\x00" * (12 * 1024 * 1024)).status_code == 201
    too_big = _upload(client, owner, customer_id, data=PNG + b"\x00" * (25 * 1024 * 1024))
    assert too_big.status_code == 400
    assert "25 MB" in too_big.json()["error"]["message"]
    assert _upload(client, owner, customer_id, kind="   ").status_code == 422
    assert _upload(client, owner, customer_id, kind="x" * 41).status_code == 422
    assert _upload(client, owner, customer_id, bookingId="00000000-0000-0000-0000-000000000000").status_code == 404


def test_caption_and_kind_can_be_edited(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    photo = _upload(client, owner, customer_id).json()

    edited = client.patch(
        f"{BASE}/customers/{customer_id}/photos/{photo['id']}",
        headers=owner,
        json={"kind": "after", "caption": "Healed"},
    )
    assert edited.status_code == 200
    assert (edited.json()["kind"], edited.json()["caption"]) == ("after", "Healed")

    cleared = client.patch(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=owner, json={"caption": ""})
    assert cleared.json()["caption"] is None


def test_removing_a_photo_hides_it_and_keeps_an_audit_record(client) -> None:
    import asyncio

    from sqlalchemy import select

    from app.db.models import AuditEvent, ClientPhoto
    from app.db.session import get_session_maker

    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    photo = _upload(client, owner, customer_id).json()

    assert client.delete(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=owner).status_code == 204
    assert client.get(f"{BASE}/customers/{customer_id}/photos", headers=owner).json()["items"] == []
    assert client.get(f"{BASE}/customers/{customer_id}/photos/{photo['id']}/file", headers=owner).status_code == 404
    assert client.delete(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=owner).status_code == 404

    async def _state():
        async with get_session_maker()() as session:
            row = await session.scalar(select(ClientPhoto).where(ClientPhoto.id == photo["id"]))
            events = (await session.scalars(select(AuditEvent).where(AuditEvent.entity_id == photo["id"]))).all()
            return row, sorted(event.action for event in events)

    row, actions = asyncio.run(_state())
    assert row is not None and row.deleted_at is not None and row.deleted_by_name
    assert actions == ["delete", "upload"]


def test_permissions_gate_viewing_and_managing(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    photo = _upload(client, owner, customer_id).json()

    viewer_only = _limited_headers(client, owner, "viewer@browbeautylab.test", ["photos.manage"])
    assert client.get(f"{BASE}/customers/{customer_id}/photos", headers=viewer_only).status_code == 200
    assert client.get(f"{BASE}/customers/{customer_id}/photos/{photo['id']}/file", headers=viewer_only).status_code == 200
    assert _upload(client, viewer_only, customer_id).status_code == 403
    assert client.patch(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=viewer_only, json={"caption": "x"}).status_code == 403
    assert client.delete(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=viewer_only).status_code == 403

    blocked = _limited_headers(client, owner, "blocked@browbeautylab.test", ["photos.view", "photos.manage"])
    assert client.get(f"{BASE}/customers/{customer_id}/photos", headers=blocked).status_code == 403
    assert client.get(f"{BASE}/customers/{customer_id}/photos/{photo['id']}/file", headers=blocked).status_code == 403
    assert client.get(f"{BASE}/customers/{customer_id}/photos/{photo['id']}/file").status_code == 401


def test_photos_are_not_reachable_from_the_public_file_route(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    photo = _upload(client, owner, customer_id).json()

    assert client.get(f"/api/v1/forms/files/{photo['id']}").status_code == 404


def test_other_businesses_cannot_reach_a_clients_photos(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    photo = _upload(client, owner, customer_id).json()

    email, password = _create_other_tenant_owner(client)
    other = _auth_headers(client, email, password)
    other_base = f"/api/v1/tenants/other-tenant/customers/{customer_id}/photos"

    assert client.get(other_base, headers=other).status_code == 404
    assert client.get(f"{other_base}/{photo['id']}/file", headers=other).status_code == 404
    assert _upload_other(client, other, other_base).status_code == 404
    assert client.delete(f"{other_base}/{photo['id']}", headers=other).status_code == 404
    # And this business's own login cannot read the other business's path.
    assert client.get(f"{BASE}/customers/{customer_id}/photos", headers=other).status_code in (401, 403, 404)


def _upload_other(client, headers, url: str):
    return client.post(url, headers=headers, files={"file": ("a.png", PNG, "image/png")}, data={"kind": "before"})


def test_businesses_can_make_their_own_photo_categories(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    assert client.get(f"{BASE}/photo-categories", headers=owner).json() == {"custom": []}

    created = _upload(client, owner, customer_id, kind="  Touch   up ")
    assert created.status_code == 201
    assert created.json()["kind"] == "Touch up"

    # Built-ins keep their canonical name whatever the case, and a custom name reuses the existing spelling.
    assert _upload(client, owner, customer_id, kind="BEFORE").json()["kind"] == "before"
    assert _upload(client, owner, customer_id, kind="touch UP").json()["kind"] == "Touch up"

    assert client.get(f"{BASE}/photo-categories", headers=owner).json() == {"custom": ["Touch up"]}

    photo = created.json()
    edited = client.patch(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=owner, json={"kind": "Progress"})
    assert edited.status_code == 200 and edited.json()["kind"] == "Progress"
    assert client.patch(f"{BASE}/customers/{customer_id}/photos/{photo['id']}", headers=owner, json={"kind": ""}).status_code == 422
    assert client.get(f"{BASE}/photo-categories", headers=owner).json()["custom"] == ["Progress", "Touch up"]


def test_custom_categories_are_private_to_their_business(client) -> None:
    owner = _auth_headers(client)
    customer_id, _ = _customer_and_booking(client)
    assert _upload(client, owner, customer_id, kind="Secret category").status_code == 201

    email, password = _create_other_tenant_owner(client)
    other = _auth_headers(client, email, password)
    assert client.get("/api/v1/tenants/other-tenant/photo-categories", headers=other).json() == {"custom": []}
    assert client.get(f"{BASE}/photo-categories").status_code == 401
