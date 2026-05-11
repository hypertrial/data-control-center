"""SQL execution endpoint."""

from fastapi import APIRouter

from app.api.deps import RegistryDep, SettingsDep
from app.models.api import QueryRequest, QueryResult
from app.services.query import execute_query

router = APIRouter(prefix="/api", tags=["query"])


@router.post("/query", response_model=QueryResult)
def run_query(
    body: QueryRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> QueryResult:
    return execute_query(registry, settings, body)
