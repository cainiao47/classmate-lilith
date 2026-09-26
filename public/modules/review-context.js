const ENDINGS = new Set(["。", "！", "？", "!", "?", "；", ";", "\n"]);

function boundaryBefore(text, index) {
  for (let i = Math.max(0, index) - 1; i >= 0; i -= 1) {
    if (ENDINGS.has(text[i])) return i + 1;
  }
  return 0;
}

function boundaryAfter(text, index) {
  for (let i = Math.max(0, index); i < text.length; i += 1) {
    if (ENDINGS.has(text[i])) return i + 1;
  }
  return text.length;
}

function trimLongSide(value, side, limit = 90) {
  if (value.length <= limit) return value;
  return side === "left" ? `…${value.slice(-limit)}` : `${value.slice(0, limit)}…`;
}

export function buildIssueContext(text, start, end) {
  const source = String(text || "");
  const from = Math.max(0, Math.min(source.length, Number(start) || 0));
  const to = Math.max(from, Math.min(source.length, Number(end) || from));
  if (!source || from === to) return null;

  const currentStart = boundaryBefore(source, from);
  const currentEnd = boundaryAfter(source, to);
  const previousStart = boundaryBefore(source, Math.max(0, currentStart - 1));
  const nextEnd = boundaryAfter(source, currentEnd);

  return {
    previous: source.slice(previousStart, currentStart).trim(),
    before: trimLongSide(source.slice(currentStart, from).replace(/^\s+/, ""), "left"),
    target: source.slice(from, to),
    after: trimLongSide(source.slice(to, currentEnd).replace(/\s+$/, ""), "right"),
    next: source.slice(currentEnd, nextEnd).trim()
  };
}
