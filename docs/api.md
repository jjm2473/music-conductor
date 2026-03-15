# Music Conductor API Reference

Base URL (default): `http://127.0.0.1:8000`

## 1) Health / Config

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

## 2) Scan

### POST /api/scan

Request:

```json
{
  "directory": "/Users/you/Music"
}
```

Behavior:

- First-level files only
- Ignore hidden files, symlinks, and subdirectories
- Only configured audio extensions are included

## 3) Metadata

### POST /api/metadata/read

Request:

```json
{
  "directory": "/Users/you/Music",
  "file_name": "Artist - Title.mp3"
}
```

Response:

- `full_metadata`: full tag map and optional technical block
- `duration_seconds`
- `metadata_error`: parser error if metadata cannot be read

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

- `updated`: true or false
- `failed`: per-file write failures

## 3.5) Media Preview

### GET /api/media/preview

Query:

- `directory`: target directory (optional if server has default directory)
- `file_name`: audio file name in that directory

Behavior:

- Returns raw audio file stream for browser playback (`<audio controls>`)
- Only allows configured music extensions
- Invalid path or file returns HTTP 400

## 4) Operation Preview / Execute

### POST /api/operations/preview

### POST /api/operations/execute

Shared request body:

```json
{
  "directory": "/Users/you/Music",
  "operation": "swap_name_parts",
  "selected_files": ["Artist - Title.mp3"]
}
```

`operation` values:

- `swap_name_parts`
- `special_char_replace`
- `metadata_fill_from_filename`
- `rename_from_metadata`
- `metadata_cleanup`

Extra fields by operation:

- Fill from filename: `fill_mode` = `artist_title` | `title_artist`
- Rename from metadata: `fill_mode` = `artist_title` | `title_artist`
- Cleanup: `cleanup_pattern`, `cleanup_use_regex`, `cleanup_fields`, `remove_fields`

Preview response notes:

- `warnings`: files skipped from the rename list (for example, missing artist/title metadata or metadata read failure)

## 5) Duplicate Scan / Execute

### POST /api/duplicates/scan

Request:

```json
{
  "directory": "/Users/you/Music"
}
```

Response:

- `groups`: duplicate groups by `A - B` and `B - A` equivalence
- each `groups[].files[]` item includes `file_name`, `extension`, `size_bytes`, `duration_seconds`, `has_lrc`
- `ignored_files`: currently effective `.mcignore` names

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

- `ignore_group=true`: appends the whole group to `.mcignore`
- keep/delete mode: deletes non-kept files
- lrc linkage: donor lrc can be adopted by kept files

## 6) Task APIs (Recommended for UI)

Task start endpoints:

- `POST /api/tasks/scan/start`
- `POST /api/tasks/operations/start`
- `POST /api/tasks/duplicates/start`

Task start response:

```json
{
  "task_id": "a1b2c3...",
  "task_type": "scan"
}
```

### GET /api/tasks/{task_id}

Response:

- `state`: `running` | `completed` | `failed`
- `progress_percent`
- `current_subtask`
- `failed`: accumulated failed subtasks
- `result`: final endpoint result when completed

### GET /api/tasks/{task_id}/events

SSE event types:

- `status`
- `progress`
- `failure`
- `completed`
- `failed`

Example SSE chunk:

```text
id: 3
event: progress
data: {"event_id":3,"state":"running","progress_percent":50.0,"current_subtask":"扫描文件: A - B.mp3","failed_count":0}

```

## 7) Error Semantics

- Bad request parameters: HTTP 400 with `detail`
- Missing task id: HTTP 404 with `detail: "Task not found"`
- Task-level failures are also reported in `failed` arrays instead of hard-failing the whole batch
