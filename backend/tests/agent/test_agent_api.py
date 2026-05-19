"""Agent tests."""

from __future__ import annotations



from app.models.api import AgentAskResponse

def test_agent_ask_http_endpoint(client, tmp_path, monkeypatch) -> None:
    def fake_run(r, s, b):  # noqa: ANN001
        return AgentAskResponse(model="m", answer="ok")

    monkeypatch.setattr("app.api.agent.run_agent_ask", fake_run)
    r = client.post("/api/agent/ask", json={"question": "hello"})
    assert r.status_code == 200
    assert r.json()["answer"] == "ok"

