"""In-memory + DuckDB-backed dataset registry."""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from threading import Lock

from app.models.api import DatasetSummary
from app.services.workspace import Workspace


SUPPORTED_EXTENSIONS = {".csv", ".parquet", ".json", ".jsonl", ".ndjson", ".tsv"}


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
        view_name = f"v_{dataset_id}"
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
            source_path=str(ds.source_path),
            format=ds.format,
            row_count=ds.row_count,
            column_count=ds.column_count,
            file_size_bytes=ds.file_size_bytes,
        )
