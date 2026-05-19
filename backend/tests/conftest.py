import sys
from pathlib import Path

import pytest


# Ensure repository root (backend/) is importable as cwd for app config paths
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture(autouse=True)
def _default_security_test_env(monkeypatch):
    monkeypatch.setenv("DCC_REQUIRE_LOCAL_API_TOKEN", "false")
    monkeypatch.setenv("DCC_ENABLE_PATH_REGISTRATION", "true")


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "test_workspace.duckdb"))
    monkeypatch.setenv("DCC_ALLOW_ARBITRARY_REGISTRATION_PATHS", "true")
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        yield c
