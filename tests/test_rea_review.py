"""Regression tests for REA subprocess cancellation and Windows descendant cleanup."""
import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

from rea_review import ReviewError, run_review, _run_rea, _terminate_process_tree


class REAReviewTests(unittest.TestCase):
    def test_requires_operator_approval_before_process_launch(self):
        with tempfile.TemporaryDirectory() as tmp, patch("rea_review._run_rea") as run:
            with self.assertRaisesRegex(ReviewError, "approval"):
                run_review(Path(tmp), approved=False, storage_root=Path(tmp) / "out")
            run.assert_not_called()

    def test_refuses_invalid_and_executable_targets(self):
        with tempfile.TemporaryDirectory() as tmp, patch("rea_review._run_rea") as run:
            root = Path(tmp)
            with self.assertRaises(ReviewError):
                run_review(root / "missing", approved=True, storage_root=root / "out")
            binary = root / "unknown.exe"
            binary.write_bytes(b"MZ")
            with self.assertRaisesRegex(ReviewError, "directory"):
                run_review(binary, approved=True, storage_root=root / "out")
            run.assert_not_called()

    def test_runs_pinned_static_command_without_shell_and_stores_untrusted_json(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            target = root / "source"
            target.mkdir()
            with patch("rea_review.shutil.which", return_value="npx.cmd"), \
                 patch("rea_review._run_rea", return_value='{"result":"observed"}') as execute:
                receipt = run_review(target, approved=True, storage_root=root / "out")
            self.assertEqual(json.loads(receipt.read_text(encoding="utf-8")), {"result": "observed"})
            self.assertEqual(receipt.parent, (root / "out").resolve())
            command = execute.call_args.args[0]
            self.assertEqual(command[:3], ["npx.cmd", "--yes", "rea-agents@6.5.0"])
            self.assertEqual(command[3:], ["analyze-javascript-application", str(target.resolve()), "--json"])

    def test_no_evidence_on_invalid_output_or_analysis_failure(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            outcomes = ["not-json", "x" * (8 * 1024 * 1024 + 1), "[]", ReviewError("analysis failed")]
            for outcome in outcomes:
                with self.subTest(outcome_type=type(outcome).__name__), \
                     patch("rea_review.shutil.which", return_value="npx.cmd"), \
                     patch("rea_review._run_rea") as execute:
                    if isinstance(outcome, Exception):
                        execute.side_effect = outcome
                    else:
                        execute.return_value = outcome
                    with self.assertRaises(ReviewError):
                        run_review(root, approved=True, storage_root=root / "out")
            self.assertEqual(list((root / "out").glob("*.json")), [])

    def test_timeout_terminates_descendants_and_never_captures_pipes(self):
        proc = Mock(pid=12345)
        proc.wait.side_effect = subprocess.TimeoutExpired("npx", 0.01)
        with patch("rea_review.subprocess.Popen", return_value=proc) as spawn, \
             patch("rea_review._terminate_process_tree") as terminate:
            with self.assertRaisesRegex(ReviewError, "timed out"):
                _run_rea(["npx.cmd", "--yes", "rea-agents@6.5.0"], timeout=0.01)
        terminate.assert_called_once_with(proc)
        kw = spawn.call_args.kwargs
        self.assertNotEqual(kw["stdout"], subprocess.PIPE)
        self.assertNotEqual(kw["stderr"], subprocess.PIPE)
        self.assertEqual(kw["stdin"], subprocess.DEVNULL)

    def test_keyboard_interrupt_terminates_descendants(self):
        proc = Mock(pid=12345)
        proc.wait.side_effect = KeyboardInterrupt()
        with patch("rea_review.subprocess.Popen", return_value=proc), \
             patch("rea_review._terminate_process_tree") as terminate:
            with self.assertRaisesRegex(ReviewError, "cancelled"):
                _run_rea(["npx.cmd", "--yes", "rea-agents@6.5.0"], timeout=0.01)
        terminate.assert_called_once_with(proc)

    @unittest.skipUnless(os.name == "nt", "Windows process-tree kill is Windows-specific")
    def test_terminate_process_tree_uses_taskkill_and_fallback(self):
        proc = Mock(pid=43210)
        proc.poll.return_value = None
        with patch("rea_review.subprocess.run", return_value=subprocess.CompletedProcess([], 0)) as kill:
            _terminate_process_tree(proc)
        self.assertEqual(kill.call_args.args[0], ["taskkill", "/PID", "43210", "/T", "/F"])
        self.assertLessEqual(kill.call_args.kwargs["timeout"], 10)
        proc.kill.assert_called_once()
        proc.wait.assert_called_once()


if __name__ == "__main__":
    unittest.main()
