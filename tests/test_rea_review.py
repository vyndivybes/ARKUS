"""Contract tests for opt-in REA capture and Windows timeout cleanup."""
import json
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from rea_review import ReviewError, run_review


def process_factory(output, *, exit_code=0, times_out=False):
    process = Mock()
    process.pid = 43219
    process.wait.side_effect = (
        subprocess.TimeoutExpired(["npx.cmd"], 180) if times_out else None
    )
    if not times_out:
        process.wait.return_value = exit_code

    def launch(command, **kwargs):
        kwargs["stdout"].write(output.encode("utf-8"))
        kwargs["stdout"].flush()
        return process

    return process, launch


class REAReviewTests(unittest.TestCase):
    def test_requires_operator_approval_before_process_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            with patch("rea_review.subprocess.Popen") as execute:
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
            with patch("rea_review.subprocess.Popen") as execute:
                with self.assertRaisesRegex(ReviewError, "directory"):
                    run_review(binary, approved=True, storage_root=root / "out")
                execute.assert_not_called()

    def test_pinned_static_command_uses_file_capture_not_inherited_pipes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "dist"
            target.mkdir()
            process, launch = process_factory('{"result":"observed"}')
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch) as execute:
                receipt = run_review(target, approved=True, storage_root=root / "out")
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), {"result": "observed"})
            self.assertEqual(receipt.parent, (root / "out").resolve())
            command = execute.call_args.args[0]
            self.assertEqual(command[:3], ["npx.cmd", "--yes", "rea-agents@6.5.0"])
            self.assertEqual(command[3:], ["analyze-javascript-application", str(target.resolve()), "--json", "--filter-output", "evidence_id,normalized_result.statistics"])
            self.assertFalse(execute.call_args.kwargs.get("shell", False))
            self.assertNotEqual(execute.call_args.kwargs["stdout"], subprocess.PIPE)
            self.assertNotEqual(execute.call_args.kwargs["stderr"], subprocess.PIPE)
            process.wait.assert_called_once_with(timeout=180)

    def test_timeout_terminates_process_tree_without_reading_inherited_pipes(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            process, launch = process_factory('{"partial":true}', times_out=True)
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch), \
                 patch("rea_review._terminate_process_tree") as cleanup:
                with self.assertRaisesRegex(ReviewError, "timed out"):
                    run_review(root, approved=True, storage_root=root / "out")
            cleanup.assert_called_once_with(process)
            self.assertFalse((root / "out").exists())

    def test_nonzero_invalid_and_excessive_output_are_not_saved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for output, code in (
                ('{"error":"failure"}', 1),
                ("not-json", 0),
                ('"' + "x" * (8 * 1024 * 1024 + 1) + '"', 0),
            ):
                process, launch = process_factory(output, exit_code=code)
                with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                     patch("rea_review.subprocess.Popen", side_effect=launch):
                    with self.assertRaises(ReviewError):
                        run_review(root, approved=True, storage_root=root / "out")
            self.assertFalse((root / "out").exists())

    def test_empty_output_has_actionable_diagnostic(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            process, launch = process_factory("")
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch):
                with self.assertRaisesRegex(ReviewError, "zero bytes"):
                    run_review(root, approved=True, storage_root=root / "out")

    def test_oversized_output_reports_actual_size_separately(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            oversized = '{"big":"' + ("x" * (8 * 1024 * 1024)) + '"}'
            process, launch = process_factory(oversized)
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch):
                with self.assertRaisesRegex(ReviewError, "exceeded 8 MiB"):
                    run_review(root, approved=True, storage_root=root / "out")

    def test_selection_and_summary_build_bounded_cli_arguments(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "dist"
            (target / "assets").mkdir(parents=True)
            (target / "assets" / "index.js").write_text("console.log('ok')", encoding="utf-8")
            process, launch = process_factory('{"evidence_id":"ev_test"}')
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch) as execute:
                run_review(
                    target, approved=True, source_paths=["assets/index.js"],
                    summary=True, storage_root=root / "out",
                )
            command = execute.call_args.args[0]
            self.assertIn("--source-path", command)
            self.assertEqual(command[command.index("--source-path") + 1], "assets/index.js")
            self.assertIn("--filter-output", command)
            self.assertEqual(
                command[command.index("--filter-output") + 1],
                "evidence_id,normalized_result.statistics,normalized_result.source_selection",
            )

    def test_refuses_paths_outside_target_before_launch(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "dist"
            target.mkdir()
            with patch("rea_review.subprocess.Popen") as execute:
                for path in ("../outside.js", "/etc/passwd", "C:/Windows/system.ini", "", "missing.js"):
                    with self.subTest(path=path):
                        with self.assertRaises(ReviewError):
                            run_review(target, approved=True, source_paths=[path], storage_root=root / "out")
                execute.assert_not_called()

    def test_error_distinguishes_empty_from_oversized_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            for output, kind in (("", "empty"), ("x" * (8 * 1024 * 1024 + 1), "exceeded")):
                process, launch = process_factory(output)
                with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                     patch("rea_review.subprocess.Popen", side_effect=launch):
                    with self.assertRaisesRegex(ReviewError, kind):
                        run_review(root, approved=True, storage_root=root / "out")
            self.assertFalse((root / "out").exists())

    def test_ctrl_c_also_terminates_process_tree(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            process, launch = process_factory("")
            process.wait.side_effect = KeyboardInterrupt()
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review.subprocess.Popen", side_effect=launch), \
                 patch("rea_review._terminate_process_tree") as cleanup:
                with self.assertRaisesRegex(ReviewError, "cancelled"):
                    run_review(root, approved=True, storage_root=root / "out")
            cleanup.assert_called_once_with(process)


if __name__ == "__main__":
    unittest.main()
