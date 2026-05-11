"""Health check."""

from fastapi import APIRouter

from app.models.api import HealthResponse

router = APIRouter(tags=["health"])


@router.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()
