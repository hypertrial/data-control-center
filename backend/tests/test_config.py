"""Default application settings."""

import pytest

from app.config import Settings

_TWO_GIB = 2 * 1024 * 1024 * 1024


def test_default_profile_large_file_settings(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = Settings()
    assert settings.profile_heavy_scan_max_bytes == 256 * 1024 * 1024
    assert settings.profile_use_parquet_metadata_count is True
    assert settings.profile_large_file_timeout_seconds == 120.0


def test_default_upload_limits_are_two_gib(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DCC_UPLOAD_MAX_BYTES_PER_FILE", raising=False)
    monkeypatch.delenv("DCC_UPLOAD_MAX_BATCH_BYTES", raising=False)
    settings = Settings()
    assert settings.upload_max_bytes_per_file == _TWO_GIB
    assert settings.upload_max_batch_bytes == _TWO_GIB


def test_default_duckdb_view_import_enabled(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("DCC_ENABLE_DUCKDB_VIEW_IMPORT", raising=False)
    settings = Settings()
    assert settings.enable_duckdb_view_import is True
    assert settings.enable_duckdb_local_open is True
    assert settings.enable_duckdb_native_pick is True
