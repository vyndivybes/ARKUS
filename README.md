# ARKUS

A local-first knowledge galaxy and Windows 11 focus companion. Your markdown notes become an interactive 3D constellation. Ask grounded questions, follow sources, and capture a thought without leaving the conversation.

## Start locally

Requires **Python 3.11+ and Node.js 22.12+**. No API key is needed for offline note search.

```powershell
npm ci
python server.py
```

Open http://127.0.0.1:4700. For the Windows application from source, run `npm run desktop`. `npm run dist` builds a portable Windows executable with its own checksum-verified Python runtime, galaxy assets, and posture model. The packaged application needs no Node/Python installation. Building it needs internet to fetch pinned dependencies and the official embedded Python archive. The portable build is unsigned.

The first run creates 30 clearly marked fictional business notes. Replace them with your own, or start with `python server.py --notes "C:\path\to\notes"`. The server reads markdown only. Captures write into that folder's `captures` directory. Browser mode stores notes in ignored `data/`; desktop mode uses `%APPDATA%\arkus`. Back up your notes before moving them. Notes are ordinary unencrypted markdown protected by your Windows account permissions.

Try:

- `What are the payment terms?`
- `Compare pricing policy, payment terms, cash reserve and expense review.`
- `Remember that the finish window should be 900 milliseconds.` Then ask about the finish window.
- `Good morning.` Small talk leaves the camera still.

Offline mode extracts matching note text; it is **not an LLM**. Generated conversation and image understanding require a configured model. Source references identify retrieved supporting notes; they do not prove a model's interpretation is correct.

## Project workspaces and continuity (v0.2.0)

Inspired by ADA V2's project-memory concept, ARKUS now offers **local isolated project workspaces** without importing ADA's broad file-reading or self-executing tools.

- In the left-hand Knowledge atlas, choose a project and click **Open**. In System controls, enter a name and click **Create**; the new project becomes active.
- You may also type or say **"Create project called Carbon Bicycle"** or **"Switch project to Carbon Bicycle"**. Only existing projects can be switched to.
- Each project has its own markdown notes, captures and bounded conversation history. Its recent dialogue is restored after an ARKUS restart. Retrieval and cloud excerpts use the **active project's notes only**.
- The original notes directory remains the **General** workspace, including pre-existing captures. There is no migration and no automatic deletion.
- In desktop mode, metadata lives under `%APPDATA%\\arkus\\projects.json` and project data under `%APPDATA%\\arkus\\projects\\<id>`. In browser mode, these paths live inside the local `data` directory. Project content is ordinary **unencrypted local data** and should be backed up.
- Project names are validated; traversal and linked project folders are refused. At most 24 project entries are supported. The most recent 40 user/assistant messages per project are kept locally; the model receives at most 12 entries.
- **Clear this project's conversation** removes stored conversation from the active project after confirmation. It does not delete markdown notes or other workspaces.

