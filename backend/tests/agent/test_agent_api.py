"""Agent HTTP route tests."""


def test_agent_ask_stream_http_endpoint(client, monkeypatch) -> None:
    def fake_stream(r, s, b):  # noqa: ANN001
        yield {"type": "answer", "data": {"answer": "ok"}}
        yield {"type": "done", "data": {}}

    monkeypatch.setattr("app.api.agent.run_agent_ask_stream", fake_stream)
    r = client.post("/api/agent/ask/stream", json={"question": "hello"})
    assert r.status_code == 200
    assert "data:" in r.text
    assert '"answer"' in r.text
