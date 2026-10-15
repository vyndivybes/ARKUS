"""Original, local-only ARKUS workflow engine.

Inspired by O.L.L.I.E.'s one-step plans, ADA's project memory, and the
personal-assistant use cases described by Brahma. Does not embed external
repository code or actuate hardware.
"""
import json
import os
import re
import secrets
import threading
from datetime import datetime, timedelta
from pathlib import Path


class WorkflowError(ValueError):
    pass


def _id():
    return secrets.token_hex(8)


class CompanionWorkflows:
    MAX_PLANS = 30
    MAX_REMINDERS = 100
    _MAX_FILE = 256000

    def __init__(self, data_dir):
        self.root = Path(data_dir).resolve() / "projects"
        self.lock = threading.RLock()

    def _file(self, project):
        if not isinstance(project, str) or not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", project):
            raise WorkflowError("Invalid project identity.")
        folder = self.root / project
        filename = folder / "companion.json"
        if any(p.is_symlink() for p in (self.root, folder, filename)):
            raise WorkflowError("Linked project workflow paths are not allowed.")
        if not folder.resolve().is_relative_to(self.root.resolve()):
            raise WorkflowError("Invalid project workflow path.")
        return filename

    def _read(self, project):
        path = self._file(project)
        if not path.exists():
            return {"plans": [], "reminders": []}
        if path.stat().st_size > self._MAX_FILE:
            raise WorkflowError("Local workflow data exceeds the size limit.")
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
            if not isinstance(data, dict) or not isinstance(data.get("plans"), list) or not isinstance(data.get("reminders"), list):
                raise ValueError("Invalid workflow data")
            return data
        except (OSError, ValueError, TypeError) as exc:
            raise WorkflowError("Workflow data is damaged; it was not replaced.") from exc

    def _write(self, project, data):
        path = self._file(project)
        path.parent.mkdir(parents=True, exist_ok=True)
        blob = json.dumps(data, indent=2, ensure_ascii=False)
        if len(blob.encode("utf-8")) > self._MAX_FILE:
            raise WorkflowError("Workflow data is too large.")
        temp = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
        try:
            temp.write_text(blob, encoding="utf-8")
            os.replace(temp, path)
        finally:
            temp.unlink(missing_ok=True)

    def snapshot(self, project, now=None):
        now = now or datetime.now()
        with self.lock:
            data = self._read(project)
            plans = data["plans"]
            reminders = data["reminders"]
            pending = [r for r in reminders if not r["acknowledged"]]
            due = [r for r in pending if datetime.fromisoformat(r["when"]) <= now]
            soon = [r for r in pending if now < datetime.fromisoformat(r["when"]) <= now + timedelta(hours=24)]
            active = [p for p in plans if not p["completed"]]
            return {"project": project, "plans": plans, "reminders": reminders,
                    "due": due, "briefing": {
                        "project": project, "active_plans": len(active),
                        "completed_plans": len(plans) - len(active),
                        "due_reminders": len(due),
                        "next_24h": sorted(soon, key=lambda r: r["when"])[:8],
                        "source": "local_project_records_only",
                        "external_data": "not_connected"}}

    def create_plan(self, project, goal, steps):
        if not isinstance(goal, str) or not 1 <= len(goal.strip()) <= 200:
            raise WorkflowError("Plan goal must contain 1–200 characters.")
        if not isinstance(steps, list) or not 1 <= len(steps) <= 12 or any(
            not isinstance(step, str) or not 1 <= len(step.strip()) <= 220 for step in steps
        ):
            raise WorkflowError("Supply 1–12 specific steps of up to 220 characters each.")
        with self.lock:
            data = self._read(project)
            if len(data["plans"]) >= self.MAX_PLANS:
                raise WorkflowError("The project has reached the local 30-plan limit.")
            plan = {"id": _id(), "goal": goal.strip(),
                    "steps": [{"text": step.strip(), "done": False} for step in steps],
                    "completed": False, "created_at": datetime.now().astimezone().isoformat()}
            data["plans"].append(plan)
            self._write(project, data)
            return {"plan": plan, "answer": "Plan saved locally. Only one confirmed step can advance at a time."}

    def advance(self, project, plan_id, confirmed):
        if confirmed is not True:
            raise WorkflowError("Explicit confirmation is required to complete the current step.")
        with self.lock:
            data = self._read(project)
            plan = next((p for p in data["plans"] if p["id"] == plan_id), None)
            if not plan:
                raise WorkflowError("Plan not found in this project.")
            if plan["completed"]:
                raise WorkflowError("This plan is already finished.")
            step = next((s for s in plan["steps"] if not s["done"]), None)
            if not step:
                raise WorkflowError("No remaining step.")
            step["done"] = True
            plan["completed"] = all(s["done"] for s in plan["steps"])
            self._write(project, data)
            return {"plan": plan, "answer": "Plan completed." if plan["completed"] else "Step recorded. The next step is ready."}

    def remind(self, project, when, message, now=None):
        now = now or datetime.now()
        if not isinstance(when, str) or len(when) > 35:
            raise WorkflowError("Enter a local date and time.")
        try:
            target = datetime.fromisoformat(when)
        except (ValueError, TypeError):
            raise WorkflowError("Use a valid local date and time.") from None
        if target.tzinfo is not None or not (now < target <= now + timedelta(days=366)):
            raise WorkflowError("Set a future local reminder within the next year.")
        if not isinstance(message, str) or not 1 <= len(message.strip()) <= 250:
            raise WorkflowError("Reminder text must contain 1–250 characters.")
        with self.lock:
            data = self._read(project)
            if len(data["reminders"]) >= self.MAX_REMINDERS:
                raise WorkflowError("The project has reached the local 100-reminder limit.")
            item = {"id": _id(), "when": target.isoformat(timespec="minutes"),
                    "message": message.strip(), "acknowledged": False}
            data["reminders"].append(item)
            self._write(project, data)
            return {"reminder": item, "answer": "Reminder saved locally. It appears while ARKUS is running; no operating-system alarm was installed."}

    def acknowledge(self, project, reminder_id):
        with self.lock:
            data = self._read(project)
            item = next((r for r in data["reminders"] if r["id"] == reminder_id), None)
            if not item:
                raise WorkflowError("Reminder not found in this project.")
            item["acknowledged"] = True
            self._write(project, data)
            return {"ok": True, "answer": "Reminder acknowledged."}


