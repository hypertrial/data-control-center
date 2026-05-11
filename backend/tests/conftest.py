import sys
from pathlib import Path

import pytest


# Ensure repository root (backend/) is importable as cwd for app config paths
ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


@pytest.fixture()
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("DCC_WORKSPACE_DB_PATH", str(tmp_path / "test_workspace.duckdb"))
    from app.main import create_app
    from fastapi.testclient import TestClient

    with TestClient(create_app()) as c:
        yield c
