from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from app.library import _list_mounted_directories, suggest_directories


class DirectorySuggestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def test_returns_children_when_input_endswith_slash(self) -> None:
        music_dir = self.root / "Music"
        (music_dir / "AlbumA").mkdir(parents=True)
        (music_dir / "AlbumB").mkdir(parents=True)
        (music_dir / "track.mp3").write_text("demo", encoding="utf-8")

        raw_input, base_dir, candidates, truncated = suggest_directories(f"{music_dir.as_posix()}/")

        self.assertEqual(raw_input, f"{music_dir.as_posix()}/")
        self.assertEqual(base_dir, str(music_dir.resolve()))
        self.assertFalse(truncated)
        self.assertEqual(candidates, [
            f"{(music_dir / 'AlbumA').resolve().as_posix()}/",
            f"{(music_dir / 'AlbumB').resolve().as_posix()}/",
        ])

    def test_matches_prefix_when_input_without_trailing_slash(self) -> None:
        parent = self.root / "Library"
        (parent / "Alpha").mkdir(parents=True)
        (parent / "Alpine").mkdir(parents=True)
        (parent / "Bravo").mkdir(parents=True)

        raw_input, _, candidates, _ = suggest_directories((parent / "Al").as_posix())

        self.assertEqual(raw_input, (parent / "Al").as_posix())
        self.assertEqual(candidates, [
            f"{(parent / 'Alpha').resolve().as_posix()}/",
            f"{(parent / 'Alpine').resolve().as_posix()}/",
        ])

    def test_does_not_echo_exact_directory_with_trailing_slash(self) -> None:
        parent = self.root / "Volumes" / "data"
        target = parent / "Music"
        target.mkdir(parents=True)
        (parent / "MusicArchive").mkdir(parents=True)

        raw_input, _, candidates, _ = suggest_directories(target.as_posix())

        self.assertEqual(raw_input, target.as_posix())
        self.assertNotIn(f"{target.resolve().as_posix()}/", candidates)
        self.assertIn(f"{(parent / 'MusicArchive').resolve().as_posix()}/", candidates)

    def test_non_absolute_input_is_treated_as_root_prefixed(self) -> None:
        root_relative = Path("/Volumes")

        raw_input, base_dir, candidates, truncated = suggest_directories("Volumes/")

        self.assertEqual(raw_input, "/Volumes/")
        self.assertEqual(base_dir, str(root_relative.resolve()))
        self.assertFalse(truncated)
        self.assertTrue(all(item.startswith("/Volumes/") for item in candidates))

    def test_root_excluded_dirs_applied(self) -> None:
        excluded = {"sys", "proc"}

        _, _, candidates, _ = suggest_directories("/", root_excluded_dirs=excluded)

        self.assertTrue(all(not item.endswith("/sys/") for item in candidates))
        self.assertTrue(all(not item.endswith("/proc/") for item in candidates))

    @patch("app.library._list_mounted_directories")
    def test_root_input_includes_mounted_points(self, mock_list_mounted_directories) -> None:
        mounted = self.root / "mounted-disk"
        mounted.mkdir(parents=True)
        mock_list_mounted_directories.return_value = [Path("/"), mounted]

        _, _, candidates, _ = suggest_directories("/", root_excluded_dirs={"sys", "proc"})

        self.assertNotIn("/", candidates)
        self.assertNotIn("//", candidates)
        self.assertIn(f"{mounted.resolve().as_posix()}/", candidates)

    @patch("app.library.subprocess.run")
    def test_list_mounted_directories_excludes_system_subdirs(self, mock_run) -> None:
        mock_run.return_value = Mock(
            returncode=0,
            stdout="\n".join(
                [
                    "devfs on /dev (devfs, local)",
                    "apfs on /private/var/vm (apfs, local)",
                    "apfs on /Volumes/MusicDisk (apfs, local)",
                    "apfs on /Users/demo/mnt (apfs, local)",
                ]
            ),
        )

        mounted = _list_mounted_directories()
        mounted_paths = [item.as_posix() for item in mounted]

        self.assertNotIn("/dev", mounted_paths)
        self.assertNotIn("/private/var/vm", mounted_paths)
        self.assertIn("/Volumes/MusicDisk", mounted_paths)
        self.assertIn("/Users/demo/mnt", mounted_paths)


if __name__ == "__main__":
    unittest.main()
