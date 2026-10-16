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

## Conversational model fallback and optional current-information search

When a configured and verified language model is accessible, ARKUS now gives **general conversational answers** to questions not covered by local notes. General answers are labeled `kind=general` and have no fabricated note or web citations; they are model responses, not verified live facts. The entirely free offline mode continues to search local project notes and honestly reports missing evidence.

If a user has explicitly configured the Gemini provider with **both** `enable_google_search=true` and `allow_paid_models=true`, questions such as **"Search the web for..."**, **"Look up online..."**, or **"latest news..."** automatically use Google Search grounding, preserve the answer in project conversation history and display returned HTTPS source references in the ordinary conversation panel. Without both opt-ins, ARKUS does **not** make an automatic Google call. This feature may incur Google charges and is not enabled by default. Live duplex voice has separate local function tools for notes, local reminders and project briefing; it does not silently inherit the search permission.

## Approved local project file drafts

Project workspaces now have an **editable file workshop** in System controls, for .md, .txt, .json, .csv, .py and .js draft files. ARKUS can list or read these files through the main conversation (for example, "list project files" or "read project file my-plan.md"). Gemini Live can also propose local project files through native function calling, but the user must explicitly approve each write or replacement in the Windows app. Source-code drafts are saved as text only: **they are never executed, deployed, installed or granted access to the operating system**.

Files are isolated under `projects/<project-id>/drafts/`, with bounded names, size and count; absolute paths, traversal and symlinks are refused. Drafts are included in ARKUS's checksum-verified backup and require the same empty-directory restore. This feature implements ADA-inspired controlled file authoring, **not** self-modifying or autonomous software upgrades.

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

## Gemini Live conversation continuity

When you explicitly start Gemini Live, ARKUS now includes **at most eight recent user/assistant messages from the active project**, with each message truncated to 300 characters, in the provider's session setup. This restores some prior context after a stop/restart. It does **not** send history from other projects or automatically open the microphone, and it does **not** add project notes to the prompt unless a normal approved tool call retrieves them. These short transcripts are sent to Google along with the consented Live session; they are not available to the provider in offline mode. Clearing a project's conversation removes that project's stored transcript context.

History is marked as **untrusted prior dialogue, not instructions or verified facts**. Live tool permissions, cost opt-in and separate approval for file drafts remain unchanged. Cumulative speech transcription updates are merged before saving the final user/assistant exchange so repeated partial phrases do not pollute project memory. This improves the application logic but requires an actual Windows microphone, provider/model-access and latency acceptance test; GitHub unit tests alone do not establish real-time voice reliability.

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

## Controlled local actions (v0.5.0)

In Settings → Controlled actions, queue a calculation and select **Approve once** or **Reject**. Each action belongs to its project, persists in a bounded local audit history, and is explicitly approved individually. The only current executor is local arithmetic (add/subtract/multiply/divide); no shell, filesystem, browser or motor authority is granted. These are deliberately not autonomous LLM tools or general desktop automation. This lays the approval/audit groundwork for later integrations without falsely suggesting that remote code or physical devices can be operated.

## Natural-language action drafting (v0.5.1)

Use Settings → Controlled actions → **Prepare from words** for a bounded numerical calculation, e.g. `Multiply 12 by 8`. In offline mode only basic arithmetic grammar is recognized; when a configured, explicitly permitted model is available it may propose a strict JSON arithmetic operation. Proposals remain **pending** and never execute from model output alone. Review the displayed operands and choose **Approve once** or **Reject**. Any unrelated requested tool, browser action, file operation or motor control is refused. This is an initial constrained action intent pipeline, **not** full ADA automatic tool execution.

## Native Gemini Live voice (v0.6.0 preview)

Click **LIVE** beside the microphone to begin a real-time **opt-in Gemini Live session**; click the same control again to stop. ARKUS uses the browser/Electron microphone via a local AudioWorklet (16 kHz PCM), Google's WebSocket Live endpoint with a **one-use constrained ephemeral token**, and native 24 kHz PCM spoken output. The client handles speech interruptions and optionally shows transcripts in the conversation panel. Live transcripts are not added to persistent project history automatically. Existing typed chat and the separate microphone button continue to work.

