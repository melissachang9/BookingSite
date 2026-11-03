"""Form attachment upload + serve endpoints (Phase 2 file pipeline)."""

from __future__ import annotations

from pathlib import Path

import pytest
from fastapi.testclient import TestClient

# Minimal valid 1x1 PNG.
PNG_BYTES = (
    b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01"
    b"\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\nIDATx\x9cc\x00\x01"
    b"\x00\x00\x05\x00\x01\x0d\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82"
)


TENANT_SLUG = "brow-beauty-lab"


def _tenant_id(client: TestClient) -> str:
    return client.get(f"/api/v1/tenants/{TENANT_SLUG}").json()["id"]


@pytest.fixture()
def media_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the upload media root at an isolated temp directory."""
    media_root = tmp_path / "media"
    monkeypatch.setenv("MEDIA_ROOT", str(media_root))
    return media_root


def test_upload_form_file_success(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("headshot.png", PNG_BYTES, "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["fileName"] == "headshot.png"
    assert body["mimeType"] == "image/png"
    assert body["fileSizeBytes"] == len(PNG_BYTES)
    assert body["url"].endswith(f"/forms/files/{body['id']}")

    # File is stored under the tenant's own id, with an extension chosen from its contents.
    tenant_dir = media_dir / _tenant_id(client)
    stored = list(tenant_dir.iterdir())
    assert len(stored) == 1
    assert stored[0].name == f"{body['id']}.png"
    assert stored[0].read_bytes() == PNG_BYTES


def test_upload_rejects_unsupported_type(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["error"]["message"]


def test_upload_rejects_oversized_file(media_dir: Path, client: TestClient) -> None:
    oversized = b"\x00" * (10 * 1024 * 1024 + 1)
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("big.png", oversized, "image/png")},
    )

    assert response.status_code == 400
    assert "File too large" in response.json()["error"]["message"]


def test_serve_uploaded_file_round_trip(media_dir: Path, client: TestClient) -> None:
    upload = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("headshot.png", PNG_BYTES, "image/png")},
    )
    file_id = upload.json()["id"]

    served = client.get(f"/api/v1/forms/files/{file_id}")
    assert served.status_code == 200
    assert served.headers["content-type"] == "image/png"
    assert served.content == PNG_BYTES


def test_serve_missing_file_returns_404(media_dir: Path, client: TestClient) -> None:
    response = client.get("/api/v1/forms/files/does-not-exist")
    assert response.status_code == 404


def test_upload_accepts_the_business_id_as_well_as_its_slug(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": _tenant_id(client)},
        files={"file": ("a.png", PNG_BYTES, "image/png")},
    )
    assert response.status_code == 200
    assert list((media_dir / _tenant_id(client)).iterdir())


def test_upload_cannot_steer_the_folder_or_use_an_unknown_business(media_dir: Path, client: TestClient) -> None:
    for tenant in ("../escape", "..", "tenant-a", "/etc"):
        response = client.post(
            "/api/v1/forms/upload",
            data={"tenant_id": tenant},
            files={"file": ("a.png", PNG_BYTES, "image/png")},
        )
        assert response.status_code == 404, tenant
    assert not media_dir.exists() or not any(media_dir.rglob("*.png"))
    assert not (media_dir.parent / "escape").exists()


def test_upload_judges_the_bytes_not_the_claimed_type_or_filename(media_dir: Path, client: TestClient) -> None:
    fake = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("photo.png", b"<script>alert(1)</script>", "image/png")},
    )
    assert fake.status_code == 400

    renamed = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("../../evil.html", PNG_BYTES, "text/html")},
    )
    assert renamed.status_code == 200
    body = renamed.json()
    assert body["mimeType"] == "image/png"
    stored = [p.name for p in media_dir.rglob("*") if p.is_file()]
    assert stored == [f"{body['id']}.png"]


def test_pdf_upload_is_recognised(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("consent.pdf", b"%PDF-1.7\n%\xe2\xe3\xcf\xd3\n", "application/pdf")},
    )
    assert response.status_code == 200, response.json()
    assert response.json()["mimeType"] == "application/pdf"


def test_serving_needs_the_exact_id_never_a_prefix(media_dir: Path, client: TestClient) -> None:
    upload = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": TENANT_SLUG},
        files={"file": ("headshot.png", PNG_BYTES, "image/png")},
    )
    file_id = upload.json()["id"]
    for guess in (file_id[0], file_id[:8], file_id[:-1], "..", "%2e%2e", file_id + "x"):
        assert client.get(f"/api/v1/forms/files/{guess}").status_code == 404, guess

    served = client.get(f"/api/v1/forms/files/{file_id}")
    assert served.status_code == 200
    assert served.headers["x-content-type-options"] == "nosniff"
