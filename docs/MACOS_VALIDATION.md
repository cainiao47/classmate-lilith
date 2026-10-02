# macOS preview validation checklist

The macOS port is implemented but must not be called release-ready until this checklist is completed on an Apple Silicon Mac.

## Build inputs

- Apple Silicon Mac running a supported macOS release.
- Xcode command-line tools with `swiftc`, `codesign`, `iconutil`, `sips`, and `plutil`.
- Official arm64 Node.js 22 executable.
- A trusted, redistributable, self-contained arm64 FFmpeg build containing `libmp3lame` and `loudnorm`.
- Exact Node.js and FFmpeg license notices recorded for the release.

## Static and automated checks

- `npm ci`
- `npm run check`
- `npm test`
- `swiftc -typecheck launcher/macos/ClassmateLilithLauncher.swift -framework AppKit -framework Foundation -framework WebKit`
- `plutil -lint launcher/macos/Info.plist`
- `bash -n distribution/build-macos-arm64.sh`

## Package checks

- Run `distribution/build-macos-arm64.sh` with the selected Node.js and FFmpeg binaries.
- Confirm the app and both bundled runtime binaries are arm64.
- Confirm the ZIP expands to `Classmate Lilith.app` with executable permissions intact.
- Confirm no `data`, `logs`, API credentials, recordings, task history, recovery responses, or local models appear in the app or ZIP.
- Confirm the generated SHA-256 file matches the archive.
- Confirm the Finder, Dock, and menu-bar icons use the current Lilith artwork.

## Clean-user behavior

- Move the app to `/Applications` and try to open it from a newly downloaded ZIP.
- Confirm the documented Privacy & Security > Open Anyway flow works without disabling Gatekeeper globally.
- Confirm launch immediately shows a normal app window, startup progress, and a Dock icon without opening a browser.
- Confirm closing the main window leaves the menu-bar item visible and clicking the Dock or menu-bar item restores the window.
- Confirm Show Window, Open Logs, Retry, and Quit and Stop Service work.
- Confirm a second launch reuses the running instance and does not create a second service.
- Confirm a port conflict produces a readable error inside the window and a useful launcher log.

## Functional checks

- Save and reload settings for Qwen, Tencent, OpenAI, and DeepSeek.
- Upload and transcribe a short audio file with every configured online provider.
- Record a short realtime session inside the app window, including the native microphone permission prompt, pause, resume, stop, TXT/Markdown/SRT/audio export, history save, and review handoff.
- Confirm audio/video and text file inputs open a native macOS file picker.
- Confirm TXT, Markdown, SRT, JSON, audio, and Word exports open a native save panel and write valid files.
- Confirm billing/help links open in the default browser while local workbench links remain in the app window.
- Play task audio, follow timestamped segments, locate review issues, edit the transcript, generate written prose, and export TXT/Markdown/Word.
- Delete a history task and confirm its task-owned audio is removed.
- Replace the `.app` with a newer build and confirm settings, history, terminology, recordings, and logs remain under the user Library directories.

## Release decision

Only after the above succeeds should the archive be uploaded as an unnotarized GitHub preview. The release notes must state that Apple has not verified the developer or notarized the build and must link to `docs/MACOS_INSTALL.md`.
