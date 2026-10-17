"""Google Gemini adapter contract without live credentials or billable calls."""
import unittest
from unittest.mock import patch
import json
from gemini_adapter import GeminiAdapter, GeminiError

class GeminiAdapterTests(unittest.TestCase):
    def test_conversion_preserves_roles_and_system_instruction(self):
        a=GeminiAdapter("private-local-test")
        body=a.format_request([
            {"role":"system","content":"Return JSON"},
            {"role":"user","content":"Rectangle area"},
            {"role":"assistant","content":"What dimensions?"},
            {"role":"user","content":"2 by 3"},
        ])
        self.assertEqual(body["systemInstruction"]["parts"][0]["text"],"Return JSON")
        self.assertEqual([x["role"] for x in body["contents"]],["user","model","user"])
        self.assertEqual(body["generationConfig"]["temperature"],0.2)
    def test_secret_is_header_not_url(self):
        a=GeminiAdapter("private-local-test")
        with patch("gemini_adapter.urllib.request.urlopen") as send:
            response=send.return_value.__enter__.return_value
            response.read.return_value=json.dumps({"candidates":[{"content":{"parts":[{"text":"ready"}]}}]}).encode()
            result=a.complete("gemini-2.5-flash",[{"role":"user","content":"hello"}])
            req=send.call_args.args[0]
            self.assertEqual(req.headers["X-goog-api-key"],"private-local-test")
            self.assertNotIn("private-local-test",req.full_url)
            self.assertEqual(result,"ready")
    def test_models_are_allowlisted_and_untrusted_invalid_responses_fail(self):
        a=GeminiAdapter("abc")
        with self.assertRaises(GeminiError):
            a.complete("../secrets",[{"role":"user","content":"hello"}])
        with self.assertRaises(GeminiError):
            a.format_request([{"role":"system","content":"x"},{"role":"tool","content":"execute"}])
        with patch("gemini_adapter.urllib.request.urlopen") as send:
            send.return_value.__enter__.return_value.read.return_value=b'{"candidates":[]}'
            with self.assertRaises(GeminiError):
                a.complete("gemini-2.5-flash",[{"role":"user","content":"hello"}])
    def test_quota_and_permission_errors_have_actionable_safe_messages(self):
        from urllib.error import HTTPError
        import io
        adapter=GeminiAdapter("private-local-test")
        for status, expected in ((429,"quota or rate limit"),(403,"permission"),(404,"model or endpoint")):
            with self.subTest(status=status):
                error=HTTPError("https://generativelanguage.googleapis.com/v1beta/models",status,"error",{},io.BytesIO(b"private-error-body"))
                with patch("gemini_adapter.urllib.request.urlopen",side_effect=error):
                    with self.assertRaises(GeminiError) as raised:
                        adapter.models()
                self.assertIn(expected,str(raised.exception))
                self.assertNotIn("private-error-body",str(raised.exception))

    def test_model_list_filters_non_generation_models(self):
        a=GeminiAdapter("abc")
        with patch("gemini_adapter.urllib.request.urlopen") as send:
            send.return_value.__enter__.return_value.read.return_value=json.dumps({"models":[
                {"name":"models/gemini-2.5-flash","supportedGenerationMethods":["generateContent"]},
                {"name":"models/text-embedding-004","supportedGenerationMethods":["embedContent"]}]}).encode()
            result=a.models()
            self.assertEqual(result,["gemini-2.5-flash"])