**Private configuration:** Configure `%APPDATA%\\arkus\\config.json` for Windows desktop (or `config.json` for source browser mode) with `"provider":"gemini"`, `"api_key":"YOUR_PRIVATE_GOOGLE_API_KEY"`, `"live_model":"gemini-3.1-flash-live-preview"`, `"enable_gemini_live":true`, and `"allow_paid_models":true`. All other settings may remain unchanged. Never paste a key into chat or commit it. You may use `ARKUS_API_KEY` instead of storing your key in a file. The local server holds the permanent key and requests a short-lived, one-use token. The UI uses the token to connect directly to Google; ephemeral tokens remain visible to developer tools while valid. **Every audio session sends microphone data to Google and may incur API charges.** Nothing is transmitted until you click LIVE, grant microphone permission and a token is issued. Tokens are not requested automatically, and no background listening continues after stopping.

**Important limitations:** This is a provider-integrated pathway, not proof that an account can access the Live model or that a particular Windows microphone/speaker works. A physical device and real provider run are still required for that verification. It is not an offline model, voice wake word, screen narration or browser/CAD/robot tool control. Function calls arriving from the Live model are explicitly refused; there are no autonomous external actions. A call may end after provider limits or token expiry, requiring deliberate reconnection. Browser autoplay permissions, echo cancellation and microphone OS permissions affect reliability.

## Live camera conversation (implementation in progress)

Gemini Live now accepts **explicitly consented camera video** while its native duplex voice session is active. Start **Camera → Enable camera preview**, check **Share live camera frames with Gemini during LIVE**, and press **LIVE** in the conversation panel. Frames are sent as JPEG through Gemini Live's `realtimeInput.video` at a maximum of 1 frame per second while the camera, consent and Live session are all active. ARKUS requests a brief opening description after the first shared frame, then accepts follow-up spoken questions in the same conversation. Unchecking the live camera consent, stopping the camera, or ending Live stops the stream. Ordinary camera posture/gesture preview remains local, and one-shot **Ask about camera** retains its separate consent.

This is implemented as a Live provider integration, **not independently proven with the user's actual Gemini account, microphone or webcam**. Model support, quota, provider cost and device acceptance are still required. The regular microphone button and typed/offline chat remain separate fallback paths; opening a camera alone never starts the microphone. No frames are stored in project memory.

## v0.7.0 — Public reference browser, editable primitive CAD, contactless navigation

**Controlled public research:** The Windows desktop app has a separately sandboxed, nonpersistent Electron research window. It accepts only approved HTTPS references (Wikipedia, GitHub, Python docs, MDN, arXiv, PyPI). Users can explicitly open a page, read up to 6,000 text characters locally, and find a phrase. Unapproved domains and schemes, remote permissions and popups are rejected; the research page has no Node/preload privileges or access to ARKUS project memory. This is **read-only assisted browsing**, not an autonomous Playwright agent, general web shopping, account login, posting, or forms automation. Browser mode without the Windows desktop shell displays the limitation.

**Editable parametric primitive assemblies:** In Settings → Local 3D mesh workshop → Editable parametric CAD assemblies, add 1–8 supported box/cylinder/tube parts, edit their numerical dimensions and XYZ positions, save to the active project, revise with optimistic revision checks, and export one combined binary STL. All work is offline. STL parts are separate intersecting/nonintersecting meshes; there is **no Boolean geometry, B-rep, STEP, build123d, design constraint solver or structural validation**. Do not use this for flight-critical/bicycle release decisions without an actual CAD/CAE process.

**Local raised-arm gestures:** Camera → Enable camera preview → opt in to local gesture controls. MediaPipe's existing locally bundled PoseLandmarker observes shoulders and wrists. Hold **left arm** to choose the previous knowledge source, **right arm** to choose the next, or **both arms** to toggle Settings. Hold time 650 ms and cooldown 1800 ms. No frames or pose landmarks leave the device for gesture control; the microphone is never enabled by gesture. This is **coarse raised-arm recognition**, not finger pinch/drag, full MediaPipe hand tracking or face authentication.

