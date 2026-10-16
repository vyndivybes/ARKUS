"""Manual REA static JavaScript/Electron analysis, outside the ARKUS runtime.

Developer-only; never invoked from ARKUS assistant, server, or MCP gateway.
The filtered summary contains identity/statistics, not the full feature graph.\nOutputs are untrusted local evidence and must be reviewed before sharing.
"""
import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path


MAX_EVIDENCE_CHARS = 8 * 1024 * 1024
REA_PACKAGE = "rea-agents@6.5.0"
REA_TIMEOUT_SECONDS = 180


class ReviewError(ValueError):
    """The explicitly requested analysis was refused or did not succeed."""


def _terminate_process_tree(process):
    """Bounded cleanup of REA and its npm/cmd descendants.

    On Windows terminating only npx.cmd leaves REA/node descendants holding
    stdout pipes open. Target this launcher PID; never kill all node.exe tasks.
    """
    if sys.platform == "win32":
        try:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
                check=False,
                timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass
    if process.poll() is None:
        try:
            process.kill()
        except (OSError, ProcessLookupError):
            pass
    try:
        process.wait(timeout=5)
    except (OSError, subprocess.TimeoutExpired):
        pass


def _collect_static_evidence(command):
    """Use seekable files instead of pipes inherited by npm's process tree."""
    with tempfile.TemporaryFile(mode="w+b") as stdout_file, \
         tempfile.TemporaryFile(mode="w+b") as stderr_file:
        try:
            process = subprocess.Popen(
                command,
                stdin=subprocess.DEVNULL,
                stdout=stdout_file,
                stderr=stderr_file,
                shell=False,
            )
        except OSError:
            raise ReviewError("Could not launch REA. No evidence was saved.") from None
        try:
            returncode = process.wait(timeout=REA_TIMEOUT_SECONDS)
        except subprocess.TimeoutExpired:
            _terminate_process_tree(process)
            raise ReviewError(
                f"REA timed out after {REA_TIMEOUT_SECONDS} seconds; "
                "its process tree was stopped. No evidence was saved."
            ) from None
        except KeyboardInterrupt:
            _terminate_process_tree(process)
            raise ReviewError("REA analysis cancelled; no evidence was saved.") from None

        if returncode != 0:
            raise ReviewError(
                f"REA exited with status {returncode}. "
                "No evidence was saved; check the target and REA capabilities."
            )
        stdout_file.seek(0, 2)
        output_size = stdout_file.tell()
        if output_size == 0:
            stderr_file.seek(0, 2)
            stderr_size = stderr_file.tell()
            raise ReviewError(
                f"REA completed but returned zero bytes of JSON output "
                f"(stderr: {stderr_size} bytes); no evidence was saved."
            )
        if output_size > MAX_EVIDENCE_CHARS:
            raise ReviewError(
                f"REA generated {output_size:,} bytes of output and exceeded 8 MiB; "
                "no evidence was saved. The compact summary filter may be unavailable."
            )
        stdout_file.seek(0)
        raw_bytes = stdout_file.read()
        try:
            raw = raw_bytes.decode("utf-8")
        except UnicodeError:
            raise ReviewError("REA evidence was not valid UTF-8.") from None
        return raw


def run_review(target, *, approved=False, storage_root=None, source_paths=None, summary=False):
    """Capture a bounded static REA summary for an authorized app directory."""
    if approved is not True:
        raise ReviewError("Explicit operator approval (--approve) is required.")
    try:
        source = Path(target).expanduser().resolve(strict=True)
    except (OSError, RuntimeError, ValueError):
        raise ReviewError("The selected local application directory does not exist.") from None
    if not source.is_dir():
        raise ReviewError("Only an existing local application directory is accepted.")
    npm = shutil.which("npx.cmd") or shutil.which("npx")
    if not npm:
        raise ReviewError("Node.js npm/npx is unavailable on PATH.")
    command = [
        npm, "--yes", REA_PACKAGE,
        "analyze-javascript-application", str(source), "--json",
        "--filter-output", "evidence_id,normalized_result.statistics",
    ]
    raw = _collect_static_evidence(command)
    try:
        evidence = json.loads(raw)
    except (ValueError, TypeError):
        raise ReviewError("REA did not return valid JSON evidence.") from None
    if not isinstance(evidence, dict):
        raise ReviewError("REA evidence must have a JSON object at its root.")
    # Preserve the evidence exactly; never execute it or auto-import into notes.
    dest = Path(storage_root) if storage_root is not None else (
        Path(__file__).resolve().parent / "work" / "rea-evidence"
    )
    dest = dest.expanduser().resolve()
    dest.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    path = dest / f"rea-js-summary-{stamp}-{uuid.uuid4().hex[:12]}.json"
    with path.open("x", encoding="utf-8") as output:
        output.write(raw)
    return path


def main():
    parser = argparse.ArgumentParser(
        description="Manually capture a compact REA static-analysis summary in local work/."
    )
    parser.add_argument("--target", required=True, help="Existing local JS/Electron app directory")
    parser.add_argument(
        "--approve", action="store_true",
        help="Confirm you are authorized to inspect the selected application.",
    )
    parser.add_argument(
        "--source-path", action="append", dest="source_paths",
        help="Analyze only this artifact-relative file; repeat for multiple files.",
    )
    parser.add_argument(
        "--summary", action="store_true",
        help="Return bounded identity, statistics, and selection metadata rather than the full graph.",
    )
    args = parser.parse_args()
    try:
        output = run_review(
            args.target, approved=args.approve,
            source_paths=args.source_paths, summary=args.summary,
        )
    except ReviewError as exc:
        parser.exit(1, f"REA review not saved: {exc}\n")
    print(f"REA static summary saved locally: {output}")
    print("Review and redact the JSON before sharing; it is untrusted analysis data.")


if __name__ == "__main__":
    main()
