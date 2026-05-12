"""In-memory + DuckDB-backed dataset registry."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from app.models.api import DatasetSummary
from app.services.workspace import Workspace


SUPPORTED_EXTENSIONS = {".csv", ".parquet", ".json", ".jsonl", ".ndjson", ".tsv"}

MAX_VIEW_STEM_LEN = 120

_RESERVED_VIEW_IDENTIFIERS = frozenset(
    {
        "select",
        "from",
        "where",
        "order",
        "group",
        "by",
        "having",
        "limit",
        "offset",
        "join",
        "inner",
        "left",
        "right",
        "full",
        "cross",
        "outer",
        "on",
        "as",
        "with",
        "union",
        "all",
        "case",
        "when",
        "then",
        "else",
        "end",
        "true",
        "false",
        "null",
        "table",
        "create",
        "drop",
        "insert",
        "update",
        "delete",
        "and",
        "or",
        "not",
        "distinct",
    },
)


def slugify_file_stem(raw_stem: str, dataset_id: str) -> str:
    s = re.sub(r"[^A-Za-z0-9_]+", "_", raw_stem)
    s = re.sub(r"_+", "_", s).strip("_")
    if not s:
        return f"dataset_{dataset_id}"
    if len(s) > MAX_VIEW_STEM_LEN:
        s = s[:MAX_VIEW_STEM_LEN].rstrip("_")
        if not s:
            return f"dataset_{dataset_id}"
    return s


def guard_reserved_identifier(slug: str) -> str:
    if slug.lower() in _RESERVED_VIEW_IDENTIFIERS:
        return f"{slug}_dcc"
    return slug


def pick_unique_view_name(base: str, dataset_id: str, taken: set[str]) -> str:
    if base not in taken:
        return base
    candidate = f"{base}_{dataset_id}"
    n = 2
    while candidate in taken:
        candidate = f"{base}_{dataset_id}_{n}"
        n += 1
    return candidate


@dataclass
class RegisteredDataset:
    dataset_id: str
    source_path: Path
    view_name: str
    format: str
    row_count: int | None
    column_count: int | None
    file_size_bytes: int | None


class DatasetRegistry:
    def __init__(self, workspace: Workspace) -> None:
        self._workspace = workspace
        self._lock = Lock()
        self._next_id = self._load_max_id() + 1
        self._by_id: dict[str, RegisteredDataset] = {}
        self._load_from_db()
        self._migrate_legacy_v_dataset_views()

    def _load_max_id(self) -> int:
        con = self._workspace.connection
        row = con.execute(
            """
            SELECT MAX(CAST(SUBSTRING(dataset_id, 4) AS INTEGER))
            FROM dcc_datasets
            WHERE dataset_id LIKE 'ds_%'
            """
        ).fetchone()
        if row and row[0] is not None:
            return int(row[0])
        return 0

    def _load_from_db(self) -> None:
        con = self._workspace.connection
        rows = con.execute("SELECT * FROM dcc_datasets").fetchall()
        for r in rows:
            did, src, view_name, fmt, row_count, col_count, fsize, _ = r
            self._by_id[did] = RegisteredDataset(
                dataset_id=did,
                source_path=Path(src),
                view_name=view_name,
                format=fmt,
                row_count=int(row_count) if row_count is not None else None,
                column_count=int(col_count) if col_count is not None else None,
                file_size_bytes=int(fsize) if fsize is not None else None,
            )

    def _migrate_legacy_v_dataset_views(self) -> None:
        """Upgrade rows created before file-stem views: `v_{dataset_id}` -> stem-based name."""
        legacy_ids = sorted(
            did for did, ds in self._by_id.items() if ds.view_name == f"v_{did}"
        )
        if not legacy_ids:
            return

        legacy_set = frozenset(legacy_ids)

        with self._lock:
            taken = {ds.view_name for did, ds in self._by_id.items() if did not in legacy_set}
            for did in legacy_ids:
                ds = self._by_id[did]
                p = ds.source_path.expanduser().resolve()
                if not p.is_file():
                    continue

                slug = slugify_file_stem(p.stem, did)
                base = guard_reserved_identifier(slug)
                new_name = pick_unique_view_name(base, did, taken)
                taken.add(new_name)

                if new_name == ds.view_name:
                    continue

                old_view = ds.view_name
                try:
                    self._workspace.register_file_view(new_name, p, ds.format)
                except (FileNotFoundError, OSError, ValueError):
                    continue
                self._workspace.drop_view_if_exists(old_view)

                rows, cols = self._workspace.get_row_column_counts(new_name)
                fsize = p.stat().st_size
                self._workspace.connection.execute(
                    """
                    UPDATE dcc_datasets
                    SET view_name = ?, row_count = ?, column_count = ?, file_size_bytes = ?
                    WHERE dataset_id = ?
                    """,
                    [new_name, rows, cols, fsize, did],
                )
                self._by_id[did] = RegisteredDataset(
                    dataset_id=did,
                    source_path=p,
                    view_name=new_name,
                    format=ds.format,
                    row_count=rows,
                    column_count=cols,
                    file_size_bytes=fsize,
                )
                self._workspace.delete_profile_cache(did)

    def _alloc_id(self) -> str:
        with self._lock:
            nid = self._next_id
            self._next_id += 1
            return f"ds_{nid:03d}"

    def register_path(self, path: Path) -> RegisteredDataset:
        p = path.expanduser().resolve()
        if not p.exists():
            raise FileNotFoundError(str(p))
        if p.is_dir():
            raise IsADirectoryError(str(p))
        ext = p.suffix.lower()
        if ext in (".jsonl", ".ndjson"):
            fmt = "json"
        elif ext == ".tsv":
            fmt = "csv"
        elif ext not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")
        else:
            fmt = (
                "parquet"
                if ext == ".parquet"
                else "csv"
                if ext in (".csv", ".tsv")
                else "json"
            )

        dataset_id = self._alloc_id()
        taken = {ds.view_name for ds in self._by_id.values()}
        slug = slugify_file_stem(p.stem, dataset_id)
        base = guard_reserved_identifier(slug)
        view_name = pick_unique_view_name(base, dataset_id, taken)
        fsize = p.stat().st_size if p.is_file() else None

        self._workspace.register_file_view(view_name, p, fmt)
        rows, cols = self._workspace.get_row_column_counts(view_name)

        with self._lock:
            self._workspace.connection.execute(
                """
                INSERT INTO dcc_datasets (dataset_id, source_path, view_name, format, row_count, column_count, file_size_bytes)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                [dataset_id, str(p), view_name, fmt, rows, cols, fsize],
            )

        ds = RegisteredDataset(
            dataset_id=dataset_id,
            source_path=p,
            view_name=view_name,
            format=fmt,
            row_count=rows,
            column_count=cols,
            file_size_bytes=fsize,
        )
        self._by_id[dataset_id] = ds
        self._workspace.delete_profile_cache(dataset_id)
        return ds

    def register_folder(self, folder: Path, recursive: bool = False) -> list[RegisteredDataset]:
        root = folder.expanduser().resolve()
        if not root.is_dir():
            raise NotADirectoryError(str(root))
        paths: list[Path] = []
        if recursive:
            for p in root.rglob("*"):
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
                    paths.append(p)
        else:
            for p in root.iterdir():
                if p.is_file() and p.suffix.lower() in SUPPORTED_EXTENSIONS:
                    paths.append(p)
        paths.sort(key=lambda x: str(x))
        out: list[RegisteredDataset] = []
        for p in paths:
            try:
                out.append(self.register_path(p))
            except ValueError:
                continue
        return out

    def unregister(self, dataset_id: str) -> bool:
        with self._lock:
            ds = self._by_id.get(dataset_id)
            if not ds:
                return False
            self._workspace.drop_view_if_exists(ds.view_name)
            self._workspace.delete_profile_cache(dataset_id)
            self._workspace.connection.execute(
                "DELETE FROM dcc_profile_history WHERE dataset_id = ?",
                [dataset_id],
            )
            self._workspace.connection.execute(
                "DELETE FROM dcc_jobs WHERE dataset_id = ?",
                [dataset_id],
            )
            self._workspace.connection.execute(
                "DELETE FROM dcc_datasets WHERE dataset_id = ?",
                [dataset_id],
            )
            self._by_id.pop(dataset_id, None)
            return True

    def get(self, dataset_id: str) -> RegisteredDataset | None:
        return self._by_id.get(dataset_id)

    def list_all(self) -> list[RegisteredDataset]:
        return list(self._by_id.values())

    @property
    def workspace(self) -> Workspace:
        return self._workspace

    def to_summary(self, ds: RegisteredDataset) -> DatasetSummary:
        return DatasetSummary(
            dataset_id=ds.dataset_id,
            name=ds.source_path.name,
            view_name=ds.view_name,
            source_path=str(ds.source_path),
            format=ds.format,
            row_count=ds.row_count,
            column_count=ds.column_count,
            file_size_bytes=ds.file_size_bytes,
        )
