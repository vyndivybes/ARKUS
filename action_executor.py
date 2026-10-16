"""A bounded local action executor; never runs external code or unapproved tools."""
import json
import math
import os
import re
import secrets
import threading
from pathlib import Path

class ActionError(ValueError):
    pass

class ActionExecutor:
    MAX_EVENTS=100
    def __init__(self,data_dir):
        self.root=Path(data_dir).resolve()/"actions"
        self.lock=threading.RLock()
    def _file(self,project):
        if not isinstance(project,str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*",project):
            raise ActionError("Invalid project.")
        folder=self.root/project
        path=folder/"history.json"
        if any(p.is_symlink() for p in (self.root,folder,path)):
            raise ActionError("Linked action files are not accepted.")
        return path
    def _read(self,project):
        path=self._file(project)
        if not path.exists():return []
        if path.stat().st_size>100000:
            raise ActionError("Action registry is too large.")
        try:
            items=json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(items,list) or len(items)>self.MAX_EVENTS:
                raise ValueError()
            return items
        except (ValueError,KeyError,TypeError,OSError):
            raise ActionError("Action history invalid.") from None
    def _write(self,project,items):
        path=self._file(project)
        path.parent.mkdir(parents=True,exist_ok=True)
        temp=path.with_name(path.name+"."+secrets.token_hex(4)+".tmp")
        try:
            temp.write_text(json.dumps(items,indent=2),encoding="utf-8")
            os.replace(temp,path)
        finally:
            temp.unlink(missing_ok=True)
    @staticmethod
    def _validate(tool,args):
        if tool!="calculate" or not isinstance(args,dict) or set(args)!={"operator","a","b"}:
            raise ActionError("Only bounded, explicit calculation tools are available.")
        if args["operator"] not in ("add","subtract","multiply","divide"):
            raise ActionError("Unsupported operation.")
        values=[]
        for name in ("a","b"):
            value=args[name]
            if isinstance(value,bool):
                raise ActionError("Finite numeric inputs required.")
            try: number=float(value)
            except (ValueError,TypeError,OverflowError):
                raise ActionError("Finite numeric inputs required.") from None
            if not math.isfinite(number) or abs(number)>1e10:
                raise ActionError("Finite numeric inputs required.")
            values.append(number)
        return {"operator":args["operator"],"a":values[0],"b":values[1]}
    def history(self,project):
        with self.lock:return self._read(project)
    def propose(self,project,tool,args):
        arguments=self._validate(tool,args)
        with self.lock:
            items=self._read(project)
            if len(items)>=self.MAX_EVENTS:
                raise ActionError("Action history limit reached.")
            item={"id":secrets.token_hex(12),"tool":tool,"arguments":arguments,"status":"pending"}
            items.append(item)
            self._write(project,items)
            return dict(item)
    def _select(self,items,identity):
        item=next((item for item in items if item.get("id")==identity),None)
        if item is None:raise ActionError("No matching action in this project.")
        return item
    def cancel(self,project,identity):
        with self.lock:
            items=self._read(project);item=self._select(items,identity)
            if item["status"]!="pending":raise ActionError("Action is no longer pending.")
            item["status"]="cancelled";self._write(project,items)
            return dict(item)
    def execute(self,project,identity,approved=False):
        if approved is not True:
            raise ActionError("This individual action requires explicit approval.")
        with self.lock:
            items=self._read(project);item=self._select(items,identity)
            if item["status"]!="pending":raise ActionError("Action has already been resolved.")
            a=item["arguments"]["a"];b=item["arguments"]["b"];operator=item["arguments"]["operator"]
            if operator=="add":result=a+b
            elif operator=="subtract":result=a-b
            elif operator=="multiply":result=a*b
            else:
                if b==0: raise ActionError("Division by zero.")
                result=a/b
            if not math.isfinite(result):raise ActionError("Calculation not finite.")
            item["status"]="complete";item["result"]=result
            self._write(project,items)
            return dict(item)
