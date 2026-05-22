"""FastAPI application entrypoint."""

from __future__ import annotations

import logging
from contextlib import asynccontextmanager
from urllib.parse import urlsplit

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, RedirectResponse

from app.api.agent import router as agent_router
from app.api.ask import router as ask_router
from app.api.datasets import router as datasets_router
from app.api.health import router as health_router
from app.api.jobs import router as jobs_router
from app.api.llm import router as llm_router
from app.api.local_session import router as local_session_router
from app.api.query import router as query_router
from app.api.saved_charts import router as saved_charts_router
from app.api.saved_queries import router as saved_queries_router
from app.config import get_settings
from app.errors import AppError, app_error_handler, http_error_handler, unhandled_error_handler
from app.security import generate_local_api_token, local_security_middleware
from app.services.jobs import JobService
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(app: FastAPI):
    settings = app.state.settings
    workspace = Workspace(settings)
    registry = DatasetRegistry(workspace, settings)
    api_token = generate_local_api_token(settings)
    jobs = JobService(workspace, redact_secrets=(api_token,) if api_token else ())

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
    app.include_router(llm_router)
    app.include_router(local_session_router)
    app.include_router(datasets_router)
    app.include_router(query_router)
    app.include_router(agent_router)
    app.include_router(ask_router)
    app.include_router(saved_charts_router)
    app.include_router(saved_queries_router)
    app.include_router(jobs_router)

    if settings.ui_dist_path is None and settings.dev_ui_origin:
        parsed_dev_ui = urlsplit(settings.dev_ui_origin)
        if parsed_dev_ui.scheme != "http" or parsed_dev_ui.hostname not in {"localhost", "127.0.0.1", "::1"}:
            logger.warning("DCC_DEV_UI_ORIGIN must be a local http origin: %s", settings.dev_ui_origin)
        else:

            @app.get("/", include_in_schema=False)
            async def dev_ui_redirect() -> RedirectResponse:
                return RedirectResponse(settings.dev_ui_origin.rstrip("/") + "/")

    if settings.ui_dist_path is not None:
        ui_root = settings.ui_dist_path.expanduser()
        if not ui_root.is_dir():
            logger.warning("DCC_UI_DIST_PATH is set but not a directory: %s", ui_root)
        else:
            resolved_root = ui_root.resolve()
            index_file = resolved_root / "index.html"
            if not index_file.is_file():
                logger.warning("DCC_UI_DIST_PATH has no index.html: %s", resolved_root)
            else:

                @app.get("/", include_in_schema=False)
                async def ui_index() -> FileResponse:
                    return FileResponse(index_file)

                @app.get("/{full_path:path}", include_in_schema=False)
                async def ui_spa_or_static(full_path: str) -> FileResponse:
                    # API routes are registered above and take precedence over this pattern.
                    if full_path == "api" or full_path.startswith("api/"):
                        raise HTTPException(status_code=404)
                    target = (resolved_root / full_path).resolve()
                    try:
                        target.relative_to(resolved_root)
                    except ValueError:
                        return FileResponse(index_file)
                    if target.is_file():
                        return FileResponse(target)
                    return FileResponse(index_file)

    return app


app = create_app()
