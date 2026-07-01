from __future__ import annotations

from pathlib import Path

import duckdb
import pytest

from app.config import Settings
from app.errors import AppError
from app.api.datasets_duckdb import import_duckdb
from app.models.api import DuckDbImportRequest, DuckDbRelationRef
from app.services.duckdb_import import (
    DUCKDB_SOURCES_DIR,
    DuckDbImportCancelled,
    DuckDbImportError,
    LOCAL_SOURCE_PREFIX,
    _local_metadata_path,
    _cleanup_empty_dir,
    _relation_row_count,
    _set_timeout,
    _snapshot_relation,
    _upload_root,
    _workspace_path,
    cleanup_duckdb_local_opens,
    cleanup_unregistered_import_files,
    count_duckdb_relation,
    import_duckdb_relations,
    inspect_duckdb_relations,
    register_local_duckdb_open,
    reject_workspace_duckdb_upload,
    resolve_duckdb_source,
    resolve_staged_duckdb_upload,
)
from app.services.upload_validation import UploadValidationError, validate_duckdb_upload
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


def _add_duckdb_table(path: Path, name: str = "refunds") -> None:
    con = duckdb.connect(str(path))
    try:
        con.execute(f"CREATE TABLE {name} (id INTEGER, amount DOUBLE)")
        con.execute(f"INSERT INTO {name} VALUES (10, -5.0)")
    finally:
        con.close()


def _stage_upload(tmp_path: Path, source: Path, *, filename: str | None = None) -> str:
    import shutil
    import uuid

    settings = _settings(tmp_path)
    upload_id = uuid.uuid4().hex[:16]
    batch = _upload_root(settings) / DUCKDB_SOURCES_DIR / upload_id
    batch.mkdir(parents=True)
    shutil.copy2(source, batch / (filename or source.name))
    return upload_id


