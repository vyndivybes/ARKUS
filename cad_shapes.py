"""Deterministic, offline STL primitive generator for ARKUS.

This is an original, dependency-free geometric export module, not the
build123d parametric CAD pipeline from ADA V2 or hardware control from O.L.L.I.E.
"""
import base64
import math
import struct


class GeometryError(ValueError):
    pass


def _measure(value, label):
    if isinstance(value, bool):
        raise GeometryError(label + " must be a number in millimetres.")
    try:
        number = float(value)
    except (TypeError, ValueError):
        raise GeometryError(label + " must be a number in millimetres.") from None
    if not math.isfinite(number) or not (1 <= number <= 300):
        raise GeometryError(label + " must be between 1 and 300 mm.")
    return number


def _stl(triangles):
    body = bytearray(b"ARKUS local generated mesh".ljust(80, b" "))
    body.extend(struct.pack("<I", len(triangles)))
    for a, b, c in triangles:
        ux, uy, uz = [b[i] - a[i] for i in range(3)]
        vx, vy, vz = [c[i] - a[i] for i in range(3)]
        nx, ny, nz = uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx
        length = math.sqrt(nx * nx + ny * ny + nz * nz)
        if length == 0:
            raise GeometryError("Degenerate triangle prevented mesh export.")
        normal = (nx / length, ny / length, nz / length)
        body.extend(struct.pack("<12fH", *(normal + a + b + c), 0))
    return bytes(body)


def generate(shape, dimensions):
    if not isinstance(dimensions, dict) or shape not in ("box", "cylinder", "tube"):
        raise GeometryError("Choose a supported box, cylinder or tube.")
    triangles = []
    def tri(a, b, c):
        triangles.append((tuple(a), tuple(b), tuple(c)))
    if shape == "box":
        x = _measure(dimensions.get("length"), "Length")
        y = _measure(dimensions.get("width"), "Width")
        z = _measure(dimensions.get("height"), "Height")
        a=(0,0,0);b=(x,0,0);c=(x,y,0);d=(0,y,0)
        e=(0,0,z);f=(x,0,z);g=(x,y,z);h=(0,y,z)
        for p,q,r,t in [(a,d,c,b),(e,f,g,h),(a,b,f,e),(b,c,g,f),(c,d,h,g),(d,a,e,h)]:
            tri(p,q,r);tri(p,r,t)
    else:
        outer = _measure(dimensions.get("radius"), "Outer radius")
        height = _measure(dimensions.get("height"), "Height")
        inner = 0.0
        if shape == "tube":
            wall = _measure(dimensions.get("wall"), "Wall thickness")
            if wall >= outer:
                raise GeometryError("Wall thickness must be smaller than outer radius.")
            inner = outer - wall
        sections=32
        for i in range(sections):
            a=2*math.pi*i/sections
            b=2*math.pi*(i+1)/sections
            p=(outer*math.cos(a),outer*math.sin(a),0)
            q=(outer*math.cos(b),outer*math.sin(b),0)
            r=(q[0],q[1],height)
            t=(p[0],p[1],height)
            tri(p,q,r);tri(p,r,t)
            if shape == "cylinder":
                tri((0,0,0),q,p)
                tri((0,0,height),t,r)
            else:
                ip=(inner*math.cos(a),inner*math.sin(a),0)
                iq=(inner*math.cos(b),inner*math.sin(b),0)
                ir=(iq[0],iq[1],height)
                it=(ip[0],ip[1],height)
                tri(ip,ir,iq);tri(ip,it,ir)
                tri(ip,iq,q);tri(ip,q,p)
                tri(it,r,ir);tri(it,t,r)
    raw = _stl(triangles)
    return {"name": "ARKUS-" + shape + ".stl", "mime": "model/stl",
            "format": "binary-stl", "dimensions_mm": dimensions,
            "triangles": len(triangles), "base64": base64.b64encode(raw).decode("ascii"),
            "answer": "Created a basic local STL mesh; this is not engineering-validated CAD or a print-ready design."}
