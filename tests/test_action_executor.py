import tempfile
import unittest
from action_executor import ActionExecutor, ActionError

class ExecutionTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.engine=ActionExecutor(self.temp.name)
    def tearDown(self):
        self.temp.cleanup()
    def test_explicit_approval_one_time_execution_and_audit(self):
        request=self.engine.propose("general","calculate",{"operator":"multiply","a":5,"b":7})
        self.assertEqual(request["status"],"pending")
        with self.assertRaises(ActionError):
            self.engine.execute("general",request["id"],approved=False)
        result=self.engine.execute("general",request["id"],approved=True)
        self.assertEqual(result["result"],35)
        with self.assertRaises(ActionError):
            self.engine.execute("general",request["id"],approved=True)
        self.assertEqual(self.engine.history("general")[0]["status"],"complete")
    def test_cross_project_and_unsupported_actions_are_rejected(self):
        request=self.engine.propose("general","calculate",{"operator":"add","a":1,"b":2})
        with self.assertRaises(ActionError):
            self.engine.execute("other",request["id"],approved=True)
        with self.assertRaises(ActionError):
            self.engine.propose("general","shell",{"cmd":"whoami"})
        with self.assertRaises(ActionError):
            self.engine.propose("../other","calculate",{"operator":"add","a":1,"b":2})
    def test_refuse_malformed_args_and_no_permanent_auto_approval(self):
        with self.assertRaises(ActionError):
            self.engine.propose("general","calculate",{"operator":"add","a":float("nan"),"b":2})
        with self.assertRaises(ActionError):
            self.engine.propose("general","calculate",{"operator":"add","a":1,"b":2,"extra":3})
    def test_cancel_cannot_execute_and_restart_retains_audit(self):
        req=self.engine.propose("general","calculate",{"operator":"subtract","a":9,"b":2})
        self.engine.cancel("general",req["id"])
        with self.assertRaises(ActionError):
            self.engine.execute("general",req["id"],approved=True)
        self.assertEqual(ActionExecutor(self.temp.name).history("general")[0]["status"],"cancelled")
