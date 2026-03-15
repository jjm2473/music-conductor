from __future__ import annotations

import json
import time
import unittest

from backend.app.models import ScanErrorItem
from backend.app.task_manager import TaskManager


def _wait_terminal_state(manager: TaskManager, task_id: str, timeout: float = 2.0):
    deadline = time.time() + timeout
    while time.time() < deadline:
        status = manager.get_status(task_id)
        if status.state in {"completed", "failed"}:
            return status
        time.sleep(0.01)
    raise AssertionError("Task did not reach terminal state in time")


def _parse_sse_events(chunks: list[str]) -> list[tuple[str, dict[str, object]]]:
    parsed: list[tuple[str, dict[str, object]]] = []
    for chunk in chunks:
        event_name = ""
        data_value = "{}"
        for line in chunk.splitlines():
            if line.startswith("event: "):
                event_name = line[len("event: ") :]
            if line.startswith("data: "):
                data_value = line[len("data: ") :]
        parsed.append((event_name, json.loads(data_value)))
    return parsed


class TaskManagerTests(unittest.TestCase):
    def test_task_success_lifecycle_and_sse_events(self) -> None:
        manager = TaskManager()

        def worker(reporter):
            reporter.progress(5.0, "prepare")
            reporter.fail(ScanErrorItem(file_name="demo.mp3", reason="metadata skipped"))
            reporter.step(1, 1, "done")
            return {"ok": True}

        created = manager.start_task("demo", worker)
        status = _wait_terminal_state(manager, created.task_id)

        self.assertEqual(status.state, "completed")
        self.assertEqual(status.progress_percent, 100.0)
        self.assertEqual(status.current_subtask, "任务已完成")
        self.assertIsNotNone(status.result)
        self.assertTrue(status.result.get("ok"))
        self.assertEqual(len(status.failed), 1)

        chunks = list(manager.sse_stream(created.task_id, 0))
        parsed = _parse_sse_events(chunks)
        event_types = [event_type for event_type, _ in parsed]

        self.assertIn("status", event_types)
        self.assertIn("progress", event_types)
        self.assertIn("failure", event_types)
        self.assertIn("completed", event_types)

        completed_payload = next(payload for event_type, payload in parsed if event_type == "completed")
        self.assertEqual(completed_payload["state"], "completed")
        self.assertEqual(completed_payload["progress_percent"], 100.0)

    def test_task_failure_state(self) -> None:
        manager = TaskManager()

        def worker(_reporter):
            raise RuntimeError("boom")

        created = manager.start_task("demo", worker)
        status = _wait_terminal_state(manager, created.task_id)

        self.assertEqual(status.state, "failed")
        self.assertGreaterEqual(len(status.failed), 1)
        self.assertIn("任务执行异常", status.failed[0].reason)


if __name__ == "__main__":
    unittest.main()
