"""HTTP API integration tests."""

from __future__ import annotations

from pathlib import Path


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_datasets_empty(client):
    r = client.get("/api/datasets")
    assert r.status_code == 200
    assert r.json() == []


def test_list_datasets_includes_quality_score_from_profile_cache(client, tmp_path):
    csv = tmp_path / "q.csv"
    csv.write_text("id\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    assert reg.status_code == 200
    did = reg.json()["dataset_id"]
    pr = client.get(f"/api/datasets/{did}/profile")
    assert pr.status_code == 200
    expected_qs = pr.json()["quality_score"]
    lst = client.get("/api/datasets").json()
    row = next(d for d in lst if d["dataset_id"] == did)
    assert row.get("quality_score") == int(expected_qs)


def test_list_datasets_invalid_cached_quality_score_ignored(client, tmp_path, monkeypatch):
    csv = tmp_path / "q.csv"
    csv.write_text("id\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")

    from app.services.workspace import Workspace

    real = Workspace.load_profile_cache

    def bad_load(self, dataset_id):
        if dataset_id == did:
            return {"quality_score": "not-a-number"}
        return real(self, dataset_id)

    monkeypatch.setattr(Workspace, "load_profile_cache", bad_load)

    lst = client.get("/api/datasets").json()
    row = next(d for d in lst if d["dataset_id"] == did)
    assert row.get("quality_score") is None


def test_register_file_not_found(client):
    r = client.post("/api/datasets/register-file", json={"path": "/no/such/file.csv"})
    assert r.status_code == 404


def test_register_file_is_directory(client, tmp_path):
    r = client.post("/api/datasets/register-file", json={"path": str(tmp_path)})
    assert r.status_code == 400


def test_register_file_bad_extension(client, tmp_path):
    p = tmp_path / "x.badext"
    p.write_text("a")
    r = client.post("/api/datasets/register-file", json={"path": str(p)})
    assert r.status_code == 400


def test_register_and_profile_csv(client, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text("id,name,amount\n1,alice,10.5\n2,bob,20\n")
    r = client.post("/api/datasets/register-file", json={"path": str(csv)})
    assert r.status_code == 200, r.text
    did = r.json()["dataset_id"]
    pr = client.get(f"/api/datasets/{did}/profile")
    assert pr.status_code == 200, pr.text
    body = pr.json()
    assert body["rows"] == 2
    assert body["columns"] == 3
    # cache hit
    pr2 = client.get(f"/api/datasets/{did}/profile")
    assert pr2.status_code == 200
    assert pr2.json()["rows"] == 2


def test_get_dataset_and_columns_quality(client, tmp_path):
    csv = tmp_path / "a.csv"
    csv.write_text("x\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    g = client.get(f"/api/datasets/{did}")
    assert g.status_code == 200
    assert g.json()["dataset_id"] == did
    col = client.get(f"/api/datasets/{did}/columns")
    assert col.status_code == 200
    assert isinstance(col.json(), list)
    q = client.get(f"/api/datasets/{did}/quality-issues")
    assert q.status_code == 200


def test_get_dataset_404(client):
    assert client.get("/api/datasets/ds_missing").status_code == 404


def test_profile_columns_quality_404(client):
    for path in (
        "/api/datasets/ds_missing/profile",
        "/api/datasets/ds_missing/columns",
        "/api/datasets/ds_missing/quality-issues",
    ):
        assert client.get(path).status_code == 404


def test_register_folder_non_recursive_only_root_files(client, tmp_path):
    root = tmp_path / "r"
    root.mkdir()
    (root / "one.csv").write_text("a\n1\n")
    sub = root / "sub"
    sub.mkdir()
    (sub / "two.csv").write_text("b\n2\n")
    r = client.post("/api/datasets/register-folder", json={"path": str(root), "recursive": False})
    assert r.status_code == 200
    assert len(r.json()) == 1


def test_register_folder_recursive_includes_subfolder(client, tmp_path):
    root = tmp_path / "r2"
    root.mkdir()
    (root / "a.csv").write_text("c\n1\n")
    sub = root / "sub"
    sub.mkdir()
    (sub / "b.csv").write_text("d\n2\n")
    r = client.post("/api/datasets/register-folder", json={"path": str(root), "recursive": True})
    assert r.status_code == 200
    assert len(r.json()) == 2


def test_register_folder_not_directory(client, tmp_path):
    f = tmp_path / "nope.txt"
    f.write_text("x")
    r = client.post("/api/datasets/register-folder", json={"path": str(f)})
    assert r.status_code == 400


def test_sample_pagination_and_bounds(client, tmp_path):
    csv = tmp_path / "rows.csv"
    csv.write_text("a\n" + "\n".join(str(i) for i in range(30)))
    r = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = r.json()["dataset_id"]
    s1 = client.get(f"/api/datasets/{did}/sample?page=1&page_size=10")
    assert s1.status_code == 200
    j1 = s1.json()
    assert len(j1["rows"]) == 10
    assert j1.get("total_rows") == 30
    sdef = client.get(f"/api/datasets/{did}/sample?page=1")
    assert sdef.status_code == 200
    too_big = client.get(f"/api/datasets/{did}/sample?page=1&page_size=99999")
    assert too_big.status_code == 400
    assert client.get("/api/datasets/ds_bad/sample").status_code == 404


def test_sql_requires_view_reference(client, tmp_path):
    csv = tmp_path / "x.csv"
    csv.write_text("id\n1\n")
    client.post("/api/datasets/register-file", json={"path": str(csv)})
    r = client.post("/api/query", json={"sql": "SELECT 1"})
    assert r.status_code == 200
    body = r.json()
    assert body.get("error")


def test_query_forbidden_and_success_and_truncation(client, tmp_path):
    csv = tmp_path / "q.csv"
    csv.write_text("id,val\n" + "\n".join(f"{i},{i}" for i in range(25)))
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    vw = f"v_{did}"
    fb = client.post("/api/query", json={"sql": f"ATTACH 'x' AS z; SELECT * FROM {vw}"})
    assert fb.status_code == 200 and fb.json()["error"]
    ok = client.post("/api/query", json={"sql": f"SELECT * FROM {vw}", "max_rows": 5})
    assert ok.status_code == 200
    b = ok.json()
    assert not b.get("error")
    assert b["truncated"]
    assert len(b["rows"]) == 5
    bad_sql = client.post("/api/query", json={"sql": f"SELECT typo FROM {vw}"})
    assert bad_sql.status_code == 200 and bad_sql.json()["error"]


def test_sample_rows_fails_when_view_missing(client, tmp_path):
    csv = tmp_path / "z.csv"
    csv.write_text("q\n1\n")
    r = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = r.json()["dataset_id"]
    ds = client.app.state.registry.get(did)
    client.app.state.workspace.drop_view_if_exists(ds.view_name)
    sr = client.get(f"/api/datasets/{did}/sample?page=1&page_size=5")
    assert sr.status_code == 400


def test_upload_csv_multipart(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[
                ("files", ("a.csv", b"id,name\n1,x", "text/csv")),
                ("files", ("b.csv", b"k\n1", "text/csv")),
            ],
        )
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body) == 2


def test_upload_no_multipart_files(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        assert c.post("/api/datasets/upload").status_code == 400


def test_upload_invalid_filename_dot(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", (".", b"id\n1", "text/csv"))],
        )
    assert r.status_code == 400


def test_upload_relative_upload_dir(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", ("rel.csv", b"id\n1", "text/csv"))],
        )
    assert r.status_code == 200, r.text
    assert (tmp_path / ".dcc_uploads").is_dir()
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", ("..", b"a\n1", "text/csv"))],
        )
    assert r.status_code == 400


def test_upload_only_unsupported_types(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", ("nope.txt", b"x", "text/plain"))],
        )
    assert r.status_code == 400
    assert "skipped" in r.json()["detail"].lower() or "No supported" in r.json()["detail"]


def test_upload_duplicate_names_in_one_batch(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[
                ("files", ("same.csv", b"a\n1", "text/csv")),
                ("files", ("same.csv", b"b\n2", "text/csv")),
            ],
        )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 2


def test_upload_exceeds_max_bytes(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    monkeypatch.setenv("DCC_UPLOAD_MAX_BYTES_PER_FILE", "5")
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", ("big.csv", b"123456", "text/csv"))],
        )
    assert r.status_code == 400


def test_upload_uses_absolute_upload_dir(tmp_path, monkeypatch):
    up = tmp_path / "absolute_up"
    up.mkdir()
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(up.resolve()))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[("files", ("z.csv", b"x\n1", "text/csv"))],
        )
    assert r.status_code == 200, r.text


