"""In-memory + DuckDB-backed dataset registry."""

from __future__ import annotations

import re
from dataclasses import dataclass
from pathlib import Path
from threading import RLock

from app.config import Settings
from app.errors import AppError, CODES
from app.models.api import DatasetSummary
from app.services.workspace import UnsupportedWorkspaceSchemaError, Workspace

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
    }
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
    source_label: str
    view_name: str
    format: str
    row_count: int | None
    column_count: int | None
    file_size_bytes: int | None


class DatasetRegistry:
    def __init__(self, workspace: Workspace, settings: Settings) -> None:
        self._workspace = workspace
        self._settings = settings
        self._lock = RLock()
        self._next_id = self._load_max_id() + 1
        self._by_id: dict[str, RegisteredDataset] = {}
        self._load_from_db()

    def _allowed_roots(self) -> list[Path]:
        roots: list[Path] = []
        for root in self._settings.registration_allowed_roots:
            p = root if root.is_absolute() else Path.cwd() / root
            roots.append(p.resolve())
        upload_dir = self._settings.upload_dir
        if not upload_dir.is_absolute():
            upload_dir = Path.cwd() / upload_dir
        roots.append(upload_dir.resolve())
        return roots

    def ensure_registration_allowed(self, path: Path) -> None:
        if self._settings.allow_arbitrary_registration_paths:
            return
        candidate = path.expanduser().resolve()
        for root in self._allowed_roots():
            try:
                candidate.relative_to(root)
                return
            except ValueError:
                continue
        raise AppError(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Path is outside allowed registration roots.",
            details={"path": candidate.name},
        )

    def _load_max_id(self) -> int:
        with self._workspace.lock_db() as con:
            row = con.execute(
                """
                SELECT MAX(CAST(SUBSTRING(dataset_id, 4) AS INTEGER))
                FROM dcc_datasets
                WHERE dataset_id LIKE 'ds_%'
                """
            ).fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    def _load_from_db(self) -> None:
        with self._workspace.lock_db() as con:
            rows = con.execute(
                "SELECT dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes FROM dcc_datasets"
            ).fetchall()
        for r in rows:
            if r[3] == f"v_{r[0]}":
                raise UnsupportedWorkspaceSchemaError(
                    "Unsupported workspace database schema: legacy dataset view names are not "
                    "supported. Delete or recreate the workspace DB, or point "
                    "DCC_WORKSPACE_DB_PATH to a fresh file."
                )
            self._by_id[r[0]] = RegisteredDataset(
                dataset_id=r[0],
                source_path=Path(r[1]),
                source_label=str(r[2] or Path(r[1]).name),
                view_name=r[3],
                format=r[4],
                row_count=int(r[5]) if r[5] is not None else None,
                column_count=int(r[6]) if r[6] is not None else None,
                file_size_bytes=int(r[7]) if r[7] is not None else None,
            )

    def _alloc_id(self) -> str:
        with self._lock:
            nid = self._next_id
            self._next_id += 1
            return f"ds_{nid:03d}"

    def register_path(self, path: Path, *, compute_counts: bool = True) -> RegisteredDataset:
        p = path.expanduser().resolve()
        self.ensure_registration_allowed(p)
        if not p.exists():
            raise FileNotFoundError(p.name)
        if p.is_dir():
            raise IsADirectoryError(p.name)

        ext = p.suffix.lower()
        if ext in (".jsonl", ".ndjson"):
            fmt = "json"
        elif ext == ".tsv":
            fmt = "csv"
        elif ext not in SUPPORTED_EXTENSIONS:
            raise ValueError(f"Unsupported file type: {ext}")
        else:
            fmt = "parquet" if ext == ".parquet" else "csv" if ext in (".csv", ".tsv") else "json"

        with self._lock:
            dataset_id = self._alloc_id()
            taken = {ds.view_name for ds in self._by_id.values()}
            slug = slugify_file_stem(p.stem, dataset_id)
            base = guard_reserved_identifier(slug)
            view_name = pick_unique_view_name(base, dataset_id, taken)
            fsize = p.stat().st_size if p.is_file() else None
            view_created = False

            try:
                self._workspace.register_file_view(view_name, p, fmt)
                view_created = True
                rows: int | None = None
                cols: int | None = None
                if compute_counts:
                    rows, cols = self._workspace.get_row_column_counts(view_name)

                with self._workspace.lock_db() as con:
                    con.execute(
                        """
                        INSERT INTO dcc_datasets (dataset_id, source_path, source_label, view_name, format, row_count, column_count, file_size_bytes)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        [dataset_id, str(p), p.name, view_name, fmt, rows, cols, fsize],
                    )

                ds = RegisteredDataset(
                    dataset_id=dataset_id,
                    source_path=p,
                    source_label=p.name,
                    view_name=view_name,
                    format=fmt,
                    row_count=rows,
                    column_count=cols,
                    file_size_bytes=fsize,
                )
                self._by_id[dataset_id] = ds
                self._workspace.delete_profile_cache(dataset_id)
                return ds
            except Exception:
                if view_created:
                    self._workspace.drop_view_if_exists(view_name)
                raise

    def set_counts(self, dataset_id: str, row_count: int | None, column_count: int | None) -> None:
        ds = self._by_id.get(dataset_id)
        if not ds:
            return
        with self._workspace.lock_db() as con:
            con.execute(
                "UPDATE dcc_datasets SET row_count = ?, column_count = ? WHERE dataset_id = ?",
                [row_count, column_count, dataset_id],
            )
        ds.row_count = row_count
        ds.column_count = column_count

    def register_folder(self, folder: Path, recursive: bool = False) -> list[RegisteredDataset]:
        root = folder.expanduser().resolve()
        self.ensure_registration_allowed(root)
        if not root.is_dir():
            raise NotADirectoryError(root.name)

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
                out.append(self.register_path(p, compute_counts=False))
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
            with self._workspace.lock_db() as con:
                con.execute("DELETE FROM dcc_profile_history WHERE dataset_id = ?", [dataset_id])
                con.execute("DELETE FROM dcc_jobs WHERE dataset_id = ?", [dataset_id])
                con.execute("DELETE FROM dcc_datasets WHERE dataset_id = ?", [dataset_id])
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
        source_path = str(ds.source_path) if self._settings.expose_absolute_source_paths else ds.source_label
        return DatasetSummary(
            dataset_id=ds.dataset_id,
            name=ds.source_label,
            view_name=ds.view_name,
            source_path=source_path,
            format=ds.format,
            row_count=ds.row_count,
            column_count=ds.column_count,
            file_size_bytes=ds.file_size_bytes,
        )
