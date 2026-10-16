import json,unittest
from unittest.mock import patch
from mcp_gateway import MCPGateway, MCPError

class MCPTests(unittest.TestCase):
 def setUp(self):
  self.gateway=MCPGateway([{"name":"local","url":"http://127.0.0.1:7800/mcp","enabled":True,"allow_tools":["search_notes"]}])
 def test_refuse_remote_and_non_loopback_or_credentials(self):
  for url in ["https://example.com/mcp","http://192.168.1.10:7800/mcp","http://127.0.0.1:80/mcp","http://admin@127.0.0.1:7800/mcp","file:///etc/passwd"]:
   with self.assertRaises(MCPError):MCPGateway([{"name":"x","url":url,"enabled":True}])
 def test_modern_protocol_tools_list(self):
  response={"jsonrpc":"2.0","id":1,"result":{"tools":[{"name":"search_notes","description":"Local search","inputSchema":{"type":"object"},"annotations":{"readOnlyHint":True}},{"name":"delete","annotations":{"readOnlyHint":False}}]}}
  with patch("mcp_gateway.urllib.request.urlopen") as request:
   request.return_value.__enter__.return_value.read.return_value=json.dumps(response).encode()
   tools=self.gateway.discover("local")
   self.assertEqual([x["name"] for x in tools],["search_notes"])
   headers=request.call_args.args[0].headers
   self.assertEqual(headers["Mcp-method"],"tools/list")
 def test_call_requires_explicit_approval_and_read_only_allowlist(self):
  with self.assertRaises(MCPError):self.gateway.call("local","search_notes",{},approved=False)
  with self.assertRaises(MCPError):self.gateway.call("local","delete",{},approved=True)
  with patch.object(self.gateway,"discover",return_value=[{"name":"search_notes","annotations":{"readOnlyHint":True}}]):
   with patch("mcp_gateway.urllib.request.urlopen") as request:
    request.return_value.__enter__.return_value.read.return_value=json.dumps({"jsonrpc":"2.0","id":1,"result":{"content":[{"type":"text","text":"found"}]}}).encode()
    result=self.gateway.call("local","search_notes",{"q":"test"},approved=True)
    self.assertEqual(result["content"][0]["text"],"found")
