"""FastAPI application entrypoint."""

from __future__ import annotations

from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

from app.api.agent import router as agent_router
from app.api.ask import router as ask_router
from app.api.datasets import router as datasets_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.local_session import router as local_session_router
from app.api.query import router as query_router
from app.api.saved_queries import router as saved_queries_router
from app.config import get_settings
from app.errors import AppError, app_error_handler, http_error_handler, unhandled_error_handler
from app.security import generate_local_api_token, local_security_middleware
from app.services.jobs import JobService
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = app.state.settings
    workspace = Workspace(settings)
    registry = DatasetRegistry(workspace, settings)
    jobs = JobService(workspace)

    app.state.settings = settings
    app.state.workspace = workspace
    app.state.registry = registry
    app.state.jobs = jobs
    yield
    jobs.shutdown()
    workspace.close()


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(title="Data Control Center API", lifespan=lifespan)
    app.state.settings = settings
    app.state.local_api_token = generate_local_api_token(settings)
    app.middleware("http")(local_security_middleware)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=False,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.add_exception_handler(AppError, app_error_handler)
    app.add_exception_handler(HTTPException, http_error_handler)
    app.add_exception_handler(Exception, unhandled_error_handler)

    app.include_router(health_router)
    app.include_router(local_session_router)
    app.include_router(datasets_router)
    app.include_router(query_router)
    app.include_router(agent_router)
    app.include_router(ask_router)
    app.include_router(saved_queries_router)
    app.include_router(jobs_router)
    return app


app = create_app()
