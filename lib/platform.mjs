import { spawn } from "node:child_process";
import path from "node:path";

export function mediaPaths(root, platform = process.platform) {
  return { ffmpeg: path.join(root, "runtime", "ffmpeg", platform === "win32" ? "ffmpeg.exe" : "ffmpeg") };
}

export function terminateProcessTree(child, platform = process.platform) {
  if (!child || child.killed) return;
  if (platform === "win32") {
    spawn("taskkill.exe", ["/PID", String(child.pid), "/T", "/F"], { windowsHide: true });
  } else {
    child.kill("SIGTERM");
  }
}
