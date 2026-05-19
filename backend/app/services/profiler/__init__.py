"""Polars-based profiling and quality heuristics."""

from app.services.profiler.builder import build_profile
from app.services.profiler.patterns import CURRENT_PROFILE_STRUCTURE_VERSION

__all__ = [
    "CURRENT_PROFILE_STRUCTURE_VERSION",
    "build_profile",
]
