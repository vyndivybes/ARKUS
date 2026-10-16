"""Local data-only ARKUS snapshot and controlled restore (never exports credentials).

Exports project metadata, notes, conversations, and companion tasks. Explicit
restore is permitted only into a fresh empty directory. No executable code.
"""
import hashlib
import json
import os
import re
import zipfile
from pathlib import Path, PurePosixPath

MAX_FILE = 2_000_000
MAX_ARCHIVE = 20_000_000
MAX_ENTRIES = 2000
NAME = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")


class BackupError(ValueError):
    pass


def _supported(name):
    pieces = PurePosixPath(name).parts
    if name == "projects.json":
        return True
    if len(pieces) in (2, 3) and pieces[0] == "notes":
        if len(pieces) == 3 and pieces[1] != "captures":
            return False
        return pieces[-1].lower().endswith((".md", ".txt"))
    if len(pieces) == 3 and pieces[0] == "projects" and NAME.fullmatch(pieces[1]):
        return pieces[2] in ("history.json", "companion.json")
    if (len(pieces) in (4, 5) and pieces[0] == "projects"
            and NAME.fullmatch(pieces[1]) and pieces[2] == "notes"):
        if len(pieces) == 5 and pieces[3] != "captures":
            return False
        return pieces[-1].lower().endswith((".md", ".txt"))
    return False

def _safe_rel(name):
    if (not isinstance(name, str) or not name or "\\" in name or name.startswith("/")
            or any(part in (".", "..", "") for part in name.split("/"))
            or ":" in name or "\x00" in name):
        return False
    return True


def export_backup(data_dir, archive_path):
    root = Path(data_dir).resolve()
    dest = Path(archive_path).resolve()
    if not root.is_dir() or Path(data_dir).is_symlink():
        raise BackupError("A real local data directory is required.")
    if dest.exists() or dest.is_relative_to(root):
        raise BackupError("Choose a new archive path outside ARKUS live data.")
    entries = {}
    for current, directories, files in os.walk(root, followlinks=False):
        current_path = Path(current)
        for folder in directories:
            if (current_path / folder).is_symlink():
                raise BackupError("Linked source directories are not included in backups.")
        for file in files:
            path = current_path / file
            if path.is_symlink():
                raise BackupError("Linked source files are not included in backups.")
            rel = path.relative_to(root).as_posix()
            if not _supported(rel):
                continue
            size = path.stat().st_size
            if size > MAX_FILE:
                raise BackupError("Local data file exceeds per-file backup limit.")
            entries[rel] = path.read_bytes()
            if len(entries) > MAX_ENTRIES or sum(map(len, entries.values())) > MAX_ARCHIVE:
                raise BackupError("Local snapshot exceeds archive limits.")
    manifest = {
        "format": "ARKUS_DATA_ONLY_1",
        "entries": {name: hashlib.sha256(content).hexdigest() for name, content in sorted(entries.items())}
    }
    if not entries:
        raise BackupError("No eligible local project data exists.")
    dest.parent.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(dest, "x", compression=zipfile.ZIP_DEFLATED) as archive:
            for name, content in sorted(entries.items()):
                archive.writestr(name, content)
            archive.writestr("_arkus_manifest.json", json.dumps(manifest))
    except Exception:
        dest.unlink(missing_ok=True)
        raise
    return {"files": len(entries), "archive": str(dest), "credentials_included": False}


def restore_backup(archive_path, destination_dir, allow_nonempty=False):
    if allow_nonempty:
        raise BackupError("Overwriting existing records is deliberately prohibited.")
    archive_path = Path(archive_path)
    dest = Path(destination_dir)
    if dest.is_symlink() or (dest.exists() and (not dest.is_dir() or any(dest.iterdir()))):
        raise BackupError("Restore target must be an empty real directory.")
    if not archive_path.is_file() or archive_path.stat().st_size > MAX_ARCHIVE:
        raise BackupError("Archive is missing or too large.")
    with zipfile.ZipFile(archive_path) as archive:
        names = archive.namelist()
        if len(names) > MAX_ENTRIES + 1 or len(names) != len(set(names)):
            raise BackupError("Archive has too many or duplicate entries.")
        if "_arkus_manifest.json" not in names:
            raise BackupError("ARKUS backup manifest is missing.")
        try:
            manifest = json.loads(archive.read("_arkus_manifest.json"))
        except (ValueError, KeyError, RuntimeError, UnicodeDecodeError) as exc:
            raise BackupError("Unreadable backup manifest.") from exc
        if not isinstance(manifest, dict) or manifest.get("format") != "ARKUS_DATA_ONLY_1":
            raise BackupError("Unsupported ARKUS backup format.")
        expected = manifest.get("entries")
        if not isinstance(expected, dict) or set(expected) != set(names) - {"_arkus_manifest.json"}:
            raise BackupError("Archive contents do not match manifest.")
        total = 0
        checked = {}
        for item in archive.infolist():
            if item.filename == "_arkus_manifest.json":
                continue
            name = item.filename
            if not _safe_rel(name) or not _supported(name) or item.is_dir():
                raise BackupError("Unsafe or unsupported archive path.")
            if (item.external_attr >> 16) & 0o170000 == 0o120000:
                raise BackupError("Archive contains symbolic links.")
            if item.file_size > MAX_FILE:
                raise BackupError("Archive entry exceeds its size limit.")
            total += item.file_size
            if total > MAX_ARCHIVE:
                raise BackupError("Archive expands beyond the safe limit.")
            content = archive.read(name)
            if hashlib.sha256(content).hexdigest() != expected[name]:
                raise BackupError("Archive integrity check failed.")
            checked[name] = content
    # Validate the entire archive before writing any user records.
    if dest.exists() and (dest.is_symlink() or any(dest.iterdir())):
        raise BackupError("Restore destination changed during validation.")
    dest.mkdir(parents=True, exist_ok=True)
    for name, content in checked.items():
        target = dest.joinpath(*name.split("/"))
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as output:
            output.write(content)
    return {"files": len(checked), "restored_to": str(dest), "credentials_restored": False}
