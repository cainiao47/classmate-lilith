import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const launcher = fs.readFileSync(new URL("../launcher/macos/ClassmateLilithLauncher.swift", import.meta.url), "utf8");
const plist = fs.readFileSync(new URL("../launcher/macos/Info.plist", import.meta.url), "utf8");
const build = fs.readFileSync(new URL("../distribution/build-macos-arm64.sh", import.meta.url), "utf8");
const install = fs.readFileSync(new URL("../docs/MACOS_INSTALL.md", import.meta.url), "utf8");

test("macOS launcher presents the workbench in a native app window", () => {
  assert.match(launcher, /import WebKit/);
  assert.match(launcher, /NSApp\.setActivationPolicy\(\.regular\)/);
  assert.match(launcher, /NSWindow\(/);
  assert.match(launcher, /WKWebView\(/);
  assert.match(launcher, /NSStatusBar\.system\.statusItem/);
  assert.match(launcher, /显示 Classmate Lilith/);
  assert.match(launcher, /退出并停止服务/);
  assert.match(launcher, /TRANSCRIPT_POLISHER_LAUNCH_TOKEN/);
  assert.match(launcher, /CLASSMATE_DATA_DIR/);
  assert.match(launcher, /CLASSMATE_LOG_DIR/);
  assert.match(launcher, /requestMediaCapturePermissionFor/);
  assert.match(launcher, /runOpenPanelWith/);
  assert.match(launcher, /WKDownloadDelegate/);
  assert.match(launcher, /isTrustedLocalURL/);
  assert.match(launcher, /titlebarAppearsTransparent = true/);
  assert.match(launcher, /brandIcon/);
  assert.match(launcher, /underWindowBackground/);
  assert.doesNotMatch(launcher, /NSWorkspace\.shared\.open\(workspaceURL\)/);
});

test("macOS app metadata describes an Apple Silicon windowed application", () => {
  assert.match(plist, /<string>com\.classmatelilith\.app<\/string>/);
  assert.doesNotMatch(plist, /<key>LSUIElement<\/key>\s*<true\/>/);
  assert.match(plist, /<string>ClassmateLilith<\/string>/);
  assert.match(plist, /NSMicrophoneUsageDescription/);
});

test("macOS packager keeps private data out and preserves bundle metadata", () => {
  assert.match(build, /Classmate-Lilith-macOS-arm64\.zip/);
  assert.match(build, /ditto -c -k --sequesterRsrc --keepParent/);
  assert.match(build, /codesign --force --sign -/);
  assert.match(build, /-framework WebKit/);
  assert.match(build, /FFmpeg depends on libraries outside the app bundle/);
  assert.match(build, /for forbidden in data logs engines models components downloads/);
  assert.match(build, /LICENSE ASSETS_LICENSE\.md THIRD_PARTY_NOTICES\.txt/);
  assert.match(install, /隐私与安全性/);
  assert.match(install, /仍要打开/);
});
