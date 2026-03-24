# Music Conductor API Reference

Base URL (default): `http://127.0.0.1:8000`

## 1) General Conventions

- Request/response body: JSON (`Content-Type: application/json`), except file stream endpoint.
- Time fields: ISO-8601 string (UTC).
- `directory` is optional on some endpoints; when omitted, backend falls back to `default_music_dir`.
- Error format: HTTP 4xx/5xx with `{"detail": "..."}`.

## 2) Health / Runtime Config

### GET /api/health

Response:

```json
{
  "status": "ok"
}
```

### GET /api/config

Response fields:

- `host`
- `port`
- `default_music_dir`
- `music_extensions`
- `security_enabled`

Frontend behavior contract:

- Frontend should call this endpoint on startup.
- If `default_music_dir` is non-empty, initialize scan directory input with it.
- If `default_music_dir` is empty/null, frontend should wait for user input.

### GET /api/directories/suggest

Query params:

- `prefix`: user input path
- `limit`: optional, max candidates (default 50, max 200)

Response shape:

```json
{
  "input": "/Users/demo/M",
  "base_dir": "/Users/demo",
  "candidates": [
    "/Users/demo/Music/",
    "/Users/demo/Movies/"
  ],
  "truncated": false
}
```

Behavior:

- If `prefix` ends with `/`, backend returns direct child directories under that path.
- Otherwise backend returns sibling directories in parent folder whose names start with the last segment.
- Hidden directories and symlinks are excluded.
- When base directory is root (`/`), system directories are excluded by default (`/sys`, `/proc`, `/dev`, `/run`, `/tmp`, `/var`, `/cores`, `/private`, `/System`, `/Library`, `/Applications`).

## 3) Media Preview

### GET /api/media/preview

Query params:

- `directory`: optional, target folder
- `file_name`: required, audio file name in target folder

Behavior:

- Streams source file directly for browser `<audio>` preview.
- Restricted to configured audio extensions.
- Invalid directory/path/file returns HTTP 400.

## 4) Scan

### POST /api/scan

Request:

```json
{
  "directory": "/Users/you/Music"
}
```

Response shape:

```json
{
  "directory": "/Users/you/Music",
  "files": [
    {
      "id": "Artist - Title.mp3",
      "file_name": "Artist - Title.mp3",
      "absolute_path": "/Users/you/Music/Artist - Title.mp3",
      "extension": "mp3",
      "format": "MP3",
      "size_bytes": 1234567,
      "modified_at": "2026-03-16T08:00:00Z",
      "duration_seconds": 213.54,
      "metadata": {
        "title": "Title",
        "artist": "Artist",
        "album": "Album"
      }
    }
  ],
  "skipped": [
    {
      "file_name": "Broken.mp3",
      "reason": "Metadata read failed: ..."
    }
  ],
  "total_files": 1
}
```

Behavior:

- Only scans first-level files in target directory.
- Ignores subdirectories, hidden files, and symlinks.
- Filters by configured audio extensions.

## 5) Metadata

### POST /api/metadata/read

Request:

```json
{
  "directory": "/Users/you/Music",
  "file_name": "Artist - Title.mp3"
}
```

Response fields:

- `directory`
- `file_name`
- `full_metadata`: full parsed metadata payload
- `duration_seconds`
- `metadata_error`: parser error string when metadata parse is not fully successful

### POST /api/metadata/update

Request:

```json
{
  "directory": "/Users/you/Music",
  "file_name": "Artist - Title.mp3",
  "updates": {
    "title": "Title",
    "artist": "Artist"
  },
  "remove_fields": ["album"]
}
```

Response:

```json
{
  "directory": "/Users/you/Music",
  "file_name": "Artist - Title.mp3",
  "updated": true,
  "failed": []
}
```

## 6) Operations (Preview / Execute)

### POST /api/operations/preview

### POST /api/operations/execute

Shared request fields:

- `directory`: optional
- `operation`: required
- `selected_files`: optional list, empty/omitted means apply to all files

Supported `operation` values:

- `swap_name_parts`
- `special_char_replace`
- `fix_extension_by_format`
- `metadata_fill_from_filename`
- `rename_from_metadata`
- `metadata_cleanup_text`
- `metadata_cleanup_remove_fields`
- `metadata_cleanup` (legacy compatibility mode)

