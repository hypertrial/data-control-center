# Changelog

All notable changes to this project will be documented in this file.

The format is based on Keep a Changelog, and this project adheres to semantic
versioning once formal releases begin.

## [Unreleased]

### Added

- Frontend API type conformance tests (`types.test.ts` + `src/api/__fixtures__/`).
- Versioned workspace schema migrations with implicit baseline stamping and pre-migration backups (`DCC_WORKSPACE_BACKUP_BEFORE_MIGRATE`).
- `make check-ci` for clean-room CI-parity validation (`npm ci` then `make check`).

### Changed

- Frontend coverage baseline raised to 88%; `types.ts` included in coverage.

## [0.1.0] - 2026-05-19

### Added

- MIT license and open-source governance files.
- Contributor, security, issue, and pull request guidance.
- Safe example datasets and a five-minute tour.
- Security and dependency automation for OSS release readiness.
- `GET /api/health` **`llm`** field probing the configured Ollama-compatible endpoint (`/api/tags`).
- Ask tab banner when the local LLM is unreachable, linking to README setup.
- **`DCC_UI_DIST_PATH`**: optional serving of the built Vite UI from FastAPI with SPA fallback; **`make serve`** and **`make build-ui`**.
- **`make check`** for CI-parity validation (backend ruff + pytest, frontend lint + test + coverage + build).
- CI frontend job runs **`npm run build`**.
- README quick start, platform notes, upgrading guidance, OpenAPI link, and UI wireframe screenshots under `docs/images/`.

### Changed

- Documentation map and contributor workflow reference **`make check`** and single-server mode.
