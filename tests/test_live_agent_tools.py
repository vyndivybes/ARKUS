"""Stage 5: owner-configured Gemini Live public Search and local read-only MCP."""
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from server import App, UserError
from gemini_adapter import GeminiError


class LiveAgentToolTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.config_path = self.root / "config.json"
        self.config_path.write_text(json.dumps({
            "provider": "gemini", "model": "gemini-2.5-flash",
            "api_key": "test-not-real", "allow_paid_models": True,
            "enable_google_search": True, "enable_live_web_search": False,
            "enable_live_mcp_readonly": False,
            "mcp_servers": [{
                "name": "notes", "url": "http://127.0.0.1:7800/mcp",
                "enabled": True, "allow_tools": ["search_notes"]
            }]
        }), encoding="utf-8")
        self.env = patch.dict(os.environ, {"ARKUS_CONFIG": str(self.config_path)})
        self.env.start()
        self.app = App(self.root)
        self.readonly_tool = {
            "name": "search_notes", "description": "Search locally",
            "annotations": {"readOnlyHint": True},
            "inputSchema": {"type": "object", "properties": {"query": {"type": "string"}}}
        }

    def tearDown(self):
        self.env.stop()
        self.temp.cleanup()

    def test_live_search_denied_until_owner_enables_persistent_permission(self):
        with patch.object(self.app, "web_search") as search:
            with self.assertRaises(UserError):
                self.app.live_tool("search_web", {"query": "Current spacecraft updates"})
            search.assert_not_called()

    def test_live_public_search_runs_without_model_supplied_approval(self):
        self.app.config["enable_live_web_search"] = True
        expected = {"answer": "Grounded report", "sources": [], "kind": "web"}
        with patch.object(self.app, "web_search", return_value=expected) as search:
            result = self.app.live_tool("search_web", {"query": " Current spacecraft updates "})
        self.assertEqual(result, expected)
        search.assert_called_once_with("Current spacecraft updates")
        for payload in ({}, {"query": "a"}, {"query": "x", "approved": True},
                        {"query": "a"*501}):
            with self.assertRaises(UserError):
                self.app.live_tool("search_web", payload)

    def test_live_token_tells_voice_client_which_search_tools_are_owner_enabled(self):
        self.app.config["enable_gemini_live"] = True
        self.app.config["enable_live_web_search"] = True
        self.app.config["enable_live_mcp_readonly"] = True
        with patch("server.LiveTokenIssuer.create", return_value={"token": "fake-test-token", "model": "gemini-2.5-flash"}):
            result = self.app.live_token()
        self.assertEqual(result["live_capabilities"], {"web_search": True, "native_google_search": False, "mcp_readonly": True})
        self.app.config["enable_google_search"] = False
        self.app._last_live_token_at = 0
        with patch("server.LiveTokenIssuer.create", return_value={"token": "fake-test-token", "model": "gemini-2.5-flash"}):
            result = self.app.live_token()
        self.assertFalse(result["live_capabilities"]["web_search"])

    def test_native_live_search_capability_uses_live_model_not_flash_model(self):
        self.app.config["enable_gemini_live"] = True
        self.app.config["enable_live_web_search"] = True
        self.app.config["enable_google_search"] = True
        self.app.config["live_model"] = "gemini-3.8-live"
        with patch("server.LiveTokenIssuer.create", return_value={"token": "fake-test-token", "model": "gemini-3.8-live"}):
            result = self.app.live_token()
        self.assertTrue(result["live_capabilities"]["native_google_search"])
        self.assertFalse(result["live_capabilities"]["web_search"])
        self.app.config["enable_live_web_search"] = False
        self.app._last_live_token_at = 0
        with patch("server.LiveTokenIssuer.create", return_value={"token": "fake-test-token", "model": "gemini-3.8-live"}):
            result = self.app.live_token()
        self.assertFalse(result["live_capabilities"]["native_google_search"])
        self.assertFalse(result["live_capabilities"]["web_search"])

    def test_quota_error_from_standard_search_is_http_429_not_502(self):
        with patch("server.GeminiAdapter.grounded",side_effect=GeminiError(
                "Gemini API quota or rate limit exceeded (HTTP 429).")):
            with self.assertRaises(UserError) as exc:
                self.app.web_search("Recent aviation news")
        self.assertEqual(exc.exception.status,429)
        self.assertIn("HTTP 429",str(exc.exception))

    def test_mcp_catalog_denied_by_default(self):
        with patch.object(self.app.mcp, "discover") as discover:
            with self.assertRaises(UserError):
                self.app.live_tool("list_mcp_tools", {})
            discover.assert_not_called()

    def test_live_mcp_discovery_filters_unapproved_servers_and_tools(self):
        self.app.config["enable_live_mcp_readonly"] = True
        self.app.mcp.servers["other"] = {
            "name": "other", "url": "http://127.0.0.1:7900/mcp",
            "enabled": False, "allow_tools": ["read_other"]}
        with patch.object(self.app.mcp, "discover", return_value=[
            self.readonly_tool, {"name": "delete", "annotations": {"readOnlyHint": False}}
        ]) as discover:
            result = self.app.live_tool("list_mcp_tools", {})
        self.assertEqual(result["servers"][0]["name"], "notes")
        self.assertEqual([t["name"] for t in result["servers"][0]["tools"]], ["search_notes"])
        self.assertEqual(len(result["servers"]), 1)
        discover.assert_called_once_with("notes")

    def test_live_mcp_readonly_call_needs_config_and_existing_allowlisted_tool(self):
        args = {"server": "notes", "tool": "search_notes",
                "arguments_json": '{"query":"report"}'}
        with patch.object(self.app.mcp, "call") as call:
            with self.assertRaises(UserError):
                self.app.live_tool("run_mcp_readonly", args)
            call.assert_not_called()
        self.app.config["enable_live_mcp_readonly"] = True
        with patch.object(self.app.mcp, "call", return_value={
            "content": [{"type": "text", "text": "local evidence"}],
            "isError": False}) as call:
            result = self.app.live_tool("run_mcp_readonly", args)
        self.assertEqual(result["content"][0]["text"], "local evidence")
        call.assert_called_once_with("notes", "search_notes",
                                     {"query": "report"}, approved=True)

    def test_voice_mcp_rejects_shell_unknown_tools_and_malformed_arguments(self):
        self.app.config["enable_live_mcp_readonly"] = True
        invalid = [
            {"server": "notes", "tool": "run_shell", "arguments_json": "{}"},
            {"server": "unknown", "tool": "search_notes", "arguments_json": "{}"},
            {"server": "notes", "tool": "search_notes", "arguments_json": "[]"},
            {"server": "notes", "tool": "search_notes", "arguments_json": "not json"},
            {"server": "notes", "tool": "search_notes", "arguments_json": "{}",
             "approved": True}
        ]
        with patch.object(self.app.mcp, "call") as call:
            for entry in invalid:
                with self.subTest(entry=entry):
                    with self.assertRaises(UserError):
                        self.app.live_tool("run_mcp_readonly", entry)
            call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
