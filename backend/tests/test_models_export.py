"""Re-export surface for app.models package."""

from __future__ import annotations

import app.models as models


def test_models_all_exported() -> None:
    for name in models.__all__:
        assert hasattr(models, name)
