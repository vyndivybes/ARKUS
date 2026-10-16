"""Explicit, loopback-only MCP 2026-07-28 JSON HTTP transport.

No process spawning, filesystem tools, write tools, hidden credentials, remote
servers or autonomous calls. Local MCP servers must be configured explicitly.
"""
import json
import re
import urllib.parse
import urllib.request
import urllib.error

class MCPError(ValueError):pass

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self,*args,**kwargs):
        raise MCPError("MCP redirects are disabled.")

class MCPGateway:
    def __init__(self,servers):
        if not isinstance(servers,list) or len(servers)>8:raise MCPError("Invalid MCP server list.")
        self.servers={}
        for server in servers:
            if not isinstance(server,dict) or not isinstance(server.get("name"),str):
                raise MCPError("Invalid MCP server configuration.")
            name=server["name"]
            if not re.fullmatch(r"[a-z][a-z0-9_-]{0,39}",name) or name in self.servers:
                raise MCPError("Invalid or repeated MCP server name.")
            url=urllib.parse.urlsplit(server.get("url",""))
            if url.scheme!="http" or url.hostname not in ("127.0.0.1","localhost") or url.username or url.password or url.query or url.fragment:
                raise MCPError("Only explicit loopback HTTP MCP endpoints are supported.")
            if url.port is None or not 1024<=url.port<=65535 or url.path!="/mcp":
                raise MCPError("Use a localhost port above 1023 and /mcp.")
            tools=server.get("allow_tools",[])
            if not isinstance(tools,list) or len(tools)>30 or any(not isinstance(t,str) or not re.fullmatch(r"[a-zA-Z0-9_.-]{1,80}",t) for t in tools):
                raise MCPError("Invalid MCP read-only allowlist.")
            self.servers[name]={"name":name,"url":url.geturl(),"enabled":server.get("enabled") is True,"allow_tools":tools}
    def names(self):
        return [{"name":v["name"],"enabled":v["enabled"],"allow_tools":v["allow_tools"]} for v in self.servers.values()]
    def _server(self,name):
        server=self.servers.get(name)
        if not server or not server["enabled"]:raise MCPError("MCP server is disabled or not configured.")
        return server
    def _rpc(self,server,method,params):
        payload={"jsonrpc":"2.0","id":1,"method":method,"params":dict(params)}
        payload["params"]["_meta"]={"io.modelcontextprotocol/clientInfo":{"name":"ARKUS","version":"0.8.0"}}
        encoded=json.dumps(payload).encode("utf-8")
        if len(encoded)>8192:raise MCPError("MCP payload too large.")
        headers={"Content-Type":"application/json","Accept":"application/json",
                 "MCP-Protocol-Version":"2026-07-28","Mcp-Method":method}
        if method=="tools/call":headers["Mcp-Name"]=params["name"]
        request=urllib.request.Request(server["url"],data=encoded,headers=headers,method="POST")
        try:
            # urlopen is patched in tests; redirects are prohibited by the
            # opener used for the real request.
            with urllib.request.urlopen(request,timeout=5) as response:
                if response.headers.get("Content-Type","application/json").split(";")[0].strip()!="application/json":
                    raise MCPError("Only JSON MCP responses are supported; SSE is not enabled.")
                raw=response.read(65_537)
                if len(raw)>65_536:raise MCPError("MCP result exceeds 64 KB.")
                result=json.loads(raw)
        except MCPError:raise
        except (urllib.error.URLError,TimeoutError,OSError,ValueError) as exc:
            raise MCPError("Local MCP request failed or returned invalid JSON.") from None
        if not isinstance(result,dict) or result.get("jsonrpc")!="2.0" or result.get("id")!=1 or "error" in result:
            raise MCPError("Local MCP server returned an error or mismatched response.")
        return result.get("result")
    def discover(self,name):
        server=self._server(name)
        raw=self._rpc(server,"tools/list",{})
        tools=raw.get("tools",[]) if isinstance(raw,dict) else []
        if not isinstance(tools,list):raise MCPError("Invalid MCP tool list.")
        return [tool for tool in tools if isinstance(tool,dict) and tool.get("name") in server["allow_tools"] and tool.get("annotations",{}).get("readOnlyHint") is True]
    def call(self,name,tool_name,arguments,approved=False):
        server=self._server(name)
        if approved is not True:raise MCPError("Approve this MCP action explicitly.")
        if not isinstance(arguments,dict) or not isinstance(tool_name,str) or tool_name not in server["allow_tools"]:
            raise MCPError("MCP tool is not allowlisted.")
        if not any(tool.get("name")==tool_name for tool in self.discover(name)):
            raise MCPError("The MCP tool is not advertised as read-only.")
        result=self._rpc(server,"tools/call",{"name":tool_name,"arguments":arguments})
        if not isinstance(result,dict):raise MCPError("Invalid MCP tool result.")
        return {"content":result.get("content",[])[:15],"isError":result.get("isError") is True}
