#!/bin/bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SOURCE_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
OUTPUT_ROOT="$SOURCE_ROOT/dist"
NODE_BIN=""
FFMPEG_BIN=""

usage() {
  echo "Usage: $0 --node-bin /path/to/node --ffmpeg /path/to/ffmpeg [--output /path/to/dist]"
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --node-bin) NODE_BIN="$2"; shift 2 ;;
    --ffmpeg) FFMPEG_BIN="$2"; shift 2 ;;
    --output) OUTPUT_ROOT="$2"; shift 2 ;;
    --help|-h) usage; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; usage; exit 2 ;;
  esac
done

[[ "$(uname -s)" == "Darwin" ]] || { echo "This package must be built on macOS." >&2; exit 1; }
[[ -n "$NODE_BIN" && -x "$NODE_BIN" ]] || { echo "--node-bin must point to an executable Apple Silicon Node.js binary." >&2; exit 1; }
[[ -n "$FFMPEG_BIN" && -x "$FFMPEG_BIN" ]] || { echo "--ffmpeg must point to an executable self-contained Apple Silicon FFmpeg binary." >&2; exit 1; }
for tool in swiftc sips iconutil codesign ditto plutil lipo otool shasum; do
  command -v "$tool" >/dev/null || { echo "Missing macOS build tool: $tool" >&2; exit 1; }
done

node_archs="$(lipo -archs "$NODE_BIN")"
ffmpeg_archs="$(lipo -archs "$FFMPEG_BIN")"
[[ " $node_archs " == *" arm64 "* ]] || { echo "Node.js does not contain an arm64 slice: $node_archs" >&2; exit 1; }
[[ " $ffmpeg_archs " == *" arm64 "* ]] || { echo "FFmpeg does not contain an arm64 slice: $ffmpeg_archs" >&2; exit 1; }
ffmpeg_links="$(otool -L "$FFMPEG_BIN")"
if echo "$ffmpeg_links" | tail -n +2 | grep -E '(/opt/homebrew|/usr/local|@rpath)' >/dev/null; then
  echo "FFmpeg depends on libraries outside the app bundle. Supply a self-contained arm64 build." >&2
  exit 1
fi
ffmpeg_encoders="$("$FFMPEG_BIN" -hide_banner -encoders 2>/dev/null)"
echo "$ffmpeg_encoders" | grep 'libmp3lame' >/dev/null || {
  echo "FFmpeg must include the libmp3lame encoder used by audio normalization." >&2
  exit 1
}
ffmpeg_filters="$("$FFMPEG_BIN" -hide_banner -filters 2>/dev/null)"
echo "$ffmpeg_filters" | grep 'loudnorm' >/dev/null || {
  echo "FFmpeg must include the loudnorm filter used by audio normalization." >&2
  exit 1
}

mkdir -p "$OUTPUT_ROOT"
OUTPUT_ROOT="$(cd "$OUTPUT_ROOT" && pwd)"
[[ "$OUTPUT_ROOT" != "/" && "$OUTPUT_ROOT" != "$HOME" ]] || { echo "Refusing to build directly in a broad system directory." >&2; exit 1; }
APP="$OUTPUT_ROOT/Classmate Lilith.app"
ARCHIVE="$OUTPUT_ROOT/Classmate-Lilith-macOS-arm64.zip"
CONTENTS="$APP/Contents"
MACOS_DIR="$CONTENTS/MacOS"
RESOURCES="$CONTENTS/Resources"
APP_ROOT="$RESOURCES/app"
ICONSET="$OUTPUT_ROOT/ClassmateLilith.iconset"

case "$APP" in "$OUTPUT_ROOT"/*) ;; *) echo "Unsafe output path." >&2; exit 1 ;; esac
rm -rf "$APP" "$ICONSET"
rm -f "$ARCHIVE" "$OUTPUT_ROOT/Classmate-Lilith-macOS-arm64.sha256"
mkdir -p "$MACOS_DIR" "$APP_ROOT/runtime/node/bin" "$APP_ROOT/runtime/ffmpeg" "$APP_ROOT/node_modules"

version="$($NODE_BIN -p "require('$SOURCE_ROOT/package.json').version")"
build_number="$(echo "$version" | tr -cd '0-9')"
[[ -n "$build_number" ]] || build_number="1"

swiftc "$SOURCE_ROOT/launcher/macos/ClassmateLilithLauncher.swift" \
  -parse-as-library \
  -target arm64-apple-macosx13.0 \
  -framework AppKit -framework Foundation \
  -o "$MACOS_DIR/Classmate Lilith"
launcher_archs="$(lipo -archs "$MACOS_DIR/Classmate Lilith")"
[[ " $launcher_archs " == *" arm64 "* ]] || { echo "Launcher does not contain an arm64 slice: $launcher_archs" >&2; exit 1; }
cp "$SOURCE_ROOT/launcher/macos/Info.plist" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $version" "$CONTENTS/Info.plist"
/usr/libexec/PlistBuddy -c "Set :CFBundleVersion $build_number" "$CONTENTS/Info.plist"
plutil -lint "$CONTENTS/Info.plist" >/dev/null

mkdir -p "$ICONSET"
SOURCE_ICON="$SOURCE_ROOT/assets/branding/lilith-app-icon-v1.png"
sips -z 16 16 "$SOURCE_ICON" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$RESOURCES/ClassmateLilith.icns"
rm -rf "$ICONSET"

for file in server.mjs settings-store.mjs transcription-worker.mjs package.json package-lock.json README.md PRIVACY.md THIRD_PARTY_NOTICES.txt WORKBENCH_INFO.txt; do
  cp "$SOURCE_ROOT/$file" "$APP_ROOT/$file"
done
cp -R "$SOURCE_ROOT/public" "$APP_ROOT/public"
cp -R "$SOURCE_ROOT/lib" "$APP_ROOT/lib"
cp -R "$SOURCE_ROOT/node_modules/ws" "$APP_ROOT/node_modules/ws"
cp "$NODE_BIN" "$APP_ROOT/runtime/node/bin/node"
cp "$FFMPEG_BIN" "$APP_ROOT/runtime/ffmpeg/ffmpeg"
chmod 755 "$MACOS_DIR/Classmate Lilith" "$APP_ROOT/runtime/node/bin/node" "$APP_ROOT/runtime/ffmpeg/ffmpeg"

for forbidden in data logs engines models components downloads; do
  [[ ! -e "$APP_ROOT/$forbidden" ]] || { echo "Private or obsolete directory entered the app: $forbidden" >&2; exit 1; }
done

# Free ad-hoc signatures preserve bundle integrity but do not identify a developer
# and do not remove Gatekeeper's first-launch warning.
codesign --force --sign - "$APP_ROOT/runtime/node/bin/node"
codesign --force --sign - "$APP_ROOT/runtime/ffmpeg/ffmpeg"
codesign --force --sign - "$MACOS_DIR/Classmate Lilith"
codesign --force --sign - "$APP"
codesign --verify --deep --strict --verbose=2 "$APP"

ditto -c -k --sequesterRsrc --keepParent "$APP" "$ARCHIVE"
archive_hash="$(shasum -a 256 "$ARCHIVE" | awk '{print $1}')"
printf '%s  %s\n' "$archive_hash" "$(basename "$ARCHIVE")" > "$OUTPUT_ROOT/Classmate-Lilith-macOS-arm64.sha256"

echo "Built: $APP"
echo "Archive: $ARCHIVE"
echo "SHA-256: $archive_hash"
