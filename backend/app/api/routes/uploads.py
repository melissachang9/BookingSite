"""File upload and serve endpoints for form attachments."""

from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings, Settings
from app.core.rate_limit import rate_limit
from app.db.models import Tenant
from app.db.session import get_db_session

router = APIRouter(tags=["uploads"])

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


def _media_dir(settings: Settings) -> Path:
    path = Path(settings.media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


def _detect_mime(head: bytes) -> str | None:
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


def _is_uuid(value: str) -> bool:
    try:
        return str(uuid.UUID(value)) == value.lower()
    except ValueError:
        return False


@router.post(
    "/forms/upload",
    summary="Upload a file attachment for a form field",
    dependencies=[Depends(rate_limit("upload", limit=30, window_seconds=600))],
)
async def upload_form_file(
    file: UploadFile,
    tenant_id: str = Form(...),
    settings: Settings = Depends(get_settings),
    session: AsyncSession = Depends(get_db_session),
) -> dict:
    # Callers send the business's id or its slug; either must name a real business. The folder is always
    # the business's own id, so nothing the client types can steer where the file lands.
    tenant = await session.scalar(select(Tenant).where(or_(Tenant.id == tenant_id, Tenant.slug == tenant_id)))
    if tenant is None:
        raise HTTPException(status_code=404, detail="Business not found.")

    chunks: list[bytes] = []
    size = 0
    while chunk := await file.read(READ_CHUNK_BYTES):
        size += len(chunk)
        if size > MAX_FILE_SIZE_BYTES:
            raise HTTPException(
                status_code=400,
                detail=f"File too large. Maximum: {MAX_FILE_SIZE_BYTES} bytes.",
            )
        chunks.append(chunk)
    contents = b"".join(chunks)

    mime = _detect_mime(contents[:32])
    if mime is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(EXTENSION_BY_MIME))}",
        )

    file_id = str(uuid.uuid4())
    safe_name = f"{file_id}{EXTENSION_BY_MIME[mime]}"

    tenant_dir = _media_dir(settings) / tenant.id
    tenant_dir.mkdir(parents=True, exist_ok=True)
    (tenant_dir / safe_name).write_bytes(contents)

    return {
        "id": file_id,
        "fileName": file.filename,
        "mimeType": mime,
        "fileSizeBytes": len(contents),
        "url": f"{settings.media_base_url}/{file_id}",
    }


@router.get(
    "/forms/files/{file_id}",
    summary="Serve an uploaded form file",
)
async def serve_form_file(
    file_id: str,
    settings: Settings = Depends(get_settings),
):
    # The id is an unguessable UUID, so the link works as its own key for staff viewers and emails. It
    # must match a stored file exactly; a prefix or a path fragment never does.
    if not _is_uuid(file_id):
        raise HTTPException(status_code=404, detail="File not found")
    media = _media_dir(settings)
    for tenant_dir in media.iterdir():
        if not tenant_dir.is_dir():
            continue
        for extension, mime in MIME_BY_EXTENSION.items():
            candidate = tenant_dir / f"{file_id.lower()}{extension}"
            if candidate.is_file():
                return FileResponse(
                    path=str(candidate),
                    media_type=mime,
                    headers={"X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; sandbox"},
                )

    raise HTTPException(status_code=404, detail="File not found")
