"""Shared FastAPI dependencies."""

from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Request

from app.config import Settings
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


def get_settings(request: Request) -> Settings:
    return request.app.state.settings


def get_workspace(request: Request) -> Workspace:
    return request.app.state.workspace


def get_registry(request: Request) -> DatasetRegistry:
    return request.app.state.registry


SettingsDep = Annotated[Settings, Depends(get_settings)]
WorkspaceDep = Annotated[Workspace, Depends(get_workspace)]
RegistryDep = Annotated[DatasetRegistry, Depends(get_registry)]
