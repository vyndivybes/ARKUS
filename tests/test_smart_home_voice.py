"""Verified voice control: opt-in lights only, exact device names, human approval otherwise."""
import tempfile
import unittest
from pathlib import Path
from smart_home import SmartHomeGateway, SmartHomeError


class FakeAdapter:
    def __init__(self):
        self.kind = "Bulb"
        self.mac = "AA:BB:CC:DD:EE:FF"
        self.state = False
        self.switch_calls = 0

    def probe(self, host):
        return {"host": host, "mac": self.mac, "model": "Test light",
                "alias": "Study Light", "type": self.kind, "is_on": self.state}

    def switch(self, host, state, expected_mac):
        self.switch_calls += 1
        if expected_mac != self.mac:
            raise SmartHomeError("Device identity changed")
        self.state = state
        return self.probe(host)


class VoicePermissionTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.adapter = FakeAdapter()
        self.gateway = SmartHomeGateway(Path(self.tmp.name), adapter=self.adapter)
        candidate = self.gateway.discover("general", "192.168.1.20", approved=True)
        self.device = self.gateway.pair("general", candidate["id"], approved=True)

    def test_default_voice_never_switches_without_typed_approval(self):
        response = self.gateway.voice("general", "Hey ARKUS, turn on Study Light")
        self.assertEqual(response["status"], "approval-required")
        self.assertEqual(self.adapter.switch_calls, 0)
        self.gateway.execute("general", response["id"], response["confirmation"])
        self.assertEqual(self.adapter.switch_calls, 1)
        self.assertTrue(self.adapter.state)

    def test_explicit_enrollment_persists_and_allows_only_trusted_lights(self):
        with self.assertRaises(SmartHomeError):
            self.gateway.set_voice_auto("general", self.device["id"], True)
        self.assertEqual(self.adapter.switch_calls, 0)
        self.gateway.set_voice_auto("general", self.device["id"], True, approved=True)
        persisted = SmartHomeGateway(Path(self.tmp.name), adapter=self.adapter)
        self.assertTrue(persisted.devices("general")[0]["voice_auto"])
        outcome = self.gateway.voice("general", "Hey ARKUS, turn on Study Light")
        self.assertEqual(outcome["status"], "complete")
        self.assertTrue(outcome["is_on"])
        self.assertEqual(self.gateway.audit("general")[-1]["source"], "voice-auto")
        with self.assertRaisesRegex(SmartHomeError, "rate limit"):
            self.gateway.voice("general", "Hey ARKUS, turn off Study Light")
        self.gateway.set_voice_auto("general", self.device["id"], False, approved=True)
        self.assertEqual(self.gateway.voice("general", "Hey ARKUS, turn off Study Light")["status"],
                         "approval-required")

    def test_wake_identity_and_cross_project_fail_closed(self):
        self.gateway.set_voice_auto("general", self.device["id"], True, approved=True)
        for phrase in ("Turn on Study Light", "Hey ARKUS, turn on all lights",
                       "Hey ARKUS, unlock Study Light", "Hey ARKUS, turn on a switch"):
            with self.subTest(phrase=phrase), self.assertRaises(SmartHomeError):
                self.gateway.voice("general", phrase)
        with self.assertRaises(SmartHomeError):
            self.gateway.voice("another", "Hey ARKUS, turn on Study Light")
        self.adapter.mac = "11:22:33:44:55:66"
        with self.assertRaisesRegex(SmartHomeError, "identity"):
            self.gateway.voice("general", "Hey ARKUS, turn on Study Light")
        self.assertEqual(self.adapter.switch_calls, 0)
        self.assertEqual(self.gateway.audit("general")[-1]["status"], "failed")

    def test_plugs_cannot_be_enrolled_for_automatic_voice(self):
        other = tempfile.TemporaryDirectory()
        self.addCleanup(other.cleanup)
        adapter = FakeAdapter()
        adapter.kind = "Plug"
        gateway = SmartHomeGateway(Path(other.name), adapter=adapter)
        candidate = gateway.discover("general", "192.168.1.44", approved=True)
        paired = gateway.pair("general", candidate["id"], approved=True)
        with self.assertRaisesRegex(SmartHomeError, "limited to lights"):
            gateway.set_voice_auto("general", paired["id"], True, approved=True)
        self.assertEqual(adapter.switch_calls, 0)


if __name__ == "__main__":
    unittest.main()
