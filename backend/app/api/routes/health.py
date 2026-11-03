from fastapi import APIRouter
from fastapi.responses import JSONResponse
from sqlalchemy import text

from app.core.config import get_settings
from app.db.session import get_engine


router = APIRouter(prefix="/health", tags=["health"])


@router.get("/live")
async def live_health() -> dict[str, str]:
    settings = get_settings()
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
    }


@router.get("/ready")
async def ready_health():
    """Ready only when the database answers, so load balancers and monitors see a real outage."""
    settings = get_settings()
    try:
        async with get_engine().connect() as connection:
            await connection.execute(text("SELECT 1"))
    except Exception:
        return JSONResponse(
            status_code=503,
            content={
                "error": {"code": "not_ready", "message": "The database is not reachable."},
                "status": "unavailable",
                "service": settings.app_name,
                "environment": settings.app_env,
            },
        )
    return {
        "status": "ok",
        "service": settings.app_name,
        "environment": settings.app_env,
    }
