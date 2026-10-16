"""Durable ARKUS backup and multi-project reminders acceptance tests."""
import tempfile
import unittest
import zipfile
from datetime import datetime, timedelta
from pathlib import Path

from backup import BackupError, export_backup, restore_backup
from companion import CompanionWorkflows


class BackupTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.data.mkdir()
        (self.data / "projects" / "general").mkdir(parents=True)
        (self.data / "projects" / "general" / "history.json").write_text('[{"role":"user","content":"Remember QA"}]', encoding="utf-8")
        (self.data / "projects.json").write_text('{"version":1}', encoding="utf-8")
        (self.data / "notes" / "captures").mkdir(parents=True)
        (self.data / "notes" / "captures" / "record.md").write_text("My stored note", encoding="utf-8")

    def tearDown(self):
        self.temp.cleanup()

    def test_roundtrip_includes_project_memory_but_excludes_secrets(self):
        (self.data / "config.json").write_text('{"api_key":"DO_NOT_EXPORT"}',encoding="utf-8")
        (self.data / "focus-ledger.jsonl").write_text("private sensor data",encoding="utf-8")
        archive = self.root / "backup.zip"
        result=export_backup(self.data,archive)
        self.assertGreater(result["files"],0)
        with zipfile.ZipFile(archive) as z:
            self.assertIn("projects/general/history.json",z.namelist())
            self.assertIn("notes/captures/record.md",z.namelist())
            self.assertNotIn("config.json",z.namelist())
            self.assertNotIn("focus-ledger.jsonl",z.namelist())
            self.assertNotIn("DO_NOT_EXPORT",repr([z.read(n) for n in z.namelist()]))
        restored=self.root / "restored"
        restore_backup(archive, restored, allow_nonempty=False)
        self.assertIn("Remember QA",(restored / "projects" / "general" / "history.json").read_text())

    def test_refuse_overwrite_existing_destination(self):
        archive=self.root / "backup.zip"
        export_backup(self.data,archive)
        with self.assertRaises(BackupError):
            restore_backup(archive,self.data)

    def test_reject_zip_slip_and_symlink(self):
        archive=self.root / "evil.zip"
        with zipfile.ZipFile(archive,"w") as z:
            z.writestr("../escape","bad")
        with self.assertRaises(BackupError):
            restore_backup(archive,self.root / "restored")
        self.assertFalse((self.root / "escape").exists())

    def test_refuse_linked_source(self):
        external=self.root / "external.txt"
        external.write_text("secret",encoding="utf-8")
        pointer=self.data / "projects" / "general" / "linked.txt"
        try:
            pointer.symlink_to(external)
        except OSError:
            self.skipTest("symlink not supported")
        with self.assertRaises(BackupError):
            export_backup(self.data,self.root / "archive.zip")


class ReminderAggregationTests(unittest.TestCase):
    def test_due_from_multiple_projects_are_visible(self):
        with tempfile.TemporaryDirectory() as temp:
            store=CompanionWorkflows(temp)
            fixed=datetime(2026,10,16,9,0)
            when=(fixed+timedelta(minutes=1)).isoformat(timespec="minutes")
            store.remind("general",when,"General reminder",now=fixed)
            store.remind("engineering",when,"Engineering reminder",now=fixed)
            due=store.due_across(["general","engineering"],now=fixed+timedelta(minutes=2))
            self.assertEqual({x["project"] for x in due},{"general","engineering"})
            self.assertEqual(len(due),2)

class AppBackupTests(unittest.TestCase):
    def test_app_backup_creates_snapshot_outside_live_directory(self):
        import os
        from unittest.mock import patch
        from server import App
        with tempfile.TemporaryDirectory() as temp:
            root=Path(temp)
            with patch.dict(os.environ, {"ARKUS_CONFIG":str(root/"not-configured.json")}):
                app=App(root/"arkus")
                app.remember("Preserve this QA note for recovery")
                info=app.backup_projects()
                archive=Path(info["archive"])
                self.assertTrue(archive.exists())
                self.assertFalse(archive.is_relative_to(app.data))
                with zipfile.ZipFile(archive) as z:
                    self.assertTrue(any(n.endswith(".md") for n in z.namelist()))
                self.assertTrue(any("notes/captures/" in n for n in z.namelist()))


if __name__=="__main__":
    unittest.main()
