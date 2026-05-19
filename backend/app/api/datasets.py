"""Dataset API router aggregate."""

from __future__ import annotations

from fastapi import APIRouter

from app.api import datasets_inspect, datasets_profile, datasets_upload
from app.api.datasets_inspect import list_datasets
from app.models.api import DatasetSummary

router = APIRouter(prefix="/api/datasets", tags=["datasets"])
router.add_api_route("", list_datasets, methods=["GET"], response_model=list[DatasetSummary])
router.include_router(datasets_upload.router)
router.include_router(datasets_inspect.router)
router.include_router(datasets_profile.router)

__all__ = ["router"]
