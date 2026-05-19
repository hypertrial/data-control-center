"""Static UI (built frontend) mounting."""

from __future__ import annotations

import logging

from fastapi.testclient import TestClient

from app.main import create_app


def test_dev_ui_origin_redirects_root_without_static_dist(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    monkeypatch.delenv("DCC_UI_DIST_PATH", raising=False)
    monkeypatch.setenv("DCC_DEV_UI_ORIGIN", "http://localhost:5173")

    with TestClient(create_app(), follow_redirects=False) as client:
        r_index = client.get("/")
        assert r_index.status_code == 307
        assert r_index.headers["location"] == "http://localhost:5173/"

        r_health = client.get("/api/health")
        assert r_health.status_code == 200


def test_dev_ui_origin_rejects_non_local_origin(tmp_path, monkeypatch, caplog) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    monkeypatch.delenv("DCC_UI_DIST_PATH", raising=False)
    monkeypatch.setenv("DCC_DEV_UI_ORIGIN", "https://example.com")

    with caplog.at_level(logging.WARNING):
        app = create_app()

    assert any("DCC_DEV_UI_ORIGIN must be a local http origin" in r.message for r in caplog.records)

    with TestClient(app, follow_redirects=False) as client:
        assert client.get("/").status_code == 404


def test_ui_dist_serves_spa_and_api_coexist(tmp_path, monkeypatch) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    monkeypatch.setenv("DCC_ENABLE_PATH_REGISTRATION", "true")
    monkeypatch.setenv("DCC_ALLOW_ARBITRARY_REGISTRATION_PATHS", "true")

    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("<!doctype html><html><title>dcc-ui</title></html>", encoding="utf-8")
    (dist / "style.css").write_text("body{}", encoding="utf-8")

    monkeypatch.setenv("DCC_UI_DIST_PATH", str(dist))

    with TestClient(create_app()) as client:
        r_index = client.get("/")
        assert r_index.status_code == 200
        assert "dcc-ui" in r_index.text

        r_health = client.get("/api/health")
        assert r_health.status_code == 200
        body = r_health.json()
        assert body["status"] == "ok"
        assert "llm" in body

        r_spa = client.get("/ask")
        assert r_spa.status_code == 200
        assert "dcc-ui" in r_spa.text

        r_bad_api = client.get("/api")
        assert r_bad_api.status_code == 404

        r_escape = client.get("/%2e%2e%2fsecret")
        assert r_escape.status_code == 200
        assert "dcc-ui" in r_escape.text

        r_asset = client.get("/style.css")
        assert r_asset.status_code == 200
        assert "body" in r_asset.text


def test_ui_dist_missing_index_warns(tmp_path, monkeypatch, caplog) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    dist = tmp_path / "dist"
    dist.mkdir()
    monkeypatch.setenv("DCC_UI_DIST_PATH", str(dist))

    with caplog.at_level(logging.WARNING):
        create_app()

    assert any("no index.html" in r.message for r in caplog.records)


def test_ui_dist_missing_directory_warns(tmp_path, monkeypatch, caplog) -> None:
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "w.duckdb"))
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    missing = tmp_path / "not-a-dir"
    monkeypatch.setenv("DCC_UI_DIST_PATH", str(missing))

    with caplog.at_level(logging.WARNING):
        create_app()

    assert any("not a directory" in r.message for r in caplog.records)
