"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.datasets import router as datasets_router
from app.api.health import router as health_router
from app.api.query import router as query_router
from app.config import get_settings
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = get_settings()
    workspace = Workspace(settings)
    registry = DatasetRegistry(workspace)
    app.state.settings = settings
    app.state.workspace = workspace
    app.state.registry = registry
    yield
    workspace.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Data Control Center API", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(health_router)
    app.include_router(datasets_router)
    app.include_router(query_router)
    app.include_router(agent_router)
    return app


app = create_app()
