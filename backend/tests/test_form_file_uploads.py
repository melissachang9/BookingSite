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


@pytest.fixture()
def media_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Point the upload media root at an isolated temp directory."""
    media_root = tmp_path / "media"
    monkeypatch.setenv("MEDIA_ROOT", str(media_root))
    return media_root


def test_upload_form_file_success(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": "tenant-a"},
        files={"file": ("headshot.png", PNG_BYTES, "image/png")},
    )

    assert response.status_code == 200
    body = response.json()
    assert body["fileName"] == "headshot.png"
    assert body["mimeType"] == "image/png"
    assert body["fileSizeBytes"] == len(PNG_BYTES)
    assert body["url"].endswith(f"/forms/files/{body['id']}")

    # File is stored under the tenant's own subdirectory.
    tenant_dir = media_dir / "tenant-a"
    stored = list(tenant_dir.iterdir())
    assert len(stored) == 1
    assert stored[0].name.startswith(body["id"])
    assert stored[0].read_bytes() == PNG_BYTES


def test_upload_rejects_unsupported_type(media_dir: Path, client: TestClient) -> None:
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": "tenant-a"},
        files={"file": ("notes.txt", b"hello", "text/plain")},
    )

    assert response.status_code == 400
    assert "Unsupported file type" in response.json()["error"]["message"]


def test_upload_rejects_oversized_file(media_dir: Path, client: TestClient) -> None:
    oversized = b"\x00" * (10 * 1024 * 1024 + 1)
    response = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": "tenant-a"},
        files={"file": ("big.png", oversized, "image/png")},
    )

    assert response.status_code == 400
    assert "File too large" in response.json()["error"]["message"]


def test_serve_uploaded_file_round_trip(media_dir: Path, client: TestClient) -> None:
    upload = client.post(
        "/api/v1/forms/upload",
        data={"tenant_id": "tenant-a"},
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
