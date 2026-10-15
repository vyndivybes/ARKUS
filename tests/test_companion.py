"""Local-workflow regression tests. No hardware, cloud provider or shell needed."""
import os
import tempfile
import unittest
from datetime import datetime, timedelta
from pathlib import Path
from unittest.mock import patch

from companion import CAPABILITIES, CompanionWorkflows, WorkflowError
from server import App


class CompanionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.worker = CompanionWorkflows(self.root)

    def tearDown(self):
        self.tmp.cleanup()

    def test_plan_one_confirmed_step_only_and_persistence(self):
        saved = self.worker.create_plan("general", "Finish bicycle review", ["Inspect model", "Sign result"])
        plan_id = saved["plan"]["id"]
        self.assertEqual(sum(s["done"] for s in saved["plan"]["steps"]), 0)
        with self.assertRaisesRegex(WorkflowError, "confirmation"):
            self.worker.advance("general", plan_id, False)
        first = self.worker.advance("general", plan_id, True)["plan"]
        self.assertEqual([s["done"] for s in first["steps"]], [True, False])
        self.assertFalse(first["completed"])
        reloaded = CompanionWorkflows(self.root)
        completed = reloaded.advance("general", plan_id, True)["plan"]
        self.assertTrue(completed["completed"])
        with self.assertRaises(WorkflowError):
            reloaded.advance("general", plan_id, True)

    def test_project_isolation_with_conflicting_identifiers(self):
        self.worker.create_plan("general", "General work", ["First"])
        self.worker.create_plan("engineering", "Design", ["Verify"])
        state = self.worker.snapshot("engineering")
        self.assertEqual([p["goal"] for p in state["plans"]], ["Design"])
        self.assertEqual([p["goal"] for p in self.worker.snapshot("general")["plans"]], ["General work"])
        with self.assertRaises(WorkflowError):
            self.worker.create_plan("../escape", "Bad", ["No"])
        self.assertFalse((self.root.parent / "escape").exists())

    def test_reminder_is_local_no_fabricated_external_intelligence(self):
        fixed = datetime(2026, 10, 16, 10, 0)
        due = (fixed + timedelta(minutes=1)).isoformat(timespec="minutes")
        saved = self.worker.remind("general", due, "Check QA", now=fixed)
        self.assertEqual(len(self.worker.snapshot("general", fixed)["due"]), 0)
        later = self.worker.snapshot("general", fixed + timedelta(minutes=2))
        self.assertEqual(later["due"][0]["message"], "Check QA")
        self.assertEqual(later["briefing"]["source"], "local_project_records_only")
        self.assertEqual(later["briefing"]["external_data"], "not_connected")
        self.worker.acknowledge("general", saved["reminder"]["id"])
        self.assertEqual(self.worker.snapshot("general", fixed + timedelta(minutes=2))["due"], [])

    def test_invalid_actions_and_symlink_refused(self):
        with self.assertRaises(WorkflowError):
            self.worker.create_plan("general", "x", [])
        with self.assertRaises(WorkflowError):
            self.worker.create_plan("general", "x", [" "] )
        with self.assertRaises(WorkflowError):
            self.worker.remind("general", "invalid", "x")
        with self.assertRaises(WorkflowError):
            self.worker.acknowledge("general", "nonexistent")
        self.worker.create_plan("safe", "Safe plan", ["Step"])
        folder = self.root / "projects" / "safe"
        external = self.root / "outside"
        external.mkdir()
        data = folder / "companion.json"
        data.unlink()
        try:
            data.symlink_to(external / "outside.json")
        except OSError:
            self.skipTest("Symlinks unavailable")
        with self.assertRaisesRegex(WorkflowError, "Linked"):
            self.worker.snapshot("safe")

    def test_registry_is_explicit_about_missing_features(self):
        self.assertTrue(any(x["name"] == "Robotic arm control" and x["status"] != "available" for x in CAPABILITIES))
        self.assertTrue(any(x["name"] == "One-step confirmed work plans" and x["status"] == "available" for x in CAPABILITIES))


class CompanionAppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.patch = patch.dict(os.environ, {"ARKUS_CONFIG": str(self.root / "missing.json")})
        self.patch.start()
        self.app = App(self.root)

    def tearDown(self):
        self.patch.stop()
        self.tmp.cleanup()

    def test_app_workflows_follow_active_project(self):
        plan = self.app.create_workflow_plan("Keep QA orderly", ["Review", "Close"])
        self.assertEqual(self.app.workflows_state()["plans"][0]["id"], plan["plan"]["id"])
        self.app.create_project("Design")
        self.assertEqual(self.app.workflows_state()["plans"], [])
        self.app.switch_project("general")
        self.assertEqual(len(self.app.workflows_state()["plans"]), 1)
        self.assertEqual(self.app.advance_workflow_plan(plan["plan"]["id"], True)["plan"]["steps"][0]["done"], True)


if __name__ == "__main__":
    unittest.main()
