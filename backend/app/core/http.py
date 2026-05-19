from __future__ import annotations

from collections.abc import Sequence

from fastapi import HTTPException


def api_exception(
    status_code: int,
    code: str,
    message: str,
    issues: Sequence[dict[str, str]] | None = None,
) -> HTTPException:
    return HTTPException(
        status_code=status_code,
        detail={
            "code": code,
            "message": message,
            "issues": list(issues or []),
        },
    )