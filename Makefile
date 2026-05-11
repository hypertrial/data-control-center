# Data Control Center — run all commands from this directory (repo root):
#   cd /path/to/data-control-center
#   make install
#   make dev
#
# Requires: GNU Make, bash (for `make dev`), uv, Node/npm.

.DEFAULT_GOAL := help

.PHONY: help install dev backend frontend

help:
	@echo "Data Control Center (run from repo root)"
	@echo ""
	@echo "  make install   Install deps (backend: uv, frontend: npm)"
	@echo "  make dev       Run API + UI together (Ctrl+C stops both)"
	@echo "  make backend   Run FastAPI only (port 8000)"
	@echo "  make frontend  Run Vite only (port 5173, proxies /api)"

install:
	cd backend && uv sync --extra dev
	cd frontend && npm install

dev:
	bash -c '\
		(cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000) & pid1=$$!; \
		(cd frontend && npm run dev) & pid2=$$!; \
		trap "kill $$pid1 $$pid2 2>/dev/null" INT TERM; \
		wait'

backend:
	cd backend && uv run uvicorn app.main:app --reload --host 127.0.0.1 --port 8000

frontend:
	cd frontend && npm run dev