def test_inspect_lists_importable_relations_metadata_by_default(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    rows = inspect_duckdb_relations(source, settings=_settings(tmp_path))

    by_name = {row.name: row for row in rows}
    assert set(by_name) == {"orders", "high_value"}
    assert by_name["orders"].schema_name == "main"
    assert by_name["orders"].type == "table"
    assert by_name["orders"].column_count == 2
    assert by_name["orders"].row_count is None
    assert by_name["high_value"].type == "view"
    assert by_name["high_value"].row_count is None


def test_inspect_include_row_counts(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    rows = inspect_duckdb_relations(source, settings=_settings(tmp_path), include_row_counts=True)
    by_name = {row.name: row for row in rows}
    assert set(by_name) == {"orders", "high_value"}
    assert by_name["orders"].row_count == 2
    assert by_name["high_value"].row_count == 1


def test_count_duckdb_relation(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    assert count_duckdb_relation(source, schema_name="main", relation_name="orders", settings=settings) == 2


def test_count_duckdb_relation_for_view_returns_count(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    assert count_duckdb_relation(source, schema_name="main", relation_name="high_value", settings=settings) == 1


def test_pick_and_register_local_duckdb(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    monkeypatch.setattr("app.services.duckdb_native_pick.native_pick_available", lambda: True)
    monkeypatch.setattr(
        "app.services.duckdb_native_pick.pick_local_duckdb_path",
        lambda: source,
    )
    from app.services.duckdb_import import pick_and_register_local_duckdb

    opened = pick_and_register_local_duckdb(registry=registry, settings=settings)
    assert opened.source_kind == "local"
    assert opened.filename == "source.duckdb"


def test_pick_and_register_cancelled(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    monkeypatch.setattr("app.services.duckdb_native_pick.native_pick_available", lambda: True)
    monkeypatch.setattr("app.services.duckdb_native_pick.pick_local_duckdb_path", lambda: None)
    from app.services.duckdb_import import pick_and_register_local_duckdb

    with pytest.raises(AppError, match="cancelled"):
        pick_and_register_local_duckdb(registry=registry, settings=settings)


def test_pick_and_register_unavailable(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    monkeypatch.setattr("app.services.duckdb_native_pick.native_pick_available", lambda: False)
    from app.services.duckdb_import import pick_and_register_local_duckdb

    with pytest.raises(AppError, match="not available"):
        pick_and_register_local_duckdb(registry=registry, settings=settings)


def test_pick_and_register_disabled(tmp_path: Path) -> None:
    settings = _settings(tmp_path, enable_duckdb_native_pick=False)
    registry = DatasetRegistry(Workspace(settings), settings)
    from app.services.duckdb_import import pick_and_register_local_duckdb

    with pytest.raises(AppError, match="disabled"):
        pick_and_register_local_duckdb(registry=registry, settings=settings)


def test_register_and_resolve_local_open(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    opened = register_local_duckdb_open(str(source), registry=registry, settings=settings)
    assert opened.source_kind == "local"
    assert opened.source_id.startswith(LOCAL_SOURCE_PREFIX)
    resolved = resolve_duckdb_source(opened.source_id, registry=registry, settings=settings)
    assert resolved == source.resolve()


def test_register_local_open_disabled(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path, enable_duckdb_local_open=False)
    registry = DatasetRegistry(Workspace(settings), settings)
    with pytest.raises(AppError, match="disabled"):
        register_local_duckdb_open(str(source), registry=registry, settings=settings)


def test_register_local_open_requires_absolute_path(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    with pytest.raises(AppError, match="absolute"):
        register_local_duckdb_open("source.duckdb", registry=registry, settings=settings)


def test_local_metadata_path_validation(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    with pytest.raises(AppError, match="Invalid DuckDB source id"):
        _local_metadata_path("not-local", settings)
    with pytest.raises(AppError, match="Invalid DuckDB source id"):
        _local_metadata_path(f"{LOCAL_SOURCE_PREFIX}tooshort", settings)


def test_register_local_open_validation_errors(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    txt = tmp_path / "data.txt"
    txt.write_text("x")
    with pytest.raises(AppError, match="\\.duckdb"):
        register_local_duckdb_open(str(txt.resolve()), registry=registry, settings=settings)
    missing = tmp_path / "missing.duckdb"
    with pytest.raises(AppError, match="not found"):
        register_local_duckdb_open(str(missing.resolve()), registry=registry, settings=settings)


def test_resolve_local_missing_file_after_register(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    opened = register_local_duckdb_open(str(source.resolve()), registry=registry, settings=settings)
    source.unlink()
    with pytest.raises(AppError, match="not found"):
        resolve_duckdb_source(opened.source_id, registry=registry, settings=settings)


def test_resolve_local_metadata_read_error(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    opened = register_local_duckdb_open(str(source.resolve()), registry=registry, settings=settings)
    meta = _upload_root(settings) / DUCKDB_SOURCES_DIR / "local" / f"{opened.source_id}.json"

    def fail_read_text(*_args, **_kwargs):  # noqa: ANN002, ANN003
        raise OSError("read failed")

    monkeypatch.setattr(type(meta), "read_text", fail_read_text)
    with pytest.raises(AppError, match="not found"):
        resolve_duckdb_source(opened.source_id, registry=registry, settings=settings)


def test_cleanup_duckdb_local_opens_ignores_unlink_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path, duckdb_local_open_ttl_hours=0.0)
    registry = DatasetRegistry(Workspace(settings), settings)
    register_local_duckdb_open(str(source.resolve()), registry=registry, settings=settings)
    original_unlink = Path.unlink

    def fail_unlink(self, *args, **kwargs):  # noqa: ANN001, ANN002, ANN003
        if str(self).endswith(".json"):
            raise OSError("unlink failed")
        return original_unlink(self, *args, **kwargs)

    monkeypatch.setattr(Path, "unlink", fail_unlink)
    cleanup_duckdb_local_opens(settings)


def test_count_duckdb_relation_open_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.duckdb_import._connect_source",
        lambda _path: (_ for _ in ()).throw(RuntimeError("open failed")),
    )
    with pytest.raises(AppError, match="could not be opened"):
        count_duckdb_relation(
            tmp_path / "missing.duckdb",
            schema_name="main",
            relation_name="orders",
            settings=_settings(tmp_path),
        )


def test_resolve_duckdb_source_invalid_id(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    with pytest.raises(AppError, match="Invalid DuckDB source id"):
        resolve_duckdb_source("bad-id", registry=registry, settings=settings)


def test_resolve_local_invalid_metadata(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    registry = DatasetRegistry(Workspace(settings), settings)
    opened = register_local_duckdb_open(str(source.resolve()), registry=registry, settings=settings)
    meta = (
        _upload_root(settings) / DUCKDB_SOURCES_DIR / "local" / f"{opened.source_id}.json"
    )
    meta.write_text("{}", encoding="utf-8")
    with pytest.raises(AppError, match="invalid"):
        resolve_duckdb_source(opened.source_id, registry=registry, settings=settings)


def test_cleanup_duckdb_local_opens(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path, duckdb_local_open_ttl_hours=0.0)
    registry = DatasetRegistry(Workspace(settings), settings)
    opened = register_local_duckdb_open(str(source), registry=registry, settings=settings)
    cleanup_duckdb_local_opens(settings)
    with pytest.raises(AppError, match="not found"):
        resolve_duckdb_source(opened.source_id, registry=registry, settings=settings)


def test_resolve_staged_upload(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    upload_id = _stage_upload(tmp_path, source)
    resolved = resolve_staged_duckdb_upload(upload_id, settings=settings)
    assert resolved.name == "source.duckdb"
    assert resolved.exists()


def test_resolve_staged_upload_errors(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    with pytest.raises(AppError, match="Invalid DuckDB upload id"):
        resolve_staged_duckdb_upload("not-valid", settings=settings)
    with pytest.raises(AppError, match="not found"):
        resolve_staged_duckdb_upload("a" * 16, settings=settings)

    source = tmp_path / "source.duckdb"
    _source_db(source)
    upload_id = _stage_upload(tmp_path, source)
    batch = _upload_root(settings) / DUCKDB_SOURCES_DIR / upload_id
    (batch / "extra.duckdb").write_bytes(b"x")
    with pytest.raises(AppError, match="invalid"):
        resolve_staged_duckdb_upload(upload_id, settings=settings)


def test_reject_workspace_duckdb_upload(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    ws_path = settings.workspace_db_path
    ws_path.parent.mkdir(parents=True, exist_ok=True)
    _source_db(ws_path)
    with pytest.raises(AppError, match="active Data Control Center workspace"):
        reject_workspace_duckdb_upload(ws_path, settings=settings)


def test_validate_duckdb_upload(tmp_path: Path) -> None:
    settings = _settings(tmp_path)
    source = tmp_path / "source.duckdb"
    _source_db(source)
    validate_duckdb_upload(source, settings)

    bad = tmp_path / "bad.duckdb"
    bad.write_bytes(b"not a duckdb file")
    with pytest.raises(UploadValidationError, match="could not be opened"):
        validate_duckdb_upload(bad, settings)

    wrong_ext = tmp_path / "wrong.txt"
    wrong_ext.write_text("x")
    with pytest.raises(UploadValidationError, match="DuckDB database"):
        validate_duckdb_upload(wrong_ext, settings)

    missing = tmp_path / "missing.duckdb"
    with pytest.raises(UploadValidationError, match="missing"):
        validate_duckdb_upload(missing, settings)


def test_validate_duckdb_upload_reraises_unexpected_timeout_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    class Con:
        def execute(self, sql: str):  # noqa: ANN201
            if sql.startswith("SET statement_timeout"):
                raise RuntimeError("timeout setup failed")
            return self

        def fetchone(self):  # noqa: ANN204
            return (1,)

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        "app.services.upload_validation.duckdb.connect",
        lambda *_a, **_k: Con(),
    )
    with pytest.raises(UploadValidationError, match="could not be inspected"):
        validate_duckdb_upload(source, settings=_settings(tmp_path))


def test_validate_duckdb_upload_preserves_upload_validation_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    class Con:
        def execute(self, sql: str):  # noqa: ANN201
            if "information_schema" in sql:
                raise UploadValidationError("custom duckdb validation")
            return self

        def fetchone(self):  # noqa: ANN204
            return (1,)

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        "app.services.upload_validation.duckdb.connect",
        lambda *_a, **_k: Con(),
    )
    with pytest.raises(UploadValidationError, match="custom duckdb validation"):
        validate_duckdb_upload(source, settings=_settings(tmp_path))


def test_validate_duckdb_upload_ignores_unrecognized_timeout_param(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    class Con:
        def execute(self, sql: str):  # noqa: ANN201
            if sql.startswith("SET statement_timeout"):
                raise RuntimeError("unrecognized configuration parameter statement_timeout")
            return self

        def fetchone(self):  # noqa: ANN204
            return (1,)

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        "app.services.upload_validation.duckdb.connect",
        lambda *_a, **_k: Con(),
    )
    validate_duckdb_upload(source, settings=_settings(tmp_path))


def test_validate_duckdb_upload_inspect_failure(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)

    class BadCon:
        def execute(self, sql: str):  # noqa: ANN201
            if "information_schema" in sql:
                raise RuntimeError("inspect failed")
            return self

        def fetchone(self):  # noqa: ANN204
            return None

        def close(self) -> None:
            pass

    monkeypatch.setattr(
        "app.services.upload_validation.duckdb.connect",
        lambda *_a, **_k: BadCon(),
    )
    with pytest.raises(UploadValidationError, match="could not be inspected"):
        validate_duckdb_upload(source, settings=_settings(tmp_path))


def test_resolve_staged_empty_batch_and_workspace_match(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    settings = _settings(tmp_path)
    upload_id = "b" * 16
    batch = _upload_root(settings) / DUCKDB_SOURCES_DIR / upload_id
    batch.mkdir(parents=True)
    (batch / "notes.txt").write_text("x")
    with pytest.raises(AppError, match="not found"):
        resolve_staged_duckdb_upload(upload_id, settings=settings)

    source = tmp_path / "source.duckdb"
    _source_db(source)
    upload_id = _stage_upload(tmp_path, source)
    resolved = resolve_staged_duckdb_upload(upload_id, settings=settings)
    monkeypatch.setattr(
        "app.services.duckdb_import._workspace_path",
        lambda _settings: resolved,
    )
    with pytest.raises(AppError, match="active Data Control Center workspace"):
        resolve_staged_duckdb_upload(upload_id, settings=settings)


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
        inspect_duckdb_relations(source, settings=_settings(tmp_path), include_row_counts=True)


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


def test_import_view_with_catalog_qualified_definition_succeeds(tmp_path: Path) -> None:
    source = tmp_path / "warehouse.duckdb"
    con = duckdb.connect(str(source))
    try:
        con.execute("CREATE SCHEMA s")
        con.execute("CREATE TABLE s.t AS SELECT 1 AS id")
        con.execute("CREATE VIEW s.v AS SELECT * FROM warehouse.s.t")
    finally:
        con.close()

    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        result = import_duckdb_relations(
            source_path=source,
            relations=[DuckDbRelationRef(schema="s", name="v")],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
        assert len(result["datasets"]) == 1
        ds = reg.get(result["datasets"][0]["dataset_id"])
        assert ds is not None
        rows = duckdb.connect(":memory:").execute(
            f"SELECT COUNT(*) FROM read_parquet('{str(ds.source_path).replace(chr(39), chr(39)*2)}')"
        ).fetchone()[0]
        assert rows == 1
    finally:
        ws.close()


def test_import_duplicate_alias_names_get_unique_views(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    _add_duckdb_table(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        result = import_duckdb_relations(
            source_path=source,
            relations=[
                DuckDbRelationRef(schema="main", name="refunds", alias="same_name"),
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


def test_malicious_duckdb_view_reading_local_file_is_not_importable(tmp_path: Path) -> None:
    secret = tmp_path / "secret.csv"
    secret.write_text("secret\nleaked\n")
    source = tmp_path / "malicious.duckdb"
    con = duckdb.connect(str(source))
    try:
        con.execute("CREATE TABLE safe_orders AS SELECT 1 AS id")
        escaped = str(secret).replace("'", "''")
        con.execute(f"CREATE VIEW steal AS SELECT * FROM read_csv_auto('{escaped}')")
    finally:
        con.close()

    settings = _settings(tmp_path)
    rows = inspect_duckdb_relations(source, settings=settings)
    by_name = {row.name: row for row in rows}
    assert set(by_name) == {"safe_orders", "steal"}
    assert by_name["steal"].type == "view"
    assert count_duckdb_relation(source, schema_name="main", relation_name="steal", settings=settings) is None

    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(DuckDbImportError, match="could not be exported"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="steal")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert reg.list_all() == []
    finally:
        ws.close()


def test_import_view_snapshots_to_parquet(tmp_path: Path) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        result = import_duckdb_relations(
            source_path=source,
            relations=[DuckDbRelationRef(schema="main", name="high_value")],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
        ds = reg.get(result["datasets"][0]["dataset_id"])
        assert ds is not None
        escaped = str(ds.source_path).replace("'", "''")
        rows = duckdb.connect(":memory:").execute(
            f"SELECT id, amount FROM read_parquet('{escaped}') ORDER BY id"
        ).fetchall()
        assert rows == [(2, 20.0)]
    finally:
        ws.close()


def test_import_nested_views_resolve_through_sandbox(tmp_path: Path) -> None:
    source = tmp_path / "layered.duckdb"
    con = duckdb.connect(str(source))
    try:
        con.execute("CREATE TABLE base AS SELECT 1 AS id, 'a' AS label")
        con.execute("CREATE VIEW mid AS SELECT * FROM base WHERE id = 1")
        con.execute("CREATE VIEW top AS SELECT id, upper(label) AS label FROM mid")
    finally:
        con.close()

    settings = _settings(tmp_path)
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        result = import_duckdb_relations(
            source_path=source,
            relations=[DuckDbRelationRef(schema="main", name="top")],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
        ds = reg.get(result["datasets"][0]["dataset_id"])
        assert ds is not None
        escaped = str(ds.source_path).replace("'", "''")
        rows = duckdb.connect(":memory:").execute(
            f"SELECT * FROM read_parquet('{escaped}')"
        ).fetchall()
        assert rows == [(1, "A")]
    finally:
        ws.close()


def test_view_import_disabled_by_settings(tmp_path: Path) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path, enable_duckdb_view_import=False)

    rows = inspect_duckdb_relations(source, settings=settings)
    assert {row.name for row in rows} == {"orders"}

    with pytest.raises(AppError, match="not available"):
        count_duckdb_relation(source, schema_name="main", relation_name="high_value", settings=settings)

    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(DuckDbImportError, match="not available"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="high_value")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert reg.list_all() == []
    finally:
        ws.close()


def test_import_rejects_view_at_snapshot_when_view_import_disabled(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    source = tmp_path / "source.duckdb"
    _source_db(source)
    settings = _settings(tmp_path, enable_duckdb_view_import=False)
    from app.models.api import DuckDbRelationSummary

    monkeypatch.setattr(
        "app.services.duckdb_import.inspect_duckdb_relations",
        lambda *_args, **_kwargs: [
            DuckDbRelationSummary(
                schema_name="main",
                name="high_value",
                type="view",
                column_count=2,
                row_count=1,
            )
        ],
    )

    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(AppError, match="not available"):
            import_duckdb_relations(
                source_path=source,
                relations=[DuckDbRelationRef(schema="main", name="high_value")],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
            )
        assert reg.list_all() == []
    finally:
        ws.close()


def test_duckdb_capabilities_reports_view_import_enabled(client) -> None:
    r = client.get("/api/datasets/duckdb/capabilities")
    assert r.status_code == 200
    body = r.json()
    assert body["view_import_enabled"] is True


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


def test_snapshot_relation_timeout_message() -> None:
    class TimeoutCon:
        def execute(self, _sql: str):  # noqa: ANN201
            raise RuntimeError("Query timeout exceeded")

    with pytest.raises(DuckDbImportError, match="Export timed out"):
        _snapshot_relation(
            TimeoutCon(),  # type: ignore[arg-type]
            rel=DuckDbRelationRef(schema="main", name="orders"),
            export_path=Path("out.parquet"),
        )


def test_import_uses_duckdb_import_timeout(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    import app.services.duckdb_import as duckdb_import

    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        upload_dir=tmp_path / "uploads",
        duckdb_import_timeout_seconds=42.0,
    )
    ws = Workspace(settings)
    timeouts: list[float] = []
    real_set_timeout = duckdb_import._set_timeout

    def capture_timeout(con, seconds: float) -> None:  # noqa: ANN001
        timeouts.append(seconds)
        real_set_timeout(con, seconds)

    try:
        reg = DatasetRegistry(ws, settings)
        monkeypatch.setattr(duckdb_import, "_set_timeout", capture_timeout)
        import_duckdb_relations(
            source_path=source,
            relations=[DuckDbRelationRef(schema="main", name="orders")],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
        assert timeouts == [42.0]
    finally:
        ws.close()


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


def test_duckdb_import_cancel_between_snapshots_cleans_and_registers_none(
    tmp_path: Path,
) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    _add_duckdb_table(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    checks = {"n": 0}

    def cancel_after_first_snapshot() -> bool:
        checks["n"] += 1
        return checks["n"] >= 3

    try:
        reg = DatasetRegistry(ws, settings)
        with pytest.raises(DuckDbImportCancelled):
            import_duckdb_relations(
                source_path=source,
                relations=[
                    DuckDbRelationRef(schema="main", name="orders"),
                    DuckDbRelationRef(schema="main", name="refunds"),
                ],
                registry=reg,
                settings=settings,
                queue_prepare=lambda dataset_id: "job",
                cancel_requested=cancel_after_first_snapshot,
            )
        assert reg.list_all() == []
        assert list((tmp_path / "uploads").rglob("*.parquet")) == []
    finally:
        ws.close()


def test_duckdb_import_snapshots_all_relations_before_registration(
    tmp_path: Path,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    source = tmp_path / "sales.duckdb"
    _source_db(source)
    _add_duckdb_table(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    snapshots = 0

    try:
        reg = DatasetRegistry(ws, settings)
        real_snapshot = _snapshot_relation
        real_register = reg.register_path

        def track_snapshot(*args, **kwargs):  # noqa: ANN001, ANN202
            nonlocal snapshots
            snapshots += 1
            return real_snapshot(*args, **kwargs)

        def track_register(path: Path, *, compute_counts: bool = True):  # noqa: ANN202
            assert snapshots == 2
            return real_register(path, compute_counts=compute_counts)

        monkeypatch.setattr("app.services.duckdb_import._snapshot_relation", track_snapshot)
        monkeypatch.setattr(reg, "register_path", track_register)
        import_duckdb_relations(
            source_path=source,
            relations=[
                DuckDbRelationRef(schema="main", name="orders"),
                DuckDbRelationRef(schema="main", name="refunds"),
            ],
            registry=reg,
            settings=settings,
            queue_prepare=lambda dataset_id: "job",
        )
    finally:
        ws.close()


def test_generic_import_failure_is_sanitized(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    import app.services.duckdb_import as duckdb_import

    source = tmp_path / "sales.duckdb"
    _source_db(source)
    settings = _settings(tmp_path)
    ws = Workspace(settings)
    real_connect = duckdb_import.duckdb.connect
    read_only_opens = 0

    def fake_connect(path: str, *args, **kwargs):  # noqa: ANN001, ANN202
        nonlocal read_only_opens
        if kwargs.get("read_only"):
            read_only_opens += 1
            if read_only_opens > 1:
                raise RuntimeError("open failed")
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
        source_id = _stage_upload(tmp_path, source)
        response = import_duckdb(
            DuckDbImportRequest(
                source_id=source_id,
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
