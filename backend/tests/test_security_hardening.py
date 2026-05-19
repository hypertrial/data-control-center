from __future__ import annotations

import os
import time
from pathlib import Path

import duckdb
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.security import (
    LOCAL_TOKEN_HEADER,
    _host_without_port,
    _is_loopback_host,
    _origin_host,
    _path_requires_token,
    generate_local_api_token,
)
from app.services import upload_validation
from app.services.registry import DatasetRegistry
from app.services.upload_validation import UploadValidationError, validate_upload_file
from app.services.workspace import Workspace


def _secure_client(tmp_path: Path, monkeypatch: pytest.MonkeyPatch, *, token: str = "tok") -> TestClient:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "true")
    monkeypatch.setenv("DCC_LOCAL_API_TOKEN", token)
    monkeypatch.setenv("DCC_ENABLE_PATH_REGISTRATION", "false")
    from app.main import create_app

    return TestClient(create_app())


def test_security_helpers_cover_loopback_and_token_generation(monkeypatch: pytest.MonkeyPatch) -> None:
    assert generate_local_api_token(Settings(local_api_token=" configured ")) == "configured"
    monkeypatch.setattr("app.security.secrets.token_urlsafe", lambda n: f"generated-{n}")
    assert generate_local_api_token(Settings(local_api_token=None)) == "generated-32"
    assert _host_without_port("") == ""
    assert _host_without_port("[::1]:8000") == "::1"
    assert _host_without_port("127.0.0.1:8000") == "127.0.0.1"
    assert _host_without_port("::1") == "::1"
    assert _is_loopback_host(None)
    assert _is_loopback_host("localhost:5173")
    assert _is_loopback_host("::1")
    assert not _is_loopback_host("example.com")
    assert _origin_host(None) is None
    assert _origin_host("http://[::1") == ""
    assert _origin_host("http://127.0.0.1:5173/x") == "127.0.0.1"
    assert _origin_host("http://[::1]:5173/x") == "::1"
    assert _origin_host("not a url") == ""
    assert not _path_requires_token("/assets/index.js")


