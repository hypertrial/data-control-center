"""Local frontend bootstrap for the per-process API token."""

from __future__ import annotations

from fastapi import APIRouter, Request

router = APIRouter(prefix="/api", tags=["local-session"])


@router.get("/local-session")
def local_session(request: Request) -> dict[str, object]:
    return {
        "token": getattr(request.app.state, "local_api_token", ""),
        "local_only": bool(request.app.state.settings.local_only),
    }
