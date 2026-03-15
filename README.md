# Music Conductor

Music Conductor is a local-first music file manager with a browser UI and backend service.

Current status: backend core flow and frontend task-driven workflow are implemented (scan, operations, duplicates, metadata API, task progress API, metadata editor UI).

- Backend: FastAPI + Mutagen
- Frontend: React + TypeScript + Vite

## Repository Layout

```
backend/               # FastAPI service
	app/
		main.py            # API entrypoint
		config.py          # config loading and priority merge
		scanner.py         # folder scan and metadata read
		models.py          # request/response models
frontend/              # React app
config/
	config.toml.example  # sample runtime config
docs/
tests/
PROMPT.md              # PRD
```

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

## Implemented APIs

Detailed API reference:

- `docs/api.md`

- `GET /api/health`
- `GET /api/config`
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

`/api/scan` request body:

```json
{
	"directory": "/Users/you/Music"
}
```

Behavior:

- Scan first-level files only
- Ignore subdirectories, hidden files, symlinks
- Filter by configured audio extensions
- Return basic metadata (`title`, `artist`, `album`) and duration when available

### Operation Preview / Execute

`/api/operations/preview` and `/api/operations/execute` share the same request shape.

Core fields:

- `directory`: target folder
- `operation`: one of
	- `swap_name_parts`
	- `special_char_replace`
	- `metadata_fill_from_filename`
	- `metadata_cleanup`
- `selected_files`: optional list of file names; if omitted, applies to all scanned files

Optional fields:

- For fill: `fill_mode` = `artist_title` | `title_artist`
- For cleanup:
	- `cleanup_pattern`
	- `cleanup_use_regex`
	- `cleanup_fields`
	- `remove_fields`

Preview returns full change list and conflict states.
Execute will block when conflicts exist and return failed items.

### Metadata Read / Update

`/api/metadata/read` request:

```json
{
	"directory": "/Users/you/Music",
	"file_name": "Artist A - Song B.mp3"
}
```

`/api/metadata/update` request:

```json
{
	"directory": "/Users/you/Music",
	"file_name": "Artist A - Song B.mp3",
	"updates": {
		"title": "Song B",
		"artist": "Artist A"
	},
	"remove_fields": ["album"]
}
```

Read returns full metadata map + technical info when available.
Update uses easy tags and returns failed items when write is unsupported.

### Duplicate Scan / Execute

`/api/duplicates/scan` request:

```json
{
	"directory": "/Users/you/Music"
}
```

It returns duplicate groups by `A - B` and `B - A` equivalence and applies `.mcignore` filtering.

`/api/duplicates/execute` request:

```json
{
	"directory": "/Users/you/Music",
	"decisions": [
		{
			"group_key": "artist a::song b",
			"ignore_group": false,
			"keep_files": ["Artist A - Song B.mp3"]
		}
	]
}
```

Execute behavior:

- ignore group -> append all names in that group into `.mcignore`
- keep + delete -> delete unkept music files
- lrc handling -> keep file missing lrc will try to adopt from deleted siblings
- no restore mechanism

### Task Progress APIs (Long-running jobs)

Task start endpoints return `task_id` immediately, then client can poll status or subscribe to SSE:

- Status: `GET /api/tasks/{task_id}`
- Events (SSE): `GET /api/tasks/{task_id}/events`

Event types:

- `status`
- `progress`
- `failure`
- `completed`
- `failed`

This supports real-time progress and failed-subtask reporting during execution.

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
