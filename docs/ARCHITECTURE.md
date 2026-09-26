# Classmate Lilith architecture

Classmate Lilith has one online-only transcription workflow shared by Windows and a future macOS build.

## Stable layers

- `public/`: platform-neutral browser UI.
- `server.mjs` and `lib/`: loopback HTTP service, persistence, online model APIs, exports, logs, and terminology.
- `transcription-worker.mjs`: audio import, FFmpeg normalization/chunking, and online ASR adapters.
- `launcher/`: Windows tray launcher and macOS AppKit menu-bar launcher. Both start the same service, open the loopback URL, and provide a visible quit action.

## Runtime layout

- `runtime/node/`: platform Node runtime.
- `runtime/ffmpeg/`: media preparation runtime required by online ASR.
- Windows stores `data/` and `logs/` beside the executable to preserve the portable-folder workflow.
- macOS stores mutable data under `~/Library/Application Support/Classmate Lilith/data` and logs under `~/Library/Logs/Classmate Lilith`; a running app never modifies its `.app` bundle.
- `CLASSMATE_DATA_DIR` and `CLASSMATE_LOG_DIR` allow a native launcher or test environment to override those defaults.

There is deliberately no component catalog, local model directory, ASR engine discovery, or model download API. Platform-specific code is limited to the launcher, Node runtime, FFmpeg binary name, and process termination.

## Realtime transcription boundary

- `public/live.js` owns microphone permission, browser audio capture, PCM resampling, recording, and the realtime page state. It uses standard Web APIs rather than Windows audio APIs.
- `lib/live-transcription.mjs` exposes the provider-neutral local `/api/live` WebSocket and keeps Tencent, Qwen, and OpenAI protocol details in separate adapters. API credentials never enter the browser page.
- `TranscriptionManager.importLiveResult()` persists a finished live session as an ordinary task, including its recording, timestamped segments, SRT, and editable transcript. The existing review and export workflow therefore does not depend on how the transcript was created.
- The macOS package adds only an AppKit launcher, arm64 Node runtime, arm64 FFmpeg build, Info.plist, and ICNS asset. The browser UI, realtime gateway, provider adapters, task format, and review workflow remain shared.
