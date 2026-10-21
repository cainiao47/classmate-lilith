# Release preparation

## Repository contents

Commit source, tests, build scripts, and documentation. Never commit `data/`, `logs/`, `downloads/`, `engines/`, `models/`, `runtime/`, generated archives, API credentials, recordings, or task history.

## Windows

Run `distribution/build-windows-base.ps1` with a trusted runtime seed. The output contains the launcher, Node.js, FFmpeg, application code, and empty data folders. It must not contain local ASR engines, models, component installers, credentials, recordings, or task history.

Before a GitHub Release, test online transcription separately with Alibaba, Tencent, and OpenAI, then test task deletion, logs, exports, and launcher shutdown. Code-sign the launcher when a certificate is available.

For the installed edition, run `distribution/build-windows-installer.ps1` against the clean portable package. Use the existing update-signing private key; the matching public key is committed in `distribution/windows-update-public.pem`. The build writes the EXE, its SHA-256 file, and the signed `windows-update.json` manifest. Never generate a new key to replace a lost release key without a migration plan.

`windows-release.yml` builds Windows only. It requires the `WINDOWS_UPDATE_PRIVATE_KEY` repository secret. A version tag must match `package.json`; workflow dispatch can build without publishing. Publish all generated installer assets together. The older dual-platform workflow is manual only, so a Windows release does not rebuild or republish macOS. See `WINDOWS_INSTALL.md` for installation and validation steps.

## macOS

The first target is Apple Silicon. On a Mac with Xcode command-line tools, provide a trusted arm64 Node.js executable and a self-contained arm64 FFmpeg executable:

```sh
bash distribution/build-macos-arm64.sh \
  --node-bin /path/to/node \
  --ffmpeg /path/to/ffmpeg
```

The script compiles the AppKit menu-bar launcher, creates `Classmate Lilith.app`, generates the ICNS icon, applies free ad-hoc signatures, verifies the bundle, and creates `Classmate-Lilith-macOS-arm64.zip` plus its SHA-256 file. It rejects FFmpeg binaries linked to Homebrew or `/usr/local` libraries because copying those binaries alone would produce a broken portable package.

This preview package is intentionally not signed with Developer ID and is not notarized. GitHub users must try to open it once and then approve it under System Settings > Privacy & Security > Open Anyway. Do not describe it as Apple-verified.

Before release, test on a clean Apple Silicon Mac: first launch, menu-bar reopen/quit, browser microphone permission, ordinary and realtime transcription, audio playback, review positioning, exports, task deletion, data persistence after replacing the app, and Gatekeeper override instructions.

Use `docs/MACOS_VALIDATION.md` as the release gate; do not publish a Mac preview merely because the bundle script completed.

## License decision

Do not make the repository public until the project owner chooses a source-code license and the Node.js/FFmpeg notices have been audited.
