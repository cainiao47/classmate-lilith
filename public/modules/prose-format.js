// The same small Markdown subset is used by prose exports on both platforms.
export function proseMarkdown(text, fallbackTitle = "讲座整理稿") {
  const body = String(text || "").replace(/\r\n/g, "\n").trim();
  return `${/^#\s+\S/m.test(body) ? body : `# ${String(fallbackTitle).replace(/[\r\n]+/g, " ")}\n\n${body}`}\n`;
}

export function inlineRuns(text) {
  return String(text).split(/(\*\*[^*\n]+\*\*)/g).filter(Boolean).map(part => ({
    text: part.startsWith("**") && part.endsWith("**") ? part.slice(2, -2) : part,
    bold: part.startsWith("**") && part.endsWith("**")
  }));
}

export function markdownBlocks(text) {
  return String(text).replace(/\r\n/g, "\n").split("\n").map(line => {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) return { type: "heading", level: heading[1].length, text: heading[2] };
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) return { type: "quote", text: quote[1] };
    const list = line.match(/^\s*(\d+[.)]|[-+*])\s+(.+)$/);
    if (list) return { type: "list", marker: /^\d/.test(list[1]) ? list[1] : "•", text: list[2] };
    return { type: "paragraph", text: line };
  });
}

export function prosePlainText(text) {
  return markdownBlocks(text).map(block => `${block.type === "list" ? `${block.marker} ` : ""}${inlineRuns(block.text).map(run => run.text).join("")}`).join("\n");
}

export function chineseNumber(value) {
  if (value >= 100) return String(value);
  const digits = "零一二三四五六七八九";
  return value < 10 ? digits[value] : `${value >= 20 ? digits[Math.floor(value / 10)] : ""}十${value % 10 ? digits[value % 10] : ""}`;
}

export function assembleLecture(plan, chunks, items) {
  const lines = [`# ${plan.title}`, "", "> **讲座文字整理稿**｜依据校订稿整理", "> **整理原则**：保留观点、论据、例证与限定条件，调整口语表达与段落结构；不补充原文之外的知识。本稿未进行外部事实核验，无法确认的内容保留标记。"];
  let previousSection = -1, subsection = 0;
  items.forEach((item, index) => {
    if (!chunks[index]?.trim()) return;
    if (item.sectionIndex !== previousSection) {
      previousSection = item.sectionIndex;
      subsection = 0;
      lines.push("", `## ${chineseNumber(previousSection + 1)}、${plan.sections[previousSection].title}`);
    }
    const body = chunks[index].replace(/^#{1,6}\s+(.+)$/gm, (_, title) => {
      // Titles are generated centrally; numbering cannot restart at a chunk boundary.
      const cleanTitle = title.replace(/^(?:\d+(?:\.\d+)*[、.．\s]+|[一二三四五六七八九十百]+[、．.])\s*/, "");
      return `### ${previousSection + 1}.${++subsection} ${cleanTitle}`;
    });
    lines.push("", body);
  });
  return lines.join("\n").trim();
}
