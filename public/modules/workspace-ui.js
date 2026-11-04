import { inlineRuns } from "./prose-format.js";

export function createDialogFocus(doc = document) {
  const stack = [];
  const priorInert = new Map();
  function refresh() {
    const top = stack.at(-1);
    for (const child of doc.body.children) {
      if (top) {
        if (!priorInert.has(child)) priorInert.set(child, child.inert);
        child.inert = child !== top.dialog && child !== top.backdrop && !child.contains(top.dialog) && !child.hasAttribute?.("data-window-chrome");
      } else if (priorInert.has(child)) child.inert = priorInert.get(child);
    }
    if (!top) priorInert.clear();
  }
  function focusable(dialog) {
    return [...dialog.querySelectorAll('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]')]
      .filter(e => !e.hidden && e.getClientRects().length && !e.closest('[hidden]'));
  }
  doc.addEventListener("keydown", event => {
    const top = stack.at(-1);
    if (!top) return;
    if (event.key === "Escape") { event.preventDefault(); event.stopImmediatePropagation(); top.close(); }
    if (event.key !== "Tab") return;
    const items = focusable(top.dialog), first = items[0] || top.dialog, last = items.at(-1) || first;
    if (!top.dialog.contains(doc.activeElement) || (!event.shiftKey && doc.activeElement === last) || (event.shiftKey && (doc.activeElement === first || !items.includes(doc.activeElement)))) {
      event.preventDefault(); (event.shiftKey ? last : first).focus();
    }
  }, true);
  return {
    open(dialog, backdrop, close, initial) {
      if (stack.some(item => item.dialog === dialog)) return;
      stack.push({ dialog, backdrop, close, previous: doc.activeElement }); refresh();
      dialog.tabIndex = -1; (initial || focusable(dialog)[0] || dialog).focus();
    },
    close(dialog) {
      const index = stack.findIndex(item => item.dialog === dialog);
      if (index < 0) return;
      const [{ previous }] = stack.splice(index, 1); refresh();
      if (previous?.isConnected && !previous.inert && !previous.disabled) previous.focus();
    }
  };
}

// Only known elements and text nodes are created. Model output is never HTML.
export function renderDocumentPreview(text, container, contents) {
  const doc = container.ownerDocument;
  container.replaceChildren(); contents.replaceChildren();
  const inline = (target, value) => {
    for (const run of inlineRuns(value)) {
      if (run.bold) { const strong = doc.createElement("strong"); strong.textContent = run.text; target.append(strong); }
      else target.append(run.text);
    }
  };
  if (!String(text || "").trim()) {
    const empty = doc.createElement("p"); empty.className = "document-empty"; empty.textContent = "当前文稿为空，可以切换到编辑继续输入。"; container.append(empty);
    const hint = doc.createElement("p"); hint.textContent = "暂无目录"; contents.append(hint); return;
  }
  let paragraph = [], list = null, code = null, headingIndex = 0;
  const flush = () => { if (paragraph.length) { const p = doc.createElement("p"); inline(p, paragraph.join("\n")); container.append(p); paragraph = []; } };
  for (const line of String(text || "").split(/\r?\n/)) {
    if (/^\s*```/.test(line)) { flush(); list = null; if (code) code = null; else { code = doc.createElement("pre"); container.append(code); } continue; }
    if (code) { code.textContent += line + "\n"; continue; }
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      flush(); list = null;
      const h = doc.createElement(`h${heading[1].length}`); inline(h, heading[2]); h.id = `prose-heading-${++headingIndex}`; container.append(h);
      const a = doc.createElement("a"); a.href = `#${h.id}`; a.textContent = h.textContent; a.dataset.level = heading[1].length; contents.append(a); continue;
    }
    const item = line.match(/^\s*(?:([-*+])|\d+[.)])\s+(.+)$/);
    if (item) {
      flush(); const tag = item[1] ? "UL" : "OL";
      if (!list || list.tagName !== tag) { list = doc.createElement(tag.toLowerCase()); container.append(list); }
      const li = doc.createElement("li"); inline(li, item[2]); list.append(li); continue;
    }
    list = null;
    if (!line.trim()) { flush(); continue; }
    if (/^>\s?/.test(line)) { flush(); const quote = doc.createElement("blockquote"); inline(quote, line.replace(/^>\s?/, "")); container.append(quote); continue; }
    paragraph.push(line);
  }
  flush();
  if (!headingIndex) { const p = doc.createElement("p"); p.textContent = "正文没有章节标题"; contents.append(p); }
}
