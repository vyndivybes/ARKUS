"""Hybrid ARKUS: local Ollama chat alongside independent Gemini Live/search/vision."""
import base64
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import App, UserError


class DualProviderTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.root = Path(self.tmp.name)
        self.config_path = self.root / "config.json"
        self.config = {
            "provider": "ollama",
            "model": "llama3.2",
            "api_key": "",
            "gemini_api_key": "secondary-local-test-key",
            "gemini_model": "gemini-2.5-flash",
            "enable_google_search": True,
            "enable_gemini_live": True,
            "live_model": "gemini-2.5-flash-native-audio-preview",
            "vision_provider": "gemini",
            "allow_paid_models": True,
            "mcp_servers": []
        }
        self.config_path.write_text(json.dumps(self.config), encoding="utf-8")
        self.env = patch.dict(os.environ, {"ARKUS_CONFIG": str(self.config_path)})
        self.env.start()
        self.app = App(self.root)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_primary_model_remains_ollama_while_gemini_search_works(self):
        expected = {"answer": "A source-backed answer", "kind": "web", "sources": []}
        with patch("server.GeminiAdapter") as adapter:
            adapter.return_value.grounded.return_value = expected
            result = self.app.chat("Search the web for the latest release")
        self.assertEqual(result, expected)
        adapter.assert_called_once_with("secondary-local-test-key")
        adapter.return_value.grounded.assert_called_once_with(
            "gemini-2.5-flash", "Search the web for the latest release"
        )
        self.assertEqual(self.app.provider, "ollama")
        self.assertEqual(self.app.model, "llama3.2")

    def test_live_uses_secondary_gemini_key_and_status_never_leaks_it(self):
        with patch("server.LiveTokenIssuer") as issuer:
            issuer.return_value.create.return_value = {
                "token": "ephemeral-test-only", "model": self.config["live_model"]
            }
            payload = self.app.live_token()
        issuer.assert_called_once_with("secondary-local-test-key")
        self.assertEqual(payload["token"], "ephemeral-test-only")
        status = self.app.status()
        self.assertTrue(status["live_available"])
        self.assertTrue(status["capabilities"]["vision"])
        self.assertNotIn("secondary-local-test-key", json.dumps(status))

    def test_camera_uses_gemini_without_ollama_image_tool(self):
        jpeg = "data:image/jpeg;base64," + base64.b64encode(
            b"\xff\xd8\xffdemo-frame\xff\xd9"
        ).decode("ascii")
        with patch("server.GeminiAdapter") as adapter:
            adapter.return_value.describe_image.return_value = "A tabletop."
            result = self.app.see({
                "source": "camera", "consent": True, "image": jpeg,
                "question": "What do you see?"
            })
        adapter.assert_called_once_with("secondary-local-test-key")
        self.assertEqual(result["answer"], "A tabletop.")
        adapter.return_value.describe_image.assert_called_once()

    def test_secondary_provider_can_use_environment_secret(self):
        with patch.dict(os.environ, {"ARKUS_GEMINI_API_KEY": "environment-key"}):
            with patch("server.GeminiAdapter") as adapter:
                adapter.return_value.grounded.return_value = {
                    "answer": "ready", "kind": "web", "sources": []
                }
                self.app.web_search("Latest weather report")
            adapter.assert_called_once_with("environment-key")

    def test_cloud_search_requires_cost_opt_in_and_gemini_configuration(self):
        self.app.config["allow_paid_models"] = False
        with patch("server.GeminiAdapter") as adapter:
            with self.assertRaises(UserError):
                self.app.web_search("Latest weather report")
            adapter.assert_not_called()
        self.app.config["allow_paid_models"] = True
        self.app.config["gemini_api_key"] = ""
        with patch.dict(os.environ, {"ARKUS_GEMINI_API_KEY": ""}):
            with self.assertRaises(UserError):
                self.app.web_search("Latest weather report")

    def test_default_ollama_without_gemini_keeps_existing_behavior(self):
        self.app.config["gemini_api_key"] = ""
        with patch.dict(os.environ, {"ARKUS_GEMINI_API_KEY": ""}):
            self.assertFalse(self.app.status()["live_available"])
            with self.assertRaises(UserError):
                self.app.web_search("Latest weather report")


if __name__ == "__main__":
    unittest.main()
