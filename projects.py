"""ARKUS local project workspaces, inspired by ADA's project memory concept.

No model tool receives arbitrary filesystem access. Project paths are derived from
validated identifiers, with the existing notes directory retained for General.
"""
import json
import os
import re
import secrets
import threading
from pathlib import Path


class ProjectError(ValueError):
    """Safe, user-visible project operation failure."""


def _write_atomic(path, payload):
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.is_symlink():
        raise ProjectError("A project metadata link is not permitted.")
    scratch = path.with_name(path.name + "." + secrets.token_hex(6) + ".tmp")
    try:
        scratch.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
        os.replace(scratch, path)
    finally:
        scratch.unlink(missing_ok=True)


class ProjectStore:
    MAX_PROJECTS = 24
    MAX_HISTORY = 40

    def __init__(self, data_dir, general_notes):
        self.data = Path(data_dir).resolve()
        self.general_notes = Path(general_notes).resolve()
        self.projects_root = self.data / "projects"
        self.manifest = self.data / "projects.json"
        self.lock = threading.RLock()
        self.data.mkdir(parents=True, exist_ok=True)
        if self.manifest.is_symlink():
            raise ProjectError("Linked project manifest is not allowed.")
        if self.manifest.exists():
            if self.manifest.stat().st_size > 100_000:
                raise ProjectError("Project manifest exceeds its size limit.")
            try:
                self._state = json.loads(self.manifest.read_text(encoding="utf-8"))
                items = self._state["projects"]
                keys = [p["id"] for p in items]
                if (not isinstance(items, list) or not (1 <= len(items) <= self.MAX_PROJECTS)
                        or len(keys) != len(set(keys)) or "general" not in keys
                        or any(not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", k) for k in keys)
                        or self._state["active"] not in keys):
                    raise ValueError("Invalid project manifest")
                for project in items:
                    if not isinstance(project["name"], str) or len(project["name"]) > 50:
                        raise ValueError("Invalid project label")
            except (OSError, KeyError, TypeError, ValueError, json.JSONDecodeError) as exc:
                raise ProjectError("Project manifest is invalid; it was not replaced.") from exc
        else:
            self._state = {"version": 1, "active": "general", "projects": [{"id": "general", "name": "General"}]}

    @property
    def active(self):
        return self._state["active"]

    def state(self):
        with self.lock:
            return {"active": self.active, "projects": [dict(item) for item in self._state["projects"]]}

    def _path(self, project_id):
        if project_id == "general":
            return self.general_notes
        if not re.fullmatch(r"[a-z0-9]+(?:-[a-z0-9]+)*", project_id):
            raise ProjectError("Invalid project identifier.")
        root = self.projects_root
        folder = root / project_id
        notes = folder / "notes"
        # Refuse linked roots and project folders rather than resolving through them.
        if any(path.is_symlink() for path in (root, folder, notes)):
            raise ProjectError("Linked project directories are not allowed.")
        if not notes.resolve().is_relative_to(root.resolve()):
            raise ProjectError("Project directory escapes local storage.")
        return notes

    def notes_path(self):
        with self.lock:
            return self._path(self.active)

    def create(self, name):
        if not isinstance(name, str):
            raise ProjectError("Project name must be text.")
        title = name.strip()
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9 _-]{0,49}", title):
            raise ProjectError("Use 1–50 letters, numbers, spaces, hyphens or underscores.")
        identifier = re.sub(r"[-_ ]+", "-", title.lower()).strip("-")
        with self.lock:
            if len(self._state["projects"]) >= self.MAX_PROJECTS:
                raise ProjectError("The local project limit is 24.")
            if any(p["id"] == identifier for p in self._state["projects"]):
                raise ProjectError("A project with this name already exists.")
            path = self._path(identifier)
            if path.parent.exists():
                raise ProjectError("A local directory with this project name already exists.")
            path.mkdir(parents=True, exist_ok=False)
            proposed = {"version": 1, "active": identifier,
                        "projects": [*self._state["projects"], {"id": identifier, "name": title}]}
            _write_atomic(self.manifest, proposed)
            self._state = proposed
            return self.state()

    def switch(self, project_id):
        with self.lock:
            if not isinstance(project_id, str) or not any(p["id"] == project_id for p in self._state["projects"]):
                raise ProjectError("Unknown project. Choose an existing workspace.")
            notes = self._path(project_id)
            if project_id != "general" and not notes.is_dir():
                raise ProjectError("Project notes folder is unavailable; no workspace was changed.")
            if project_id != self.active:
                proposed = {**self._state, "active": project_id}
                _write_atomic(self.manifest, proposed)
                self._state = proposed
            return self.state()

    def _history_path(self):
        project_id = self.active
        notes = self._path(project_id)
        if project_id != "general" and not notes.is_dir():
            raise ProjectError("Project folder is unavailable.")
        root = self.projects_root
        folder = root / project_id
        if root.is_symlink() or folder.is_symlink():
            raise ProjectError("Linked project history directories are not allowed.")
        return folder / "history.json"

    def read_history(self):
        with self.lock:
            path = self._history_path()
            if path.is_symlink():
                raise ProjectError("Linked history files are not allowed.")
            if not path.exists():
                return []
            if path.stat().st_size > 500_000:
                raise ProjectError("Project conversation file exceeds its size limit.")
            try:
                content = json.loads(path.read_text(encoding="utf-8"))
                if not isinstance(content, list):
                    raise ValueError()
                return [{"role": entry["role"], "content": entry["content"]}
                        for entry in content[-self.MAX_HISTORY:]
                        if isinstance(entry, dict) and entry.get("role") in ("user", "assistant")
                        and isinstance(entry.get("content"), str) and len(entry["content"]) <= 10000]
            except (ValueError, TypeError, KeyError):
                raise ProjectError("Project history is invalid; no conversation was overwritten.") from None

    def append_history(self, messages):
        if not isinstance(messages, list) or any(
            not isinstance(m, dict) or m.get("role") not in ("user", "assistant")
            or not isinstance(m.get("content"), str) or len(m["content"]) > 10000 for m in messages
        ):
            raise ProjectError("Conversation history contains an invalid entry.")
        with self.lock:
            path = self._history_path()
            current = self.read_history()
            _write_atomic(path, (current + messages)[-self.MAX_HISTORY:])
            return True

    def clear_history(self):
        with self.lock:
            _write_atomic(self._history_path(), [])
