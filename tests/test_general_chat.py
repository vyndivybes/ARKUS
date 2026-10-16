"""General conversation and opted-in fresh web question contracts."""
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import App, UserError

class GeneralChatTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.path=Path(self.tmp.name)
        self.env=patch.dict(os.environ,{"ARKUS_CONFIG":str(self.path/"config-not-present.json")})
        self.env.start()
        self.app=App(self.path)

    def tearDown(self):
        self.env.stop()
        self.tmp.cleanup()

    def activate_provider_for_mock(self):
        self.app.provider="gemini"
        self.app.model="gemini-2.5-flash"
        self.app.verified.add(self.app.model)

    def test_uncovered_question_uses_configured_model_not_false_local_gap(self):
        self.activate_provider_for_mock()
        with patch.object(self.app,"completion",return_value="Rayleigh scattering makes the sky blue.") as completion:
            result=self.app.chat("Why is the sky blue on Earth?")
        self.assertEqual(result["kind"],"general")
        self.assertEqual(result["nodes"],[])
        self.assertIn("Rayleigh scattering",result["answer"])
        self.assertEqual(completion.call_count,1)
        self.assertIn("sky blue",App(self.path).projects.read_history()[-2]["content"])

    def test_offline_uncovered_question_never_claims_general_ai(self):
        with patch.object(self.app,"completion") as completion:
            result=self.app.chat("Why is the sky blue on Earth?")
        self.assertEqual(result["kind"],"uncovered")
        completion.assert_not_called()

    def test_live_current_web_search_requires_prior_config_and_cost_optin(self):
        self.activate_provider_for_mock()
        self.app.config.update(enable_google_search=True,allow_paid_models=True)
        evidence={"answer":"The source reports a release today.","sources":[{"url":"https://example.org/source","title":"Official source"}],"kind":"web","grounded":True}
        with patch.object(self.app,"web_search",return_value=evidence) as web,patch.object(self.app,"completion") as completion:
            result=self.app.chat("Search the web for the latest release news")
        self.assertEqual(result["kind"],"web")
        self.assertEqual(result["sources"][0]["url"],"https://example.org/source")
        web.assert_called_once()
        completion.assert_not_called()

    def test_general_ai_cannot_fabricate_web_grounding_when_disallowed(self):
        self.activate_provider_for_mock()
        self.app.config.update(enable_google_search=False,allow_paid_models=False)
        with patch.object(self.app,"web_search") as web,patch.object(self.app,"completion",return_value="I cannot verify current public developments.") as completion:
            result=self.app.chat("Search the web for the latest release news")
        self.assertEqual(result["kind"],"general")
        self.assertFalse(result.get("sources"))
        web.assert_not_called()
        self.assertTrue(completion.called)

    def test_failed_grounded_search_does_not_emit_fabricated_sources(self):
        self.activate_provider_for_mock()
        self.app.config.update(enable_google_search=True,allow_paid_models=True)
        with patch.object(self.app,"web_search",side_effect=UserError("Provider failed",502)):
            with self.assertRaisesRegex(UserError,"Provider failed"):
                self.app.chat("Look up online the latest release")
