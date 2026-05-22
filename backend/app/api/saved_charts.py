"""Persisted saved chart configurations (workspace DuckDB)."""

from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException, Query

from app.api.deps import WorkspaceDep
from app.models.api import SavedChart, SavedChartCreate, SavedChartPatch

router = APIRouter(prefix="/api/saved-charts", tags=["saved-charts"])


def _validate_spec_json(raw: str) -> str:
    try:
        parsed: Any = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Chart spec must be valid JSON") from exc
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=400, detail="Chart spec must be a JSON object")
    return json.dumps(parsed, separators=(",", ":"), sort_keys=True)


@router.get("", response_model=list[SavedChart])
def list_saved_charts(
    workspace: WorkspaceDep,
    dataset_id: str = Query(..., min_length=1, max_length=200),
) -> list[SavedChart]:
    return [SavedChart(**r) for r in workspace.saved_charts.list_saved_charts(dataset_id)]


@router.post("", response_model=SavedChart)
def create_saved_chart(body: SavedChartCreate, workspace: WorkspaceDep) -> SavedChart:
    spec_json = _validate_spec_json(body.spec_json)
    cid = workspace.saved_charts.insert_saved_chart(body.dataset_id, body.name, spec_json)
    row = workspace.saved_charts.get_saved_chart(cid)
    if not row:
        raise HTTPException(status_code=500, detail="Failed to read saved chart")
    return SavedChart(**row)


@router.patch("/{chart_id}", response_model=SavedChart)
def patch_saved_chart(
    chart_id: str,
    body: SavedChartPatch,
    workspace: WorkspaceDep,
) -> SavedChart:
    if body.name is None and body.spec_json is None:
        raise HTTPException(status_code=400, detail="No fields to update")
    spec_json = _validate_spec_json(body.spec_json) if body.spec_json is not None else None
    if not workspace.saved_charts.update_saved_chart(chart_id, name=body.name, spec_json=spec_json):
        raise HTTPException(status_code=404, detail="Saved chart not found")
    row = workspace.saved_charts.get_saved_chart(chart_id)
    if not row:
        raise HTTPException(status_code=404, detail="Saved chart not found")
    return SavedChart(**row)


@router.delete("/{chart_id}", status_code=204)
def delete_saved_chart(chart_id: str, workspace: WorkspaceDep) -> None:
    if not workspace.saved_charts.delete_saved_chart(chart_id):
        raise HTTPException(status_code=404, detail="Saved chart not found")
