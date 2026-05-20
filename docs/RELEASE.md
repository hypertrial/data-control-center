# Release process

Data Control Center is a **local workstation app**. Releases are **git tags and GitHub
Releases** only—there is no PyPI or npm package publish step.

## Preconditions

- **[`CHANGELOG.md`](../CHANGELOG.md)** includes a dated version section (for example
  **`[1.0.0] - YYYY-MM-DD`**) and an empty **`[Unreleased]`** stub at the top.
- Versions match in [`backend/pyproject.toml`](../backend/pyproject.toml) and
  [`frontend/package.json`](../frontend/package.json).
- **`make check`** is green on the release commit (see
  [`CONTRIBUTING.md`](../CONTRIBUTING.md#validation)).
- Optional but recommended before tagging:

  ```bash
  cd frontend && npm audit --audit-level=moderate
  cd backend && uv run pip-audit
  ```

## Post-merge: tag and GitHub Release

From an up-to-date **`main`** checkout:

```bash
# Copy the [1.0.0] section from CHANGELOG.md into a notes file, then:
git tag -a v1.0.0 -m "Data Control Center 1.0.0"
git push origin v1.0.0
gh release create v1.0.0 --title "1.0.0" --notes-file /path/to/release-notes.md
```

Use the **Upgrade from 0.1.0** callout and breaking items from the changelog in the
release notes body.

## Out of scope

- Publishing backend or frontend packages to a registry.
- Hosting or multi-user deployment (see [`SECURITY.md`](../SECURITY.md)).

## Related docs

- User upgrade path: [README — Upgrading to 1.0.0](../README.md#upgrading-to-100)
- Contributor validation: [`CONTRIBUTING.md`](../CONTRIBUTING.md)
