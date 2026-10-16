"""Opt-in local smart-home contract tests (fake adapter; no LAN traffic)."""
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from smart_home import SmartHomeGateway, SmartHomeError, normalize_lan_host

class FakeAdapter:
    def __init__(self):
        self.calls=[]
        self.fingerprint="AA:BB:CC:DD:EE:FF"
        self.state=False
    def probe(self,host):
        self.calls.append(("probe",host))
        return {"host":host,"model":"Test Bulb","alias":"Study Light",
                "mac":self.fingerprint,"type":"Bulb","is_on":self.state}
    def switch(self,host,state,expected_mac):
        self.calls.append(("switch",host,state,expected_mac))
        if self.fingerprint!=expected_mac:raise SmartHomeError("Device identity changed.")
        self.state=state
        return self.probe(host)

class SmartHomeTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.adapter=FakeAdapter()
        self.gateway=SmartHomeGateway(Path(self.tmp.name),adapter=self.adapter)
    def test_no_scans_or_external_addresses(self):
        for host in ["127.0.0.1","169.254.10.5","0.0.0.0","192.0.2.8",
                     "8.8.8.8","localhost","10.0.0.0","192.168.1.255",
                     "10.1.1.2:80","http://192.168.1.5","::1","172.32.0.2"]:
            with self.subTest(host=host):
                with self.assertRaises(SmartHomeError):
                    self.gateway.discover("general",host,approved=True)
        self.assertFalse(self.adapter.calls)
        self.assertEqual(normalize_lan_host("192.168.1.20"),"192.168.1.20")
        self.assertEqual(normalize_lan_host("172.16.2.30"),"172.16.2.30")
    def test_discovery_is_optin_readonly_and_pair_is_separate(self):
        with self.assertRaises(SmartHomeError):
            self.gateway.discover("general","192.168.1.20",approved=False)
        self.assertFalse(self.adapter.calls)
        candidate=self.gateway.discover("general","192.168.1.20",approved=True)
        self.assertEqual(candidate["status"],"candidate")
        self.assertNotIn("password",json.dumps(candidate))
        self.assertFalse(self.adapter.state)
        self.assertEqual(self.gateway.devices("general"),[])
        with self.assertRaises(SmartHomeError):
            self.gateway.pair("general",candidate["id"],approved=False)
        paired=self.gateway.pair("general",candidate["id"],approved=True)
        self.assertEqual(paired["mac"],"AA:BB:CC:DD:EE:FF")
        self.assertEqual(len(SmartHomeGateway(Path(self.tmp.name),adapter=self.adapter).devices("general")),1)
        self.assertTrue(all(call[0]=="probe" for call in self.adapter.calls))
    def test_explicit_exact_approval_one_use_ttl_and_audit(self):
        candidate=self.gateway.discover("general","10.1.2.3",approved=True)
        device=self.gateway.pair("general",candidate["id"],approved=True)
        proposal=self.gateway.propose("general",device["id"],"on")
        self.assertFalse(self.adapter.state)
        for value in (None,"approved",proposal["confirmation"].lower()):
            with self.assertRaises(SmartHomeError):
                self.gateway.execute("general",proposal["id"],value)
        self.assertFalse(self.adapter.state)
        result=self.gateway.execute("general",proposal["id"],proposal["confirmation"])
        self.assertTrue(self.adapter.state)
        self.assertEqual(result["status"],"complete")
        with self.assertRaises(SmartHomeError):
            self.gateway.execute("general",proposal["id"],proposal["confirmation"])
        self.assertEqual(self.gateway.audit("general")[-1]["status"],"complete")
        again=self.gateway.propose("general",device["id"],"off")
        with patch("smart_home.time.monotonic",return_value=10**15):
            with self.assertRaisesRegex(SmartHomeError,"expired"):
                self.gateway.execute("general",again["id"],again["confirmation"])
        self.assertTrue(self.adapter.state)
    def test_project_isolation_and_identity_change_fail_closed(self):
        candidate=self.gateway.discover("general","192.168.1.20",approved=True)
        device=self.gateway.pair("general",candidate["id"],approved=True)
        plan=self.gateway.propose("general",device["id"],"on")
        self.assertEqual(self.gateway.devices("other"),[])
        with self.assertRaises(SmartHomeError):
            self.gateway.execute("other",plan["id"],plan["confirmation"])
        with self.assertRaises(SmartHomeError):
            self.gateway.pair("other",candidate["id"],approved=True)
        self.adapter.fingerprint="11:22:33:44:55:66"
        with self.assertRaisesRegex(SmartHomeError,"identity"):
            self.gateway.execute("general",plan["id"],plan["confirmation"])
        self.assertFalse(self.adapter.state)
        self.assertEqual(self.gateway.audit("general")[-1]["status"],"failed")
    def test_unknown_actions_refused_and_no_autonomous_tool_path(self):
        candidate=self.gateway.discover("general","192.168.1.20",approved=True)
        device=self.gateway.pair("general",candidate["id"],approved=True)
        for change in ["unlock","reboot","set temperature",True,{}]:
            with self.subTest(change=change):
                with self.assertRaises(SmartHomeError):
                    self.gateway.propose("general",device["id"],change)
        self.gateway.unpair("general",device["id"],approved=True)
        self.assertEqual(self.gateway.devices("general"),[])
    def test_bad_storage_symlink_refused(self):
        root=Path(self.tmp.name)
        file=root/"smart-home-devices.json"
        try:
            file.symlink_to(root/"other.json")
        except OSError:
            self.skipTest("Windows symlink creation needs developer permission.")
        with self.assertRaises(SmartHomeError):
            SmartHomeGateway(root,adapter=self.adapter)

if __name__=="__main__":
    unittest.main()
