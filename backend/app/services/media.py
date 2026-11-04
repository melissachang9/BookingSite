"""Shared handling for uploaded files: type detection from the bytes, size cap, storage location."""
from __future__ import annotations

from pathlib import Path

from fastapi import UploadFile

from app.core.config import Settings
from app.core.http import api_exception

# Detected from the file's own bytes, never from the client's filename or Content-Type.
EXTENSION_BY_MIME = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/gif": ".gif",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
    "application/pdf": ".pdf",
}
MIME_BY_EXTENSION = {ext: mime for mime, ext in EXTENSION_BY_MIME.items()} | {".jpeg": "image/jpeg"}
HEIF_BRANDS = {b"heic", b"heix", b"hevc", b"hevx", b"heim", b"heis", b"mif1", b"msf1"}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB
READ_CHUNK_BYTES = 1024 * 1024


def media_dir(settings: Settings) -> Path:
    path = Path(settings.media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def detect_mime(head: bytes) -> str | None:
    if head.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if head.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp"
    if head.startswith(b"%PDF-"):
        return "application/pdf"
    if head[4:8] == b"ftyp":
        brand = head[8:12]
        if brand in HEIF_BRANDS:
            return "image/heic" if brand.startswith(b"hei") or brand == b"hevc" else "image/heif"
    return None


async def read_upload_limited(file: UploadFile, max_bytes: int = MAX_FILE_SIZE_BYTES) -> bytes:
    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(READ_CHUNK_BYTES):
        size += len(chunk)
        if size > max_bytes:
            raise api_exception(400, "bad_request", f"File too large. Maximum: {max_bytes // (1024 * 1024)} MB.")
        chunks.append(chunk)
    return b"".join(chunks)
