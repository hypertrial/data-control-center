from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from app.config import Settings
from app.errors import AppError
from app.api.datasets_duckdb import import_duckdb
from app.models.api import DuckDbImportRequest, DuckDbRelationRef
from app.services.duckdb_import import (
    DuckDbImportError,
    _cleanup_empty_dir,
    _relation_row_count,
    _set_timeout,
    _snapshot_relation,
    _upload_root,
    _workspace_path,
    cleanup_unregistered_import_files,
    import_duckdb_relations,
    inspect_duckdb_relations,
    resolve_duckdb_source_path,
)
from app.services.registry import DatasetRegistry
from app.services.workspace import Workspace


def _settings(tmp_path: Path, **overrides) -> Settings:
    values = {
        "workspace_db_path": tmp_path / "workspace.duckdb",
        "upload_dir": tmp_path / "uploads",
        "enable_path_registration": True,
        "allow_arbitrary_registration_paths": True,
    }
    values.update(overrides)
    return Settings(**values)


def _source_db(path: Path) -> None:
    con = duckdb.connect(str(path))
    try:
        con.execute("CREATE TABLE orders (id INTEGER, amount DOUBLE)")
        con.execute("INSERT INTO orders VALUES (1, 10.5), (2, 20.0)")
        con.execute("CREATE VIEW high_value AS SELECT * FROM orders WHERE amount >= 20")
    finally:
        con.close()


