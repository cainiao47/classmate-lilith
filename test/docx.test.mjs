import assert from "node:assert/strict";
import test from "node:test";
import { createDocx } from "../lib/docx.mjs";

test("createDocx returns a valid ZIP envelope and escapes XML", () => {
  const docx = createDocx("标题 & 测试", "正文 <内容>");
  assert.equal(docx.readUInt32LE(0), 0x04034b50);
  assert.match(docx.toString("utf8"), /标题 &amp; 测试/);
  assert.match(docx.toString("utf8"), /正文 &lt;内容&gt;/);
});
