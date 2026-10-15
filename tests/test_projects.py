"""Regression tests for ADA-inspired, locally isolated ARKUS project workspaces."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from projects import ProjectError, ProjectStore
from server import App


class ProjectStoreTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def test_new_project_default_and_persistence(self):
        store = ProjectStore(self.root, (self.root / "legacy-notes").resolve())
        self.assertEqual(store.active, "general")
        self.assertEqual(store.notes_path(), (self.root / "legacy-notes").resolve())
        result = store.create("Carbon Bicycle")
        self.assertEqual(result["active"], "carbon-bicycle")
        self.assertEqual(store.notes_path(), (self.root / "projects" / "carbon-bicycle" / "notes").resolve())
        store2 = ProjectStore(self.root, (self.root / "legacy-notes").resolve())
        self.assertEqual(store2.active, "carbon-bicycle")
        self.assertEqual(len(store2.state()["projects"]), 2)
        store2.switch("general")
        self.assertEqual(store2.notes_path(), (self.root / "legacy-notes").resolve())

    def test_names_are_validated_and_duplicate_project_refused(self):
        store = ProjectStore(self.root, (self.root / "legacy-notes").resolve())
        for value in ("", " ", "../outside", "a/b", "x\\y", ".", "a" * 60):
            with self.subTest(name=value), self.assertRaises(ProjectError):
                store.create(value)
        store.create("Company Operations")
        with self.assertRaises(ProjectError):
            store.create("company operations")
        with self.assertRaises(ProjectError):
            store.switch("../outside")
        self.assertFalse((self.root.parent / "outside").exists())

    def test_symlinked_notes_folder_is_refused(self):
        store = ProjectStore(self.root, (self.root / "legacy-notes").resolve())
        store.create("Safe")
        folder = store.notes_path()
        folder.rmdir()
        external = self.root / "private"
        external.mkdir()
        try:
            folder.symlink_to(external, target_is_directory=True)
        except OSError:
            self.skipTest("Symlinks unavailable on this device")
        with self.assertRaises(ProjectError):
            store.notes_path()

    def test_chat_history_only_in_its_project_and_bounded(self):
        store = ProjectStore(self.root, (self.root / "legacy-notes").resolve())
        store.append_history([{"role": "user", "content": "General only"}])
        store.create("Design")
        self.assertEqual(store.read_history(), [])
        store.append_history([{"role": "user", "content": "Design only"}] * 50)
        self.assertEqual(len(store.read_history()), 40)
        store.switch("general")
        self.assertEqual(store.read_history()[0]["content"], "General only")
        store.clear_history()
        self.assertEqual(store.read_history(), [])
        store.switch("design")
        self.assertEqual(store.read_history()[0]["content"], "Design only")


class ProjectAppTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"ARKUS_CONFIG": str(self.root / "missing-config.json")})
        self.env.start()
        self.app = App(self.root)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_project_isolation_and_restart(self):
        self.app.create_project("Engineering")
        self.assertEqual(self.app.status()["project"], "engineering")
        self.app.remember("auroracarbon layup requires a test certificate")
        self.assertIn("auroracarbon", self.app.chat("auroracarbon")["answer"])
        self.app.switch_project("general")
        self.assertEqual(self.app.chat("auroracarbon")["kind"], "uncovered")
        self.app.switch_project("engineering")
        self.assertIn("auroracarbon", self.app.chat("auroracarbon")["answer"])
        restarted = App(self.root)
        self.assertEqual(restarted.projects.active, "engineering")
        self.assertGreaterEqual(len(restarted.history), 2)
        restarted.clear_chat_history()
        self.assertEqual(ProjectStore(self.root, self.root / "notes").read_history(), [])
