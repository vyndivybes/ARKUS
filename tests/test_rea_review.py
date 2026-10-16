"""Tests for the explicitly triggered, static-only REA evidence workflow."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from rea_review import ReviewError, run_review


class REAReviewTests(unittest.TestCase):
    def test_requires_operator_approval_before_process_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("rea_review.subprocess.run") as execute:
                with self.assertRaisesRegex(ReviewError, "approval"):
                    run_review(Path(tmp), approved=False, storage_root=Path(tmp) / "out")
                execute.assert_not_called()

    def test_refuses_nonexistent_and_non_directory_targets(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            with self.assertRaises(ReviewError):
                run_review(root / "missing", approved=True, storage_root=root / "out")
            binary = root / "unknown.exe"
            binary.write_bytes(b"MZ")
            with patch("rea_review.subprocess.run") as execute:
                with self.assertRaisesRegex(ReviewError, "directory"):
                    run_review(binary, approved=True, storage_root=root / "out")
                execute.assert_not_called()

    def test_runs_pinned_static_command_without_shell_and_stores_untrusted_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "source"
            target.mkdir()
            result = subprocess.CompletedProcess([], 0, '{"result":"observed"}', "")
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.run", return_value=result) as execute:
                receipt = run_review(target, approved=True, storage_root=root / "out")
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), {"result":"observed"})
            self.assertEqual(receipt.parent, (root / "out").resolve())
            command = execute.call_args.args[0]
            self.assertEqual(command[:3], ["npx.cmd", "--yes", "rea-agents@6.5.0"])
            self.assertEqual(command[3:], ["analyze-javascript-application", str(target.resolve()), "--json"])
            self.assertFalse(execute.call_args.kwargs.get("shell", False))

    def test_does_not_save_nonzero_or_invalid_output(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for result in (
                subprocess.CompletedProcess([], 1, '{"error":"failed"}', "provider failed"),
                subprocess.CompletedProcess([], 0, "not-json", ""),
                subprocess.CompletedProcess([], 0, "x" * (8 * 1024 * 1024 + 1), ""),
            ):
                with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                     patch("rea_review.subprocess.run", return_value=result):
                    with self.assertRaises(ReviewError):
                        run_review(root, approved=True, storage_root=root / "out")
            self.assertEqual(list((root / "out").glob("*.json")), [])


if __name__ == "__main__":
    unittest.main()
