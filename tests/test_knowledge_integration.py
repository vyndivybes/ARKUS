"""Integration: project document grounding, offline fallback and cost defaults."""
import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from server import App, UserError

class KnowledgeAppTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.cfg=patch.dict(os.environ,{"ARKUS_CONFIG":str(Path(self.tmp.name)/"missing.json")})
  self.cfg.start()
  self.app=App(self.tmp.name)
 def tearDown(self):
  self.cfg.stop()
  self.tmp.cleanup()
 def test_documents_in_chat_and_isolated_across_projects(self):
  result=self.app.knowledge_import("composites.md",base64.b64encode(b"vayulocalmaterial 0.224 mm cured ply test requirement").decode())
  self.assertEqual(result["chunks"],1)
  answer=self.app.chat("vayulocalmaterial")
  self.assertEqual(answer["kind"],"documents")
  self.assertEqual(answer["document_sources"][0]["title"],"composites.md")
  self.app.create_project("Other")
  self.assertEqual(self.app.chat("vayulocalmaterial")["kind"],"uncovered")
  self.app.switch_project("general")
  self.assertEqual(App(self.tmp.name).chat("vayulocalmaterial")["kind"],"documents")
 def test_web_search_and_mcp_are_off_by_default(self):
  with self.assertRaises(UserError):self.app.web_search("latest materials")
  self.assertEqual(self.app.mcp_servers()["servers"],[])
  self.assertEqual(self.app.knowledge_search("nothing")["sources"],[])
 def test_names_with_same_contents_get_distinct_document_ids(self):
  data=base64.b64encode(b"uniquetestcarbon document text").decode()
  a=self.app.knowledge_import("one.txt",data)
  b=self.app.knowledge_import("two.txt",data)
  self.assertNotEqual(a["id"],b["id"])
  self.assertEqual(len(self.app.knowledge_list()["documents"]),2)
