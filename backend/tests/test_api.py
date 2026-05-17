"""HTTP API integration tests."""

from __future__ import annotations

import time
from dataclasses import replace
from pathlib import Path

from app.services.workspace import Workspace


def _wait_for_job(client, job_id: str, *, timeout: float = 2.0) -> dict:
    deadline = time.time() + timeout
    while time.time() < deadline:
        res = client.get(f"/api/jobs/{job_id}")
        assert res.status_code == 200
        body = res.json()
        if body["status"] in {"completed", "failed", "canceled"}:
            return body
        time.sleep(0.02)
    raise AssertionError(f"job {job_id} did not finish within {timeout}s")


def test_health(client):
    r = client.get("/api/health")
    assert r.status_code == 200
    assert r.json()["status"] == "ok"


def test_list_datasets_empty(client):
    r = client.get("/api/datasets")
    assert r.status_code == 200
    assert r.json() == []


def test_queue_count_job_handles_missing_dataset(client):
    from app.api.datasets import _queue_count_job
    from app.config import Settings

    captured: dict[str, object] = {}

    class Jobs:
        def submit(self, *, kind, dataset_id, fn):  # noqa: ANN001
            captured["kind"] = kind
            captured["dataset_id"] = dataset_id
            captured["result"] = fn("job_x")
            return "job_x"

    job_id = _queue_count_job("ds_missing", Jobs(), client.app.state.registry, Settings())
    assert job_id == "job_x"
    assert captured["kind"] == "dataset_count"
    assert captured["result"] == {"dataset_id": "ds_missing", "row_count": None, "column_count": None}


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


