import tempfile
import unittest
import zipfile
from pathlib import Path
from knowledge_base import KnowledgeBase
from backup import export_backup,restore_backup

class KnowledgeBackupTests(unittest.TestCase):
 def test_project_search_survives_archive_restore(self):
  with tempfile.TemporaryDirectory() as folder:
   root=Path(folder);data=root/"data";data.mkdir()
   (data/"projects.json").write_text('{"version":1}',encoding="utf-8")
   kb=KnowledgeBase(data)
   kb.import_bytes("general","requirements.md",b"Qualified technical knowledge archive sample alpha")
   archive=root/"saved.zip"
   export_backup(data,archive)
   with zipfile.ZipFile(archive) as z:
    self.assertIn("knowledge/general/sources.sqlite3",z.namelist())
   restored=root/"restored";restore_backup(archive,restored)
   hits=KnowledgeBase(restored).search("general","qualified technical")
   self.assertEqual(hits[0]["title"],"requirements.md")