These features remain opt-in. Full ADA V2 parity—including autonomous web actions, editable solid/STEP CAD, precise finger gesture manipulation—and O.L.L.I.E robotics remain pending. No unsupported copyrighted source has been copied.

**3D CAD preview:** Use **Preview 3D assembly** in the editable CAD section to rotate and zoom a local Three.js scene built from the editable JSON parameters before export. The preview has no inference, cloud cost, Boolean mesh union or structural validation.

**One-click reference lookup:** Type a public Wikipedia topic into the Research Browser and select **Search and read public article**. ARKUS opens the approved public URL in its separate local window and extracts a short page text preview. It never sends the page to an AI model automatically or executes forms. This is bounded scripted lookup rather than full autonomous web browsing.

## ARKUS v0.8: Knowledge & Intelligence Engine

**Document-backed offline knowledge.** Settings → Project knowledge base imports one explicitly selected TXT, Markdown, DOCX or text-based PDF up to 2 MB. Each project gets an isolated SQLite FTS5 database with chunked full-text retrieval, a list of sources, removal controls and references attached to responses from imported documents. Maximum 50 documents per project. Both the document text and its index remain on the local machine; source snippets leave the machine **only if** a configured cloud LLM is invoked to answer a question. PDFs that contain only scans require OCR and are not supported. The Windows EXE includes the checksum-verified open-source `pypdf` 6.0.0 parser (BSD-3-Clause). For source checkout, install `pypdf==6.0.0` separately if you want to index text PDFs.

**Google Search grounding.** Settings → Online Google Search grounding offers an explicit paid-cost-consent search, returning Google's text response and attributed public HTTPS sources (when the provider returns citations). Add `"provider":"gemini"`, `"api_key":"YOUR_PRIVATE_KEY"`, `"enable_google_search":true`, and `"allow_paid_models":true` in your local config (never commit a credential). This is **off by default** because API calls and grounding may incur charges or have quotas. Web search is never silently triggered by an ordinary question.

**Ollama/local models.** Existing `"provider":"ollama"` integration remains available as the optional no-key local reasoning backend. It does not bundle or download a model or guarantee your machine can run one. Without a provider, imported documents remain searchable offline.

**MCP client foundation (modern stateless HTTP 2026-07-28).** In the local config, for example:
```json
"mcp_servers": [
  {"name":"local","url":"http://127.0.0.1:7800/mcp","enabled":true,"allow_tools":["search_notes"]}
]
```
Settings → Local MCP tools discovers only server-advertised `readOnlyHint:true` tools that are explicitly allowlisted; the user must approve each invocation with displayed JSON parameters. Remote URLs, redirects, STDIO processes, unapproved/write tools and automatic model-chosen execution are not supported. MCP response transport supports bounded JSON only, not streaming SSE, remote OAuth or unrestricted agents. For tools with side effects despite `readOnlyHint`, do not approve the server until you trust its implementation. This is a controlled MCP client subset, **not** the general Claude Desktop plugin ecosystem.

**Current limitations.** This is full-text retrieval, not vector-semantic embeddings or a general folder watcher. External web results are not added to local knowledge automatically. Engineering files such as native CAD, STEP and scanned PDFs still need dedicated parsers. The Windows preview is unsigned; no automatic software upgrades are enabled.

**Backup:** Existing ARKUS ZIP snapshot/restore now includes project knowledge SQLite databases as local data (up to 32 MB per database, 40 MB total archive). Credentials are still excluded. Restore remains restricted to an empty destination. If an archive exceeds these bounds, backup refuses rather than silently discarding knowledge.

## Tested skill revisions and recoverable project tooling

Active calculation skills now support independently authored expected-result examples and candidate upgrades. In Skill Forge, select **Prepare upgrade**, edit the specification and its `tests` examples, then **Draft upgrade**. A candidate retains the active skill's name and input interface. Testing compares actual results with the expected values. A failing example never replaces the working revision. **Activate skill** swaps a passing candidate atomically; **Roll back** restores its preceding tested revision. Concurrent stale candidates are refused. This remains a bounded declarative arithmetic engine, not execution or installation of generated Python or JavaScript.

