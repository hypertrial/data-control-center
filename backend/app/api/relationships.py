"""Relationship candidates across datasets."""

from fastapi import APIRouter

from app.api.deps import RegistryDep
from app.models.api import RelationshipCandidate
from app.services.relationships import find_relationships

router = APIRouter(prefix="/api", tags=["relationships"])


@router.get("/relationships", response_model=list[RelationshipCandidate])
def relationships(registry: RegistryDep) -> list[RelationshipCandidate]:
    return find_relationships(registry)


@router.post("/relationships/refresh", response_model=list[RelationshipCandidate])
def refresh_relationships(registry: RegistryDep) -> list[RelationshipCandidate]:
    return find_relationships(registry, force_refresh=True)
