"""Natural-language data agent (local Ollama)."""

from __future__ import annotations

from fastapi import APIRouter

from app.api.deps import RegistryDep, SettingsDep
from app.models.api import AgentAskRequest, AgentAskResponse
from app.services.agent import run_agent_ask

router = APIRouter(prefix="/api", tags=["agent"])


@router.post("/agent/ask", response_model=AgentAskResponse)
def agent_ask(
    body: AgentAskRequest,
    registry: RegistryDep,
    settings: SettingsDep,
) -> AgentAskResponse:
    return run_agent_ask(registry, settings, body)
