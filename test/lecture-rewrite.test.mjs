import assert from "node:assert/strict";
import test from "node:test";
import { runLectureRewrite, parseLecturePlan, parseLectureAudit, sourceBlocks, validateLecturePlan, lectureItems, validateLectureDraft } from "../lib/lecture-rewrite.mjs";
import { parseRewriteJson } from "../lib/text-processing.mjs";
import { assembleLecture, proseMarkdown, prosePlainText } from "../public/modules/prose-format.js";

const source = "我想先说明，规则可能影响参与，但并不是唯一的因素。\n\n以两个村庄为例，一个村庄筹资成功，另一个没有成功。这个例子不能直接推广到所有地区。\n\n相关政策年份为【待确认】1996年。";
const planFor = blocks => ({ title: "公共事务参与", sections: [{ title: "规则与参与的关系", block_ids: blocks.map(b => b.id), key_points: ["规则可能影响参与", "两个村庄的对比及适用范围"], protected_facts: ["【待确认】1996年"] }] });
const capture = () => { const events = []; return { events, emit: e => events.push(structuredClone(e)) }; };
const originalFrom = options => options.messages[1].content.match(/<corrected_transcript>\n([\s\S]*?)\n<\/corrected_transcript>/)[1];
function mockModel({ auditIssues = () => [], draft = text => text } = {}) {
  const calls = []; let audits = 0;
  return { calls, request: async options => {
    calls.push(options);
    const user = options.messages[1].content;
    let result;
    if (options.parser === parseLecturePlan) {
      const blocks = JSON.parse(user.slice(user.lastIndexOf("原文块：\n") + 5));
      result = planFor(blocks);
    } else if (options.parser === parseLectureAudit) result = { issues: auditIssues(audits++, options) };
    else result = { written_text: draft(originalFrom(options), options) };
    return { ...options.parser(JSON.stringify(result)), usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } };
  } };
}

test("chapter plans reject omitted, duplicated, foreign and reordered original blocks", () => {
  const blocks = [{ id: 0, text: "甲" }, { id: 1, text: "乙" }, { id: 2, text: "丙" }];
  for (const ids of [[0, 2], [0, 1, 1], [0, 1, 99], [2, 1, 0]]) {
    const plan = planFor(blocks); plan.sections[0].block_ids = ids;
    assert.throws(() => validateLecturePlan(plan, blocks), /遗漏、重复或顺序错误/);
  }
  assert.equal(validateLecturePlan(planFor(blocks), blocks).sections.length, 1);
});

test("chapter subdivision preserves all source material and never merges different chapters", () => {
  assert.deepEqual(sourceBlocks("一个主题。\n\n另一个主题。").map(block => block.text), ["一个主题。", "另一个主题。"]);
  const blocks = sourceBlocks(("例子与限定条件。".repeat(200) + "\n\n").repeat(10));
  const plan = planFor(blocks);
  plan.sections = [{ ...plan.sections[0], block_ids: [blocks[0].id] }, { ...plan.sections[0], title: "另一主题", block_ids: blocks.slice(1).map(b => b.id) }];
  const items = lectureItems(validateLecturePlan(plan, blocks), blocks);
  assert.ok(items.every(item => item.source.length <= 6_000));
  assert.deepEqual(items.flatMap(item => item.block_ids), blocks.map(b => b.id));
  assert.equal(items[0].sectionIndex, 0); assert.equal(items[1].sectionIndex, 1);
});

test("draft guard preserves uncertain phrases verbatim and rejects duplicate document headers", () => {
  assert.equal(validateLectureDraft(source, source), source);
  assert.throws(() => validateLectureDraft(source.replace("【待确认】1996年", "1996年"), source), /待确认/);
  assert.throws(() => validateLectureDraft(source.replace("1996年", "1995年"), source), /待确认/);
  assert.throws(() => validateLectureDraft(`# 多余的标题\n${source}`, source), /重复生成/);
  // Removing oral filler must not be mistaken for summarization solely by length.
  const concise = "规则可能影响参与，但不是唯一因素。".repeat(12);
  assert.equal(validateLectureDraft(concise, `${"嗯，这个，那个，就是说，".repeat(25)}${concise}`), concise);
});

