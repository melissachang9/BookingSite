"""Before/after photos on a client's profile. Private to staff with permission."""
from __future__ import annotations

import uuid
from pathlib import Path

from fastapi import UploadFile
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.http import api_exception
from app.db.models import Booking, ClientPhoto, Customer, User
from app.schemas.client_photos import (
    BUILT_IN_KINDS,
    MAX_KIND_LENGTH,
    ClientPhotoCategoriesResponse,
    ClientPhotoListResponse,
    ClientPhotoResponse,
    UpdateClientPhotoRequest,
)
from app.services.audit import ActorRef, record_audit
from app.services.media import EXTENSION_BY_MIME, detect_mime, media_dir, read_upload_limited
from app.services.tenants import get_tenant_by_slug

# Photos only. The shared uploader also accepts PDFs for forms, which have no place here.
PHOTO_MIME_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"}
# Phone cameras routinely produce 5-15 MB originals, so photos get more room than form attachments (10 MB).
MAX_PHOTO_BYTES = 25 * 1024 * 1024
LIST_LIMIT = 200
PHOTO_FOLDER = "client-photos"


def _photo_dir(tenant_id: str) -> Path:
    # A subfolder of the business's media folder, so the public form-file route (which only looks at the top
    # level) can never serve these.
    path = media_dir(get_settings()) / tenant_id / PHOTO_FOLDER
    path.mkdir(parents=True, exist_ok=True)
    return path


def _to_response(photo: ClientPhoto) -> ClientPhotoResponse:
    return ClientPhotoResponse(
        id=photo.id,
        customer_id=photo.customer_id,
        booking_id=photo.booking_id,
        kind=photo.kind,
        caption=photo.caption,
        mime_type=photo.mime_type,
        file_size_bytes=photo.file_size_bytes,
        original_file_name=photo.original_file_name,
        uploaded_by_name=photo.uploaded_by_name,
        created_at=photo.created_at,
    )


async def _normalize_kind(session: AsyncSession, tenant_id: str, raw: str) -> str:
    """Built-in categories keep their canonical lowercase name; a custom one is trimmed, and reuses the spelling
    the business already has if it differs only by case."""
    cleaned = " ".join((raw or "").split())
    if not cleaned:
        raise api_exception(422, "validation_error", "Choose a category.")
    if len(cleaned) > MAX_KIND_LENGTH:
        raise api_exception(422, "validation_error", f"Category names can be up to {MAX_KIND_LENGTH} characters.")
    if cleaned.lower() in BUILT_IN_KINDS:
        return cleaned.lower()
    existing = await session.scalar(
        select(ClientPhoto.kind)
        .where(ClientPhoto.tenant_id == tenant_id, func.lower(ClientPhoto.kind) == cleaned.lower())
        .limit(1)
    )
    return existing or cleaned


async def list_photo_categories(session: AsyncSession, tenant_slug: str) -> ClientPhotoCategoriesResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    kinds = (
        await session.scalars(
            select(ClientPhoto.kind)
            .where(ClientPhoto.tenant_id == tenant.id, ClientPhoto.deleted_at.is_(None), ClientPhoto.kind.not_in(BUILT_IN_KINDS))
            .distinct()
            .order_by(ClientPhoto.kind)
        )
    ).all()
    return ClientPhotoCategoriesResponse(custom=list(kinds))


async def _load_customer(session: AsyncSession, tenant_id: str, customer_id: str) -> Customer:
    customer = await session.scalar(select(Customer).where(Customer.tenant_id == tenant_id, Customer.id == customer_id))
    if customer is None:
        raise api_exception(404, "not_found", "Customer was not found for this tenant.")
    return customer


async def _load_photo(session: AsyncSession, tenant_id: str, customer_id: str, photo_id: str) -> ClientPhoto:
    photo = await session.scalar(
        select(ClientPhoto).where(
            ClientPhoto.tenant_id == tenant_id,
            ClientPhoto.customer_id == customer_id,
            ClientPhoto.id == photo_id,
            ClientPhoto.deleted_at.is_(None),
        )
    )
    if photo is None:
        raise api_exception(404, "not_found", "Photo was not found for this client.")
    return photo


async def list_client_photos(session: AsyncSession, tenant_slug: str, customer_id: str) -> ClientPhotoListResponse:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    await _load_customer(session, tenant.id, customer_id)
    photos = (
        await session.scalars(
            select(ClientPhoto)
            .where(
                ClientPhoto.tenant_id == tenant.id,
                ClientPhoto.customer_id == customer_id,
                ClientPhoto.deleted_at.is_(None),
            )
            .order_by(ClientPhoto.created_at.desc())
            .limit(LIST_LIMIT)
        )
    ).all()
    return ClientPhotoListResponse(items=[_to_response(photo) for photo in photos])


