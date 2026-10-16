"""Gemini Live scoped token provisioning: no private API keys in browser responses."""
import json
import io
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
    def test_live_token_http_requires_local_csrf_token(self):
        import threading
        import urllib.request
        import urllib.error
        from server import make_server
        server=make_server(0,self.app())
        thread=threading.Thread(target=server.serve_forever,daemon=True)
        thread.start()
        try:
            url=f"http://127.0.0.1:{server.server_port}/live/token"
            request=urllib.request.Request(url,data=b"{}",headers={"Content-Type":"application/json"})
            with self.assertRaises(urllib.error.HTTPError) as caught:
                urllib.request.urlopen(request,timeout=2)
            self.assertEqual(caught.exception.code,403)
            caught.exception.close()
            request.add_header("X-Arkus-Token",server.app.token)
            with patch("server.LiveTokenIssuer") as issuer:
                issuer.return_value.create.return_value={
                    "token":"auth_tokens/a_limited_example",
                    "model":"gemini-3.1-flash-live-preview",
                    "expires_at":"2026-10-16T02:00:00Z"}
                with urllib.request.urlopen(request,timeout=3) as response:
                    result=json.load(response)
            self.assertEqual(result["token"],"auth_tokens/a_limited_example")
            self.assertNotIn("PRIVATE_TEST_KEY_123",json.dumps(result))
        finally:
            server.shutdown()
            server.server_close()


    def test_live_http_400_reports_safe_structured_reason(self):
        error_body=json.dumps({"error":{"code":400,"status":"INVALID_ARGUMENT",
            "message":"PRIVATE_PROVIDER_MESSAGE_API_KEY_DO_NOT_COPY"}}).encode()
        with patch("live_tokens.urllib.request.urlopen",
                   side_effect=HTTPError("https://generativelanguage.googleapis.com/v1beta/auth_tokens",
                                         400,"PRIVATE_PROVIDER_MESSAGE_API_KEY_DO_NOT_COPY",
                                         {},io.BytesIO(error_body))):
            with self.assertRaises(LiveTokenError) as caught:
                LiveTokenIssuer("PRIVATE_TEST_KEY_123").create("gemini-3.1-flash-live-preview")
        explanation=str(caught.exception)
        self.assertIn("INVALID_ARGUMENT",explanation)
        self.assertIn("Live",explanation)
        self.assertNotIn("PRIVATE_PROVIDER_MESSAGE",explanation)
        self.assertNotIn("PRIVATE_TEST_KEY_123",explanation)

    def test_oauth_client_id_is_not_a_gemini_api_key(self):
        client_id="1234567890-abcdefghijklmnop.apps.googleusercontent.com"
        with self.assertRaisesRegex(LiveTokenError,"OAuth client ID"):
            LiveTokenIssuer(client_id).create("gemini-3.8-live")

    def test_default_live_model_is_supported_current_recommendation(self):
        app=self.app()
        del app.config["live_model"]
        with patch("server.LiveTokenIssuer") as mock:
            mock.return_value.create.return_value={
                "token":"auth_tokens/single_use_sample","model":"gemini-3.8-live",
                "expires_at":"2026-10-16T15:00:00Z"}
            app.live_token()
            mock.return_value.create.assert_called_once_with("gemini-3.8-live")

    def test_invalid_response_fails_without_key_or_provider_body(self):
        with patch("live_tokens.urllib.request.urlopen") as request:
            request.return_value.__enter__.return_value.read.return_value=b'{}'
            with self.assertRaises(LiveTokenError):
                LiveTokenIssuer("key").create("gemini-3.1-flash-live-preview")
            request.side_effect=HTTPError("https://example.test",403,"UNSAFE_PROVIDER_SECRET",{},None)
            with self.assertRaises(LiveTokenError) as exc:
                LiveTokenIssuer("key").create("gemini-3.1-flash-live-preview")
            self.assertNotIn("UNSAFE_PROVIDER_SECRET",str(exc.exception))
