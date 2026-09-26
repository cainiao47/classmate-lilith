export function cleanText(text) {
  return String(text || "")
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/(?<=[\u3400-\u9fff])\s+(?=[\u3400-\u9fff])/g, "")
    .trim();
}

export function srtToText(srt) {
  const blocks = String(srt || "").replace(/\r\n/g, "\n").trim().split(/\n{2,}/);
  const paragraphs = [];
  for (const block of blocks) {
    const lines = block.split("\n").filter((line) => !/^\d+$/.test(line.trim()) && !/-->/.test(line));
    const text = cleanText(lines.join(" "));
    if (text && !text.includes("请不吝点赞订阅转发打赏") && !text.includes("字幕志愿者")) paragraphs.push(text);
  }
  return `${paragraphs.join("\n\n")}\n`;
}

export function formatSrtTime(milliseconds) {
  const value = Math.max(0, Math.round(milliseconds));
  const hours = Math.floor(value / 3_600_000);
  const minutes = Math.floor(value % 3_600_000 / 60_000);
  const seconds = Math.floor(value % 60_000 / 1000);
  const millis = value % 1000;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")},${String(millis).padStart(3, "0")}`;
}

export function buildSrt(segments) {
  return segments.filter((segment) => segment.text?.trim()).map((segment, index) => `${index + 1}\n${formatSrtTime(segment.startMs)} --> ${formatSrtTime(Math.max(segment.endMs, segment.startMs + 200))}\n${segment.text.trim()}\n`).join("\n");
}

export function approximateSegments(text, offsetMs, durationMs) {
  const parts = cleanText(text).match(/[^。！？!?；;]+[。！？!?；;]?/g)?.filter((part) => part.trim()) || [cleanText(text)];
  const total = Math.max(1, parts.reduce((sum, part) => sum + part.length, 0));
  let cursor = offsetMs;
  return parts.map((part, index) => {
    const share = index === parts.length - 1 ? offsetMs + durationMs - cursor : Math.max(500, durationMs * part.length / total);
    const segment = { startMs: cursor, endMs: Math.min(offsetMs + durationMs, cursor + share), text: part.trim(), approximate: true };
    cursor = segment.endMs;
    return segment;
  });
}