async def upload_client_photo(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
    file: UploadFile,
    *,
    kind: str,
    caption: str | None,
    booking_id: str | None,
    actor: User,
) -> ClientPhotoResponse:
    actor_ref = ActorRef.from_user(actor)
    tenant = await get_tenant_by_slug(session, tenant_slug)
    tenant_id = tenant.id
    await _load_customer(session, tenant_id, customer_id)

    kind = await _normalize_kind(session, tenant_id, kind)
    cleaned_caption = (caption or "").strip() or None
    if cleaned_caption is not None and len(cleaned_caption) > 1000:
        raise api_exception(422, "validation_error", "Caption is too long.")

    if booking_id:
        booking = await session.scalar(
            select(Booking).where(Booking.tenant_id == tenant_id, Booking.id == booking_id, Booking.customer_id == customer_id)
        )
        if booking is None:
            raise api_exception(404, "not_found", "Booking was not found for this client.")
    else:
        booking_id = None

    contents = await read_upload_limited(file, MAX_PHOTO_BYTES)
    if not contents:
        raise api_exception(400, "bad_request", "The file is empty.")
    mime = detect_mime(contents[:32])
    if mime not in PHOTO_MIME_TYPES:
        raise api_exception(400, "bad_request", "Unsupported file type. Use a JPEG, PNG, WebP or HEIC photo.")

    photo_id = str(uuid.uuid4())
    stored_name = f"{photo_id}{EXTENSION_BY_MIME[mime]}"
    (_photo_dir(tenant_id) / stored_name).write_bytes(contents)

    photo = ClientPhoto(
        id=photo_id,
        tenant_id=tenant_id,
        customer_id=customer_id,
        booking_id=booking_id,
        kind=kind,
        caption=cleaned_caption,
        stored_name=stored_name,
        original_file_name=(file.filename or "")[:255] or None,
        mime_type=mime,
        file_size_bytes=len(contents),
        uploaded_by_user_id=actor_ref.id,
        uploaded_by_name=actor_ref.name,
    )
    session.add(photo)
    await session.flush()
    await record_audit(
        session,
        tenant_id=tenant_id,
        entity_type="client_photo",
        entity_id=photo_id,
        action="upload",
        actor=actor_ref,
        notes=f"{kind} photo for customer {customer_id}",
    )
    await session.commit()
    await session.refresh(photo)
    return _to_response(photo)


async def update_client_photo(
    session: AsyncSession,
    tenant_slug: str,
    customer_id: str,
    photo_id: str,
    payload: UpdateClientPhotoRequest,
    actor: User,
) -> ClientPhotoResponse:
    actor_ref = ActorRef.from_user(actor)
    tenant = await get_tenant_by_slug(session, tenant_slug)
    tenant_id = tenant.id
    photo = await _load_photo(session, tenant_id, customer_id, photo_id)

    changes: dict[str, object] = {}
    if payload.kind is not None:
        new_kind = await _normalize_kind(session, tenant_id, payload.kind)
        if new_kind != photo.kind:
            changes["kind"] = {"from": photo.kind, "to": new_kind}
            photo.kind = new_kind
    if payload.caption is not None:
        new_caption = payload.caption.strip() or None
        if new_caption != photo.caption:
            changes["caption"] = {"from": photo.caption, "to": new_caption}
            photo.caption = new_caption
    if changes:
        await record_audit(
            session, tenant_id=tenant_id, entity_type="client_photo", entity_id=photo_id, action="update", actor=actor_ref, changes=changes
        )
    await session.commit()
    await session.refresh(photo)
    return _to_response(photo)


async def delete_client_photo(session: AsyncSession, tenant_slug: str, customer_id: str, photo_id: str, actor: User) -> None:
    from datetime import datetime, timezone

    actor_ref = ActorRef.from_user(actor)
    tenant = await get_tenant_by_slug(session, tenant_slug)
    tenant_id = tenant.id
    photo = await _load_photo(session, tenant_id, customer_id, photo_id)
    photo.deleted_at = datetime.now(timezone.utc)
    photo.deleted_by_user_id = actor_ref.id
    photo.deleted_by_name = actor_ref.name
    await record_audit(
        session, tenant_id=tenant_id, entity_type="client_photo", entity_id=photo_id, action="delete", actor=actor_ref
    )
    await session.commit()


async def client_photo_file(session: AsyncSession, tenant_slug: str, customer_id: str, photo_id: str) -> tuple[Path, str]:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    photo = await _load_photo(session, tenant.id, customer_id, photo_id)
    path = _photo_dir(tenant.id) / photo.stored_name
    if not path.is_file():
        raise api_exception(404, "not_found", "The photo file is missing.")
    return path, photo.mime_type
