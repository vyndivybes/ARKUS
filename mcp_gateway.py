"""Explicit, loopback-only MCP 2026-07-28 HTTP transport with bounded JSON and request-scoped SSE.

No process spawning, filesystem tools, write tools, hidden credentials, remote
servers or autonomous calls. Local MCP servers must be configured explicitly.
"""
import json
import base64
import time
import re
import urllib.parse
import urllib.request
import urllib.error

class MCPError(ValueError):pass

PROTOCOL="2026-07-28"


def schema_headers(schema):
    """Validate mirrored parameter declarations, including unreachable annotations."""
    result=[];names=set()
    def walk(node,path=(),reachable=True,depth=0):
        if depth>20:raise MCPError("MCP schema nesting limit exceeded.")
        if isinstance(node,list):
            for child in node:walk(child,path,False,depth+1)
        elif isinstance(node,dict):
            if "x-mcp-header" in node:
                name=node["x-mcp-header"];kind=node.get("type")
                if (not reachable or not path or not isinstance(name,str)
                        or not re.fullmatch(r"[!#$%&'*+.^_`|~0-9A-Za-z-]{1,80}",name)
                        or name.lower() in names or kind not in ("string","integer","boolean")):
                    raise MCPError("Invalid MCP parameter header declaration.")
                names.add(name.lower());result.append((path,name,kind))
                if len(result)>32:raise MCPError("Too many MCP parameter headers.")
            for key,value in node.items():
                if key=="properties" and isinstance(value,dict) and reachable:
                    for prop,child in value.items():walk(child,path+(prop,),True,depth+1)
                elif key!="x-mcp-header":walk(value,path,False,depth+1)
    if not isinstance(schema,dict):raise MCPError("Invalid MCP input schema.")
    walk(schema)
    return result


def parameter_headers(schema,arguments):
    headers={}
    for path,name,kind in schema_headers(schema):
        value=arguments
        for key in path:
            value=value.get(key) if isinstance(value,dict) else None
        if value is None:continue
        if ((kind=="string" and type(value) is not str)
                or (kind=="boolean" and type(value) is not bool)
                or (kind=="integer" and (type(value) is not int or abs(value)>2**53-1))):
            raise MCPError("Invalid mirrored MCP parameter value.")
        text=str(value).lower() if type(value) is bool else str(value)
        if (text!=text.strip() or not re.fullmatch(r"[\x20-\x7e\t]*",text)
                or (text.startswith("=?base64?") and text.endswith("?="))):
            text="=?base64?"+base64.b64encode(text.encode("utf-8")).decode("ascii")+"?="
        headers["Mcp-Param-"+name]=text
    return headers


