# REA local analysis handoff for ARKUS

This is an **opt-in developer workflow**, not an ARKUS runtime skill, permission grant, autonomous action, or Cloudflare feature. REA v6.5.0 is an external tool; installing its user-level skill does **not** automatically register an MCP server with ARKUS or Codex.

## Windows developer setup

1. In PowerShell, check the installed skill without changing configuration:

   ```powershell
   npx rea-agents doctor --skill --json
   npx rea-agents capabilities --json
   ```

2. For REA tool use inside Codex, separately configure the MCP client:

   ```powershell
   npx rea-agents setup --client codex
   npx rea-agents doctor --client codex --json
   ```

   Review the exact proposed changes before approval. Restart Codex afterward. The shared `.agents/skills/reverse-engineer-anything` skill alone is not proof of MCP registration.

3. From an ARKUS source checkout, capture a compact **static JavaScript/Electron** summary for a directory you own or are authorized to inspect:

   ```powershell
   python rea_review.py --target "C:\\Users\\ASUS\\ada_v2\\dist" --approve
   ```

   The command calls pinned `rea-agents@6.5.0` with `--json --filter-output evidence_id,normalized_result.statistics` so the default result is an analysis identity and statistics, not a multi-hundred-MB graph. npm may fetch the package if absent. The target is an existing **directory**, not an EXE; prefer a small built `dist` directory rather than a complete project containing `node_modules`. The static lane reads JS/Electron artifacts without launching the selected application. A too-large target may still time out; do not repeat a broad scan automatically. Native binary analysis through Ghidra or other engines is intentionally outside this workflow.

To refresh a standalone copy in your Windows home directory after this fix merges:

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/vyndivybes/ARKUS/main/rea_review.py" -OutFile "$HOME\\rea_review.py"
python "$HOME\\rea_review.py" --target "$HOME\\ada_v2\\dist" --approve
```

When the built ADA V2 bundle is large, select exact artifact-relative source paths and retain only a compact summary. The MediaPipe `hand_landmarker.task` model is not a JavaScript module:

```powershell
# Quick HTML inventory check (small source selection)
python "$HOME\\rea_review.py" --target "$HOME\\ada_v2\\dist" --source-path index.html --summary --approve

# Analyze the bundled JavaScript separately; this may still need substantial CPU/RAM
python "$HOME\\rea_review.py" --target "$HOME\\ada_v2\\dist" --source-path assets/index-BEyMx5mJ.js --summary --approve
```

The `--source-path` value must match an existing file relative to `dist` exactly. `--summary` includes selection metadata alongside the default identity/statistics filter. If REA reports empty output or output above 8 MiB, the launcher provides the actual stdout size without disclosing untrusted output text. Do not increase limits blindly. Prefer direct review of ADA V2's available source code for feature parity, rather than reverse engineering the compiled bundle.

REA's upstream CLI can also generate **full** application Evidence for expert analysis, but it may be hundreds of megabytes and should be retained on local disk, not pasted into an agent conversation. The manual ARKUS launcher intentionally captures only a small first-pass statistics summary to avoid excessive local memory/disk use. For feature-level inspection, use the authorized Codex/REA MCP analysis views; never imply that statistics alone establish feature parity.

## Evidence boundary

- A compact summary is saved only on success as JSON under ignored `work/rea-evidence/`. The saved summary is **not** a complete module or feature trace; use REA's own analysis views or Codex MCP for deeper evidence after review.
- REA results, source maps, recovered strings and metadata may contain confidential information, embedded instructions, or credentials. Treat all output as **untrusted**; inspect and redact it before sharing or deriving a bounded design specification.
- **Do not** commit raw evidence files, upload proprietary binaries, or feed raw findings directly into a model's instructions, system prompts, or live ARKUS knowledge store.
- The script requires `--approve`, refuses executable-file targets, has a 180-second deadline, checks actual stdout size, differentiates empty output from outputs over 8 MiB, and uses bounded temporary-file output rather than inheritable pipes, and on Windows explicitly ends the targeted npm/REA process tree on timeout or Ctrl+C. It does not use shell interpolation or change ARKUS's MCP/server permissions. Do not kill unrelated Node.js processes.
- The existing `mcp_gateway.py` is a constrained HTTP, read-only tool boundary. REA's local CLI/stdio transport must not be exposed by adding unrestricted subprocess or filesystem tools to that gateway.

## Qualification

```powershell
python -m unittest discover -s tests -p test_rea_review.py -v
npm test
```

These tests cover the authorization gate, target eligibility, pinned compact summary command, separate output-size diagnostics, safe subprocess arguments, and fail-closed evidence saving. A passing mocked test is not evidence that REA executed successfully on the user's Windows host. Validate with the approved local target before claiming operational integration.

## Workflow

1. Prefer direct source-code review for ADA V2, O.L.L.I.E and Brahma when source access and licensing permit.
2. Use REA only for evidence gaps in compiled JS/Electron applications or unknown behavior.
3. Derive a source-cited feature specification and implementation tests.
4. Implement features independently in ARKUS under its existing write-approval and execution boundaries.
5. Review any external licenses and test on the actual Windows machine.

**Status:** Local static REA evidence capture is implemented as a manual developer tool. Automatic ARKUS skill invocation, native reverse engineering, VAOS network execution and self-modifying updates are **not** enabled.
