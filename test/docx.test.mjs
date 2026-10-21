import assert from "node:assert/strict";
import test from "node:test";
import { createDocx } from "../lib/docx.mjs";

test("createDocx returns a valid ZIP envelope and escapes XML", () => {
  const docx = createDocx("标题 & 测试", "正文 <内容>");
  assert.equal(docx.readUInt32LE(0), 0x04034b50);
  assert.match(docx.toString("utf8"), /标题 &amp; 测试/);
  assert.match(docx.toString("utf8"), /正文 &lt;内容&gt;/);
});

test("prose Word export renders headings, emphasis and notes without duplicate title or Markdown syntax", () => {
  const markdown = "# 原有标题\n\n> **整理原则**：保留例证。\n\n## 一、研究问题\n\n### 1.1 界定范围\n**可能**影响结果，范围 < 全部。\n\n1. **第一类**：内容。";
  const xml = createDocx("备用标题", markdown, { markdown: true }).toString("utf8");
  assert.equal((xml.match(/原有标题/g) || []).length, 1);
  assert.doesNotMatch(xml, /备用标题|##|\*\*|&gt; \*\*/);
  assert.match(xml, /w:outlineLvl w:val="0"/);
  assert.match(xml, /w:outlineLvl w:val="1"/);
  assert.match(xml, /w:outlineLvl w:val="2"/);
  assert.match(xml, /<w:b\/>.*?<w:t xml:space="preserve">可能<\/w:t>/);
  assert.match(xml, /范围 &lt; 全部/);
  assert.match(xml, /1\. /);
});
