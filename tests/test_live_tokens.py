"""Gemini Live scoped token provisioning: no private API keys in browser responses."""
import json
import os
import tempfile
import unittest
from unittest.mock import patch
from urllib.error import HTTPError
from server import App, UserError
from live_tokens import LiveTokenIssuer, LiveTokenError

class LiveTokenTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.config=self.tmp.name+"/config.json"
        with open(self.config,"w") as f:
            json.dump({"provider":"gemini","model":"gemini-2.5-flash",
                       "api_key":"PRIVATE_TEST_KEY_123",
                       "allow_paid_models":True,
                       "enable_gemini_live":True,
                       "live_model":"gemini-3.1-flash-live-preview"},f)
    def tearDown(self):self.tmp.cleanup()
    def app(self):
        with patch.dict(os.environ,{"ARKUS_CONFIG":self.config}):
            return App(self.tmp.name)
    def test_requires_separate_live_optin_and_cost_consent(self):
        app=self.app()
        app.config["enable_gemini_live"]=False
        with self.assertRaisesRegex(UserError,"not enabled"):
            app.live_token()
        app.config["enable_gemini_live"]=True
        app.config["allow_paid_models"]=False
        with self.assertRaisesRegex(UserError,"pricing"):
            app.live_token()
    def test_rejects_other_provider_and_invalid_model(self):
        app=self.app();app.provider="offline"
        with self.assertRaises(UserError):app.live_token()
        app.provider="gemini";app.config["live_model"]="../path"
        with self.assertRaises(UserError):app.live_token()
    def test_uses_scoped_single_use_token_without_returning_real_key(self):
        app=self.app()
        with patch("live_tokens.urllib.request.urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value=b'{"name":"auth_tokens/ephemeral_sample"}'
            result=app.live_token()
            req=request.call_args.args[0]
            body=json.loads(req.data)
            self.assertEqual(req.headers["X-goog-api-key"],"PRIVATE_TEST_KEY_123")
            self.assertEqual(body["uses"],1)
            self.assertEqual(body["liveConnectConstraints"]["model"],"models/gemini-3.1-flash-live-preview")
            self.assertIn("AUDIO",body["liveConnectConstraints"]["config"]["responseModalities"])
            self.assertEqual(result["token"],"auth_tokens/ephemeral_sample")
            self.assertNotIn("PRIVATE_TEST_KEY_123",json.dumps(result))
            self.assertNotIn("PRIVATE_TEST_KEY_123",req.full_url)
    def test_invalid_response_fails_without_key_or_provider_body(self):
        with patch("live_tokens.urllib.request.urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value=b'{}'
            with self.assertRaises(LiveTokenError):
                LiveTokenIssuer("key").create("gemini-3.1-flash-live-preview")
            request.side_effect=HTTPError("https://example.test",403,"UNSAFE_PROVIDER_SECRET",{},None)
            with self.assertRaises(LiveTokenError) as exc:
                LiveTokenIssuer("key").create("gemini-3.1-flash-live-preview")
            self.assertNotIn("UNSAFE_PROVIDER_SECRET",str(exc.exception))