CAPABILITIES = [
    {"name": "Project knowledge galaxy", "status": "available", "source": "ARKUS"},
    {"name": "Isolated persistent conversations", "status": "available", "source": "ADA-inspired"},
    {"name": "One-step confirmed work plans", "status": "available", "source": "O.L.L.I.E-inspired"},
    {"name": "Local reminders and briefing", "status": "available", "source": "Original Brahma-inspired design"},
    {"name": "Voice and interruptible speech", "status": "device_check_required", "source": "ARKUS"},
    {"name": "Local posture and consented vision", "status": "device_check_required", "source": "ARKUS"},
    {"name": "Real-time cloud multimodal voice", "status": "requires_provider", "source": "ADA"},
    {"name": "CAD and 3D printer", "status": "requires_optional_tools_and_hardware", "source": "ADA"},
    {"name": "Robotic arm control", "status": "requires_hardware_and_calibration", "source": "O.L.L.I.E"},
    {"name": "Gesture-operated UI", "status": "not_implemented", "source": "ADA"},
    {"name": "Web automation and smart home", "status": "not_implemented", "source": "ADA/Brahma"},
    {"name": "External calendar/email/weather", "status": "not_connected", "source": "Brahma"},
    {"name": "Autonomous code modification", "status": "not_enabled", "source": "Brahma"},
]