def test_upload_register_valueerror_skips_file(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_UPLOAD_DIR", str(tmp_path / "up"))
    from app.main import create_app
    from app.services.registry import DatasetRegistry
    from fastapi.testclient import TestClient

    orig = DatasetRegistry.register_path

    def boom(self, path: Path):
        if path.name == "bad.csv":
            raise ValueError("no")
        return orig(self, path)

    monkeypatch.setattr(DatasetRegistry, "register_path", boom)
    with TestClient(create_app()) as c:
        r = c.post(
            "/api/datasets/upload",
            files=[
                ("files", ("bad.csv", b"a\n1", "text/csv")),
                ("files", ("good.csv", b"b\n2", "text/csv")),
            ],
        )
    assert r.status_code == 200, r.text
    assert len(r.json()) == 1


def test_refresh_profile(client, tmp_path):
    csv = tmp_path / "t.csv"
    csv.write_text("id,name\n1,x\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    pr = client.post(f"/api/datasets/{did}/profile/refresh")
    assert pr.status_code == 200
    assert pr.json()["dataset_id"] == did


def test_refresh_profile_not_found(client):
    assert client.post("/api/datasets/ds_missing/profile/refresh").status_code == 404


def test_refresh_profile_build_failure(client, tmp_path, monkeypatch):
    csv = tmp_path / "t.csv"
    csv.write_text("id\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]

    def boom(*a, **k):  # noqa: ANN002, ANN003
        raise RuntimeError("prof fail")

    monkeypatch.setattr("app.api.datasets.build_profile", boom)
    pr = client.post(f"/api/datasets/{did}/profile/refresh")
    assert pr.status_code == 500

