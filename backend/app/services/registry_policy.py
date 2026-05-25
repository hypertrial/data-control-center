"""Filesystem registration policy helpers."""

from __future__ import annotations

from pathlib import Path

from app.config import Settings
from app.errors import AppError, CODES


class RegistrationPathPolicy:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings

    def upload_root(self) -> Path:
        upload_dir = self._settings.upload_dir
        if not upload_dir.is_absolute():
            upload_dir = Path.cwd() / upload_dir
        return upload_dir.resolve()

    def allowed_roots(self, implicit_roots: list[Path]) -> list[Path]:
        roots = [root.resolve() for root in implicit_roots]
        for root in self._settings.registration_allowed_roots:
            p = root if root.is_absolute() else Path.cwd() / root
            roots.append(p.resolve())
        roots.append(self.upload_root())
        return roots

    def is_app_owned_upload(self, path: Path) -> bool:
        try:
            path.expanduser().resolve().relative_to(self.upload_root())
            return True
        except ValueError:
            return False

    def ensure_registration_allowed(self, path: Path, implicit_roots: list[Path]) -> None:
        if self._settings.allow_arbitrary_registration_paths:
            return
        candidate = path.expanduser().resolve()
        for root in self.allowed_roots(implicit_roots):
            try:
                candidate.relative_to(root)
                return
            except ValueError:
                continue
        raise AppError(
            status_code=403,
            code=CODES.PATH_NOT_ALLOWED,
            message="Path is outside allowed registration roots.",
            details={"path": candidate.name},
        )
