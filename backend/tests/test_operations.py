from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from backend.app.config import AppConfig
from backend.app.models import OperationPreviewRequest
from backend.app.operations import build_operation_preview, execute_operation


class OperationFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_special_char_preview_marks_conflict(self) -> None:
        (self.directory / "A_B.mp3").write_bytes(b"ID3")
        (self.directory / "A B.mp3").write_bytes(b"ID3")

        config = AppConfig(
            default_music_dir=str(self.directory),
            special_char_map={"_": " "},
        )

        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="special_char_replace",
            ),
            config,
        )

        self.assertTrue(preview.has_conflict)
        self.assertGreaterEqual(preview.conflict_count, 1)
        self.assertTrue(any(item.conflict for item in preview.items))

    def test_execute_operation_blocks_when_conflict(self) -> None:
        (self.directory / "A_B.mp3").write_bytes(b"ID3")
        (self.directory / "A B.mp3").write_bytes(b"ID3")

        config = AppConfig(
            default_music_dir=str(self.directory),
            special_char_map={"_": " "},
        )

        result = execute_operation(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="special_char_replace",
            ),
            config,
        )

        self.assertTrue(result.has_conflict)
        self.assertEqual(result.executed, [])
        self.assertGreaterEqual(len(result.failed), 1)

    def test_execute_swap_renames_music_and_lrc(self) -> None:
        source_music = self.directory / "A - B.mp3"
        source_lrc = self.directory / "A - B.lrc"
        source_music.write_bytes(b"ID3")
        source_lrc.write_text("[00:00.00]demo", encoding="utf-8")

        config = AppConfig(default_music_dir=str(self.directory))

        result = execute_operation(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="swap_name_parts",
            ),
            config,
        )

        self.assertFalse(result.has_conflict)
        self.assertEqual(result.failed, [])
        self.assertEqual(len(result.executed), 2)

        self.assertFalse(source_music.exists())
        self.assertFalse(source_lrc.exists())
        self.assertTrue((self.directory / "B - A.mp3").exists())
        self.assertTrue((self.directory / "B - A.lrc").exists())

    @patch("backend.app.operations.read_easy_metadata")
    def test_metadata_rename_preview_skips_unchanged_and_reports_missing(
        self,
        mock_read_easy_metadata,
    ) -> None:
        (self.directory / "track-1.mp3").write_bytes(b"ID3")
        (self.directory / "track-1.lrc").write_text("[00:00.00]demo", encoding="utf-8")
        (self.directory / "track-2.mp3").write_bytes(b"ID3")
        (self.directory / "Artist C - Song C.mp3").write_bytes(b"ID3")

        def fake_read(entry: Path) -> tuple[dict[str, str], str | None]:
            if entry.name == "track-1.mp3":
                return {"artist": "Artist A", "title": "Song A", "album": ""}, None
            if entry.name == "track-2.mp3":
                return {"artist": "", "title": "Song B", "album": ""}, None
            if entry.name == "Artist C - Song C.mp3":
                return {"artist": "Artist C", "title": "Song C", "album": ""}, None
            return {}, "metadata not mocked"

        mock_read_easy_metadata.side_effect = fake_read

        config = AppConfig(default_music_dir=str(self.directory))

        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="rename_from_metadata",
                fill_mode="artist_title",
            ),
            config,
        )

        self.assertFalse(preview.has_conflict)
        self.assertEqual(preview.conflict_count, 0)
        self.assertEqual(len(preview.items), 2)
        self.assertEqual(len(preview.warnings), 1)
        self.assertEqual(preview.warnings[0].file_name, "track-2.mp3")

        music_item = next(item for item in preview.items if item.target_type == "music")
        lrc_item = next(item for item in preview.items if item.target_type == "lrc")

        self.assertEqual(music_item.source_file, "track-1.mp3")
        self.assertEqual(music_item.destination_file, "Artist A - Song A.mp3")
        self.assertEqual(lrc_item.source_file, "track-1.lrc")
        self.assertEqual(lrc_item.destination_file, "Artist A - Song A.lrc")
        self.assertFalse(any(item.source_file == "Artist C - Song C.mp3" for item in preview.items))

    @patch("backend.app.operations.read_easy_metadata")
    def test_metadata_rename_preview_supports_title_artist_mode(self, mock_read_easy_metadata) -> None:
        (self.directory / "input.mp3").write_bytes(b"ID3")
        mock_read_easy_metadata.return_value = ({"artist": "Artist X", "title": "Song X", "album": ""}, None)

        config = AppConfig(default_music_dir=str(self.directory))
        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="rename_from_metadata",
                fill_mode="title_artist",
            ),
            config,
        )

        self.assertEqual(len(preview.warnings), 0)
        self.assertEqual(len(preview.items), 1)
        self.assertEqual(preview.items[0].destination_file, "Song X - Artist X.mp3")


if __name__ == "__main__":
    unittest.main()