def test_local_session_and_token_guard(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _secure_client(tmp_path, monkeypatch, token="secret") as c:
        session = c.get("/api/local-session")
        assert session.status_code == 200
        assert session.json() == {"token": "secret", "local_only": True}
        assert c.get("/api/datasets").status_code == 403
        ok = c.get("/api/datasets", headers={LOCAL_TOKEN_HEADER: "secret"})
        assert ok.status_code == 200


def test_local_only_rejects_non_loopback_headers(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    with _secure_client(tmp_path, monkeypatch, token="secret") as c:
        headers = {LOCAL_TOKEN_HEADER: "secret"}
        assert c.get("/api/health", headers={"host": "example.com"}).status_code == 403
        assert c.get("/api/datasets", headers={**headers, "origin": "https://evil.example"}).status_code == 403
        assert c.get("/api/datasets", headers={**headers, "referer": "https://evil.example/x"}).status_code == 403


def test_allow_non_local_override_still_requires_token(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCC_ALLOW_NON_LOCAL_HOST", "true")
    with _secure_client(tmp_path, monkeypatch, token="secret") as c:
        assert c.get("/api/datasets", headers={"host": "example.com"}).status_code == 403
        ok = c.get("/api/datasets", headers={"host": "example.com", LOCAL_TOKEN_HEADER: "secret"})
        assert ok.status_code == 200
        assert c.options("/api/datasets", headers={"host": "example.com"}).status_code in {200, 405}


def test_path_registration_disabled_by_default(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_ENABLE_PATH_REGISTRATION", "false")
    from app.main import create_app

    csv = tmp_path / "x.csv"
    csv.write_text("a\n1\n")
    with TestClient(create_app()) as c:
        r = c.post("/api/datasets/register-file", json={"path": str(csv)})
        folder = c.post("/api/datasets/register-folder", json={"path": str(tmp_path)})
    assert r.status_code == 403
    assert folder.status_code == 403


def test_upload_batch_limits(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    monkeypatch.setenv("DCC_UPLOAD_MAX_FILES_PER_BATCH", "1")
    from app.main import create_app

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[
                ("files", ("a.csv", b"a\n1\n", "text/csv")),
                ("files", ("b.csv", b"b\n2\n", "text/csv")),
            ],
        )
    assert r.status_code == 400

    monkeypatch.setenv("DCC_UPLOAD_MAX_FILES_PER_BATCH", "5")
    monkeypatch.setenv("DCC_UPLOAD_MAX_BATCH_BYTES", "5")
    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[
                ("files", ("a.csv", b"a\n123\n", "text/csv")),
                ("files", ("b.csv", b"b\n456\n", "text/csv")),
            ],
        )
    assert r.status_code == 400


def test_upload_validation_rejects_bad_content(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        for name, body, ctype in [
            ("bad.csv", b"a\x00b", "text/csv"),
            ("bad.json", b"not-json", "application/json"),
            ("bad.jsonl", b"[]\n", "application/x-ndjson"),
            ("bad.parquet", b"not parquet", "application/octet-stream"),
        ]:
            r = c.post("/api/datasets/upload", files=[("files", (name, body, ctype))])
            assert r.status_code == 400


def test_uploaded_copy_is_deleted_on_unregister(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app

    with TestClient(create_app()) as c:
        r = c.post("/api/datasets/upload", files=[("files", ("owned.csv", b"a\n1\n", "text/csv"))])
        assert r.status_code == 200
        dataset_id = r.json()[0]["dataset_id"]
        ds = c.app.state.registry.get(dataset_id)
        assert ds is not None
        copied = ds.source_path
        assert copied.exists()
        assert c.delete(f"/api/datasets/{dataset_id}").status_code == 204
        assert not copied.exists()


def test_external_registered_file_is_preserved_on_unregister(tmp_path: Path) -> None:
    csv = tmp_path / "external.csv"
    csv.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
        enable_path_registration=True,
    )
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        ds = reg.register_path(csv)
        assert reg.unregister(ds.dataset_id)
        assert csv.exists()
    finally:
        ws.close()


def test_upload_validation_direct_paths(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    csv = tmp_path / "ok.csv"
    csv.write_text("a\n1\n")
    validate_upload_file(csv, settings)
    tsv = tmp_path / "ok.tsv"
    tsv.write_text("a\tb\n1\t2\n")
    validate_upload_file(tsv, settings)
    js = tmp_path / "ok.json"
    js.write_text('[{"a":1}]')
    validate_upload_file(js, settings)
    jl = tmp_path / "ok.jsonl"
    jl.write_text('{"a":1}\n')
    validate_upload_file(jl, settings)
    many = tmp_path / "many.jsonl"
    many.write_text("".join('{"a":1}\n' for _ in range(101)))
    validate_upload_file(many, settings)
    pq = tmp_path / "ok.parquet"
    con = duckdb.connect(":memory:")
    con.execute(f"COPY (SELECT 1 AS a) TO '{pq}' (FORMAT PARQUET)")
    con.close()
    validate_upload_file(pq, settings)
    validate_upload_file(csv, Settings(upload_validate_parse=False))
    bad = tmp_path / "bad.txt"
    bad.write_text("x")
    with pytest.raises(UploadValidationError):
        validate_upload_file(bad, settings)
    small_parquet = tmp_path / "small.parquet"
    small_parquet.write_bytes(b"PAR1")
    with pytest.raises(UploadValidationError):
        validate_upload_file(small_parquet, settings)


def test_example_fixtures_validate_and_register(tmp_path: Path) -> None:
    repo_root = Path(__file__).resolve().parents[2]
    examples = [
        repo_root / "examples" / "customers.csv",
        repo_root / "examples" / "events.jsonl",
        repo_root / "examples" / "orders.parquet",
    ]
    assert all(path.exists() for path in examples)

    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        allow_arbitrary_registration_paths=True,
        enable_path_registration=True,
    )
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        view_names: set[str] = set()
        for path in examples:
            validate_upload_file(path, settings)
            ds = reg.register_path(path)
            view_names.add(ds.view_name)
            assert ds.row_count is not None
            assert ds.row_count > 0
        assert view_names == {"customers", "events", "orders"}
    finally:
        ws.close()


def test_upload_validation_text_edge_cases(tmp_path: Path) -> None:
    settings = Settings(workspace_db_path=tmp_path / "w.duckdb")
    for name, body in [
        ("empty.csv", b"   "),
        ("bad_encoding.csv", b"\xff\xfe\xff"),
        ("empty.json", b"   "),
        ("empty.jsonl", b"\n\n"),
        ("bad.jsonl", b"{nope}\n"),
    ]:
        p = tmp_path / name
        p.write_bytes(body)
        with pytest.raises(UploadValidationError):
            validate_upload_file(p, settings)


def test_upload_validation_wraps_parser_failures(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    csv = tmp_path / "bad.csv"
    csv.write_text("a\n1\n")
    monkeypatch.setattr(
        upload_validation,
        "_validate_csv",
        lambda path, settings, *, tsv: (_ for _ in ()).throw(RuntimeError("boom")),
    )
    with pytest.raises(UploadValidationError):
        validate_upload_file(csv, Settings(workspace_db_path=tmp_path / "w.duckdb"))


def test_upload_validation_reraises_unknown_timeout_setting_error(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    class Con:
        def execute(self, sql: str):  # noqa: ANN201
            if sql.startswith("SET statement_timeout"):
                raise RuntimeError("different failure")
            return self

        def fetchone(self):  # noqa: ANN201
            return None

        def close(self) -> None:
            pass

    monkeypatch.setattr(upload_validation.duckdb, "connect", lambda _: Con())
    with pytest.raises(RuntimeError, match="different failure"):
        upload_validation._probe_duckdb("SELECT 1", 1.0)


def test_upload_orphan_cleanup_removes_old_inactive_batch(tmp_path: Path) -> None:
    upload_root = tmp_path / "up"
    old_batch = upload_root / "old"
    old_batch.mkdir(parents=True)
    stale = old_batch / "stale.csv"
    stale.write_text("a\n1\n")
    old = time.time() - 3600
    os.utime(stale, (old, old))
    os.utime(old_batch, (old, old))
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        upload_dir=upload_root,
        upload_orphan_ttl_hours=0,
    )
    ws = Workspace(settings)
    try:
        DatasetRegistry(ws, settings)
        assert not old_batch.exists()
    finally:
        ws.close()


def test_upload_orphan_cleanup_skip_paths_and_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload_root = tmp_path / "up"
    upload_root.mkdir()
    (upload_root / "loose.csv").write_text("a\n1\n")
    fresh = upload_root / "fresh"
    fresh.mkdir()
    (fresh / "fresh.csv").write_text("a\n1\n")
    error_dir = upload_root / "error"
    error_dir.mkdir()
    (error_dir / "x.csv").write_text("a\n1\n")
    old = time.time() - 3600
    os.utime(error_dir / "x.csv", (old, old))
    os.utime(error_dir, (old, old))

    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        upload_dir=upload_root,
        upload_orphan_ttl_hours=24,
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        reg.cleanup_upload_orphans()
        assert fresh.exists()
        monkeypatch.setattr("app.services.registry.shutil.rmtree", lambda _: (_ for _ in ()).throw(OSError()))
        reg._settings.upload_orphan_ttl_hours = 0
        reg.cleanup_upload_orphans()
        assert error_dir.exists()
    finally:
        ws.close()


def test_upload_orphan_cleanup_keeps_active_upload(tmp_path: Path) -> None:
    upload_root = tmp_path / "up"
    batch = upload_root / "batch"
    batch.mkdir(parents=True)
    csv = batch / "active.csv"
    csv.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        upload_dir=upload_root,
        upload_orphan_ttl_hours=24,
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        reg.register_path(csv)
        old = time.time() - 3600
        os.utime(csv, (old, old))
        os.utime(batch, (old, old))
        reg._settings.upload_orphan_ttl_hours = 0
        reg.cleanup_upload_orphans()
        assert batch.exists()
    finally:
        ws.close()


def test_unregister_ignores_upload_delete_errors(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    upload_root = tmp_path / "up"
    batch = upload_root / "batch"
    batch.mkdir(parents=True)
    csv = batch / "owned.csv"
    csv.write_text("a\n1\n")
    settings = Settings(
        workspace_db_path=tmp_path / "w.duckdb",
        upload_dir=upload_root,
        allow_arbitrary_registration_paths=True,
    )
    ws = Workspace(settings)
    try:
        reg = DatasetRegistry(ws, settings)
        ds = reg.register_path(csv)
        original_unlink = Path.unlink

        def fail_owned(path: Path, *args, **kwargs):  # noqa: ANN001, ANN202
            if path == csv:
                raise OSError("cannot delete")
            return original_unlink(path, *args, **kwargs)

        monkeypatch.setattr(Path, "unlink", fail_owned)
        assert reg.unregister(ds.dataset_id)
    finally:
        ws.close()
