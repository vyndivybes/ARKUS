# Verification record

Executed on Windows 11 on 16 October 2026. This record distinguishes running local chains from external/device checks.

| Check | Actual result |
| --- | --- |
| Python backend, storage, HTTP, privacy, model refusal, focus edge cases and desktop bridge contracts | 19 tests passed |
| Local posture classification/calibration contracts | 9 tests passed |
| Browser probe at1440x900 | ARKUS PROBE PASS12/12 |
| Real Chromium workflow | WebGL, offline chat, note-source panel, multi-source cluster, live capture, immediate recall, session reload, mobile composition passed; console errors0 |
| Synthetic camera and local MediaPipe runtime | Real WASM/model loading and inference passed; three-boolean-only requests; opt-out cleared state; external requests0; vision frame uploads0 |
| Live local preflight | 10 pass,0 fail,1 warn |
| npm dependency audit | 0 known vulnerabilities after removing the vulnerable build-time global-agent chain through a pinned supported dependency override |
| Windows foreground query | Fresh real Windows process reading passed; no title/URL content emitted |
| Packaged Windows application | Embedded Python backend, WebGL galaxy, live countdown bridge, card pause/end and opt-in fresh Windows sensor passed; no screen/webcam capture |

The preflight warning is intentional: no provider API key was supplied, so a real cloud model answer, model-account access, billable calls and vision understanding have not been demonstrated. Mocked provider parsing tests are not represented as cloud success.

The packaged smoke test is `tests/desktop-smoke.cjs`. It uses a separate local port, mutes all speech, and does not capture a real screen or webcam. The synthetic camera test uses Chromium's fake test device, never the user's webcam.

## Remaining device acceptance

1. Run a muted test tab first. Click a note and confirm the camera dive and readable excerpt. Ask a multi-note comparison and confirm cluster illumination while the camera holds.
2. Enable speech in a foreground tab. Tap the ear. Say "What are the payment", pause less than900ms, then finish "terms?" Confirm one combined question. Say "stop" mid-answer. Open a separate `?mute=1` tab and confirm it never speaks. Confirm browser speech-service privacy is acceptable before dictating sensitive content.
3. Configure an exact provider model privately. Keep costs disabled for free endpoints, or explicitly permit paid/unknown pricing. Verify a real model; request a nonexistent version and confirm refusal. Restart and confirm the configured default returns.
4. Share a non-sensitive test display, preview it, consent to one upload and ask about visible content. Stop the share and confirm no stale frame can be used. Repeat using a non-sensitive camera frame only if desired.
5. Opt into desktop app sensing before starting focus. Start from home, settle on a work app, switch to another app and hear a callout; return home without drift. Pause, resume, excuse and retarget from the card. Switching browser tabs is explicitly unsupported and must not be presented as tracked.
6. Opt into local posture, calibrate with clear nose/shoulders, and test lowering the head. This is a heuristic; verify it in the actual camera framing. Say the relief phrase and confirm silence. Stop camera and confirm all tracks/inference stop.
7. Share the entire display for screen watch. Test stillness and local pixel resets first. Opt into cloud nudges separately only when ready to send a frame. Confirm the3-minute cooldown and the visible desktop indicator. Exclusive-fullscreen overlay behavior needs testing on the destination device.

The local server is not deployed as a public website. It has personal local storage and no remote-account authentication. Desktop delivery is the appropriate deployment for this build.

## Live session reliability, 16 October 2026

Continuation starts at main `037debb383703f37aff19ed4c012e132d52299c8`, after PRs #14–17. GitHub verification run 38853659073 and Windows publication run 38853659079 both succeeded for that exact commit. The v0.8.0-preview release has portable and setup EXEs plus SHA256 sums uploaded at 05:06 UTC. Its release target still names PR #13's commit. Publication now includes ARKUS-BUILD.json to identify the source commit and workflow run for the replaceable preview assets without rewriting historical tags.

The new deterministic regression checks cover binary and Blob WebSocket JSON, microphone disconnection, provider-error cleanup, a connection deadline, oversized packets, late microphone permission and late token responses after restart. Camera tests cover late permission after stop, overlapping starts, disconnect cleanup and denied permission retry. Stale Live project requests are rejected before they can read drafts, write files, remember notes or save transcripts in another project. These tests use fake media and transport, not a real microphone, camera or provider.

The protocol configuration follows Google's Live API reference at https://ai.google.dev/api/live, including a 900 ms silence window. Cloud charges remain disabled unless the user configures permission privately. No provider key or paid subscription was introduced.
