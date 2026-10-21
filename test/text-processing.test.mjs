import assert from "node:assert/strict";
import test from "node:test";
import {
  escapeJsonControlCharacters,
  locateUncertainties,
  parseModelJson,
  parseRewriteJson,
  parseRewritePlanJson,
  sanitizeCorrectedText,
  sanitizeWrittenText,
  splitTranscript
} from "../lib/text-processing.mjs";

test("splitTranscript preserves all text while respecting the limit", () => {
  const source = "第一段。\n\n第二段很长，需要被切开。\n\n第三段。";
  const chunks = splitTranscript(source, 12);
  assert.ok(chunks.length > 1);
  assert.equal(chunks.join("\n\n").replace(/\n\n/g, ""), source.replace(/\n\n/g, ""));
  assert.ok(chunks.every((chunk) => chunk.length <= 12));
});

test("model parsers recover JSON surrounded by explanatory text", () => {
  const corrected = parseModelJson('说明文字 {"corrected_text":"正文","uncertainties":[],"changes":[]} 尾部');
  assert.equal(corrected.corrected_text, "正文");
  assert.equal(parseRewriteJson('```json\n{"written_text":"论述稿"}\n```').written_text, "论述稿");
});

test("rewrite plan parser preserves outline and protected facts", () => {
  assert.deepEqual(parseRewritePlanJson('{"outline":"一、问题；二、论证","protected_facts":["1998 年","⟦存疑⟧"]}'), {
    outline: "一、问题；二、论证",
    protected_facts: ["1998 年", "⟦存疑⟧"]
  });
});

test("model parser locally repairs raw control characters inside JSON strings", () => {
  const malformed = '{"corrected_text":"正文","uncertainties":[],"changes":[{"before":"原文","after":"正文","reason":"第一行\n第二行"}]}';
  assert.match(escapeJsonControlCharacters(malformed), /第一行\\n第二行/);
  const parsed = parseModelJson(malformed);
  assert.equal(parsed.corrected_text, "正文");
  assert.equal(parsed.changes[0].reason, "第一行\n第二行");
  const missingQuote = '{"corrected_text":"正文","uncertainties":[],"changes":[{"before":"原文","after":"正文","reason":"删除重复\n}]}';
  assert.equal(parseModelJson(missingQuote).changes[0].reason, "删除重复");
});

test("sanitizeCorrectedText removes leaked prompt wrappers", () => {
  const output = "课程背景：社会学\n术语提示：田野调查\n请只做全文一致性检查：<transcript>这是校订正文。</transcript>";
  assert.equal(sanitizeCorrectedText(output, "这是原始正文。"), "这是校订正文。");
});

test("written prose validation rejects accidental summaries", () => {
  const source = "这是需要完整保留的课堂论述。".repeat(40);
  assert.throws(() => sanitizeWrittenText("一句话摘要。", source), /长度异常/);
  assert.equal(sanitizeWrittenText(source, source), source);
});

test("locateUncertainties keeps only items present in corrected text", () => {
  const located = locateUncertainties("这里是田野访谈内容。", [
    { current_text: "田野访谈", context: "这里是田野访谈内容" },
    { current_text: "不存在的术语" }
  ]);
  assert.equal(located.length, 1);
  assert.equal(located[0].anchor.start, 3);
});
