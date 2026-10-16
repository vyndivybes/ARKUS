import tempfile
import unittest
from unittest.mock import patch
from server import App, UserError

class NaturalActionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        with patch.dict("os.environ",{"ARKUS_CONFIG":self.temp.name+"/empty-config.json"}):
            self.app=App(self.temp.name)
    def tearDown(self):self.temp.cleanup()
    def test_offline_natural_language_creates_pending_not_executed(self):
        r=self.app.request_action("multiply 8 by 9")
        self.assertEqual(r["status"],"pending")
        self.assertNotIn("result",r)
        self.assertEqual(self.app.approve_action(r["id"],True)["result"],72)
    def test_model_suggestion_never_auto_executes(self):
        self.app.provider="ollama";self.app.model="local";self.app.verified.add("local")
        with patch.object(self.app,"completion",return_value='{"tool":"calculate","arguments":{"operator":"add","a":5,"b":3}}'):
            item=self.app.request_action("calculate something")
        self.assertEqual(item["status"],"pending")
    def test_invalid_tool_never_reaches_executor(self):
        self.app.provider="ollama";self.app.model="local";self.app.verified.add("local")
        with patch.object(self.app,"completion",return_value='{"tool":"shell","arguments":{"cmd":"whoami"}}'):
            with self.assertRaises(UserError):self.app.request_action("run a command")
    def test_missing_model_or_unrecognized_request_fails_closed(self):
        with self.assertRaises(UserError):self.app.request_action("open my browser and buy something")