def test_profile_rebuilds_when_cached_structure_version_stale(client, tmp_path):
    csv = tmp_path / "grain.csv"
    csv.write_text("player_id,year\n1,2024\n2,2024\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    assert reg.status_code == 200
    did = reg.json()["dataset_id"]
    pr = client.get(f"/api/datasets/{did}/profile")
    assert pr.status_code == 200
    body = pr.json()
    assert body["structure_version"] == "v4"
    stale = {**body, "structure_version": "v2", "entity_id_columns": [], "potential_id_columns": []}
    client.app.state.workspace.save_profile_cache(did, stale)
    pr2 = client.get(f"/api/datasets/{did}/profile")
    assert pr2.status_code == 200
    refreshed = pr2.json()
    assert refreshed["structure_version"] == "v4"
    assert refreshed["entity_id_columns"] or refreshed["potential_id_columns"]


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


def test_delete_dataset(client, tmp_path):
    csv = tmp_path / "delete_me.csv"
    csv.write_text("x\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")

    assert client.delete(f"/api/datasets/{did}").status_code == 204
    assert client.get(f"/api/datasets/{did}").status_code == 404
    assert client.get(f"/api/datasets/{did}/profile/history").status_code == 404
    assert client.delete(f"/api/datasets/{did}").status_code == 404


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


def test_sample_uses_query_count_when_registry_row_count_missing(client, tmp_path, monkeypatch) -> None:
    csv = tmp_path / "missing_count.csv"
    csv.write_text("a\n1\n2\n3\n")
    did = client.post("/api/datasets/register-file", json={"path": str(csv)}).json()["dataset_id"]

    registry = client.app.state.registry
    original = registry.get(did)
    assert original is not None

    monkeypatch.setattr(registry, "get", lambda dataset_id: replace(original, row_count=None) if dataset_id == did else None)
    monkeypatch.setattr(client.app.state.workspace, "query_count", lambda view_name, timeout_seconds: 3)

    res = client.get(f"/api/datasets/{did}/sample?page=1&page_size=2")
    assert res.status_code == 200
    assert res.json()["total_rows"] == 3


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
    assert reg.status_code == 200
    vw = "q"
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
    msg = r.json()["error"]["message"]
    assert "skipped" in msg.lower() or "No supported" in msg


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

    def boom(self, path: Path, *, compute_counts=True):
        if path.name == "bad.csv":
            raise ValueError("no")
        return orig(self, path, compute_counts=compute_counts)

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
    assert pr.json()["status"] == "queued"
    job = _wait_for_job(client, pr.json()["job_id"])
    assert job["status"] == "completed"
    assert job["result"]["dataset_id"] == did


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
    assert pr.status_code == 200
    job = _wait_for_job(client, pr.json()["job_id"])
    assert job["status"] == "failed"
    assert job["error_code"] == "JOB_FAILED"


def test_profile_history_and_diff(client, tmp_path) -> None:
    csv = tmp_path / "h.csv"
    csv.write_text("a,b\n1,\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    refresh = client.post(f"/api/datasets/{did}/profile/refresh")
    _wait_for_job(client, refresh.json()["job_id"])
    h = client.get(f"/api/datasets/{did}/profile/history")
    assert h.status_code == 200
    assert len(h.json()) >= 2
    diff = client.get(f"/api/datasets/{did}/profile/diff")
    assert diff.status_code == 200
    body = diff.json()
    assert "new_columns" in body
    assert "history_id_a" in body


def test_profile_diff_requires_two_snapshots(client, tmp_path) -> None:
    csv = tmp_path / "one.csv"
    csv.write_text("x\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    assert client.get(f"/api/datasets/{did}/profile/diff").status_code == 404


def test_profile_diff_unknown_history(client, tmp_path) -> None:
    csv = tmp_path / "z.csv"
    csv.write_text("x\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    refresh = client.post(f"/api/datasets/{did}/profile/refresh")
    _wait_for_job(client, refresh.json()["job_id"])
    assert (
        client.get(f"/api/datasets/{did}/profile/diff?a=nope&b=alsono").status_code == 404
    )


def test_saved_queries_http(client) -> None:
    assert client.get("/api/saved-queries").json() == []
    c = client.post("/api/saved-queries", json={"name": "q1", "sql": "SELECT 1"})
    assert c.status_code == 200
    sid = c.json()["saved_id"]
    assert len(client.get("/api/saved-queries").json()) == 1
    p = client.patch(f"/api/saved-queries/{sid}", json={"name": "q2"})
    assert p.status_code == 200
    assert client.patch(f"/api/saved-queries/{sid}", json={}).status_code == 400
    assert client.delete(f"/api/saved-queries/{sid}").status_code == 204
    assert client.delete(f"/api/saved-queries/{sid}").status_code == 404
    assert client.get("/api/saved-queries").json() == []


def test_patch_saved_query_unknown_id(client) -> None:
    assert (
        client.patch("/api/saved-queries/sq_missing", json={"name": "x"}).status_code == 404
    )


def test_agent_ask_stream_route(client, monkeypatch) -> None:
    def fake_stream(*_a, **_k):
        yield {"type": "meta", "data": {"model": "m"}}
        yield {"type": "done", "data": {}}

    monkeypatch.setattr("app.api.agent.run_agent_ask_stream", fake_stream)
    r = client.post("/api/agent/ask/stream", json={"question": "hello"})
    assert r.status_code == 200
    assert "data:" in r.text


def test_profile_history_404(client) -> None:
    assert client.get("/api/datasets/ds_missing/profile/history").status_code == 404


def test_profile_diff_explicit_ids(client, tmp_path) -> None:
    csv = tmp_path / "e.csv"
    csv.write_text("a\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    refresh = client.post(f"/api/datasets/{did}/profile/refresh")
    _wait_for_job(client, refresh.json()["job_id"])
    h = client.get(f"/api/datasets/{did}/profile/history").json()
    assert len(h) >= 2
    ha, hb = h[1]["history_id"], h[0]["history_id"]
    d = client.get(f"/api/datasets/{did}/profile/diff?a={ha}&b={hb}")
    assert d.status_code == 200
    assert d.json()["history_id_a"] == ha


def test_profile_diff_blobs_missing(client, tmp_path, monkeypatch) -> None:
    csv = tmp_path / "m.csv"
    csv.write_text("x\n1\n")
    reg = client.post("/api/datasets/register-file", json={"path": str(csv)})
    did = reg.json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    refresh = client.post(f"/api/datasets/{did}/profile/refresh")
    _wait_for_job(client, refresh.json()["job_id"])
    monkeypatch.setattr(
        Workspace,
        "load_profile_history_blob",
        lambda self, hid: None,
    )
    assert client.get(f"/api/datasets/{did}/profile/diff").status_code == 404


def test_create_saved_query_get_fails(client, monkeypatch) -> None:
    monkeypatch.setattr(Workspace, "get_saved_query", lambda self, sid: None)
    r = client.post("/api/saved-queries", json={"name": "n", "sql": "SELECT 1"})
    assert r.status_code == 500


def test_patch_saved_query_missing_after_update(client, monkeypatch) -> None:
    c = client.post("/api/saved-queries", json={"name": "n", "sql": "SELECT 1"})
    sid = c.json()["saved_id"]
    monkeypatch.setattr(Workspace, "get_saved_query", lambda self, x: None)
    assert client.patch(f"/api/saved-queries/{sid}", json={"name": "x"}).status_code == 404


def test_profile_diff_history_from_other_dataset(client, tmp_path) -> None:
    a = tmp_path / "a.csv"
    a.write_text("x\n1\n")
    b = tmp_path / "b.csv"
    b.write_text("y\n2\n")
    d1 = client.post("/api/datasets/register-file", json={"path": str(a)}).json()["dataset_id"]
    d2 = client.post("/api/datasets/register-file", json={"path": str(b)}).json()["dataset_id"]
    client.get(f"/api/datasets/{d2}/profile")
    hid = client.get(f"/api/datasets/{d2}/profile/history").json()[0]["history_id"]
    assert (
        client.get(f"/api/datasets/{d1}/profile/diff?a={hid}&b={hid}").status_code == 404
    )


def test_profile_diff_dataset_not_found(client) -> None:
    assert client.get("/api/datasets/ds_missing/profile/diff").status_code == 404


def test_profile_diff_b_from_other_dataset(client, tmp_path) -> None:
    a = tmp_path / "a.csv"
    a.write_text("x\n1\n")
    b = tmp_path / "b.csv"
    b.write_text("y\n2\n")
    d1 = client.post("/api/datasets/register-file", json={"path": str(a)}).json()["dataset_id"]
    d2 = client.post("/api/datasets/register-file", json={"path": str(b)}).json()["dataset_id"]
    client.get(f"/api/datasets/{d1}/profile")
    client.get(f"/api/datasets/{d2}/profile")
    ha = client.get(f"/api/datasets/{d1}/profile/history").json()[0]["history_id"]
    hb = client.get(f"/api/datasets/{d2}/profile/history").json()[0]["history_id"]
    assert client.get(f"/api/datasets/{d1}/profile/diff?a={ha}&b={hb}").status_code == 404


def test_profile_diff_explicit_ids_missing_blobs(client, tmp_path, monkeypatch) -> None:
    csv = tmp_path / "e2.csv"
    csv.write_text("a\n1\n")
    did = client.post("/api/datasets/register-file", json={"path": str(csv)}).json()["dataset_id"]
    client.get(f"/api/datasets/{did}/profile")
    refresh = client.post(f"/api/datasets/{did}/profile/refresh")
    _wait_for_job(client, refresh.json()["job_id"])
    h = client.get(f"/api/datasets/{did}/profile/history").json()
    ha, hb = h[1]["history_id"], h[0]["history_id"]
    monkeypatch.setattr(Workspace, "load_profile_history_blob", lambda self, _hid: None)
    assert (
        client.get(f"/api/datasets/{did}/profile/diff?a={ha}&b={hb}").status_code == 404
    )


def test_refresh_profile_canceled_before_build(client, tmp_path, monkeypatch) -> None:
    csv = tmp_path / "cancel.csv"
    csv.write_text("a\n1\n")
    did = client.post("/api/datasets/register-file", json={"path": str(csv)}).json()["dataset_id"]
    monkeypatch.setattr(Workspace, "job_cancel_requested", lambda self, job_id: True)
    pr = client.post(f"/api/datasets/{did}/profile/refresh")
    job = _wait_for_job(client, pr.json()["job_id"])
    assert job["status"] == "canceled"


def test_refresh_profile_canceled_after_build(client, tmp_path, monkeypatch) -> None:
    from app.models.api import DatasetProfile

    csv = tmp_path / "cancel2.csv"
    csv.write_text("a\n1\n")
    did = client.post("/api/datasets/register-file", json={"path": str(csv)}).json()["dataset_id"]
    cached_profile = client.get(f"/api/datasets/{did}/profile").json()
    calls = {"count": 0}

    def fake_cancel(self, job_id):  # noqa: ANN001
        calls["count"] += 1
        return calls["count"] in {2, 3}

    monkeypatch.setattr(
        "app.api.datasets.build_profile",
        lambda ds: DatasetProfile.model_validate(cached_profile),
    )
    monkeypatch.setattr(Workspace, "job_cancel_requested", fake_cancel)
    pr = client.post(f"/api/datasets/{did}/profile/refresh")
    job = _wait_for_job(client, pr.json()["job_id"])
    assert job["status"] == "canceled"


def test_sample_rows_raises_on_timeout_setup_failure(client, tmp_path, monkeypatch) -> None:
    csv = tmp_path / "sample.csv"
    csv.write_text("a\n1\n")
    did = client.post("/api/datasets/register-file", json={"path": str(csv)}).json()["dataset_id"]

    class BadCtx:
        def __enter__(self):  # noqa: ANN204
            class Con:
                def execute(self, _sql: str):
                    raise RuntimeError("broken setup")

            return Con()

        def __exit__(self, exc_type, exc, tb):  # noqa: ANN001, ANN204
            return False

    monkeypatch.setattr(client.app.state.workspace, "read_db", lambda: BadCtx())
    res = client.get(f"/api/datasets/{did}/sample?page=1&page_size=5")
    assert res.status_code == 400
