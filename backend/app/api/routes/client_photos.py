from __future__ import annotations

from fastapi import APIRouter, Depends, Form, Response, UploadFile
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.core.rate_limit import rate_limit
from app.db.models import User
from app.db.session import get_db_session
from app.schemas.client_photos import ClientPhotoCategoriesResponse, ClientPhotoListResponse, ClientPhotoResponse, UpdateClientPhotoRequest
from app.services.client_photos import (
    client_photo_file,
    delete_client_photo,
    list_client_photos,
    list_photo_categories,
    update_client_photo,
    upload_client_photo,
)

router = APIRouter(tags=["client-photos"])

BASE = "/tenants/{tenant_slug}/customers/{customer_id}/photos"


@router.get(
    "/tenants/{tenant_slug}/photo-categories",
    response_model=ClientPhotoCategoriesResponse,
    summary="List the custom photo categories this business uses",
)
async def list_photo_categories_route(
    tenant_slug: str,
    _: object = Depends(require_tenant_permission("photos.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ClientPhotoCategoriesResponse:
    return await list_photo_categories(session, tenant_slug)


@router.get(BASE, response_model=ClientPhotoListResponse, summary="List a client's photos")
async def list_photos_route(
    tenant_slug: str,
    customer_id: str,
    _: object = Depends(require_tenant_permission("photos.view")),
    session: AsyncSession = Depends(get_db_session),
) -> ClientPhotoListResponse:
    return await list_client_photos(session, tenant_slug, customer_id)


@router.post(
    BASE,
    response_model=ClientPhotoResponse,
    status_code=201,
    summary="Upload a client photo",
    dependencies=[Depends(rate_limit("client-photo-upload", limit=60, window_seconds=600))],
)
async def upload_photo_route(
    tenant_slug: str,
    customer_id: str,
    file: UploadFile,
    kind: str = Form("other"),
    caption: str | None = Form(None),
    booking_id: str | None = Form(None, alias="bookingId"),
    actor: User = Depends(require_tenant_permission("photos.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ClientPhotoResponse:
    return await upload_client_photo(
        session, tenant_slug, customer_id, file, kind=kind, caption=caption, booking_id=booking_id, actor=actor
    )


@router.get(BASE + "/{photo_id}/file", summary="Download a client photo")
async def photo_file_route(
    tenant_slug: str,
    customer_id: str,
    photo_id: str,
    _: object = Depends(require_tenant_permission("photos.view")),
    session: AsyncSession = Depends(get_db_session),
) -> FileResponse:
    path, mime = await client_photo_file(session, tenant_slug, customer_id, photo_id)
    return FileResponse(
        path=str(path),
        media_type=mime,
        headers={
            "Cache-Control": "private, no-store",
            "X-Content-Type-Options": "nosniff",
            "Content-Security-Policy": "default-src 'none'; sandbox",
        },
    )


@router.patch(BASE + "/{photo_id}", response_model=ClientPhotoResponse, summary="Edit a photo's caption or kind")
async def update_photo_route(
    tenant_slug: str,
    customer_id: str,
    photo_id: str,
    payload: UpdateClientPhotoRequest,
    actor: User = Depends(require_tenant_permission("photos.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> ClientPhotoResponse:
    return await update_client_photo(session, tenant_slug, customer_id, photo_id, payload, actor)


@router.delete(BASE + "/{photo_id}", status_code=204, summary="Remove a client photo")
async def delete_photo_route(
    tenant_slug: str,
    customer_id: str,
    photo_id: str,
    actor: User = Depends(require_tenant_permission("photos.manage")),
    session: AsyncSession = Depends(get_db_session),
) -> Response:
    await delete_client_photo(session, tenant_slug, customer_id, photo_id, actor)
    return Response(status_code=204)
