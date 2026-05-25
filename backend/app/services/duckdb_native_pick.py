"""Native OS file picker for local DuckDB open (same machine as the backend)."""

from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

_MACOS_PICK_SCRIPT = 'POSIX path of (choose file with prompt "Select DuckDB database")'


def _tkinter_pick_available() -> bool:
    try:
        import tkinter as tk
    except ImportError:
        return False
    try:
        root = tk.Tk()
        root.withdraw()
        root.destroy()
        return True
    except Exception:
        return False


def native_pick_available() -> bool:
    """True when a blocking native picker can run in the API worker thread."""
    if sys.platform == "darwin":
        return shutil.which("osascript") is not None
    return _tkinter_pick_available()


def _pick_macos_duckdb_path() -> Path | None:
    proc = subprocess.run(
        ["osascript", "-e", _MACOS_PICK_SCRIPT],
        capture_output=True,
        text=True,
        timeout=3600,
        check=False,
    )
    if proc.returncode != 0:
        return None
    path = proc.stdout.strip()
    return Path(path) if path else None


def _pick_tkinter_duckdb_path() -> Path | None:
    import tkinter as tk
    from tkinter import filedialog

    root = tk.Tk()
    root.withdraw()
    try:
        root.attributes("-topmost", True)
    except tk.TclError:
        pass
    root.update_idletasks()
    selected = filedialog.askopenfilename(
        title="Select DuckDB database",
        filetypes=[("DuckDB database", "*.duckdb"), ("All files", "*.*")],
    )
    root.destroy()
    if not selected:
        return None
    return Path(selected)


def pick_local_duckdb_path() -> Path | None:
    """Blocking dialog; returns None when the user cancels."""
    if sys.platform == "darwin":
        return _pick_macos_duckdb_path()
    return _pick_tkinter_duckdb_path()