def test_inspect_lists_tables_and_views(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    rows = inspect_duckdb_relations(source, settings=_settings(tmp_path))

    by_name = {row.name: row for row in rows}
    assert by_name["orders"].schema_name == "main"
    assert by_name["orders"].type == "table"
    assert by_name["orders"].column_count == 2
    assert by_name["orders"].row_count == 2
    assert by_name["high_value"].type == "view"
    assert by_name["high_value"].row_count == 1


def test_resolve_rejects_disabled_paths_and_workspace_db(tmp_path: Path) -> None:
    settings = _settings(tmp_path, enable_path_registration=False)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        source = tmp_path / "source.duckdb"
        _source_db(source)
        with pytest.raises(AppError, match="disabled"):
            resolve_duckdb_source_path(str(source), registry=reg, settings=settings)
    finally:
        ws.close()

    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(AppError, match="active Data Control Center workspace"):
            resolve_duckdb_source_path(str(settings.workspace_db_path), registry=reg, settings=settings)
    finally:
        ws.close()


def test_resolve_rejects_bad_paths(tmp_path: Path) -> None:
    settings = _settings(tmp_path, allow_arbitrary_registration_paths=False, registration_allowed_roots=[tmp_path / "allowed"])
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        blocked = tmp_path / "blocked.duckdb"
        _source_db(blocked)
        with pytest.raises(AppError, match="outside allowed"):
            resolve_duckdb_source_path(str(blocked), registry=reg, settings=settings)

        allowed = tmp_path / "allowed"
        allowed.mkdir()
        text = allowed / "not_duck.txt"
        text.write_text("x")
        with pytest.raises(AppError, match=".duckdb"):
            resolve_duckdb_source_path(str(text), registry=reg, settings=settings)

        with pytest.raises(AppError, match="must be a DuckDB file"):
            resolve_duckdb_source_path(str(allowed), registry=reg, settings=settings)

        with pytest.raises(AppError, match="not found"):
            resolve_duckdb_source_path(str(allowed / "missing.duckdb"), registry=reg, settings=settings)
    finally:
        ws.close()


def test_relative_workspace_and_upload_paths_resolve_from_cwd(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.chdir(tmp_path)
    settings = Settings(workspace_db_path=Path("rel.duckdb"), upload_dir=Path("up"))
    assert _workspace_path(settings) == tmp_path / "rel.duckdb"
    assert _upload_root(settings) == tmp_path / "up"


def test_set_timeout_reraises_unexpected_errors() -> None:
    class Con:
        def execute(self, _sql: str):  # noqa: ANN201
            raise RuntimeError("different failure")

    with pytest.raises(RuntimeError, match="different failure"):
        _set_timeout(Con(), 1.0)  # type: ignore[arg-type]


def test_relation_row_count_returns_none_on_count_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    con = duckdb.connect(":memory:")
    monkeypatch.setattr(
        "app.services.duckdb_import._set_timeout",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(RuntimeError("timeout setup failed")),
    )
    try:
        assert _relation_row_count(
            con,
            schema_name="main",
            relation_name="missing",
            settings=_settings(tmp_path),
        ) is None
    finally:
        con.close()


def test_inspect_wraps_open_and_query_failures(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    bad = tmp_path / "bad.duckdb"

    monkeypatch.setattr(
        "app.services.duckdb_import._connect_source",
        lambda _path: (_ for _ in ()).throw(RuntimeError("open failed")),
    )
    with pytest.raises(AppError, match="could not be opened"):
        inspect_duckdb_relations(bad, settings=_settings(tmp_path))

    class BadCon:
        def execute(self, _sql: str):  # noqa: ANN201
            raise RuntimeError("query failed")

        def close(self) -> None:
            pass

    monkeypatch.setattr("app.services.duckdb_import._connect_source", lambda _path: BadCon())
    with pytest.raises(AppError, match="could not be inspected"):
        inspect_duckdb_relations(bad, settings=_settings(tmp_path))


def test_inspect_preserves_app_errors_from_row_count(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    def fail_row_count(*_args, **_kwargs):  # noqa: ANN202
        raise AppError(status_code=400, code="X", message="row count app error")

    monkeypatch.setattr("app.services.duckdb_import._relation_row_count", fail_row_count)
    with pytest.raises(AppError, match="row count app error"):
        inspect_duckdb_relations(source, settings=_settings(tmp_path))


def test_import_table_snapshots_to_app_owned_parquet(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        queued: list[str] = []
        result = import_duckdb_relations(
            source_path=source,
            relations=[DuckDbRelationRef(schema="main", name="orders")],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: queued.append(dataset_id) or "job",
        )

        ds_id = result["datasets"][0]["dataset_id"]
        ds = reg.get(ds_id)
        assert ds is not None
        assert ds.format == "parquet"
        assert ds.source_path.exists()
        assert ds.source_path.is_relative_to((tmp_path / "uploads").resolve())
        assert queued == [ds_id]

        con = duckdb.connect(str(source))
        try:
            con.execute("INSERT INTO orders VALUES (3, 999.0)")
        finally:
            con.close()

        rows = ws.connection.execute(f"SELECT COUNT(*) FROM {ds.view_name}").fetchone()[0]
        assert rows == 2
    finally:
        ws.close()


def test_import_view_and_duplicate_names_get_unique_views(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        result = import_duckdb_relations(
            source_path=source,
            relations=[
                DuckDbRelationRef(schema="main", name="high_value", alias="same_name"),
                DuckDbRelationRef(schema="main", name="orders", alias="same_name"),
            ],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
        ids = [row["dataset_id"] for row in result["datasets"]]
        views = [reg.get(ds_id).view_name for ds_id in ids if reg.get(ds_id)]
        assert len(views) == 2
        assert len(set(views)) == 2
    finally:
        ws.close()


def test_invalid_relation_fails_before_partial_registry_entry(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(DuckDbImportError, match="not available"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="missing")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert reg.list_all() == []
    finally:
        ws.close()


def test_empty_import_request_fails(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(DuckDbImportError, match="Select at least one"):
            import_duckdb_relations(
                source_path=source,
                relations=[],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
    finally:
        ws.close()


def test_snapshot_relation_sanitizes_copy_failures(tmp_path: Path) -> None:
    class BadCon:
        def execute(self, _sql: str):  # noqa: ANN201
            raise RuntimeError(str(tmp_path / "private.duckdb"))

    with pytest.raises(DuckDbImportError, match="friendly"):
        _snapshot_relation(
            BadCon(),  # type: ignore[arg-type]
            rel=DuckDbRelationRef(schema="main", name="orders", alias="friendly"),
            export_path=tmp_path / "out.parquet",
        )


def test_duckdb_import_error_during_snapshot_cleans_batch(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        monkeypatch.setattr(
            "app.services.duckdb_import._snapshot_relation",
            lambda *_args, **_kwargs: (_ for _ in ()).throw(DuckDbImportError("copy failed")),
        )
        with pytest.raises(DuckDbImportError, match="copy failed"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="orders")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert list((tmp_path / "uploads").rglob("*.parquet")) == []
    finally:
        ws.close()


def test_generic_import_failure_and_detach_failure_are_sanitized(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.duckdb_import as duckdb_import

    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    real_connect = duckdb_import.duckdb.connect

    class BadImportCon:
        def execute(self, sql: str):  # noqa: ANN201
            if sql.startswith("DETACH"):
                raise RuntimeError("detach failed")
            if sql.startswith("SET"):
                return self
            raise RuntimeError("attach failed")

        def close(self) -> None:
            pass

    def fake_connect(path: str, *args, **kwargs):  # noqa: ANN001, ANN202
        if path == ":memory:":
            return BadImportCon()
        return real_connect(path, *args, **kwargs)

    try:
        reg = DatasetRegistry(ws, settings)
        monkeypatch.setattr(duckdb_import.duckdb, "connect", fake_connect)
        with pytest.raises(DuckDbImportError, match="DuckDB import failed"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="orders")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
    finally:
        ws.close()


def test_register_failure_cleans_unregistered_parquet(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)

        def fail_register(path: Path, *, compute_counts: bool = True):  # noqa: ARG001
            raise RuntimeError("registration failed")

        monkeypatch.setattr(reg, "register_path", fail_register)
        with pytest.raises(DuckDbImportError, match="failed"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="orders")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert list((tmp_path / "uploads").rglob("*.parquet")) == []
    finally:
        ws.close()


def test_cleanup_helpers_ignore_os_errors(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    empty_dir = tmp_path / "empty"
    empty_dir.mkdir()
    monkeypatch.setattr(Path, "iterdir", lambda self: (_ for _ in ()).throw(OSError("no list")))
    _cleanup_empty_dir(empty_dir)

    monkeypatch.undo()
    p = tmp_path / "leftover.parquet"
    p.write_text("x")
    original_unlink = Path.unlink

    def fail_unlink(path: Path, *args, **kwargs):  # noqa: ANN001, ANN202
        if path == p:
            raise OSError("cannot unlink")
        return original_unlink(path, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_unlink)
    cleanup_unregistered_import_files([p], [])
    assert p.exists()


def test_duckdb_import_route_job_honors_preexisting_cancel(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    captured = {}

    class Jobs:
        def submit(self, *, kind, dataset_id, fn):  # noqa: ANN001
            captured["kind"] = kind
            captured["dataset_id"] = dataset_id
            captured["fn"] = fn
            return "job_cancel"

    class CancelingJobs:
        def job_cancel_requested(self, _job_id: str) -> bool:
            return True

        def job_update(self, *_args, **_kwargs) -> None:  # noqa: ANN002, ANN003
            raise AssertionError("job_update should not be called for a canceled import")

    class WorkspaceFacade:
        jobs = CancelingJobs()

    try:
        reg = DatasetRegistry(ws, settings)
        response = import_duckdb(
            DuckDbImportRequest(
                path=str(source),
                relations=[DuckDbRelationRef(schema="main", name="orders")],
            ),
            reg,
            WorkspaceFacade(),  # type: ignore[arg-type]
            Jobs(),  # type: ignore[arg-type]
            settings,
        )
        assert response.job_id == "job_cancel"
        assert captured["kind"] == "duckdb_import"
        assert captured["dataset_id"] is None
        assert captured["fn"]("job_cancel") == {"datasets": [], "status": "canceled"}
    finally:
        ws.close()
