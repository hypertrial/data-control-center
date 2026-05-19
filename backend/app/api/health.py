"""Health check."""

from fastapi import APIRouter, Request

from app.models.api import HealthResponse
from app.services.llm_health import check_llm_health

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
def health(request: Request) -> HealthResponse:
    settings = request.app.state.settings
    llm = check_llm_health(settings)
    return HealthResponse(llm=llm)
