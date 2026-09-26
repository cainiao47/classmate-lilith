export const DEFAULT_SHORTCUTS = Object.freeze({
  togglePlayback: "F8",
  applyCurrent: "Control+Enter",
  nextReview: "Alt+ArrowDown",
  previousReview: "Alt+ArrowUp",
  rewindAudio: "Alt+ArrowLeft",
  forwardAudio: "Alt+ArrowRight"
});

export const SHORTCUT_ACTIONS = Object.freeze([
  { id: "togglePlayback", label: "播放 / 暂停", hint: "控制最近使用的录音播放器" },
  { id: "applyCurrent", label: "确认并继续", hint: "应用当前待确认项的已选方案" },
  { id: "nextReview", label: "下一条待确认", hint: "跳到下一条尚未处理的疑点" },
  { id: "previousReview", label: "上一条待确认", hint: "跳到上一条尚未处理的疑点" },
  { id: "rewindAudio", label: "后退 5 秒", hint: "复听当前录音的上一小段" },
  { id: "forwardAudio", label: "前进 5 秒", hint: "跳过当前录音的下一小段" }
]);

const RESERVED = new Set([
  "F5", "Alt+F4", "Control+L", "Control+N", "Control+R", "Control+T", "Control+W",
  "Control+Shift+N", "Control+Shift+T", "Control+Shift+W"
]);

export function shortcutFromEvent(event) {
  if (event.isComposing || event.key === "Process") return "";
  const modifiers = [];
  if (event.ctrlKey) modifiers.push("Control");
  if (event.altKey) modifiers.push("Alt");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.metaKey) modifiers.push("Meta");
  let key = event.key;
  if (["Control", "Alt", "Shift", "Meta"].includes(key)) return "";
  if (key === " ") key = "Space";
  else if (key.length === 1) key = key.toUpperCase();
  return [...modifiers, key].join("+");
}

export function isReservedShortcut(value) {
  return RESERVED.has(String(value || ""));
}

export function displayShortcut(value) {
  if (!value) return "未设置";
  return String(value)
    .replace(/Control/g, "Ctrl")
    .replace(/Meta/g, "Cmd")
    .replace(/ArrowUp/g, "↑")
    .replace(/ArrowDown/g, "↓")
    .replace(/ArrowLeft/g, "←")
    .replace(/ArrowRight/g, "→")
    .replace(/\+/g, " + ");
}

export function isEditableTarget(target) {
  if (!(target instanceof Element)) return false;
  return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
}
