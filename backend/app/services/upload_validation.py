"""Preflight validation for uploaded dataset files."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import duckdb

from app.config import Settings

SAMPLE_BYTES = 64 * 1024
JSONL_SAMPLE_LINES = 100


class UploadValidationError(ValueError):
    """Raised with a sanitized reason when an uploaded file is not usable data."""


def _sample_bytes(path: Path, size: int = SAMPLE_BYTES) -> bytes:
    with path.open("rb") as f:
        return f.read(size)


def _decode_text_sample(path: Path) -> str:
    raw = _sample_bytes(path)
    if b"\x00" in raw:
        raise UploadValidationError("File appears to be binary, not text data.")
    try:
        return raw.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise UploadValidationError("Text data must be valid UTF-8.") from exc


def _probe_duckdb(sql: str, timeout_seconds: float) -> None:
    con = duckdb.connect(":memory:")
    try:
        try:
            con.execute(f"SET statement_timeout='{max(100, int(timeout_seconds * 1000))}ms'")
        except Exception as exc:  # noqa: BLE001
            if "unrecognized configuration parameter" not in str(exc):
                raise
        con.execute(sql).fetchone()
    finally:
        con.close()


def _escaped(path: Path) -> str:
    return str(path.resolve()).replace("'", "''")


def _validate_parquet(path: Path, settings: Settings) -> None:
    size = path.stat().st_size
    if size < 8:
        raise UploadValidationError("Parquet file is too small.")
    with path.open("rb") as f:
        head = f.read(4)
        f.seek(-4, 2)
        tail = f.read(4)
    if head != b"PAR1" or tail != b"PAR1":
        raise UploadValidationError("Parquet file is missing the expected PAR1 markers.")
    _probe_duckdb(
        f"SELECT * FROM read_parquet('{_escaped(path)}') LIMIT 1",
        settings.registration_count_timeout_seconds,
    )


def _validate_csv(path: Path, settings: Settings, *, tsv: bool) -> None:
    text = _decode_text_sample(path)
    if not text.strip():
        raise UploadValidationError("Text data is empty.")
    delim = ","
    if tsv:
        delim = "\\t"
        sql = f"SELECT * FROM read_csv_auto('{_escaped(path)}', delim='{delim}') LIMIT 1"
    else:
        sql = f"SELECT * FROM read_csv_auto('{_escaped(path)}') LIMIT 1"
    _probe_duckdb(sql, settings.registration_count_timeout_seconds)


def _validate_json(path: Path, settings: Settings) -> None:
    text = _decode_text_sample(path).lstrip()
    if not text:
        raise UploadValidationError("JSON data is empty.")
    if text[0] not in "[{":
        raise UploadValidationError("JSON data must start with an object or array.")
    _probe_duckdb(
        f"SELECT * FROM read_json_auto('{_escaped(path)}') LIMIT 1",
        settings.registration_count_timeout_seconds,
    )


def _validate_jsonl(path: Path, settings: Settings) -> None:
    _decode_text_sample(path)
    seen = 0
    with path.open("r", encoding="utf-8-sig") as f:
        for line in f:
            s = line.strip()
            if not s:
                continue
            try:
                obj: Any = json.loads(s)
            except json.JSONDecodeError as exc:
                raise UploadValidationError("JSON Lines data contains an invalid JSON line.") from exc
            if not isinstance(obj, dict):
                raise UploadValidationError("JSON Lines records must be JSON objects.")
            seen += 1
            if seen >= JSONL_SAMPLE_LINES:
                break
    if seen == 0:
        raise UploadValidationError("JSON Lines data is empty.")
    _probe_duckdb(
        f"SELECT * FROM read_json_auto('{_escaped(path)}') LIMIT 1",
        settings.registration_count_timeout_seconds,
    )


def validate_upload_file(path: Path, settings: Settings) -> None:
    if not settings.upload_validate_parse:
        return
    ext = path.suffix.lower()
    try:
        if ext == ".parquet":
            _validate_parquet(path, settings)
        elif ext == ".csv":
            _validate_csv(path, settings, tsv=False)
        elif ext == ".tsv":
            _validate_csv(path, settings, tsv=True)
        elif ext == ".json":
            _validate_json(path, settings)
        elif ext in {".jsonl", ".ndjson"}:
            _validate_jsonl(path, settings)
        else:
            raise UploadValidationError("Unsupported file type.")
    except UploadValidationError:
        raise
    except Exception as exc:  # noqa: BLE001
        raise UploadValidationError("File could not be parsed as a supported dataset.") from exc
