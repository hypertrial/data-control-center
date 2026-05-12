"""HTTP tests for /api/ask conversations."""

from __future__ import annotations


def test_ask_conversations_crud(client):
    r = client.post("/api/ask/conversations", json={"title": "One", "dataset_ids": ["ds_a"]})
    assert r.status_code == 200, r.text
    cid = r.json()["conversation_id"]
    assert r.json()["title"] == "One"
    assert r.json()["dataset_ids"] == ["ds_a"]

    lst = client.get("/api/ask/conversations")
    assert lst.status_code == 200
    assert len(lst.json()) == 1

    r2 = client.patch(f"/api/ask/conversations/{cid}", json={"title": "Ren"})
    assert r2.status_code == 200
    assert r2.json()["title"] == "Ren"

    r404 = client.patch("/api/ask/conversations/missing", json={"title": "x"})
    assert r404.status_code == 404

    d204 = client.delete(f"/api/ask/conversations/{cid}")
    assert d204.status_code == 204

    d404 = client.delete(f"/api/ask/conversations/{cid}")
    assert d404.status_code == 404


def test_ask_conversations_patch_no_fields(client):
    r = client.post("/api/ask/conversations", json={})
    cid = r.json()["conversation_id"]
    bad = client.patch(f"/api/ask/conversations/{cid}", json={})
    assert bad.status_code == 400


def test_ask_turns_list_and_delete(client):
    r = client.post("/api/ask/conversations", json={})
    cid = r.json()["conversation_id"]

    t404 = client.get("/api/ask/conversations/missing/turns")
    assert t404.status_code == 404

    con = client.get(f"/api/ask/conversations/{cid}/turns")
    assert con.status_code == 200
    assert con.json() == []

    dt = client.delete(f"/api/ask/conversations/{cid}/turns/nota")
    assert dt.status_code == 404


def test_ask_turns_roundtrip_delete(client, tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "ask_roundtrip.duckdb"))
    from app.main import create_app
    from app.services import ask_store
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        cid = c.post("/api/ask/conversations", json={}).json()["conversation_id"]
        ws = c.app.state.workspace
        tid, _ = ask_store.append_turn(
            ws.connection,
            cid,
            "hi",
            sql="SELECT 1",
            explanation=None,
            answer="y",
            error=None,
            attempts=[],
            query_result=None,
            model="m",
            elapsed_ms=3,
        )
        tr = c.get(f"/api/ask/conversations/{cid}/turns")
        assert tr.status_code == 200
        assert len(tr.json()) == 1
        assert tr.json()[0]["turn_id"] == tid
        assert c.delete(f"/api/ask/conversations/{cid}/turns/{tid}").status_code == 204
        assert c.get(f"/api/ask/conversations/{cid}/turns").json() == []
