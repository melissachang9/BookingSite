from fastapi import FastAPI

from app.api.router import api_router
from app.core.config import get_settings


def create_application() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title=settings.app_name, version="0.1.0")

    @application.get("/")
    async def root() -> dict[str, str]:
        return {
            "message": "Booking Platform API is running",
            "environment": settings.app_env,
            "version": "v1",
        }

    application.include_router(api_router, prefix=settings.api_prefix)
    return application


app = create_application()