Operation-specific fields:

- `special_char_replace`: `special_char_map`
- `fix_extension_by_format`: no extra fields
- `metadata_fill_from_filename`: `fill_mode` (`artist_title` | `title_artist`)
- `rename_from_metadata`: `fill_mode` (`artist_title` | `title_artist`)
- `metadata_cleanup_text`: `cleanup_pattern`, `cleanup_use_regex`, `cleanup_case_sensitive`, `cleanup_fields`
- `metadata_cleanup_remove_fields`: `remove_fields`
- `metadata_cleanup` (legacy): can combine `cleanup_*` and `remove_fields`

Preview response highlights:

- `items`: full operation plan list
- `warnings`: non-fatal skips (for example missing metadata when renaming from metadata)
- `has_conflict` + `conflict_count`: conflict summary

Execute response highlights:

- `has_conflict=true` means execution is blocked and `failed` contains conflict reasons.
- `executed` contains successful plan items.
- `failed` contains execution failures.

## 7) Duplicates (Scan / Execute)

### POST /api/duplicates/scan

Request:

```json
{
  "directory": "/Users/you/Music"
}
```

Response fields:

- `groups`: duplicate groups by normalized `A - B` / `B - A` equivalence
- `groups[].files[]`: `file_name`, `extension`, `size_bytes`, `duration_seconds`, `has_lrc`
- `ignored_files`: loaded from `.mcignore`

### POST /api/duplicates/execute

Request:

```json
{
  "directory": "/Users/you/Music",
  "decisions": [
    {
      "group_key": "artist::title",
      "ignore_group": false,
      "keep_files": ["Artist - Title.mp3"]
    }
  ]
}
```

Behavior:

- `ignore_group=true`: append this group into `.mcignore`.
- `ignore_group=false`: delete non-kept files in the group.
- lrc linkage: kept file without lrc may adopt donor lrc from deleted siblings.

Execute response fields:

- `deleted_files`
- `lrc_renamed`
- `lrc_deleted`
- `ignored_written`
- `failed`

## 8) Task APIs (Recommended for Frontend)

Task start endpoints:

- `POST /api/tasks/scan/start` (body = scan request)
- `POST /api/tasks/operations/start` (body = operations request)
- `POST /api/tasks/duplicates/start` (body = duplicates execute request)

Start response:

```json
{
  "task_id": "a1b2c3...",
  "task_type": "scan"
}
```

### GET /api/tasks/{task_id}

Response fields:

- `task_id`
- `task_type`
- `state`: `running` | `completed` | `failed`
- `progress_percent`
- `current_subtask`
- `started_at`
- `finished_at`
- `failed`: accumulated subtask failures
- `result`: final business response payload when completed

### GET /api/tasks/{task_id}/events (SSE)

Event types:

- `status`: initial status event
- `progress`: progress updates
- `failure`: non-fatal subtask failure record
- `completed`: task completed with `result`
- `failed`: task-level failure

Example event chunk:

```text
id: 3
event: progress
data: {"event_id":3,"task_id":"...","state":"running","progress_percent":50.0,"current_subtask":"扫描文件: A - B.mp3","failed_count":0}

```

## 9) Frontend Integration Recipe

Recommended flow for long-running actions:

1. Call task start endpoint.
2. Open blocking progress UI immediately.
3. Subscribe SSE (`/events`) for near-real-time progress and failure list.
4. Poll status (`/api/tasks/{task_id}`) every 200-500ms as source of truth.
5. On `completed` or `failed`, use status result to refresh UI state.

Direct synchronous endpoints (`/api/scan`, `/api/operations/execute`, `/api/duplicates/execute`) are still available for scripts or simple clients.

## 10) Error Semantics

- Invalid parameters/path/file: HTTP 400 with `detail`.
- Unknown task id: HTTP 404 with `detail: "Task not found"`.
- Batch/task failures are primarily returned in `failed` arrays, not always as hard HTTP failure.

## 11) Static Frontend Hosting

- Backend can serve frontend static files directly when `frontend/dist` exists.
- `/api/*` routes remain backend API endpoints.
- Non-API static requests are served from frontend build output.
