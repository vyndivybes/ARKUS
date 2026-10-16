"""Regression contracts for Gemini Live's narrowly scoped local tool gateway."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import App, UserError


class LiveToolTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.env = patch.dict(os.environ, {"ARKUS_CONFIG": str(self.root / "missing-config.json")})
        self.env.start()
        self.app = App(self.root)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_read_briefing_and_project_scoped_search_without_cloud(self):
        briefing = self.app.live_tool("get_briefing", {})
        self.assertIn("indexed notes", briefing["answer"])
        found = self.app.live_tool("search_knowledge", {"query": "payment terms"})
        self.assertTrue(found["sources"])
        self.assertTrue(all("title" in n and "excerpt" in n for n in found["sources"]))
        self.assertNotIn("api_key", str(found))

    def test_remember_and_reminder_persist_without_automatic_external_actions(self):
        saved = self.app.live_tool("remember_note", {"text": "My project alpha expects cobalt-blue sample"})
        self.assertIn("Remembered", saved["answer"])
        reminder = self.app.live_tool("set_reminder", {"when": "2030-01-02T15:30", "message": "Review the alpha sample"})
        self.assertTrue(reminder["answer"])
        restarted = App(self.root)
        self.assertIn("cobalt-blue", restarted.chat("cobalt-blue")["answer"])
        self.assertTrue(any("alpha sample" in x["message"] for x in restarted.workflows_state()["reminders"]))

    def test_unknown_and_malicious_calls_fail_closed(self):
        for tool, arguments in [
            ("run_shell", {"command": "whoami"}),
            ("delete_file", {"path": "notes"}),
            ("remember_note", {"text": ""}),
            ("remember_note", {"text": "a", "path": "../../outside.txt"}),
            ("search_knowledge", {"query": ""}),
            ("set_reminder", {"when": "now", "message": "Invalid date"}),
            ("set_reminder", {"when": "2030-01-02T15:30", "message": "A", "url": "https://unknown"}),
            ("get_briefing", {"unsafe": True}),
        ]:
            with self.subTest(tool=tool,arguments=arguments):
                with self.assertRaises(UserError):
                    self.app.live_tool(tool, arguments)

    def test_live_transcript_history_is_persistent_bounded_and_project_scoped(self):
        saved = self.app.record_live_exchange("Where are my notes?", "Inside this project's local workspace.")
        self.assertTrue(saved["ok"])
        history = App(self.root).projects.read_history()
        self.assertEqual(history[-2]["content"], "Where are my notes?")
        self.assertEqual(history[-1]["content"], "Inside this project's local workspace.")
        self.app.create_project("Secret Demo")
        self.assertEqual(self.app.projects.read_history(), [])
        with self.assertRaises(UserError):
            self.app.record_live_exchange("", "No request")
        with self.assertRaises(UserError):
            self.app.record_live_exchange("test", "x"*5000)
        with self.assertRaises(UserError):
            self.app.live_tool("search_knowledge", {"query": "a"*600})

    def test_tool_validation_rejects_non_objects_and_does_not_create_state(self):
        before = len(self.app.graph["nodes"])
        for args in [None, [], "text", {"text": 1}]:
            with self.assertRaises(UserError):
                self.app.live_tool("remember_note", args)
        self.assertEqual(len(self.app.graph["nodes"]), before)
