# Music Conductor

Music Conductor is a local-first music file manager with a browser UI and backend service.

- Backend: FastAPI + Mutagen
- Frontend: React + TypeScript + Vite

## Project Structure

```
backend/
	app/
		main.py                 # FastAPI routes and app bootstrap
		models.py               # Pydantic request/response models
		config.py               # config loading and merge priority (CLI > ENV > file > defaults)
		scanner.py              # directory scan and metadata extraction
		metadata_service.py     # metadata read/update service
		operations.py           # operation preview and execute pipeline
		duplicates.py           # duplicate grouping and execution
		task_manager.py         # in-memory task state and SSE event stream
		library.py              # shared path/metadata helper utilities
	tests/
		test_task_manager.py
		test_duplicates.py
		test_operations.py
		test_metadata_service.py
	requirements.txt

frontend/
	src/
		App.tsx                 # main page and task-driven workflow
		types.ts                # shared API/domain type definitions
		utils/appHelpers.ts     # frontend helper functions
		components/             # reusable UI components
		test/                   # test setup and test utilities
	package.json

config/
	config.toml.example       # sample runtime config

docs/
	api.md                    # backend API source-of-truth reference

tests/                      # reserved for cross-layer integration/e2e tests
PROMPT.md                   # product requirements / design constraints
```

## Backend Module Ownership

- API routes and HTTP contract: `backend/app/main.py`
- Data models (single source for schema): `backend/app/models.py`
- File scan and metadata parse: `backend/app/scanner.py`
- Metadata read/write APIs: `backend/app/metadata_service.py`
- Batch operation planning/execution: `backend/app/operations.py`
- Duplicate strategy and `.mcignore` handling: `backend/app/duplicates.py`
- Long-running task orchestration and SSE: `backend/app/task_manager.py`

## Prerequisites

- Python 3.12+
- Node.js 20+

## Quick Start

### 1) Backend

```bash
cd backend
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m app.main --host 127.0.0.1 --port 8000
```

Useful env vars:

- `MC_CONFIG_FILE`: custom config file path
- `MC_MUSIC_DIR`: default music directory
- `MC_SERVER_HOST`, `MC_SERVER_PORT`
- `MC_SCAN_EXTENSIONS` (comma-separated, e.g. `mp3,flac,ogg`)

Config priority order:

1. CLI args
2. Environment variables
3. Config file
4. Built-in defaults

### 2) Frontend

```bash
cd frontend
npm install
npm run dev
```

Optional frontend env:

- `VITE_API_BASE` (default: `http://127.0.0.1:8000`)

### 3) Backend Tests

Run from repository root:

```bash
cd /path/to/music-conductor
PYTHONPATH=backend backend/.venv/bin/python -m unittest discover -s backend/tests -v
```

If you are already in `backend/`, use:

```bash
.venv/bin/python -m unittest discover -s tests -v
```

### 4) Frontend Tests

```bash
cd frontend
npm run test:run
```

## API Documentation

Source of truth:

- `docs/api.md`

Implemented endpoints (summary):

- `GET /api/health`
- `GET /api/config`
- `GET /api/media/preview`
- `POST /api/scan`
- `POST /api/metadata/read`
- `POST /api/metadata/update`
- `POST /api/operations/preview`
- `POST /api/operations/execute`
- `POST /api/duplicates/scan`
- `POST /api/duplicates/execute`
- `POST /api/tasks/scan/start`
- `POST /api/tasks/operations/start`
- `POST /api/tasks/duplicates/start`
- `GET /api/tasks/{task_id}`
- `GET /api/tasks/{task_id}/events`

Operation values currently supported:

- `swap_name_parts`
- `special_char_replace`
- `metadata_fill_from_filename`
- `rename_from_metadata`
- `metadata_cleanup_text`
- `metadata_cleanup_remove_fields`
- `metadata_cleanup` (legacy compatibility mode)

## Frontend Integration Notes

- For scan/operations/duplicates, prefer task endpoints (`/api/tasks/*/start`) plus status polling and SSE events.
- Keep synchronous endpoints as fallback for script use or quick debugging.
- Frontend type contracts should be aligned with:
  - `backend/app/models.py`
  - `frontend/src/types.ts`

## Smoke Test Notes

Validated with curl on macOS using `/tmp/music-conductor-demo`.

- scan endpoint works on first-level files only
- operation preview and execute work for swap rename + lrc linkage
- duplicate scan and execute work with keep/ignore decisions
- metadata read/update endpoints return expected success/failure payloads
- task start/status/events endpoints work and emit progress/completed events

## Next Steps

- Add browser-level Playwright E2E with real backend and fixture audio files
- Polish time slider labels into fully non-uniform visual spacing