The project file workshop can **Check saved Python/JSON syntax**. It parses the named saved file and reports syntax errors without importing or executing that file. Passing syntax does not prove correct behavior or safe execution. Draft validation includes a content checksum in the API response.

Project backups now include calculation-skill revisions, parametric CAD registries and controlled-action history. Arbitrary scripts, credentials and activity ledgers remain excluded. Recovery still requires an empty destination. An empty `ARKUS_NOTES_DIR` now uses the project's local notes folder rather than scanning the process working directory.

## MCP and Windows project/research tools

Configured loopback MCP endpoints support the 2026-07-28 request metadata and safe mirrored parameter headers, paginated discovery, bounded JSON responses and bounded request-scoped SSE with progress notifications. Tool allowlists, explicit approval and the server's read-only annotation remain required. HTTP proxies and redirects are disabled. Legacy handshake/SSE sessions, remote endpoints, process launching and interactive server input requests remain unsupported. A real loopback fixture exercises discovery and tool calls; no third-party server credentials were supplied. Protocol reference: https://modelcontextprotocol.io/specification/2026-07-28/basic/transports/streamable-http.

The isolated Windows public research browser lists up to 30 approved HTTPS references from a page's first 200 links. Selecting a reference opens that exact reviewed URL. Script URLs, private addresses, other hosts, forms, permissions and downloads remain blocked. Page content is untrusted reference material.

The draft workshop can **Open saved draft in Windows Notepad**. It opens only the active project's saved, bounded file through a fixed Notepad executable with separate arguments. Python and JavaScript files are opened as text, never launched through a file association. This provides a narrow local desktop editing action; it is not arbitrary computer control.

## Windows microphone behavior

The primary microphone button now routes to Gemini Live when browser speech recognition is missing (as on many Electron installs). When browser dictation fails with a network error, the next microphone click uses the same explicit Gemini Live start/stop action. Native audio still requires a user-configured Gemini provider, a supported model, explicit paid-model opt-in and microphone permissions; ARKUS does not silently enable billable calls. A declined Windows microphone permission reports the appropriate Settings path. Permission prompts are no longer counted against the provider connection deadline. Actual physical input and provider access still require on-device acceptance.

## Gemini Live HTTP 400 diagnostics

A banner such as **Gemini · KEY LOADED** confirms only that a private key exists; it does not prove a successful Google API request. If LIVE reports **HTTP 400**, Google has rejected the server-side `/v1beta/auth_tokens` request **before the microphone can stream**. ARKUS now reports only the safe Google error-status code (for example `INVALID_ARGUMENT`), never the provider's raw error body or the secret key. Check that `%APPDATA%\\arkus\\config.json` contains a Gemini *API key*, not a Google Calendar OAuth client ID. For a modern compatible Live model use `"live_model":"gemini-3.8-live"`; save and fully restart the Windows app. The normal `"model"` key selects a separate text generation model. A legacy/new-format key issue was previously reported to Google and marked resolved in May 2026; do not infer key incompatibility solely from a 400. Use Google AI Studio to confirm the project's key restrictions and model access. No automatic fallback to unconstrained tokens or exposing a permanent key to the browser is permitted. Gemini Live may incur charges.


## Opt-in workaround for Google HTTP 400 on Live token constraints

If Google successfully issues `{"uses":1}` tokens but rejects all `liveConnectConstraints` requests with HTTP 400, there is a **separate, explicitly opt-in** setting:

```json
"allow_unconstrained_live_token": true
```

The default is **false**. With the switch enabled, ARKUS first attempts its constrained token as before. **Only** if Google returns HTTP 400 will it retry **once** with the Google-documented basic one-use Live token. The initial new-session deadline stays at 55 seconds and the token expires after 25 minutes. ARKUS still uses your configured `live_model`, keeps the permanent Google API key solely in the local Python backend and requires existing paid-model permission. This does **not** give remote sites general credentials or authorize unrestricted automation; however, unlike the constrained token, **the basic token is not model-locked** and could be misused during its brief validity if extracted from the client. Enable this only on your trusted private Windows computer; disable it afterward if the provider fixes constrained token support. A successful token request is not proof that Google's Live WebSocket will accept the model or return speech. Explicit user consent is still required for microphone access.
