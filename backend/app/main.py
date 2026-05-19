from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.router import api_router
from app.core.config import get_settings
from app.db.seed import seed_demo_data
from app.db.session import dispose_engine, get_session_maker, initialize_database


@asynccontextmanager
async def lifespan(_: FastAPI):
    await initialize_database()
    async with get_session_maker()() as session:
        await seed_demo_data(session)
    yield
    await dispose_engine()


def _error_code_for_status(status_code: int) -> str:
    if status_code == 401:
        return "unauthorized"
    if status_code == 403:
        return "forbidden"
    if status_code == 404:
        return "not_found"
    if status_code == 409:
        return "conflict"
    return "bad_request"


def create_application() -> FastAPI:
    settings = get_settings()
    application = FastAPI(title=settings.app_name, version=settings.app_version, lifespan=lifespan)

    application.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origin_list,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @application.exception_handler(HTTPException)
    async def http_exception_handler(_, exc: HTTPException) -> JSONResponse:
        detail = exc.detail if isinstance(exc.detail, dict) else None
        error_payload = {
            "code": detail.get("code") if detail else _error_code_for_status(exc.status_code),
            "message": detail.get("message") if detail else str(exc.detail),
            "issues": detail.get("issues") if detail else [],
        }
        return JSONResponse(status_code=exc.status_code, content={"error": error_payload})

    @application.exception_handler(RequestValidationError)
    async def validation_exception_handler(_, exc: RequestValidationError) -> JSONResponse:
        issues = [
            {
                "field": ".".join(str(part) for part in error["loc"] if part not in {"body", "query", "path"}),
                "message": error["msg"],
                "code": error["type"],
            }
            for error in exc.errors()
        ]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Request validation failed.",
                    "issues": issues,
                }
            },
        )

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