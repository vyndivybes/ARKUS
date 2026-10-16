import unittest
from unittest.mock import patch
from gemini_adapter import GeminiAdapter, GeminiError

class GroundingTests(unittest.TestCase):
 def test_google_search_tool_and_source_citations(self):
  with patch("gemini_adapter.GeminiAdapter._request") as call:
   call.return_value={"candidates":[{"content":{"parts":[{"text":"Official release is dated 2026."}]},"groundingMetadata":{"groundingChunks":[{"web":{"uri":"https://example.org/release","title":"Release notes"}}]}}]}
   result=GeminiAdapter("private-local").grounded("gemini-2.5-flash","latest release")
   self.assertEqual(call.call_args.args[1]["tools"],[{"googleSearch":{}}])
   self.assertEqual(result["sources"][0]["title"],"Release notes")
   self.assertEqual(result["answer"],"Official release is dated 2026.")
 def test_discard_non_https_references(self):
  with patch("gemini_adapter.GeminiAdapter._request") as call:
   call.return_value={"candidates":[{"content":{"parts":[{"text":"ok"}]},"groundingMetadata":{"groundingChunks":[{"web":{"uri":"file:///secret","title":"Secret"}}]}}]}
   self.assertEqual(GeminiAdapter("private-local").grounded("gemini-2.5-flash","latest")["sources"],[])
