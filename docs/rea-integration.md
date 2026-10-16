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

3. From an ARKUS source checkout, capture **static JavaScript/Electron** evidence for a directory you own or are authorized to inspect:

   ```powershell
   python rea_review.py --target "$HOME\\ada_v2\\dist" --approve
   ```

   For a built Vite/Electron app, prefer its smaller `dist` directory over the entire source checkout; a full directory (especially one containing `node_modules`) can be expensive to analyze. Confirm the target exists first. The command explicitly calls pinned `rea-agents@6.5.0`. npm may fetch the package if absent. The target is an existing **directory**, not an EXE; this lane reads JS/Electron artifacts without launching the selected application. Native binary analysis through Ghidra or other engines is intentionally outside this workflow.

If the tool was previously copied to your home directory, refresh that copy after this change merges:

```powershell
Invoke-WebRequest -Uri "https://raw.githubusercontent.com/vyndivybes/ARKUS/main/rea_review.py" -OutFile "$HOME\\rea_review.py"
Test-Path "$HOME\\ada_v2\\dist"
python "$HOME\\rea_review.py" --target "$HOME\\ada_v2\\dist" --approve
```

If `dist` does not exist, build the ADA V2 project using its normal `npm.cmd run build` command, then use the generated `dist` directory. The utility captures stdout and stderr to temporary local files, destroys failed temporary output, and saves a JSON evidence file only for successful, valid analysis. Real elapsed time is bounded by the analysis timeout plus bounded process cleanup.

## Evidence boundary

- A result is saved only on success as JSON under ignored `work/rea-evidence/`.
- REA results, source maps, recovered strings and metadata may contain confidential information, embedded instructions, or credentials. Treat all output as **untrusted**; inspect and redact it before sharing or deriving a bounded design specification.
- **Do not** commit raw evidence files, upload proprietary binaries, or feed raw findings directly into a model's instructions, system prompts, or live ARKUS knowledge store.
- The script requires `--approve`, refuses executable-file targets, has a 180-second deadline with Windows child-process tree termination on timeout or Ctrl+C and file-backed subprocess output (no inherited PIPE deadlock), does not intentionally run a shell, and does not change ARKUS's MCP/server permissions.
- The existing `mcp_gateway.py` is a constrained HTTP, read-only tool boundary. REA's local CLI/stdio transport must not be exposed by adding unrestricted subprocess or filesystem tools to that gateway.

## Qualification

```powershell
python -m unittest discover -s tests -p test_rea_review.py -v
npm test
```

These tests cover the authorization gate, target eligibility, pinned command, file-backed output, Windows child-process cleanup after timeouts or Ctrl+C, and fail-closed evidence saving. A passing mocked test is not evidence that REA executed successfully on the user's Windows host. Validate with the approved local target before claiming operational integration.

## Workflow

1. Prefer direct source-code review for ADA V2, O.L.L.I.E and Brahma when source access and licensing permit.
2. Use REA only for evidence gaps in compiled JS/Electron applications or unknown behavior.
3. Derive a source-cited feature specification and implementation tests.
4. Implement features independently in ARKUS under its existing write-approval and execution boundaries.
5. Review any external licenses and test on the actual Windows machine.

**Status:** Local static REA evidence capture is implemented as a manual developer tool. Automatic ARKUS skill invocation, native reverse engineering, VAOS network execution and self-modifying updates are **not** enabled.
