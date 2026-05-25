"""Persisted saved SQL snippets (workspace DuckDB)."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.api.deps import WorkspaceDep
from app.models.api import SavedQuery, SavedQueryCreate, SavedQueryPatch

router = APIRouter(prefix="/api/saved-queries", tags=["saved-queries"])


@router.get("", response_model=list[SavedQuery])
def list_saved_queries(workspace: WorkspaceDep) -> list[SavedQuery]:
    return [SavedQuery(**r) for r in workspace.saved_queries.list_saved_queries()]


@router.post("", response_model=SavedQuery)
def create_saved_query(body: SavedQueryCreate, workspace: WorkspaceDep) -> SavedQuery:
    sid = workspace.saved_queries.insert_saved_query(body.name, body.sql, body.description)
    row = workspace.saved_queries.get_saved_query(sid)
    if not row:
        raise HTTPException(status_code=500, detail="Failed to read saved query")
    return SavedQuery(**row)


@router.patch("/{saved_id}", response_model=SavedQuery)
def patch_saved_query(
    saved_id: str,
    body: SavedQueryPatch,
    workspace: WorkspaceDep,
) -> SavedQuery:
    if not body.model_fields_set:
        raise HTTPException(status_code=400, detail="No fields to update")
    if (
        "description" not in body.model_fields_set
        and body.name is None
        and body.sql is None
    ):
        raise HTTPException(status_code=400, detail="No fields to update")
    description = body.description if "description" in body.model_fields_set else None
    kwargs = {"name": body.name, "sql": body.sql}
    if "description" in body.model_fields_set:
        kwargs["description"] = description
    if not workspace.saved_queries.update_saved_query(
        saved_id,
        **kwargs,
    ):
        raise HTTPException(status_code=404, detail="Saved query not found")
    row = workspace.saved_queries.get_saved_query(saved_id)
    if not row:
        raise HTTPException(status_code=404, detail="Saved query not found")
    return SavedQuery(**row)


@router.delete("/{saved_id}", status_code=204)
def delete_saved_query(saved_id: str, workspace: WorkspaceDep) -> None:
    if not workspace.saved_queries.delete_saved_query(saved_id):
        raise HTTPException(status_code=404, detail="Saved query not found")
