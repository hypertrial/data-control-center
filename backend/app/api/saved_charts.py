"""Persisted chart specifications."""

from __future__ import annotations

import json

from fastapi import APIRouter, Query, Response

from app.api.deps import RegistryDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import SavedChart, SavedChartCreate, SavedChartPatch

router = APIRouter(prefix="/api/saved-charts", tags=["saved-charts"])
MAX_SPEC_BYTES = 500_000


def _clean_name(name: str) -> str:
    cleaned = name.strip()
    if not cleaned:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart name is required"
        )
    return cleaned


def _validate_spec(spec: dict, dataset_id: str) -> None:
    version = spec.get("version")
    if isinstance(version, bool) or not isinstance(version, int) or version <= 0:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart spec version must be positive"
        )
    if spec.get("datasetId") != dataset_id:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart spec dataset does not match"
        )
    if len(json.dumps(spec, separators=(",", ":")).encode()) > MAX_SPEC_BYTES:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart spec is too large"
        )


@router.get("", response_model=list[SavedChart])
def list_saved_charts(
    workspace: WorkspaceDep, dataset_id: str | None = Query(default=None)
) -> list[SavedChart]:
    return [SavedChart(**row) for row in workspace.saved_charts.list_saved_charts(dataset_id)]


@router.post("", response_model=SavedChart, status_code=201)
def create_saved_chart(
    body: SavedChartCreate, workspace: WorkspaceDep, registry: RegistryDep
) -> SavedChart:
    if not registry.get(body.dataset_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    _validate_spec(body.spec, body.dataset_id)
    chart_id = workspace.saved_charts.insert_saved_chart(
        body.dataset_id, _clean_name(body.name), body.description, body.spec
    )
    return SavedChart(**workspace.saved_charts.get_saved_chart(chart_id))  # type: ignore[arg-type]


@router.patch("/{chart_id}", response_model=SavedChart)
def patch_saved_chart(
    chart_id: str, body: SavedChartPatch, workspace: WorkspaceDep, registry: RegistryDep
) -> SavedChart:
    if not body.model_fields_set:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="No fields to update"
        )
    existing = workspace.saved_charts.get_saved_chart(chart_id)
    if not existing:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Saved chart not found")
    if not registry.get(existing["dataset_id"]):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Dataset not found")
    if "name" in body.model_fields_set and body.name is None:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart name cannot be null"
        )
    if "spec" in body.model_fields_set and body.spec is None:
        raise to_http_error(
            status_code=400, code=CODES.BAD_REQUEST, message="Chart spec cannot be null"
        )
    if body.spec is not None:
        _validate_spec(body.spec, existing["dataset_id"])
    kwargs: dict[str, object] = {
        "name": _clean_name(body.name) if body.name is not None else None,
        "spec": body.spec,
    }
    if "description" in body.model_fields_set:
        kwargs["description"] = body.description
    workspace.saved_charts.update_saved_chart(chart_id, **kwargs)
    return SavedChart(**workspace.saved_charts.get_saved_chart(chart_id))  # type: ignore[arg-type]


@router.delete("/{chart_id}", status_code=204)
def delete_saved_chart(chart_id: str, workspace: WorkspaceDep) -> Response:
    if not workspace.saved_charts.delete_saved_chart(chart_id):
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message="Saved chart not found")
    return Response(status_code=204)
