"""Editable multi-part primitive assemblies; offline deterministic CAD revisions and STL.

This is parametric primitive/assembly modeling, not a mechanical CAD solver:
no STEP, mating constraints, Boolean solids or physical validation.
"""
import base64
import json
import math
import os
import re
import secrets
import struct
import threading
from pathlib import Path
from cad_shapes import generate, GeometryError, _stl

class CADModelError(ValueError):
    pass

class ParametricCAD:
    def __init__(self,data_dir):
        self.root=Path(data_dir).resolve()/"parametric-cad"
        self.lock=threading.RLock()
    def _path(self,project):
        if not isinstance(project,str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*",project):
            raise CADModelError("Invalid CAD project.")
        folder=self.root/project
        file=folder/"models.json"
        if any(p.is_symlink() for p in (self.root,folder,file)):
            raise CADModelError("Symlink CAD storage is not permitted.")
        if not file.resolve().is_relative_to(self.root.resolve()):
            raise CADModelError("Invalid CAD storage.")
        return file
    def _load(self,project):
        file=self._path(project)
        if not file.exists():return []
        if file.stat().st_size>180000:raise CADModelError("CAD storage exceeds limits.")
        try:
            rows=json.loads(file.read_text(encoding="utf-8"))
            if not isinstance(rows,list) or len(rows)>30:raise ValueError()
            for row in rows:
                if not isinstance(row,dict) or not isinstance(row.get("id"),str) or row.get("revision",0)<1:raise ValueError()
                self.validate_parts(row["parts"])
            return rows
        except (OSError,ValueError,KeyError,TypeError) as e:
            raise CADModelError("CAD registry corrupted; no changes made.") from e
    def _save(self,project,rows):
        file=self._path(project);file.parent.mkdir(parents=True,exist_ok=True)
        temp=file.with_name(file.name+"."+secrets.token_hex(5)+".tmp")
        try:temp.write_text(json.dumps(rows,indent=2),encoding="utf-8");os.replace(temp,file)
        finally:temp.unlink(missing_ok=True)
    @staticmethod
    def validate_parts(parts):
        if not isinstance(parts,list) or not 1<=len(parts)<=8:
            raise CADModelError("Assemblies support 1–8 parts.")
        clean=[]
        for p in parts:
            if not isinstance(p,dict) or set(p)!={"shape","dimensions","position"}:
                raise CADModelError("Each part needs shape, dimensions and position.")
            xyz=p["position"]
            if not isinstance(xyz,list) or len(xyz)!=3 or any(isinstance(x,bool) or not isinstance(x,(int,float)) or not math.isfinite(x) or abs(x)>500 for x in xyz):
                raise CADModelError("Part positions must be finite millimetre coordinates within ±500.")
            try: mesh=generate(p["shape"],p["dimensions"])
            except GeometryError as e:raise CADModelError(str(e)) from None
            clean.append({"shape":p["shape"],"dimensions":mesh["dimensions_mm"].copy(),"position":list(xyz)})
        return clean
    def list(self,project):
        with self.lock:return [{k:v for k,v in row.items() if k!="parts"} for row in self._load(project)]
    def get(self,project,identity):
        with self.lock:
            row=next((r for r in self._load(project) if r["id"]==identity),None)
            if row is None:raise CADModelError("Model not found in this project.")
            return json.loads(json.dumps(row))
    def create(self,project,name,parts):
        if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z][A-Za-z0-9_-]{1,39}",name):
            raise CADModelError("CAD model name must be 2–40 letters, digits, hyphen or underscore.")
        clean=self.validate_parts(parts)
        with self.lock:
            rows=self._load(project)
            if len(rows)>=30:raise CADModelError("Maximum 30 models per project.")
            row={"id":secrets.token_hex(12),"name":name,"revision":1,"parts":clean}
            rows.append(row);self._save(project,rows);return row
    def revise(self,project,identity,parts,expected_revision):
        clean=self.validate_parts(parts)
        with self.lock:
            rows=self._load(project);row=next((r for r in rows if r["id"]==identity),None)
            if row is None:raise CADModelError("Model not found.")
            if type(expected_revision) is not int or row["revision"]!=expected_revision:
                raise CADModelError("CAD revision conflict. Reload the latest before saving.")
            row["parts"]=clean;row["revision"]+=1;self._save(project,rows);return dict(row)
    def export(self,project,identity):
        model=self.get(project,identity);triangles=[]
        for part in model["parts"]:
            payload=base64.b64decode(generate(part["shape"],part["dimensions"])["base64"])
            count=struct.unpack_from("<I",payload,80)[0]
            x,y,z=part["position"]
            for n in range(count):
                values=struct.unpack_from("<12fH",payload,84+n*50)
                a,b,c=values[3:6],values[6:9],values[9:12]
                triangles.append(tuple(tuple(float(p[i]+v) for i,v in enumerate((x,y,z))) for p in (a,b,c)))
        data=_stl(triangles)
        return {"name":f"ARKUS-{model['name']}-r{model['revision']}.stl",
                "format":"binary-stl","mime":"model/stl","triangles":len(triangles),
                "base64":base64.b64encode(data).decode("ascii"),
                "revision":model["revision"],"answer":"Exported an editable, multi-part primitive assembly. No Boolean union or engineering validation was performed."}
