"""Test actual offline triangle mesh exports and rejection of malformed dimensions."""
import base64
import math
import struct
import unittest
from cad_shapes import GeometryError, generate


class GeometryTests(unittest.TestCase):
    def test_box_has_12_nonzero_triangles(self):
        result=generate("box",{"length":24,"width":12,"height":4})
        binary=base64.b64decode(result["base64"], validate=True)
        self.assertEqual(binary[:5], b"ARKUS")
        self.assertEqual(struct.unpack_from("<I",binary,80)[0],12)
        self.assertEqual(len(binary),84+50*12)

    def test_cylinder_and_tube_have_valid_geometry(self):
        a=generate("cylinder",{"radius":10,"height":50})
        b=generate("tube",{"radius":20,"wall":2,"height":50})
        self.assertEqual(a["triangles"],128)
        self.assertEqual(b["triangles"],256)
        for x in (a,b):
            raw=base64.b64decode(x["base64"],validate=True)
            self.assertEqual(len(raw),84+x["triangles"]*50)
            for i in range(x["triangles"]):
                nx,ny,nz=struct.unpack_from("<3f",raw,84+i*50)
                self.assertTrue(0.99 < math.sqrt(nx*nx+ny*ny+nz*nz) < 1.01)

    def test_reject_unknown_nonfinite_out_of_range_and_thick_wall(self):
        examples=[
            ("arbitrary",{"length":1}),
            ("box",{"length":"nan","width":5,"height":5}),
            ("box",{"length":3,"width":0,"height":3}),
            ("cylinder",{"radius":99999,"height":20}),
            ("tube",{"radius":5,"wall":5,"height":10}),
            ("tube",{"radius":5,"wall":6,"height":10}),
            ("cylinder",{"radius":True,"height":10}),
        ]
        for shape,params in examples:
            with self.subTest(shape=shape,params=params), self.assertRaises(GeometryError):
                generate(shape,params)
