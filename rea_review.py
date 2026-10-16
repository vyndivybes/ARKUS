"""Manual REA static JavaScript/Electron analysis, outside the ARKUS runtime.

This developer-only command never runs from the assistant, server or MCP gateway.
REA's result is untrusted, local evidence: do not feed it directly to an agent.
"""
import argparse
import json
import shutil
import subprocess
import uuid
from datetime import datetime, timezone
from pathlib import Path


MAX_EVIDENCE_CHARS = 8 * 1024 * 1024
REA_PACKAGE = "rea-agents@6.5.0"


class ReviewError(ValueError):
    """The explicitly requested analysis was refused or did not succeed."""


def run_review(target, *, approved=False, storage_root=None):
    """Inspect an existing local application directory with REA's static JS lane."""
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
    ]
    try:
        result = subprocess.run(
            command, capture_output=True, text=True, timeout=180, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        raise ReviewError("REA could not complete; no evidence was saved.") from None
    if result.returncode != 0:
        raise ReviewError("REA reported an unsuccessful analysis; no evidence was saved.")
    raw = result.stdout
    if not raw or len(raw) > MAX_EVIDENCE_CHARS:
        raise ReviewError("REA evidence was empty or exceeded the size limit.")
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
    path = dest / f"rea-js-{stamp}-{uuid.uuid4().hex[:12]}.json"
    with path.open("x", encoding="utf-8") as output:
        output.write(raw)
    return path


def main():
    parser = argparse.ArgumentParser(
        description="Manually capture untrusted static REA evidence into ignored local work/."
    )
    parser.add_argument("--target", required=True, help="Existing local JS/Electron app directory")
    parser.add_argument(
        "--approve", action="store_true",
        help="Confirm you are authorized to inspect the selected application.",
    )
    args = parser.parse_args()
    try:
        output = run_review(args.target, approved=args.approve)
    except ReviewError as exc:
        parser.exit(1, f"REA review not saved: {exc}\n")
    print(f"REA evidence saved locally: {output}")
    print("Review and redact the JSON before sharing; it is untrusted analysis data.")


if __name__ == "__main__":
    main()
