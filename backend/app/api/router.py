from fastapi import APIRouter

from app.api.routes.auth import router as auth_router
from app.api.routes.bookings import router as bookings_router
from app.api.routes.booking_drafts import router as booking_drafts_router
from app.api.routes.customers import router as customers_router
from app.api.routes.health import router as health_router
from app.api.routes.payments import router as payments_router
from app.api.routes.tenants import router as tenants_router
from app.api.routes.testing import router as testing_router
from app.core.config import get_settings


api_router = APIRouter()


@api_router.get("/")
async def api_root() -> dict[str, str]:
	settings = get_settings()
	return {
		"message": "Booking Platform API is running",
		"environment": settings.app_env,
		"version": "v1",
	}


api_router.include_router(auth_router)
api_router.include_router(tenants_router)
api_router.include_router(bookings_router)
api_router.include_router(booking_drafts_router)
api_router.include_router(customers_router)
api_router.include_router(payments_router)
api_router.include_router(health_router)
api_router.include_router(testing_router)