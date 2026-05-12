"""Ask conversation CRUD (workspace DuckDB)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query, Response

from app.api.deps import WorkspaceDep
from app.models.api import AskConversation, AskConversationCreate, AskConversationPatch, AskTurn
from app.services import ask_store

router = APIRouter(prefix="/api/ask", tags=["ask"])


@router.get("/conversations", response_model=list[AskConversation])
def list_conversations(
    workspace: WorkspaceDep,
    limit: int = Query(default=100, ge=1, le=500),
) -> list[AskConversation]:
    rows = ask_store.list_conversations(workspace.connection, limit=limit)
    return [AskConversation(**r) for r in rows]


@router.post("/conversations", response_model=AskConversation)
def create_conversation(body: AskConversationCreate, workspace: WorkspaceDep) -> AskConversation:
    row = ask_store.create_conversation(
        workspace.connection,
        title=body.title,
        dataset_ids=body.dataset_ids,
    )
    return AskConversation(**row)


@router.patch("/conversations/{conversation_id}", response_model=AskConversation)
def patch_conversation(
    conversation_id: str,
    body: AskConversationPatch,
    workspace: WorkspaceDep,
) -> AskConversation:
    if body.title is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    if not ask_store.rename_conversation(workspace.connection, conversation_id, body.title):
        raise HTTPException(status_code=404, detail="Conversation not found")
    row = ask_store.get_conversation(workspace.connection, conversation_id)
    assert row is not None  # renamed row exists
    return AskConversation(**row)


@router.delete("/conversations/{conversation_id}", status_code=204)
def delete_conversation(conversation_id: str, workspace: WorkspaceDep) -> Response:
    if not ask_store.delete_conversation(workspace.connection, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    return Response(status_code=204)


@router.get("/conversations/{conversation_id}/turns", response_model=list[AskTurn])
def list_turns_route(
    conversation_id: str,
    workspace: WorkspaceDep,
    limit: int = Query(default=100, ge=1, le=200),
) -> list[AskTurn]:
    if not ask_store.get_conversation(workspace.connection, conversation_id):
        raise HTTPException(status_code=404, detail="Conversation not found")
    rows = ask_store.list_turns(workspace.connection, conversation_id, limit=limit)
    return [AskTurn(**r) for r in rows]


@router.delete("/conversations/{conversation_id}/turns/{turn_id}", status_code=204)
def delete_turn_route(
    conversation_id: str,
    turn_id: str,
    workspace: WorkspaceDep,
) -> Response:
    if not ask_store.delete_turn(workspace.connection, conversation_id, turn_id):
        raise HTTPException(status_code=404, detail="Turn not found")
    return Response(status_code=204)
