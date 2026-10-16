import tempfile,unittest,base64,struct
from parametric_cad import ParametricCAD, CADModelError

class CADRevisionTests(unittest.TestCase):
 def setUp(self):self.t=tempfile.TemporaryDirectory();self.cad=ParametricCAD(self.t.name)
 def tearDown(self):self.t.cleanup()
 def test_editable_assembly_and_revision_export(self):
  parts=[{"shape":"box","dimensions":{"length":40,"width":20,"height":10},"position":[0,0,0]},{"shape":"tube","dimensions":{"radius":8,"wall":2,"height":30},"position":[0,0,10]}]
  a=self.cad.create("general","frame_demo",parts)
  self.assertEqual(a["revision"],1)
  parts[0]["dimensions"]["length"]=60
  b=self.cad.revise("general",a["id"],parts,expected_revision=1)
  self.assertEqual(b["revision"],2)
  restored=ParametricCAD(self.t.name).get("general",a["id"])
  self.assertEqual(restored["parts"][0]["dimensions"]["length"],60)
  out=self.cad.export("general",a["id"])
  raw=base64.b64decode(out["base64"])
  self.assertEqual(struct.unpack_from("<I",raw,80)[0],out["triangles"])
  self.assertGreater(out["triangles"],20)
 def test_invalid_and_cross_project_denied(self):
  with self.assertRaises(CADModelError):self.cad.create("../escape","bad",[{"shape":"box","dimensions":{"length":10,"width":20,"height":30},"position":[0,0,0]}])
  with self.assertRaises(CADModelError):self.cad.create("general","invalid",[{"shape":"shell","dimensions":{},"position":[0,0,0]}])
  x=self.cad.create("general","good",[{"shape":"box","dimensions":{"length":10,"width":20,"height":30},"position":[0,0,0]}])
  with self.assertRaises(CADModelError):self.cad.get("other",x["id"])
  with self.assertRaises(CADModelError):self.cad.revise("general",x["id"],x["parts"],expected_revision=5)
 def test_limit_on_parts(self):
  a={"shape":"cylinder","dimensions":{"radius":6,"height":10},"position":[0,0,0]}
  with self.assertRaises(CADModelError):self.cad.create("general","oversized",[a]*9)
