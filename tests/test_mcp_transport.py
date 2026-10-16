"""Exercise MCP against a real loopback service rather than a patched HTTP client."""
import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler,ThreadingHTTPServer
from mcp_gateway import MCPGateway,MCPError,parameter_headers,schema_headers,read_sse

class MCPTransportTests(unittest.TestCase):
    def setUp(self):
        self.mode='json';self.requests=[]
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def do_POST(self):
                request=json.loads(self.rfile.read(int(self.headers['Content-Length'])))
                owner.requests.append((request,dict(self.headers)))
                meta=request['params'].get('_meta',{})
                good=(meta.get('io.modelcontextprotocol/protocolVersion')=='2026-07-28'
                      and meta.get('io.modelcontextprotocol/clientCapabilities')=={}
                      and 'application/json' in self.headers['Accept'] and 'text/event-stream' in self.headers['Accept'])
                if not good:
                    self.send_response(400);self.end_headers();return
                if request['method']=='tools/list':
                    tools=[{'name':'search','annotations':{'readOnlyHint':True},'inputSchema':{'type':'object','properties':{'query':{'type':'string','x-mcp-header':'Query'}}}}]
                    if owner.mode=='bad_annotations':tools.append({'name':'malformed','annotations':[]})
                    result={'tools':tools}
                else:
                    result={'content':[{'type':'text','text':'matched'}]}
                    if owner.mode=='invalid_content':result={'content':'wrong type'}
                body=json.dumps({'jsonrpc':'2.0','id':request['id'],'result':result}).encode()
                if owner.mode=='sse':body=b': heartbeat\r\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{}}\r\n\r\ndata: '+body+b'\r\n\r\n'
                self.send_response(200);self.send_header('Content-Type','text/event-stream' if owner.mode=='sse' else 'application/json')
                self.send_header('Content-Length',str(len(body)));self.end_headers();self.wfile.write(body)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.gateway=MCPGateway([{'name':'fixture','url':f'http://127.0.0.1:{self.server.server_port}/mcp','enabled':True,'allow_tools':['search','malformed']}])
    def tearDown(self):self.server.shutdown();self.server.server_close();self.thread.join()
    def test_json_request_metadata_and_encoded_parameter_headers(self):
        result=self.gateway.call('fixture','search',{'query':'line1\nline2'},approved=True)
        self.assertEqual(result['content'][0]['text'],'matched')
        request,headers=self.requests[-1]
        self.assertEqual(headers.get('Mcp-Param-Query'),'=?base64?bGluZTEKbGluZTI=?=')
        self.assertEqual(request['params']['arguments']['query'],'line1\nline2')
    def test_sse_progress_and_comments_do_not_hide_the_final_result(self):
        self.mode='sse'
        self.assertEqual(self.gateway.call('fixture','search',{'query':'hello'},True)['content'][0]['text'],'matched')
    def test_malformed_annotations_are_omitted_instead_of_crashing(self):
        self.mode='bad_annotations';self.assertEqual([t['name'] for t in self.gateway.discover('fixture')],['search'])
    def test_invalid_result_content_is_rejected(self):
        self.mode='invalid_content'
        with self.assertRaises(MCPError):self.gateway.call('fixture','search',{'query':'hello'},True)


class MCPBoundaryTests(unittest.TestCase):
    def test_bad_header_annotations_and_unsafe_values_fail_closed(self):
        for schema in [
            {"properties":{"x":{"type":"number","x-mcp-header":"X"}}},
            {"properties":{"x":{"type":"string","x-mcp-header":"X\r\nInjected"}}},
            {"items":{"properties":{"x":{"type":"string","x-mcp-header":"X"}}}},
            {"properties":{"x":{"type":"string","x-mcp-header":"X"},"y":{"type":"string","x-mcp-header":"x"}}},
        ]:
            with self.assertRaises(MCPError):schema_headers(schema)
        schema={"properties":{"x":{"type":"integer","x-mcp-header":"X"}}}
        for value in [True,1.5,2**53]:
            with self.assertRaises(MCPError):parameter_headers(schema,{"x":value})
        self.assertEqual(parameter_headers(schema,{"x":None}),{})
    def test_sse_size_and_missing_final_response_are_errors(self):
        import io
        for data in [b"data: "+b"x"*65537,b": heartbeat\n\n"]:
            with self.assertRaises(MCPError):read_sse(io.BytesIO(data))
