from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from fastapi import APIRouter, Depends, Query
from fastapi.responses import Response
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.dependencies.auth import require_tenant_permission
from app.core.http import api_exception
from app.db.models import Location, Provider, Tenant, User
from app.db.session import get_db_session
from app.schemas.reports import (
    AppointmentsReportResponse,
    ClientsReportResponse,
    SalesReportResponse,
    TeamReportResponse,
)
from app.services.auth import effective_permissions_for_user
from app.services.reports.appointments import build_appointments_report
from app.services.reports.clients import build_clients_report
from app.services.reports.csv_export import (
    appointments_sections,
    clients_sections,
    range_label,
    render_csv,
    sales_sections,
    team_sections,
)
from app.services.reports.ranges import ReportRange, build_range
from app.services.reports.sales import build_sales_report
from app.services.reports.team import build_team_report
from app.services.tenants import get_tenant_by_slug

router = APIRouter(prefix="/tenants/{tenant_slug}/reports", tags=["reports"])


@dataclass
class _Filters:
    """Common report query parameters, validated against the tenant."""

    start_date: date
    end_date: date
    group_by: str
    location_id: str | None
    provider_id: str | None
    export_format: str


def report_filters(
    start_date: date = Query(alias="from"),
    end_date: date = Query(alias="to"),
    group_by: str = Query(default="day", alias="groupBy"),
    location_id: str | None = Query(default=None, alias="locationId"),
    provider_id: str | None = Query(default=None, alias="providerId"),
    export_format: str = Query(default="json", alias="format"),
) -> _Filters:
    return _Filters(start_date, end_date, group_by, location_id, provider_id, export_format)


async def _resolve(
    session: AsyncSession, tenant_slug: str, filters: _Filters
) -> tuple[Tenant, ReportRange]:
    tenant = await get_tenant_by_slug(session, tenant_slug)
    location = None
    if filters.location_id:
        location = await session.scalar(
            select(Location).where(Location.id == filters.location_id, Location.tenant_id == tenant.id)
        )
        if location is None:
            raise api_exception(404, "not_found", "Location was not found for this tenant.")
    if filters.provider_id:
        found = await session.scalar(
            select(Provider.id).where(Provider.id == filters.provider_id, Provider.tenant_id == tenant.id)
        )
        if found is None:
            raise api_exception(404, "not_found", "Provider was not found for this tenant.")
    if filters.export_format not in ("json", "csv"):
        raise api_exception(422, "validation_error", "format must be json or csv.")
    return tenant, build_range(tenant, filters.start_date, filters.end_date, filters.group_by, location)


async def _permissions(session: AsyncSession, user: User) -> set[str]:
    return await effective_permissions_for_user(session, user)


def _csv_response(title: str, report, sections, filename: str) -> Response:
    body = render_csv(title, range_label(report), sections)
    return Response(
        content=body,
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


def _require_export(permissions: set[str]) -> None:
    if "reports.export" not in permissions:
        raise api_exception(403, "forbidden", "You do not have permission to export reports.")


def _filename(kind: str, rng: ReportRange) -> str:
    return f"{kind}-report-{rng.start}-to-{rng.end}.csv"


@router.get("/sales", response_model=SalesReportResponse, summary="Sales report")
async def sales_report_route(
    tenant_slug: str,
    filters: _Filters = Depends(report_filters),
    compare: str | None = Query(default=None, pattern="^(prior_period|prior_year)$"),
    user: User = Depends(require_tenant_permission("reports.financial")),
    session: AsyncSession = Depends(get_db_session),
):
    tenant, rng = await _resolve(session, tenant_slug, filters)
    if filters.export_format == "csv":
        _require_export(await _permissions(session, user))
    report = await build_sales_report(
        session, tenant, rng, location_id=filters.location_id, provider_id=filters.provider_id, compare=compare
    )
    if filters.export_format == "csv":
        return _csv_response("Sales report", report, sales_sections(report), _filename("sales", rng))
    return report


@router.get("/team", response_model=TeamReportResponse, summary="Team report")
async def team_report_route(
    tenant_slug: str,
    filters: _Filters = Depends(report_filters),
    user: User = Depends(require_tenant_permission("reports.view")),
    session: AsyncSession = Depends(get_db_session),
):
    tenant, rng = await _resolve(session, tenant_slug, filters)
    permissions = await _permissions(session, user)
    if filters.export_format == "csv":
        _require_export(permissions)
    report = await build_team_report(
        session,
        tenant,
        rng,
        include_financial="reports.financial" in permissions,
        location_id=filters.location_id,
        provider_id=filters.provider_id,
    )
    if filters.export_format == "csv":
        return _csv_response("Team report", report, team_sections(report), _filename("team", rng))
    return report


@router.get("/clients", response_model=ClientsReportResponse, summary="Clients report")
async def clients_report_route(
    tenant_slug: str,
    filters: _Filters = Depends(report_filters),
    user: User = Depends(require_tenant_permission("reports.view")),
    session: AsyncSession = Depends(get_db_session),
):
    tenant, rng = await _resolve(session, tenant_slug, filters)
    permissions = await _permissions(session, user)
    if filters.export_format == "csv":
        _require_export(permissions)
    report = await build_clients_report(
        session, tenant, rng, include_financial="reports.financial" in permissions
    )
    if filters.export_format == "csv":
        return _csv_response("Clients report", report, clients_sections(report), _filename("clients", rng))
    return report


@router.get("/appointments", response_model=AppointmentsReportResponse, summary="Appointments report")
async def appointments_report_route(
    tenant_slug: str,
    filters: _Filters = Depends(report_filters),
    user: User = Depends(require_tenant_permission("reports.view")),
    session: AsyncSession = Depends(get_db_session),
):
    tenant, rng = await _resolve(session, tenant_slug, filters)
    if filters.export_format == "csv":
        _require_export(await _permissions(session, user))
    report = await build_appointments_report(
        session, tenant, rng, location_id=filters.location_id, provider_id=filters.provider_id
    )
    if filters.export_format == "csv":
        return _csv_response("Appointments report", report, appointments_sections(report), _filename("appointments", rng))
    return report
