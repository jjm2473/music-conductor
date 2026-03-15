from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from app.config import AppConfig
from app.duplicates import execute_duplicates, load_ignore_set, scan_duplicates
from app.models import DuplicateDecision, DuplicateExecuteRequest


class DuplicateFlowTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)
        self.config = AppConfig(default_music_dir=self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_scan_and_execute_ignore_group(self) -> None:
        (self.directory / "A - B.mp3").write_bytes(b"ID3")
        (self.directory / "B - A.ogg").write_bytes(b"OggS")

        scan_result = scan_duplicates(str(self.directory), self.config)
        self.assertEqual(len(scan_result.groups), 1)
        group_key = scan_result.groups[0].group_key

        execute_result = execute_duplicates(
            DuplicateExecuteRequest(
                directory=str(self.directory),
                decisions=[
                    DuplicateDecision(
                        group_key=group_key,
                        keep_files=[],
                        ignore_group=True,
                    )
                ],
            ),
            self.config,
        )

        self.assertEqual(execute_result.deleted_files, [])
        self.assertEqual(set(execute_result.ignored_written), {"A - B.mp3", "B - A.ogg"})
        self.assertEqual(load_ignore_set(self.directory), {"A - B.mp3", "B - A.ogg"})

    def test_execute_keep_with_lrc_adoption(self) -> None:
        keep_music = self.directory / "A - B.mp3"
        delete_music = self.directory / "B - A.ogg"
        donor_lrc = self.directory / "B - A.lrc"

        keep_music.write_bytes(b"ID3")
        delete_music.write_bytes(b"OggS")
        donor_lrc.write_text("[00:00.00]demo", encoding="utf-8")

        scan_result = scan_duplicates(str(self.directory), self.config)
        self.assertEqual(len(scan_result.groups), 1)
        group_key = scan_result.groups[0].group_key

        execute_result = execute_duplicates(
            DuplicateExecuteRequest(
                directory=str(self.directory),
                decisions=[
                    DuplicateDecision(
                        group_key=group_key,
                        keep_files=[keep_music.name],
                        ignore_group=False,
                    )
                ],
            ),
            self.config,
        )

        self.assertIn(delete_music.name, execute_result.deleted_files)
        self.assertEqual(execute_result.failed, [])

        adopted_lrc = self.directory / "A - B.lrc"
        self.assertTrue(adopted_lrc.exists())
        self.assertFalse(donor_lrc.exists())


if __name__ == "__main__":
    unittest.main()
