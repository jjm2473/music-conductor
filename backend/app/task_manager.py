from __future__ import annotations

import json
import threading
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Callable
from uuid import uuid4

from .models import ScanErrorItem, TaskCreateResponse, TaskStatusResponse


@dataclass
class TaskEvent:
    event_id: int
    event_type: str
    payload: dict[str, Any]


@dataclass
class TaskRecord:
    task_id: str
    task_type: str
    state: str = "running"
    progress_percent: float = 0.0
    current_subtask: str | None = None
    started_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))
    finished_at: datetime | None = None
    failed: list[ScanErrorItem] = field(default_factory=list)
    result: dict[str, Any] | None = None
    events: list[TaskEvent] = field(default_factory=list)
    next_event_id: int = 1


class TaskReporter:
    def __init__(self, manager: "TaskManager", task_id: str):
        self._manager = manager
        self._task_id = task_id

    def progress(self, percent: float, current_subtask: str | None = None) -> None:
        self._manager.update_progress(self._task_id, percent, current_subtask)

    def step(self, current: int, total: int, current_subtask: str | None = None) -> None:
        bounded_total = max(total, 1)
        bounded_current = max(0, min(current, bounded_total))
        percent = round((bounded_current / bounded_total) * 100, 2)
        self.progress(percent, current_subtask)

    def fail(self, failure: ScanErrorItem) -> None:
        self._manager.append_failure(self._task_id, failure)


class TaskManager:
    def __init__(self) -> None:
        self._tasks: dict[str, TaskRecord] = {}
        self._lock = threading.Lock()
        self._condition = threading.Condition(self._lock)

    def _push_event(self, task: TaskRecord, event_type: str, payload: dict[str, Any]) -> None:
        event = TaskEvent(event_id=task.next_event_id, event_type=event_type, payload=payload)
        task.next_event_id += 1
        task.events.append(event)

    def start_task(
        self,
        task_type: str,
        worker: Callable[[TaskReporter], dict[str, Any]],
    ) -> TaskCreateResponse:
        task_id = uuid4().hex

        with self._condition:
            task = TaskRecord(task_id=task_id, task_type=task_type)
            self._tasks[task_id] = task
            self._push_event(
                task,
                "status",
                {
                    "task_id": task.task_id,
                    "task_type": task.task_type,
                    "state": task.state,
                    "progress_percent": task.progress_percent,
                    "current_subtask": task.current_subtask,
                },
            )
            self._condition.notify_all()

        def run() -> None:
            reporter = TaskReporter(self, task_id)
            try:
                result = worker(reporter)
                with self._condition:
                    current = self._tasks[task_id]
                    current.state = "completed"
                    current.progress_percent = 100.0
                    current.current_subtask = "任务已完成"
                    current.finished_at = datetime.now(timezone.utc)
                    current.result = result
                    self._push_event(
                        current,
                        "completed",
                        {
                            "task_id": current.task_id,
                            "state": current.state,
                            "progress_percent": current.progress_percent,
                            "current_subtask": current.current_subtask,
                            "result": current.result,
                        },
                    )
                    self._condition.notify_all()
            except Exception as exc:
                failure = ScanErrorItem(file_name="system", reason=f"任务执行异常: {exc}")
                with self._condition:
                    current = self._tasks[task_id]
                    current.state = "failed"
                    current.current_subtask = "任务异常终止"
                    current.finished_at = datetime.now(timezone.utc)
                    current.failed.append(failure)
                    self._push_event(
                        current,
                        "failed",
                        {
                            "task_id": current.task_id,
                            "state": current.state,
                            "progress_percent": current.progress_percent,
                            "current_subtask": current.current_subtask,
                            "failure": failure.model_dump(),
                        },
                    )
                    self._condition.notify_all()

        thread = threading.Thread(target=run, name=f"task-{task_type}-{task_id}", daemon=True)
        thread.start()

        return TaskCreateResponse(task_id=task_id, task_type=task_type)

    def update_progress(self, task_id: str, percent: float, current_subtask: str | None) -> None:
        with self._condition:
            task = self._tasks.get(task_id)
            if task is None or task.state != "running":
                return

            task.progress_percent = max(0.0, min(100.0, round(percent, 2)))
            task.current_subtask = current_subtask
            self._push_event(
                task,
                "progress",
                {
                    "task_id": task.task_id,
                    "state": task.state,
                    "progress_percent": task.progress_percent,
                    "current_subtask": task.current_subtask,
                    "failed_count": len(task.failed),
                },
            )
            self._condition.notify_all()

    def append_failure(self, task_id: str, failure: ScanErrorItem) -> None:
        with self._condition:
            task = self._tasks.get(task_id)
            if task is None:
                return

            task.failed.append(failure)
            self._push_event(
                task,
                "failure",
                {
                    "task_id": task.task_id,
                    "state": task.state,
                    "progress_percent": task.progress_percent,
                    "current_subtask": task.current_subtask,
                    "failure": failure.model_dump(),
                    "failed_count": len(task.failed),
                },
            )
            self._condition.notify_all()

    def get_status(self, task_id: str) -> TaskStatusResponse:
        with self._lock:
            task = self._tasks.get(task_id)
            if task is None:
                raise KeyError(task_id)

            return TaskStatusResponse(
                task_id=task.task_id,
                task_type=task.task_type,
                state=task.state,
                progress_percent=task.progress_percent,
                current_subtask=task.current_subtask,
                started_at=task.started_at,
                finished_at=task.finished_at,
                failed=task.failed,
                result=task.result,
            )

    def sse_stream(self, task_id: str, last_event_id: int = 0):
        while True:
            with self._condition:
                task = self._tasks.get(task_id)
                if task is None:
                    break

                pending = [event for event in task.events if event.event_id > last_event_id]
                if not pending:
                    if task.state in {"completed", "failed"}:
                        break
                    self._condition.wait(timeout=1.0)
                    continue

                last_event_id = pending[-1].event_id
                terminal = task.state in {"completed", "failed"}

            for event in pending:
                payload = {
                    "event_id": event.event_id,
                    **event.payload,
                }
                data = json.dumps(payload, ensure_ascii=False)
                yield f"id: {event.event_id}\nevent: {event.event_type}\ndata: {data}\n\n"

            if terminal and not pending:
                break


TASK_MANAGER = TaskManager()
