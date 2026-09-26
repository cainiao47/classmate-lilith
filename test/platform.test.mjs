import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { mediaPaths } from "../lib/platform.mjs";

test("shared FFmpeg path remains portable across Windows and macOS", () => {
  const root = path.resolve("app");
  assert.match(mediaPaths(root, "win32").ffmpeg, /runtime[\\/]ffmpeg[\\/]ffmpeg\.exe$/);
  assert.match(mediaPaths(root, "darwin").ffmpeg, /runtime[\\/]ffmpeg[\\/]ffmpeg$/);
});
