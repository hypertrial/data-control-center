"""Heuristic relationship detection across registered datasets."""

from __future__ import annotations

import json
import re
from difflib import SequenceMatcher

import polars as pl

from app.models.api import RelationshipCandidate
from app.services.registry import DatasetRegistry, RegisteredDataset
from app.services.profiler import _lazy_frame_for


def _norm_name(s: str) -> str:
    return re.sub(r"[^a-z0-9]", "", s.lower())


def _similar(a: str, b: str) -> float:
    na, nb = _norm_name(a), _norm_name(b)
    if not na or not nb:
        return 0.0
    if na == nb:
        return 1.0
    return SequenceMatcher(None, na, nb).ratio()


def _sample_column(ds: RegisteredDataset, col: str, n: int = 8_000) -> pl.Series:
    lf = _lazy_frame_for(ds)
    return lf.select(pl.col(col)).drop_nulls().head(n).collect()[col]


def _jaccard_sample(a: pl.Series, b: pl.Series) -> float:
    sa = set(str(x) for x in a.to_list())
    sb = set(str(x) for x in b.to_list())
    if not sa or not sb:
        return 0.0
    inter = len(sa & sb)
    union = len(sa | sb)
    return inter / union if union else 0.0


def registry_fingerprint(registry: DatasetRegistry) -> str:
    dss = sorted(registry.list_all(), key=lambda d: d.dataset_id)
    return "|".join(
        f"{d.dataset_id}:{d.view_name}:{d.row_count}:{d.column_count}"
        for d in dss
    )


def find_relationships(
    registry: DatasetRegistry,
    min_score: float = 0.35,
    *,
    force_refresh: bool = False,
) -> list[RelationshipCandidate]:
    ws = registry.workspace
    fp = registry_fingerprint(registry)
    if not force_refresh:
        cached = ws.load_relationships_cache()
        if cached:
            cf, payload = cached
            if cf == fp:
                try:
                    raw = json.loads(payload)
                    return [RelationshipCandidate.model_validate(x) for x in raw]
                except Exception:
                    pass

    datasets = registry.list_all()
    candidates: list[RelationshipCandidate] = []
    for i, left in enumerate(datasets):
        lf_left = _lazy_frame_for(left)
        left_schema = lf_left.collect_schema()
        left_cols = left_schema.names()
        for right in datasets[i + 1 :]:
            lf_right = _lazy_frame_for(right)
            right_schema = lf_right.collect_schema()
            right_cols = right_schema.names()
            for lc in left_cols:
                for rc in right_cols:
                    name_sim = _similar(lc, rc)
                    if name_sim < 0.6 and _norm_name(lc) != _norm_name(rc):
                        continue
                    lt = left_schema[lc]
                    rt = right_schema[rc]
                    if str(lt) != str(rt) and not (
                        str(lt).startswith("Int") and str(rt).startswith("Int")
                    ):
                        if name_sim < 0.95:
                            continue
                    try:
                        ls = _sample_column(left, lc)
                        rs = _sample_column(right, rc)
                        jac = _jaccard_sample(ls, rs)
                    except Exception:
                        jac = 0.0
                    score = 0.5 * name_sim + 0.5 * jac
                    if score < min_score:
                        continue
                    evidence = f"name_similarity={name_sim:.2f}, value_overlap_sample={jac:.2f}"
                    candidates.append(
                        RelationshipCandidate(
                            left_dataset_id=left.dataset_id,
                            left_column=lc,
                            right_dataset_id=right.dataset_id,
                            right_column=rc,
                            score=round(score, 4),
                            evidence=evidence,
                        )
                    )
    candidates.sort(key=lambda x: -x.score)
    out = candidates[:200]
    ws.save_relationships_cache(fp, json.dumps([c.model_dump(mode="json") for c in out]))
    return out