def read_sse(response):
    total=0;data=[];deadline=time.monotonic()+5
    while total<=65536 and time.monotonic()<deadline:
        line=response.readline(65537-total)
        total+=len(line)
        if total>65536:raise MCPError("MCP SSE response exceeds 64 KB.")
        if not line:break
        line=line.rstrip(b"\r\n")
        if not line:
            if not data:continue
            event=json.loads(b"\n".join(data));data=[]
            if not isinstance(event,dict):raise MCPError("Invalid MCP SSE message.")
            if "id" not in event:continue  # Request-scoped progress notifications.
            if "method" in event:raise MCPError("MCP server-initiated requests are not supported.")
            return event
        if line.startswith(b"data:"):
            field=line[5:];data.append(field[1:] if field.startswith(b" ") else field)
    raise MCPError("MCP SSE ended without a final response or exceeded its deadline.")


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
        if not isinstance(name,str):raise MCPError("Invalid MCP server name.")
        server=self.servers.get(name)
        if not server or not server["enabled"]:raise MCPError("MCP server is disabled or not configured.")
        return server
    def _rpc(self,server,method,params,extra_headers=None):
        payload={"jsonrpc":"2.0","id":1,"method":method,"params":dict(params)}
        payload["params"]["_meta"]={"io.modelcontextprotocol/clientInfo":{"name":"ARKUS","version":"0.8.0"},
            "io.modelcontextprotocol/protocolVersion":PROTOCOL,"io.modelcontextprotocol/clientCapabilities":{}}
        try:encoded=json.dumps(payload,allow_nan=False).encode("utf-8")
        except (ValueError,TypeError):raise MCPError("MCP arguments must be finite JSON data.") from None
        if len(encoded)>8192:raise MCPError("MCP payload too large.")
        headers={"Content-Type":"application/json","Accept":"application/json, text/event-stream",
                 "MCP-Protocol-Version":PROTOCOL,"Mcp-Method":method,**(extra_headers or {})}
        if method=="tools/call":headers["Mcp-Name"]=params["name"]
        request=urllib.request.Request(server["url"],data=encoded,headers=headers,method="POST")
        try:
            # urlopen is patched in tests; redirects are prohibited by the
            # opener used for the real request.
            with urllib.request.build_opener(urllib.request.ProxyHandler({}),NoRedirect()).open(request,timeout=5) as response:
                content_type=response.headers.get("Content-Type","application/json").split(";")[0].strip()
                if content_type=="text/event-stream":result=read_sse(response)
                elif content_type=="application/json":
                    raw=response.read(65_537)
                    if len(raw)>65_536:raise MCPError("MCP result exceeds 64 KB.")
                    result=json.loads(raw)
                else:raise MCPError("MCP response must be JSON or SSE.")
        except MCPError:raise
        except urllib.error.HTTPError as exc:
            code=exc.code;exc.close()
            raise MCPError(f"Local MCP request failed (HTTP {code}). Check the configured protocol and server.") from None
        except (urllib.error.URLError,TimeoutError,OSError,ValueError) as exc:
            raise MCPError("Local MCP request failed or returned invalid JSON.") from None
        if not isinstance(result,dict) or result.get("jsonrpc")!="2.0" or result.get("id")!=1 or "error" in result:
            raise MCPError("Local MCP server returned an error or mismatched response.")
        return result.get("result")
    def discover(self,name):
        server=self._server(name);found={};cursor=None;seen=set()
        for _page in range(8):
            raw=self._rpc(server,"tools/list",{"cursor":cursor} if cursor else {})
            tools=raw.get("tools",[]) if isinstance(raw,dict) else None
            if not isinstance(tools,list):raise MCPError("Invalid MCP tool list.")
            for tool in tools:
                if not isinstance(tool,dict) or tool.get("name") not in server["allow_tools"]:continue
                annotations=tool.get("annotations")
                if not isinstance(annotations,dict) or annotations.get("readOnlyHint") is not True:continue
                try:schema_headers(tool.get("inputSchema",{}))
                except MCPError:continue
                found.setdefault(tool["name"],tool)
            cursor=raw.get("nextCursor")
            if cursor is None:return list(found.values())
            if not isinstance(cursor,str) or not 1<=len(cursor)<=512 or cursor in seen:
                raise MCPError("Invalid or repeated MCP pagination cursor.")
            seen.add(cursor)
        raise MCPError("MCP discovery page limit exceeded.")

    def call(self,name,tool_name,arguments,approved=False):
        server=self._server(name)
        if approved is not True:raise MCPError("Approve this MCP action explicitly.")
        if not isinstance(arguments,dict) or not isinstance(tool_name,str) or tool_name not in server["allow_tools"]:
            raise MCPError("MCP tool is not allowlisted.")
        tool=next((tool for tool in self.discover(name) if tool.get("name")==tool_name),None)
        if tool is None:raise MCPError("The MCP tool is not advertised as read-only.")
        headers=parameter_headers(tool.get("inputSchema",{}),arguments)
        result=self._rpc(server,"tools/call",{"name":tool_name,"arguments":arguments},headers)
        if not isinstance(result,dict) or not isinstance(result.get("content",[]),list):
            raise MCPError("Invalid MCP tool result.")
        if "inputRequests" in result:raise MCPError("Interactive MCP input requests are not supported.")
        return {"content":result.get("content",[])[:15],"isError":result.get("isError") is True}
