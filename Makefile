# Shortcuts for macOS/Linux/CI. On Windows, the README lists the same commands.
PY := backend/env/bin/python

.PHONY: install dev-api dev-web check test lint snapshot up down loadtest

install:            ## set up both apps
	cd backend && python3 -m venv env && env/bin/pip install -r requirements-dev.txt
	cd frontend && npm ci

dev-api:            ## FastAPI with auto-reload on :8000
	cd backend && env/bin/uvicorn app.main:app --reload --port 8000

dev-web:            ## Next.js dev server on :3000 (proxies /api to :8000)
	cd frontend && npm run dev

lint:
	cd backend && env/bin/ruff check . && env/bin/ruff format --check . && env/bin/mypy app main.py
	cd frontend && npm run lint && npm run typecheck

test:
	cd backend && env/bin/pytest --cov
	cd frontend && npm test

check: lint test    ## everything CI runs

snapshot:           ## re-fetch January 2026 from Elexon into backend/data/snapshot.json.gz
	cd backend && env/bin/python -m app.cli ingest

up:                 ## whole stack in Docker
	docker compose up --build

down:
	docker compose down

loadtest:           ## needs the API running on :8000
	cd backend && env/bin/python scripts/loadtest.py --seconds 15 --concurrency 64
