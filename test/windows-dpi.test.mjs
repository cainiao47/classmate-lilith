import assert from "node:assert/strict";
import fs from "node:fs/promises";
import test from "node:test";

const read = relative => fs.readFile(new URL(relative, new URL("../", import.meta.url)), "utf8");

test("WinForms opts into per-monitor V2 DPI with a compatible runtime and Windows manifest", async () => {
  const config = await read("launcher/app.config"), manifest = await read("launcher/app.manifest");
  assert.match(config, /sku="\.NETFramework,Version=v4\.7\.2"/);
  assert.match(config, /key="DpiAwareness" value="PerMonitorV2"/);
  assert.match(config, /key="EnableWindowsFormsHighDpiAutoResizing" value="true"/);
  assert.match(manifest, /8e0f7a12-bfb3-4fe8-b9a5-48fd50a15a9a/);
  assert.doesNotMatch(manifest, /<dpiAware(?:ness)?\b/);
});

test("the launcher initializes DPI before controls and scales the host rather than forcing browser zoom", async () => {
  const source = await read("launcher/Launcher.cs");
  assert.ok(source.indexOf("Application.EnableVisualStyles()") < source.indexOf("Application.SetUnhandledExceptionMode"));
  assert.match(source, /AutoScaleDimensions = new SizeF\(96F, 96F\)/);
  assert.match(source, /AutoScaleMode = AutoScaleMode\.Dpi/);
  assert.match(source, /override void OnDpiChanged\(DpiChangedEventArgs e\)/);
  assert.match(source, /ConstrainToWorkingArea/);
  assert.doesNotMatch(source, /webView\.ZoomFactor\s*=/);
});

test("builds and installers require and ship the DPI configuration sidecars", async () => {
  const build = await read("launcher/build.ps1"), installer = await read("distribution/build-windows-installer.ps1");
  assert.match(build, /\/win32manifest:\$manifest/);
  assert.match(build, /System\.Runtime\.Versioning\.TargetFramework/);
  assert.match(build, /\$OutputPath \+ '\.config'/);
  assert.match(build, /\$updateOutput \+ '\.config'/);
  assert.match(installer, /Classmate Lilith\.exe\.config/);
  assert.match(installer, /UpdateHelper\.exe\.config/);
});