test("lecture assembly numbers subsections across chunks and exports only one title", () => {
  const plan = { title: "学术写作", sections: [{ title: "选题" }, { title: "文献" }] };
  const text = assembleLecture(plan, ["### 3.9 经验问题\n正文。", "### 3.9 理论问题\n另一段。", "### 阅读方法\n**核心概念**。"], [{ sectionIndex: 0 }, { sectionIndex: 0 }, { sectionIndex: 1 }]);
  assert.match(text, /### 1\.1 经验问题/); assert.match(text, /### 1\.2 理论问题/); assert.match(text, /### 2\.1 阅读方法/);
  assert.equal((proseMarkdown(text, "备用标题").match(/^# /gm) || []).length, 1);
  const plain = prosePlainText(text);
  assert.doesNotMatch(plain, /^#{1,6} |\*\*|^>/m);
  assert.match(plain, /核心概念/);
});

test("lecture audit repairs an overstated conclusion then checks the repair against the original", async () => {
  const { events, emit } = capture();
  const model = mockModel({ auditIssues: n => n ? [] : [{ kind: "certainty", source_quote: "规则可能影响参与", draft_quote: "规则决定参与", reason: "候选稿把可能性强化为确定因果" }],
    draft: (text, options) => options.messages[0].content.includes("依据核对问题修订") ? text : text.replace("规则可能影响参与", "规则决定参与") });
  await runLectureRewrite({ text: source, request: model.request, emit });
  assert.equal(model.calls.filter(c => c.parser === parseLectureAudit).length, 2);
  assert.equal(model.calls.filter(c => c.parser === parseRewriteJson).length, 2);
  assert.match(events.find(e => e.type === "final").written_text, /规则可能影响参与/);
  assert.equal(events.filter(e => e.type === "usage").length, model.calls.length);
  assert.equal(events.at(-1).type, "done");
});

test("unresolved omissions never enter completed chunks or a final document", async () => {
  const { events, emit } = capture();
  const model = mockModel({ auditIssues: () => [{ kind: "omission", source_quote: "两个村庄", draft_quote: "", reason: "遗漏具体对比案例" }] });
  await assert.rejects(runLectureRewrite({ text: source, request: model.request, emit }), /核对仍有问题/);
  assert.ok(!events.some(e => e.type === "chunk" || e.type === "final" || e.type === "done"));
});

test("resume reuses the validated chapter plan and completed draft without model calls", async () => {
  const first = capture(), model = mockModel();
  await runLectureRewrite({ text: source, request: model.request, emit: first.emit });
  const checkpoint = first.events.find(e => e.type === "plan").lecturePlan;
  const chunks = first.events.filter(e => e.type === "chunk").map(e => e.written_text);
  const second = capture();
  await runLectureRewrite({ text: source, checkpoint, completedChunks: chunks, completedIndices: [0],
    request: () => { throw new Error("must not call model"); }, emit: second.emit });
  assert.deepEqual(second.events.find(e => e.type === "start").completed, [0]);
  assert.equal(second.events.find(e => e.type === "final").written_text, first.events.find(e => e.type === "final").written_text);
  const changed = capture(), changedModel = mockModel();
  await runLectureRewrite({ text: source, glossary: "新术语", checkpoint, completedChunks: chunks, completedIndices: [0], request: changedModel.request, emit: changed.emit });
  assert.equal(changedModel.calls.filter(c => c.parser === parseLecturePlan).length, 1);
  assert.deepEqual(changed.events.find(e => e.type === "start").completed, []);
});

test("lectures longer than 120000 characters plan and audit every block including the tail", async () => {
  const text = ("需要保留的例子与限定条件。".repeat(150) + "\n\n").repeat(70) + "结尾的唯一观点不能遗漏。";
  assert.ok(text.length > 120_000);
  const { events, emit } = capture(), model = mockModel();
  await runLectureRewrite({ text, request: model.request, emit });
  assert.ok(model.calls.filter(c => c.parser === parseLecturePlan).length > 1);
  assert.equal(model.calls.filter(c => c.parser === parseLectureAudit).length, events.filter(e => e.type === "chunk").length);
  assert.match(events.find(e => e.type === "final").written_text, /结尾的唯一观点不能遗漏/);
});

test("cancelled lecture rewrite makes no model requests or final result", async () => {
  const controller = new AbortController(); controller.abort();
  const { events, emit } = capture();
  await assert.rejects(runLectureRewrite({ text: source, signal: controller.signal, request: () => { throw new Error("unexpected request"); }, emit }), { name: "AbortError" });
  assert.ok(!events.some(e => e.type === "final" || e.type === "done"));
});

test("malformed audit results are errors rather than assumed approval", () => {
  assert.throws(() => parseLectureAudit('{"passed":true}'), /格式无效/);
  assert.throws(() => parseLectureAudit('{"issues":[{"kind":"omission"}]}'), /格式无效/);
});
