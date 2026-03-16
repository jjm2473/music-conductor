from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from app.library import detect_audio_format, read_full_metadata
from app.scanner import scan_music_directory


class ScannerTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.directory = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    @patch("app.scanner.MutagenFile")
    @patch("app.scanner.detect_audio_format")
    def test_scan_uses_detected_mutagen_format(self, mock_detect_audio_format, mock_mutagen_file) -> None:
        music_file = self.directory / "demo.mp3"
        music_file.write_bytes(b"ID3")

        mock_detect_audio_format.return_value = ("MP3", "mp3", None)

        class FakeInfo:
            length = 123.456

        class FakeAudio:
            info = FakeInfo()
            tags = {
                "title": ["Song"],
                "artist": ["Artist"],
                "album": ["Album"],
            }

        mock_mutagen_file.return_value = FakeAudio()

        records, skipped = scan_music_directory(self.directory, {"mp3"})

        mock_mutagen_file.assert_called_once_with(music_file, easy=True)
        mock_detect_audio_format.assert_called_once()
        self.assertEqual(mock_detect_audio_format.call_args.kwargs.get("file_path"), music_file)
        self.assertIs(mock_detect_audio_format.call_args.kwargs.get("audio"), mock_mutagen_file.return_value)

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].file_name, "demo.mp3")
        self.assertEqual(records[0].format, "MP3")
        self.assertEqual(records[0].duration_seconds, 123.46)
        self.assertEqual(records[0].metadata.title, "Song")
        self.assertEqual(records[0].metadata.artist, "Artist")
        self.assertEqual(records[0].metadata.album, "Album")
        self.assertEqual(skipped, [])

    @patch("app.scanner.MutagenFile")
    @patch("app.scanner.detect_audio_format")
    def test_scan_format_falls_back_to_unknown_when_detection_fails(
        self,
        mock_detect_audio_format,
        mock_mutagen_file,
    ) -> None:
        music_file = self.directory / "unknown.mp3"
        music_file.write_bytes(b"ID3")

        mock_detect_audio_format.return_value = (None, None, "cannot parse")
        mock_mutagen_file.return_value = None

        records, skipped = scan_music_directory(self.directory, {"mp3"})

        self.assertEqual(len(records), 1)
        self.assertEqual(records[0].format, "UNKNOWN")
        self.assertEqual(len(skipped), 1)
        self.assertIn("Unsupported or unreadable audio metadata", skipped[0].reason)
        self.assertIn("format detect failed", skipped[0].reason)

    @patch("app.library.MutagenFile")
    def test_detect_audio_format_falls_back_to_easy_mode_when_primary_parse_fails(
        self,
        mock_mutagen_file,
    ) -> None:
        music_file = self.directory / "fake-flac.mp3"
        music_file.write_bytes(b"fLaC")

        fallback_audio = type("FLAC", (), {"mime": ["audio/flac"]})()
        mock_mutagen_file.side_effect = [
            RuntimeError("can't sync to MPEG frame"),
            fallback_audio,
        ]

        display, preferred_extension, error = detect_audio_format(file_path=music_file)

        self.assertEqual(display, "FLAC")
        self.assertEqual(preferred_extension, "flac")
        self.assertIsNone(error)

        self.assertEqual(mock_mutagen_file.call_count, 2)
        first_call = mock_mutagen_file.call_args_list[0]
        second_call = mock_mutagen_file.call_args_list[1]
        self.assertEqual(first_call.args, (music_file,))
        self.assertEqual(first_call.kwargs, {"easy": False})
        self.assertEqual(second_call.args, (music_file,))
        self.assertEqual(second_call.kwargs, {"easy": True})

    @patch("app.library.MutagenFile")
    def test_read_full_metadata_falls_back_to_easy_mode_when_primary_parse_fails(
        self,
        mock_mutagen_file,
    ) -> None:
        music_file = self.directory / "fake-flac.mp3"
        music_file.write_bytes(b"fLaC")

        fallback_audio = type(
            "EasyFallback",
            (),
            {
                "tags": {
                    "title": ["God is a Girl"],
                    "artist": ["Groove Coverage"],
                    "album": ["Best of Groove Coverage"],
                },
                "info": None,
            },
        )()

        mock_mutagen_file.side_effect = [
            RuntimeError("can't sync to MPEG frame"),
            fallback_audio,
        ]

        payload, metadata_error = read_full_metadata(music_file)

        self.assertIsNone(metadata_error)
        self.assertIn("tags", payload)
        self.assertEqual(payload["tags"].get("title"), ["God is a Girl"])
        self.assertEqual(payload["tags"].get("artist"), ["Groove Coverage"])
        self.assertEqual(payload["tags"].get("album"), ["Best of Groove Coverage"])

        self.assertEqual(mock_mutagen_file.call_count, 2)
        first_call = mock_mutagen_file.call_args_list[0]
        second_call = mock_mutagen_file.call_args_list[1]
        self.assertEqual(first_call.args, (music_file,))
        self.assertEqual(first_call.kwargs, {"easy": False})
        self.assertEqual(second_call.args, (music_file,))
        self.assertEqual(second_call.kwargs, {"easy": True})


if __name__ == "__main__":
    unittest.main()
