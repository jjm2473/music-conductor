from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.config import AppConfig
from app.models import OperationPreviewRequest
from app.operations import build_operation_preview, execute_operation


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

    def test_special_char_preview_uses_request_override_map(self) -> None:
        (self.directory / "A_B.mp3").write_bytes(b"ID3")

        config = AppConfig(
            default_music_dir=str(self.directory),
            special_char_map={"_": " "},
        )

        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="special_char_replace",
                special_char_map={"_": "-"},
            ),
            config,
        )

        self.assertEqual(len(preview.items), 1)
        self.assertEqual(preview.items[0].destination_file, "A-B.mp3")

    def test_special_char_preview_supports_ampersand_to_ideographic_comma(self) -> None:
        (self.directory / "A&B.mp3").write_bytes(b"ID3")

        config = AppConfig(
            default_music_dir=str(self.directory),
            special_char_map={"&": "、"},
        )

        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="special_char_replace",
            ),
            config,
        )

        self.assertEqual(len(preview.items), 1)
        self.assertEqual(preview.items[0].source_file, "A&B.mp3")
        self.assertEqual(preview.items[0].destination_file, "A、B.mp3")

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

    @patch("app.operations.read_easy_metadata")
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

    @patch("app.operations.read_easy_metadata")
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

    @patch("app.operations.read_easy_metadata")
    def test_metadata_cleanup_text_supports_case_sensitive(self, mock_read_easy_metadata) -> None:
        (self.directory / "cleanup.mp3").write_bytes(b"ID3")
        mock_read_easy_metadata.return_value = (
            {
                "title": "feat. Song",
                "artist": "Feat. Artist",
                "album": "Demo",
            },
            None,
        )

        config = AppConfig(default_music_dir=str(self.directory))
        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="metadata_cleanup_text",
                cleanup_pattern="feat.",
                cleanup_use_regex=False,
                cleanup_case_sensitive=True,
                cleanup_fields=["title", "artist"],
            ),
            config,
        )

        self.assertEqual(len(preview.items), 1)
        changes = {change.field: change.new_value for change in preview.items[0].metadata_changes}
        self.assertEqual(changes.get("title"), "Song")
        self.assertNotIn("artist", changes)

    @patch("app.operations.read_easy_metadata")
    def test_metadata_cleanup_remove_fields_deletes_requested_fields(self, mock_read_easy_metadata) -> None:
        (self.directory / "remove.mp3").write_bytes(b"ID3")
        mock_read_easy_metadata.return_value = (
            {
                "title": "Song",
                "artist": "Artist",
                "album": "Album",
                "comment": "",
            },
            None,
        )

        config = AppConfig(default_music_dir=str(self.directory))
        preview = build_operation_preview(
            OperationPreviewRequest(
                directory=str(self.directory),
                operation="metadata_cleanup_remove_fields",
                remove_fields=["artist", "album", "comment"],
            ),
            config,
        )

        self.assertEqual(len(preview.items), 1)
        removed_fields = {
            change.field
            for change in preview.items[0].metadata_changes
            if change.new_value is None
        }
        self.assertEqual(removed_fields, {"artist", "album"})

    def test_metadata_cleanup_remove_fields_requires_input(self) -> None:
        config = AppConfig(default_music_dir=str(self.directory))

        with self.assertRaisesRegex(ValueError, "请至少提供一个待删除字段"):
            build_operation_preview(
                OperationPreviewRequest(
                    directory=str(self.directory),
                    operation="metadata_cleanup_remove_fields",
                    remove_fields=[],
                ),
                config,
            )


if __name__ == "__main__":
    unittest.main()
