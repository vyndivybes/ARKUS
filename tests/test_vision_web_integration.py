"""Regression tests for consented camera analysis and voice-triggered web lookup."""
import base64
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from gemini_adapter import GeminiAdapter, GeminiError
from server import App, UserError


class GeminiVisionWebTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.env = patch.dict(os.environ, {"ARKUS_CONFIG": str(Path(self.tmp.name) / "missing.json")})
        self.env.start()
        self.app = App(Path(self.tmp.name))
        self.app.provider = "gemini"
        self.app.key = "local-test-only"
        self.app.model = "gemini-3.8-flash"
        self.app.verified.add(self.app.model)
        self.app.config.update(allow_paid_models=True, enable_google_search=True)
        self.jpeg = base64.b64encode(b"\xff\xd8\xffexample\xff\xd9").decode("ascii")

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def test_gemini_image_request_contains_actual_inline_jpeg_part(self):
        with patch.object(GeminiAdapter, "_request", return_value={
            "candidates": [{"content": {"parts": [{"text": "I can see a book."}]}}]
        }) as send:
            response = GeminiAdapter("local-test-only").describe_image(
                "gemini-3.8-flash", "Describe only what is visible.", "What is there?", self.jpeg)
        self.assertEqual(response, "I can see a book.")
        payload = send.call_args.args[1]
        self.assertEqual(payload["contents"][0]["parts"][0]["text"], "What is there?")
        self.assertEqual(payload["contents"][0]["parts"][1], {
            "inline_data": {"mime_type": "image/jpeg", "data": self.jpeg}
        })
        self.assertIn("Describe only", payload["systemInstruction"]["parts"][0]["text"])

    def test_photo_from_see_reaches_gemini_image_method(self):
        with patch.object(GeminiAdapter, "describe_image", return_value="The camera shows a desk.") as image:
            result = self.app.see({
                "source": "camera", "consent": True, "question": "Describe this.",
                "image": "data:image/jpeg;base64," + self.jpeg
            })
        self.assertIn("desk", result["answer"])
        self.assertEqual(result["kind"], "vision")
        self.assertEqual(image.call_args.args[3], self.jpeg)

    def test_invalid_jpeg_stays_off_network(self):
        with patch.object(GeminiAdapter, "describe_image") as image:
            for value in ("http://example.net/photo", "data:image/png;base64,AAAA",
                          "data:image/jpeg;base64,AAAA"):
                with self.assertRaises((UserError, GeminiError)):
                    self.app.see({"source": "camera", "consent": True, "question": "Describe.",
                                  "image": value})
            image.assert_not_called()

    def test_web_lookup_from_live_requires_every_request_to_be_approved(self):
        with patch.object(self.app, "web_search", return_value={
            "answer": "Source confirms it.", "sources": [{"url": "https://example.org", "title": "Source"}],
            "kind": "web", "grounded": True
        }) as search:
            for payload in ({"query": "latest release"}, {"query": "latest release", "approved": False},
                            {"query": "latest release", "approved": "yes"}):
                with self.assertRaises(UserError):
                    self.app.live_tool("search_web", payload)
            search.assert_not_called()
            result = self.app.live_tool("search_web", {"query": "latest release", "approved": True})
            self.assertEqual(result["sources"][0]["url"], "https://example.org")
            search.assert_called_once_with("latest release")

    def test_voice_web_lookup_respects_disabled_search_configuration(self):
        self.app.config["enable_google_search"] = False
        with self.assertRaisesRegex(UserError, "disabled"):
            self.app.live_tool("search_web", {"query": "latest release", "approved": True})

    def test_internet_chat_understands_google_request(self):
        with patch.object(self.app, "web_search", return_value={
            "answer": "Source-backed information.", "sources": [], "kind": "web", "grounded": False
        }) as search:
            result = self.app.chat("Can you google the latest ARKUS release?")
            self.assertEqual(result["kind"], "web")
            search.assert_called_once()


if __name__ == "__main__":
    unittest.main()
