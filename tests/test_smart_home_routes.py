"""Local HTTP smart-home boundary: default disabled, CSRF and active project isolation."""
import json
import os
import tempfile
import threading
import unittest
import urllib.request
import urllib.error
from pathlib import Path
from unittest.mock import patch
from server import App, make_server, UserError

class FakeAdapter:
    def __init__(self):self.probes=0
    def probe(self,host):
        self.probes+=1
        return {"host":host,"mac":"AA:BB:CC:DD:EE:FF","type":"Bulb",
                "model":"Mock Light","alias":"Test Light","is_on":False}
    def switch(self,*_):
        raise AssertionError("No device may be switched by discovery, pairing, or unapproved action.")

class SmartHomeRouteTests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root=Path(self.tmp.name)
        self.config=self.root/"config.json"
        self.config.write_text(json.dumps({"provider":"offline","enable_smart_home":False}),encoding="utf-8")
        self.env=patch.dict(os.environ,{"ARKUS_CONFIG":str(self.config)})
        self.env.start();self.addCleanup(self.env.stop)
        self.app=App(self.root)
        self.fake=FakeAdapter()
        self.app.smart_home.adapter=self.fake
        self.server=make_server(0,self.app)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True)
        self.thread.start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
    def post(self,path,payload,token=True):
        headers={"Content-Type":"application/json"}
        if token:headers["X-Arkus-Token"]=self.app.token
        req=urllib.request.Request(f"http://127.0.0.1:{self.server.server_port}"+path,
           data=json.dumps(payload).encode("utf-8"),headers=headers,method="POST")
        try:
            with urllib.request.urlopen(req,timeout=3) as reply:
                return reply.status,json.load(reply)
        except urllib.error.HTTPError as failure:
            status=failure.code;data=json.load(failure);failure.close()
            return status,data
    def test_disabled_default_and_missing_csrf_never_probe(self):
        data={"project":"general","host":"192.168.1.32","approved":True}
        self.assertEqual(self.post("/smart-home/discover",data,token=False)[0],403)
        self.assertEqual(self.post("/smart-home/discover",data)[0],409)
        self.assertEqual(self.fake.probes,0)
    def test_enabled_exact_host_probe_and_project_guard(self):
        self.app.config["enable_smart_home"]=True
        data={"project":"general","host":"192.168.1.32","approved":True}
        status,candidate=self.post("/smart-home/discover",data)
        self.assertEqual(status,200)
        self.assertEqual(candidate["status"],"candidate")
        self.assertEqual(self.fake.probes,1)
        status,error=self.post("/smart-home/pair",{"project":"other",
            "candidate_id":candidate["id"],"approved":True})
        self.assertEqual(status,409)
        self.assertIn("Project changed",error["error"])
        status,_=self.post("/smart-home/pair",{"project":"general",
            "candidate_id":candidate["id"],"approved":True})
        self.assertEqual(status,200)
        with urllib.request.urlopen(f"http://127.0.0.1:{self.server.server_port}/smart-home/devices",timeout=3) as reply:
            result=json.load(reply)
        self.assertEqual(len(result["devices"]),1)

if __name__=="__main__":
    unittest.main()
