from __future__ import annotations

import argparse
import mimetypes
import os
import re
from pathlib import Path
from typing import Any

import uvicorn
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles
from starlette.types import Scope

from .config import AppConfig, load_app_config
from .duplicates import execute_duplicates, scan_duplicates
from .library import resolve_directory, resolve_file_in_directory
from .metadata_service import read_metadata, update_metadata
from .models import (
    DirectorySuggestResponse,
    DuplicateExecuteRequest,
    DuplicateExecuteResponse,
    DuplicateScanRequest,
    DuplicateScanResponse,
    MetadataReadRequest,
    MetadataReadResponse,
    MetadataUpdateRequest,
    MetadataUpdateResponse,
    OperationExecuteResponse,
    OperationPreviewRequest,
    OperationPreviewResponse,
    ScanRequest,
    ScanResponse,
    TaskCreateResponse,
    TaskStatusResponse,
)
from .operations import build_operation_preview, execute_operation
from .scanner import scan_music_directory
from .task_manager import TASK_MANAGER, TaskReporter


HTML_STATIC_CACHE_CONTROL = "public, max-age=300"
ASSET_STATIC_CACHE_CONTROL = "public, max-age=31536000, immutable"


def _cache_control_for_static_path(path: str) -> str:
    return HTML_STATIC_CACHE_CONTROL if path.lower().endswith(".html") else ASSET_STATIC_CACHE_CONTROL


class CachedStaticFiles(StaticFiles):
    def file_response(
        self,
        full_path: str | os.PathLike[str],
        stat_result: os.stat_result,
        scope: Scope,
        status_code: int = 200,
    ) -> FileResponse:
        response = super().file_response(full_path, stat_result, scope, status_code)
        response.headers["Cache-Control"] = _cache_control_for_static_path(str(full_path))
        return response


def _resolve_frontend_dist(frontend_dist: Path | None = None) -> Path:
    if frontend_dist is not None:
        return frontend_dist
    return Path(__file__).resolve().parents[2] / "frontend" / "dist"