**ADA reference and limits:** [nazirlouis/ada_v2](https://github.com/nazirlouis/ada_v2) is MIT-licensed (© 2025 Nazir Louis). We reimplemented its local project-memory idea rather than copying its code. ADA additionally describes Gemini native audio, CAD generation, printer/IoT control, Playwright browsing, gesture control and face matching. ARKUS v0.2.0 **does not claim** these integrations: real-time native duplex voice needs hardware/provider acceptance; CAD and printing require separate tools and device testing; unrestricted browser automation and automatic safety acknowledgement were intentionally not imported; weak heuristic face matching is not treated as authentication. ARKUS's existing galaxy, focus, local posture, typed chat and opt-in vision remain.

## Local companion workflows (v0.3.0)

ARKUS provides an opt-in, **offline action-plan and reminder engine** for practical personal assistance. Open System controls → **Local action plans** or **Personal reminders**.

- **O.L.L.I.E-inspired sequenced planning:** enter a goal and 1–12 *user-specified* steps. Only one step is exposed at a time; mark a step finished only after explicit confirmation. ARKUS never drives motors, printers or your computer as part of these steps.
- **Brahma-inspired daily organization:** create local reminders with an exact local date and time. Use **Local daily briefing** for project notes, active/completed plans, due reminders and next-24-hour local reminders. It will state plainly that external calendar, email, weather and news are **not connected**.
- **ADA-inspired continuity:** plans and reminders remain isolated with each project and persist across ARKUS restarts. Stored in `%APPDATA%\\arkus\\projects\\<id>\\companion.json` on desktop, not encrypted. Back up these files before reinstalling or resetting Windows.
- Reminders are **in-app only**: ARKUS must be open and its running server reachable; overdue reminders are surfaced after reopening. Browser notifications require a separate click and browser permission. ARKUS does not install Windows scheduled tasks or operate while closed.
- Commands: `Create a plan for Quality Review: Check CAD; Record defects; Summarize results`; `Remind me on 2026-12-01 09:30 to check the proposal`; `Daily briefing`; `What can you do?` The structured UI accepts normal line-by-line steps and a date/time picker.
- **Basic offline CAD:** System controls → Local 3D mesh workshop exports binary STL boxes, cylinders and hollow tubes with bounded dimensions in millimetres, without a key, web access, build123d or hardware. These are basic triangle meshes, **not** engineering-validated models, editable parametric CAD, slicer jobs or robot/3D-printer instructions.
- **Capability inventory** labels each feature available, requiring hardware/provider qualification, or not implemented. Feature listing is not evidence of device functionality.

### Reference-source and permission boundaries

- [ADA V2](https://github.com/nazirlouis/ada_v2): MIT licensed; project memory already adapted in ARKUS v0.2. Additional components require optional CAD/3D-print, Kasa, Playwright, Gemini native-audio or MediaPipe hand infrastructure. They are **not** claimed implemented here.
- [O.L.L.I.E](https://github.com/nazirlouis/O.L.L.I.E): hardware-specific robot-arm research project involving CAN motors, RealSense camera, hand-eye calibration, IK and simulation. Its single-next-action concept inspired independently written plans; **no physical robot integration or O.L.L.I.E code** has been copied. No LICENSE file was present in the inspected repository.
- [Brahma AI Evo](https://github.com/titechprabhasolutions/Brahma-Ai-Evo): source-available, personal-use and **non-redistribution** license. ARKUS does not include or derive distributable Brahma source. Local reminders and truthfully bounded briefings are new implementations of common assistant concepts, not ports of Brahma code. Automatic unsafe shell/browser actions and autonomous code patching are **not enabled**.

The preview remains unsigned and free for its local base features. Third-party cloud AI, native voice, CAD, smart-home and hardware capabilities are not supplied free by ARKUS. No integration claims should be made without real testing and explicit hardware/provider setup.

## Local reliability improvement (v0.3.1)

- **Project backup:** System controls → Project workspaces → **Back up all projects**. Saves a timestamped ZIP under a neighboring `ARKUS-Backups` folder, outside ARKUS's live data directory. Includes all allowlisted project metadata, General/project markdown notes including captures, conversations, action plans and reminders. Excludes API credentials, local config, activity ledgers, executables and arbitrary filesystem contents.
- **Verifiable restore:** Backup ZIP includes a checksum manifest. Restore is manual and only permitted to an **empty directory**, never over existing live data. With Python 3.11+ installed, use `python backup.py restore "path\\to\\archive.zip" "path\\to\\empty-recovery-folder"`. To create manually, use `python backup.py export "path\\to\\ARKUS-userData" "path\\to\\new-backup.zip"`. Protect the archive: notes and chat records are not encrypted.
- **Cross-project reminders:** While the ARKUS interface remains running, every 30 seconds it polls for due reminders **across all local workspaces**, showing the source project instead of silently missing reminders in inactive workspaces. Optional operating-system/browser notifications require explicit permission. ARKUS still **does not** deliver notifications while the application is closed.
- **Recovery limitations:** This is a project-data snapshot, not a full Windows disaster-recovery image. No automatic off-device copy, remote sync or credential backup is included. Keep a separate offline copy and verify restoring it before treating ARKUS as a sole recordkeeper.

## Configure a model privately

Copy `config.example.json` to `config.json` for browser mode, or `%APPDATA%\arkus\config.json` for desktop mode. Both files stay outside the served viewer. Desktop also honors `ARKUS_CONFIG` for another private path. Restart after changing configuration.

Set `provider` to `ollama`, `openai`, or `openrouter`, and `model` to an **exact ID** returned by that provider's catalogue. Use `ARKUS_API_KEY` in your local environment or `api_key` in the ignored configuration. Never paste a key into chat or commit it. Ollama uses `http://127.0.0.1:11434/v1`, has no API fee, and requires a separately installed model plus sufficient hardware. It is not installed or downloaded by ARKUS.

Open System controls to discover models and verify access with a minimal real call. Catalogue presence alone does not prove account access. Every cloud model switch verifies the exact ID before activating it. Unknown versions are refused; no nearest-match fallback. A restart restores the configured model. Exact spoken aliases belong in one config dictionary, for example `"aliases": {"my local brain": "EXACT_INSTALLED_ID"}`. `Go back to your normal brain` returns to the configured model. Introductions rotate without making extra API calls.

Paid or unknown-price models are blocked unless you explicitly set `allow_paid_models: true`. OpenRouter's catalogue supplies per-token prices when available; zero-price endpoints still have quotas and provider terms. OpenAI pricing is treated as unknown here and requires the same explicit permission. Availability can change; the PDF's Astra/Fable IDs, prices, dates and performance claims are **not assumed valid**. No key or paid model is enabled by default.

## Voice and vision

Voice output starts only after interaction. `?mute=1` silences every spoken path. Recognition availability depends on Chrome/Edge or the Electron runtime and may use the browser vendor's speech service. Click the ear yourself; no organ enables the microphone. Completed phrases buffer for `FINISH_MS = 900`; `stop` and `wait` interrupt immediately. Speech and microphone require a real device check before relying on them.

Screen and camera controls are separate. Each first opens a local preview. Check the corresponding consent before asking about it. Each vision request captures one **fresh JPEG**; frames are neither saved nor added to chat history. Cloud vision sends that frame to the configured provider, whose own retention rules apply. Stopping sharing clears consent. Never share sensitive content you do not intend to send.

Screen watch requires an **entire monitor**, samples tiny thumbnails locally every 5 seconds, and resets when pixels change. A separately checked cloud-nudge permission permits one frame after 60 seconds of stillness, with a 3-minute cooldown. Pixel stillness is not proof of distraction. Browser-only watch cannot put a card over other desktop apps. The desktop screen picker is explicit, Cancel by default, and captures no audio.

Optional posture awareness requires camera preview, a separate opt-in, and calibration. MediaPipe's model and runtime load from this app, not a remote CDN. Frames and landmarks remain in browser memory; only `present`, `head_down`, and `slouched` booleans reach the local server. The camera estimate is a heuristic, **not phone detection or a medical assessment**. Low confidence and camera angle can cause misses or false nudges. Hips outside the frame disable the torso estimate. Sustained posture uses 700 ms, absence 12 seconds, cooldown 30 seconds. `Give me a minute` silences nudges for 3 minutes. No inference starts the microphone.

## Focus on Windows 11

Focus is voluntary accountability, not an OS lock or a blocker. It never prevents leaving an app. The server owns the timer, so a viewer reload rejoins it. Pause, resume, extend, snooze, excuse, relief, abort, intent and retarget controls are available, including common spoken commands.

In the desktop menu, explicitly enable **foreground app focus sensor**. It queries Windows' actual foreground process every tick. Only session-salted app hashes reach the private reader; a process display label may pass momentarily into speech. Public state, diagnostics and the aggregates-only ledger exclude identities. Home base is ARKUS itself. The sensor is off again after application restart.

**Browser tab/host tracking is not implemented.** Chrome, Edge and other browsers are tracked at app level only. Switching tabs within one browser will not count as drift. The app says "App locked" rather than claiming a tab lock. There is no background-window guess or URL scraping. Browser mode is timer-only and cannot measure attention. A session begun without the sensor stays timer-only; enable the sensor before starting a tracked session.

Starting or retargeting from ARKUS or its desktop card defers the lock until two **distinct fresh foreground readings** agree on a non-ARKUS app. If nothing settles after 45 seconds, it continues as an untracked timer rather than locking home base. The card is always-on-top and nonfocusable; exclusive fullscreen or Windows policies may cover it. It has pause/resume, retarget and end controls.

No app label, tab identity, intent, screenshot or webcam content is written to the focus ledger. Ledger keys are strictly limited to timestamp, planned/active/on-target minutes, drifts, seconds adrift, percent and completed. Unknown sensor time cannot count as on-target. Timer-only sessions report zero measured attention rather than inventing a score.

## Verification and diagnostics

```powershell
npm test
python preflight.py
```

Preflight calls the **running server**, writes one clearly identifiable capture, retrieves it immediately, checks disk/served parity and verifies that configuration cannot be downloaded. It leaves that test capture in your notes intentionally. Offline preflight warns that cloud access and vision are untested.

After configuring credentials and permitting costs, opt into real provider validation with:

```powershell
python preflight.py --live --jpeg "C:\path\to\an-intentionally-shared-test.jpg"
```

This sends the chosen JPEG and makes real provider calls. Missing configuration fails; no mocked success. The JPEG must contain no sensitive information.

`/?mute=1&focusprobe=1` runs the browser logic probe; use a **1440 by 900** viewport. `?focusdebug=1` shows live flags and pixel gates. `/focus/diag` reads the running thread. With Playwright installed, `node tests/browser.cjs` verifies rendered WebGL, real offline chat, source focus, cluster lighting, capture/recall, timer reload and mobile layout. See [verification notes](docs/verification.md) for executed results and remaining device acceptance.

## Security boundaries

The server binds only to loopback and serves an allowlist rooted in `viewer`, plus explicit local vendor assets. It rejects untrusted Host/Origin headers and requires a session token for mutations. The desktop sensor has a separate random authorization token. Notes render as text, never HTML. Electron uses context isolation, sandboxing, no renderer Node access, restricted navigation, and a narrow validated IPC bridge. Dependencies are pinned in the lockfile.

There is no self-modification, model tool execution, arbitrary shell endpoint, automatic credential collection, telemetry, background webcam activation, or public internet server. Another malicious local process under your Windows account remains outside this app's security boundary. Public hosting would need authentication and per-user storage before it could safely serve personal notes; do not expose port 4700 to a LAN or tunnel.

Implementation traceability: [16-prompt acceptance map](docs/requirements.md). Desktop details: [desktop guide](desktop/README.md).

## Skill Forge (v0.4.0)

In Settings → Skill Forge, ARKUS supports AI-authored **declarative numeric skills** through its existing optional model provider, with free offline manual JSON authoring. The available operations are add, subtract, multiply, divide, percentage, average and clamp. Each skill is a bounded JSON definition, tested in the built-in safe calculation engine and explicitly activated before use. Every skill is isolated to its project and retained locally across sessions. No third-party Brahma source code is included. **This is not general Python code generation or self-modifying ARKUS:** there is deliberately no arbitrary script execution, automatic GitHub push, external system control or unreviewed dynamic Python module loading. Gemini requires separately configured API access and may incur provider charges. Never commit a Google API key to GitHub.

## Google Gemini AI provider (v0.4.1)

ARKUS has a direct Google Gemini REST adapter for text chat and **Skill Forge draft creation**. Keep credentials on your own computer in the existing user-data `config.json` (not in GitHub and not in chat). Use the following example after choosing a supported model visible through Google's model-list response:

```json
{"provider":"gemini","model":"gemini-2.5-flash","api_key":"YOUR_PRIVATE_GEMINI_KEY","allow_paid_models":false,"aliases":{}}
```

**Default fail-closed cost guard:** `allow_paid_models:false` blocks Gemini generation calls because ARKUS cannot establish Google's billing/free-tier state from the API catalog. Changing it to true explicitly permits provider-billed requests; never do this unless you accept that costs may occur. Model availability and quotas depend on your Google account. The API key is sent in Google's `X-goog-api-key` request header, not in the URL. Model lists do not establish live credentials until tested. This adapter does not yet provide streaming duplex audio, webcam/vision through Gemini, code-execution sandbox or autonomous self-upgrade.
