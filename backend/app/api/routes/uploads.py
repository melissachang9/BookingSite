"""File upload and serve endpoints for form attachments."""

from __future__ import annotations

import os
import uuid
from pathlib import Path

from fastapi import APIRouter, Depends, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.core.config import get_settings, Settings

router = APIRouter(tags=["uploads"])

ALLOWED_MIME_TYPES = {
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "image/heic",
    "image/heif",
    "application/pdf",
}
MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024  # 10 MB


def _media_dir(settings: Settings) -> Path:
    path = Path(settings.media_root)
    path.mkdir(parents=True, exist_ok=True)
    return path


@router.post(
    "/forms/upload",
    summary="Upload a file attachment for a form field",
)
async def upload_form_file(
    file: UploadFile,
    tenant_id: str = Form(...),
    settings: Settings = Depends(get_settings),
) -> dict:
    if file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: {file.content_type}. Allowed: {', '.join(sorted(ALLOWED_MIME_TYPES))}",
        )

    contents = await file.read()
    if len(contents) > MAX_FILE_SIZE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"File too large ({len(contents)} bytes). Maximum: {MAX_FILE_SIZE_BYTES} bytes.",
        )

    file_id = str(uuid.uuid4())
    ext = os.path.splitext(file.filename or "file")[1] or ".bin"
    safe_name = f"{file_id}{ext}"

    tenant_dir = _media_dir(settings) / tenant_id
    tenant_dir.mkdir(parents=True, exist_ok=True)

    file_path = tenant_dir / safe_name
    file_path.write_bytes(contents)

    return {
        "id": file_id,
        "fileName": file.filename,
        "mimeType": file.content_type,
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
    media = _media_dir(settings)
    # Search all tenant subdirectories for the file
    for tenant_dir in media.iterdir():
        if not tenant_dir.is_dir():
            continue
        for entry in tenant_dir.iterdir():
            if entry.is_file() and entry.name.startswith(file_id):
                return FileResponse(
                    path=str(entry),
                    media_type=_guess_mime(entry.name),
                )

    raise HTTPException(status_code=404, detail="File not found")


def _guess_mime(filename: str) -> str:
    ext = os.path.splitext(filename)[1].lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".gif": "image/gif",
        ".webp": "image/webp",
        ".heic": "image/heic",
        ".heif": "image/heif",
        ".pdf": "application/pdf",
    }.get(ext, "application/octet-stream")
