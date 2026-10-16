"""ADA-inspired local project file drafts with bounded, approved edits and backup."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import App, UserError
from backup import export_backup, restore_backup


class DraftFilesTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.root=Path(self.tmp.name)
        self.env=patch.dict(os.environ,{"ARKUS_CONFIG":str(self.root/"missing.json")})
        self.env.start()
        self.app=App(self.root)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_approved_write_read_list_revisions_and_project_isolation(self):
        with self.assertRaises(UserError):
            self.app.write_project_draft("quality.md","First draft",approved=False)
        written=self.app.write_project_draft("quality.md","First draft",approved=True)
        self.assertTrue(written["saved"])
        self.assertEqual(self.app.read_project_draft("quality.md")["content"],"First draft")
        self.assertEqual(self.app.list_project_drafts()["files"][0]["name"],"quality.md")
        with self.assertRaises(UserError):
            self.app.write_project_draft("quality.md","Overwrite",approved=True)
        with self.assertRaises(UserError):
            self.app.write_project_draft("quality.md","Overwrite",approved=False,replace=True)
        self.app.write_project_draft("quality.md","Second version",approved=True,replace=True)
        self.assertEqual(App(self.root).read_project_draft("quality.md")["content"],"Second version")
        self.app.create_project("Different Project")
        self.assertEqual(self.app.list_project_drafts()["files"],[])

    def test_no_arbitrary_os_path_symlinks_extension_or_oversize(self):
        bad=["../x.py","C:\\Windows\\boot.ini","/etc/passwd",".hidden","file.exe","hello/notes.md","a"*100+".md"]
        for name in bad:
            with self.subTest(name=name):
                with self.assertRaises(UserError):
                    self.app.write_project_draft(name,"safe",approved=True)
        with self.assertRaises(UserError):
            self.app.write_project_draft("allowed.py","X"*120000,approved=True)
        with self.assertRaises(UserError):
            self.app.read_project_draft("unknown.md")
        directory=self.root/"projects"/"general"/"drafts"
        directory.parent.mkdir(parents=True,exist_ok=True)
        directory.write_text("not a directory",encoding="utf8")
        with self.assertRaises(UserError):
            self.app.write_project_draft("file.md","text",approved=True)

    def test_drafts_in_checked_backup_and_clean_restore(self):
        self.app.write_project_draft("prototype.py","print('draft only')",approved=True)
        with tempfile.TemporaryDirectory() as outside:
            target=Path(outside)/"archive.zip"
            result=export_backup(self.root,target)
            self.assertGreater(result["files"],0)
            restored=Path(outside)/"restored"
            restore_backup(target,restored)
            self.assertEqual((restored/"projects"/"general"/"drafts"/"prototype.py").read_text(),"print('draft only')")
