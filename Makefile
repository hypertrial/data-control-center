# Data Control Center — run all commands from this directory (repo root):
#   cd /path/to/data-control-center
#   make install
#   make dev
#
# Requires: GNU Make, bash (for `make dev`), uv, Node/npm.

.DEFAULT_GOAL := help

.PHONY: help install dev backend frontend clean-local check check-ci build-ui serve

help:
	@echo "Data Control Center (run from repo root)"
	@echo ""
	@echo "  make install   Install deps (backend: uv, frontend: npm)"
	@echo "  make dev       Run API + UI together (Ctrl+C stops both)"
	@echo "  make backend   Run FastAPI only (port 8000)"
	@echo "  make frontend  Run Vite only (port 5173, proxies /api)"
	@echo "  make build-ui  Build frontend to frontend/dist"
	@echo "  make serve     Build UI then run API on :8000 serving that dist"
	@echo "  make check     Lint and test backend + frontend (parity with CI)"
	@echo "  make check-ci  Same as check but runs 'npm ci' in frontend first"
	@echo "  make clean-local"
	@echo "                  Delete local app state and generated artifacts"

install:
	cd backend && uv sync --extra dev
	cd frontend && npm install

# Ensures Vite exists so `npm run dev` can resolve it (avoids "vite: command not found"
# after a fresh clone or if frontend deps were never installed).
frontend/node_modules/.bin/vite:
	@echo "Installing frontend dependencies (npm install)..."
	cd frontend && npm install

# `--reload-dir app` keeps uvicorn from restarting on test-file edits, which
# would otherwise interrupt in-flight `/api/...` requests and surface as
# `socket hang up` errors in the Vite proxy log.
dev: frontend/node_modules/.bin/vite
	bash -c '\
		(cd backend && uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000) & pid1=$$!; \
		(cd frontend && npm run dev) & pid2=$$!; \
		trap "kill $$pid1 $$pid2 2>/dev/null" INT TERM; \
		wait'

backend:
	cd backend && uv run uvicorn app.main:app --reload --reload-dir app --host 127.0.0.1 --port 8000

frontend: frontend/node_modules/.bin/vite
	cd frontend && npm run dev

build-ui: frontend/node_modules/.bin/vite
	cd frontend && npm run build

serve: build-ui
	cd backend && DCC_UI_DIST_PATH=../frontend/dist uv run uvicorn app.main:app --host 127.0.0.1 --port 8000

check:
	cd backend && uv run ruff check app tests
	cd backend && uv run pytest
	cd frontend && npm run lint
	cd frontend && npm test
	cd frontend && npm run test:coverage
	cd frontend && npm run build

check-ci:
	cd frontend && npm ci
	$(MAKE) check

clean-local:
	@echo "Deleting local app state and generated artifacts..."
	rm -rf .coverage .dcc_uploads .pytest_cache
	rm -f .dcc_workspace.duckdb .dcc_workspace.duckdb.wal .dcc_workspace.duckdb.tmp .dcc_workspace.duckdb.corrupt* .dcc_workspace.duckdb.wal.corrupt*
	rm -rf backend/.coverage backend/.pytest_cache backend/.ruff_cache backend/htmlcov
	rm -f backend/.dcc_workspace.duckdb backend/.dcc_workspace.duckdb.wal backend/.dcc_workspace.duckdb.tmp backend/.dcc_workspace.duckdb.corrupt* backend/.dcc_workspace.duckdb.wal.corrupt*
	rm -rf frontend/coverage frontend/dist
	find . -type d -name __pycache__ -prune -exec rm -rf {} +
