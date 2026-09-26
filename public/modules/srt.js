const compactSpeechText = (value) => String(value || "").replace(/[\s，。！？、；：,.!?;:'“”‘’（）()\-—]/g, "").toLowerCase();

export function srtSeconds(value) {
  const match = String(value).match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return match ? Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]) + Number(`0.${match[4]}`) : 0;
}

export function parseSrtSegments(srt) {
  const blocks = String(srt || "").replace(/\r\n/g, "\n").trim().split(/\n{2,}/).filter(Boolean);
  const segments = [];
  let transcriptOffset = 0;
  for (const block of blocks) {
    const lines = block.split("\n");
    const timing = lines.find((line) => line.includes("-->"));
    if (!timing) continue;
    const [start, end] = timing.split("-->").map((part) => part.trim());
    const text = lines.filter((line) => line !== timing && !/^\d+$/.test(line.trim())).join(" ").trim();
    const compact = compactSpeechText(text);
    if (!compact) continue;
    segments.push({ start: srtSeconds(start), end: srtSeconds(end), text, compact, from: transcriptOffset, to: transcriptOffset + compact.length });
    transcriptOffset += compact.length;
  }
  return segments;
}

export function findIssueAudioCue(item, srt, workingText = "") {
  const segments = parseSrtSegments(srt);
  if (!segments.length) return null;
  const transcript = segments.map((segment) => segment.compact).join("");
  const candidates = [item.original, item.current_text, item.suggestion].map(compactSpeechText).filter(Boolean);
  const expected = workingText.length ? Number(item.globalStart || 0) / workingText.length * transcript.length : 0;
  let best = null;
  for (const candidate of [...new Set(candidates)]) {
    let position = 0;
    while ((position = transcript.indexOf(candidate, position)) >= 0) {
      const score = Math.abs(position - expected);
      if (!best || score < best.score) best = { position, score };
      position += Math.max(1, candidate.length);
    }
  }
  if (!best) return null;
  return segments.find((segment) => best.position >= segment.from && best.position < segment.to) || null;
}

export function formatClock(seconds) {
  const value = Math.max(0, Math.floor(Number(seconds) || 0));
  const minutes = Math.floor(value / 60);
  const remainder = value % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}
