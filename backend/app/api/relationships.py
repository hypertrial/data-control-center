"""Dataset relationship discovery and decisions."""

from __future__ import annotations

import logging

import duckdb
from fastapi import APIRouter, Query, Response

from app.api.deps import RegistryDep, SettingsDep, WorkspaceDep
from app.errors import CODES, to_http_error
from app.models.api import (
    DatasetRelationship,
    RelationshipDecisionRequest,
    RelationshipsResponse,
    RelationshipVerification,
)
from app.services.relationships import RelationshipService
from app.services.source_errors import MISSING_DATASET_SOURCE_MESSAGE, is_missing_dataset_source_error

logger = logging.getLogger(__name__)
router = APIRouter(prefix="/api/relationships", tags=["relationships"])


def _service(registry: RegistryDep, workspace: WorkspaceDep, settings: SettingsDep):
    return RelationshipService(registry, workspace, settings)


@router.get("", response_model=RelationshipsResponse)
def list_relationships(
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
    dataset_id: str | None = Query(default=None),
    include_dismissed: bool = Query(default=False),
) -> RelationshipsResponse:
    try:
        return RelationshipsResponse(
            **_service(registry, workspace, settings).list_relationships(
                dataset_id, include_dismissed=include_dismissed
            )
        )
    except LookupError as exc:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message=str(exc))


@router.post("/{relationship_id}/verify", response_model=RelationshipVerification)
def verify_relationship(
    relationship_id: str,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> RelationshipVerification:
    try:
        return RelationshipVerification(
            **_service(registry, workspace, settings).verify(relationship_id)
        )
    except LookupError as exc:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message=str(exc))
    except duckdb.Error as exc:
        message = str(exc).lower()
        if is_missing_dataset_source_error(exc):
            public_message, status, code = MISSING_DATASET_SOURCE_MESSAGE, 400, CODES.BAD_REQUEST
        elif "timeout" in message or "interrupted" in message:
            public_message, status, code = "Relationship verification timed out", 408, CODES.SQL_TIMEOUT
        else:
            logger.warning("relationship verification failed: %s", exc)
            public_message, status, code = "Unable to verify relationship", 400, CODES.BAD_REQUEST
        raise to_http_error(status_code=status, code=code, message=public_message)


@router.put("/{relationship_id}/decision", response_model=DatasetRelationship)
def set_relationship_decision(
    relationship_id: str,
    body: RelationshipDecisionRequest,
    registry: RegistryDep,
    workspace: WorkspaceDep,
    settings: SettingsDep,
) -> DatasetRelationship:
    try:
        return DatasetRelationship(
            **_service(registry, workspace, settings).set_decision(
                relationship_id, body.status
            )
        )
    except LookupError as exc:
        raise to_http_error(status_code=404, code=CODES.NOT_FOUND, message=str(exc))


@router.delete("/{relationship_id}/decision", status_code=204)
def delete_relationship_decision(
    relationship_id: str, workspace: WorkspaceDep
) -> Response:
    if not workspace.relationship_decisions.delete_decision(relationship_id):
        raise to_http_error(
            status_code=404, code=CODES.NOT_FOUND, message="Relationship decision not found"
        )
    return Response(status_code=204)