def create_app(config: AppConfig | None = None, frontend_dist: Path | None = None) -> FastAPI:
    app = FastAPI(title="Music Conductor API", version="0.1.0")

    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.state.config = config or load_app_config()
    app.state.task_manager = TASK_MANAGER

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    @app.get("/api/config")
    def read_config(request: Request) -> dict[str, Any]:
        current = request.app.state.config
        return {
            "host": current.host,
            "port": current.port,
            "default_music_dir": current.default_music_dir,
            "music_extensions": current.music_extensions,
            "security_enabled": current.security_enabled,
        }

    @app.get("/api/directories/suggest", response_model=DirectorySuggestResponse)
    def suggest_scan_directories(prefix: str = "", limit: int = 50) -> DirectorySuggestResponse:
        from .library import suggest_directories

        raw_input, base_dir, candidates, truncated = suggest_directories(prefix, limit=limit)
        return DirectorySuggestResponse(
            input=raw_input,
            base_dir=base_dir,
            candidates=candidates,
            truncated=truncated,
        )

    @app.get("/api/media/preview")
    def preview_media(
        request: Request,
        directory: str | None = None,
        file_name: str = "",
    ) -> FileResponse:
        current: AppConfig = request.app.state.config
        try:
            target_directory = resolve_directory(directory or current.default_music_dir)
            target_file = resolve_file_in_directory(
                target_directory,
                file_name,
                set(current.music_extensions),
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

        media_type, _ = mimetypes.guess_type(target_file.name)
        return FileResponse(
            path=target_file,
            media_type=media_type or "application/octet-stream",
            filename=target_file.name,
        )

    @app.post("/api/scan", response_model=ScanResponse)
    def scan_music(request: Request, payload: ScanRequest) -> ScanResponse:
        current: AppConfig = request.app.state.config
        directory_value = payload.directory or current.default_music_dir

        if not directory_value:
            raise HTTPException(
                status_code=400,
                detail="No directory provided. Send directory in request or set MC_MUSIC_DIR.",
            )

        directory = Path(directory_value).expanduser()
        if not directory.exists() or not directory.is_dir():
            raise HTTPException(status_code=400, detail="Directory does not exist or is not a folder.")

        try:
            records, skipped = scan_music_directory(directory, set(current.music_extensions))
        except PermissionError as exc:
            raise HTTPException(status_code=403, detail=f"Permission denied: {exc}") from exc

        return ScanResponse(
            directory=str(directory.resolve()),
            files=records,
            skipped=skipped,
            total_files=len(records),
        )

    @app.post("/api/metadata/read", response_model=MetadataReadResponse)
    def read_full_metadata(request: Request, payload: MetadataReadRequest) -> MetadataReadResponse:
        current: AppConfig = request.app.state.config
        try:
            return read_metadata(payload, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/metadata/update", response_model=MetadataUpdateResponse)
    def update_full_metadata(request: Request, payload: MetadataUpdateRequest) -> MetadataUpdateResponse:
        current: AppConfig = request.app.state.config
        try:
            return update_metadata(payload, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/operations/preview", response_model=OperationPreviewResponse)
    def preview_operations(request: Request, payload: OperationPreviewRequest) -> OperationPreviewResponse:
        current: AppConfig = request.app.state.config
        try:
            return build_operation_preview(payload, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except re.error as exc:  # type: ignore[name-defined]
            raise HTTPException(status_code=400, detail=f"Invalid regex: {exc}") from exc

    @app.post("/api/operations/execute", response_model=OperationExecuteResponse)
    def execute_operations(request: Request, payload: OperationPreviewRequest) -> OperationExecuteResponse:
        current: AppConfig = request.app.state.config
        try:
            return execute_operation(payload, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        except re.error as exc:  # type: ignore[name-defined]
            raise HTTPException(status_code=400, detail=f"Invalid regex: {exc}") from exc

    @app.post("/api/duplicates/scan", response_model=DuplicateScanResponse)
    def scan_duplicate_groups(request: Request, payload: DuplicateScanRequest) -> DuplicateScanResponse:
        current: AppConfig = request.app.state.config
        try:
            return scan_duplicates(payload.directory, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/duplicates/execute", response_model=DuplicateExecuteResponse)
    def execute_duplicate_groups(
        request: Request,
        payload: DuplicateExecuteRequest,
    ) -> DuplicateExecuteResponse:
        current: AppConfig = request.app.state.config
        try:
            return execute_duplicates(payload, current)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/tasks/scan/start", response_model=TaskCreateResponse)
    def start_scan_task(request: Request, payload: ScanRequest) -> TaskCreateResponse:
        current: AppConfig = request.app.state.config
        manager = request.app.state.task_manager

        def worker(reporter: TaskReporter) -> dict[str, Any]:
            directory = resolve_directory(payload.directory or current.default_music_dir)
            reporter.progress(0.0, "准备扫描目录")
            records, skipped = scan_music_directory(
                directory,
                set(current.music_extensions),
                progress_callback=reporter.step,
                failure_callback=reporter.fail,
            )

            response = ScanResponse(
                directory=str(directory.resolve()),
                files=records,
                skipped=skipped,
                total_files=len(records),
            )
            return response.model_dump(mode="json")

        try:
            return manager.start_task("scan", worker)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc

    @app.post("/api/tasks/operations/start", response_model=TaskCreateResponse)
    def start_operation_task(request: Request, payload: OperationPreviewRequest) -> TaskCreateResponse:
        current: AppConfig = request.app.state.config
        manager = request.app.state.task_manager

        def worker(reporter: TaskReporter) -> dict[str, Any]:
            reporter.progress(0.0, "准备批量操作")
            result = execute_operation(
                payload,
                current,
                progress_callback=reporter.step,
                failure_callback=reporter.fail,
            )
            if result.has_conflict:
                reporter.progress(100.0, "检测到冲突，未执行")
            return result.model_dump(mode="json")

        return manager.start_task("operation_execute", worker)

    @app.post("/api/tasks/duplicates/start", response_model=TaskCreateResponse)
    def start_duplicate_task(request: Request, payload: DuplicateExecuteRequest) -> TaskCreateResponse:
        current: AppConfig = request.app.state.config
        manager = request.app.state.task_manager

        def worker(reporter: TaskReporter) -> dict[str, Any]:
            reporter.progress(0.0, "准备执行去重")
            result = execute_duplicates(
                payload,
                current,
                progress_callback=reporter.step,
                failure_callback=reporter.fail,
            )
            return result.model_dump(mode="json")

        return manager.start_task("duplicates_execute", worker)

    @app.get("/api/tasks/{task_id}", response_model=TaskStatusResponse)
    def get_task_status(request: Request, task_id: str) -> TaskStatusResponse:
        manager = request.app.state.task_manager
        try:
            return manager.get_status(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Task not found") from exc

    @app.get("/api/tasks/{task_id}/events")
    def stream_task_events(request: Request, task_id: str) -> StreamingResponse:
        manager = request.app.state.task_manager

        try:
            manager.get_status(task_id)
        except KeyError as exc:
            raise HTTPException(status_code=404, detail="Task not found") from exc

        last_event_id_raw = request.headers.get("last-event-id", "0").strip() or "0"
        try:
            last_event_id = int(last_event_id_raw)
        except ValueError:
            last_event_id = 0

        return StreamingResponse(
            manager.sse_stream(task_id, last_event_id),
            media_type="text/event-stream",
            headers={
                "Cache-Control": "no-cache",
                "Connection": "keep-alive",
                "X-Accel-Buffering": "no",
            },
        )

    frontend_dist_dir = _resolve_frontend_dist(frontend_dist)
    if frontend_dist_dir.exists() and frontend_dist_dir.is_dir():
        # API routes keep precedence because they are registered before this mount.
        app.mount("/", CachedStaticFiles(directory=str(frontend_dist_dir), html=True), name="frontend")

    return app


app = create_app()


def _build_cli() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Music Conductor backend service")
    parser.add_argument("--host", dest="host", default=None)
    parser.add_argument("--port", dest="port", type=int, default=None)
    parser.add_argument("--music-dir", dest="default_music_dir", default=None)
    parser.add_argument("--config", dest="config_file", default=None)
    return parser


def main() -> None:
    args = vars(_build_cli().parse_args())
    config = load_app_config(args)
    uvicorn.run(create_app(config), host=config.host, port=config.port)


if __name__ == "__main__":
    main()
