from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.config import AppConfig
from backend.app.metadata_service import read_metadata, update_metadata
from backend.app.models import MetadataReadRequest, MetadataUpdateRequest


class MetadataServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.file_name = "A - B.mp3"
        (self.directory / self.file_name).write_bytes(b"ID3")
        self.config = AppConfig(default_music_dir=str(self.directory))

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_read_metadata_returns_full_payload(self) -> None:
        with (
            patch("backend.app.metadata_service.read_full_metadata", return_value=({"tags": {"title": ["B"]}}, None)),
            patch("backend.app.metadata_service.read_duration_seconds", return_value=12.34),
        ):
            result = read_metadata(
                MetadataReadRequest(directory=str(self.directory), file_name=self.file_name),
                self.config,
            )

        self.assertEqual(result.file_name, self.file_name)
        self.assertEqual(result.duration_seconds, 12.34)
        self.assertIsNone(result.metadata_error)
        self.assertIn("tags", result.full_metadata)

    def test_update_metadata_collects_failure(self) -> None:
        with patch("backend.app.metadata_service.write_easy_metadata", side_effect=ValueError("write not supported")):
            result = update_metadata(
                MetadataUpdateRequest(
                    directory=str(self.directory),
                    file_name=self.file_name,
                    updates={"title": "B"},
                    remove_fields=["album"],
                ),
                self.config,
            )

        self.assertFalse(result.updated)
        self.assertEqual(len(result.failed), 1)
        self.assertIn("写入元数据失败", result.failed[0].reason)

    def test_update_metadata_success(self) -> None:
        with patch("backend.app.metadata_service.write_easy_metadata", return_value=None):
            result = update_metadata(
                MetadataUpdateRequest(
                    directory=str(self.directory),
                    file_name=self.file_name,
                    updates={"title": "B"},
                    remove_fields=[],
                ),
                self.config,
            )

        self.assertTrue(result.updated)
        self.assertEqual(result.failed, [])


if __name__ == "__main__":
    unittest.main()
