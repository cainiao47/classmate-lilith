import assert from "node:assert/strict";
import test from "node:test";
import { copyDocumentText, fetchWordDocument } from "../public/modules/document-actions.js";
import { renderDocumentPreview } from "../public/modules/workspace-ui.js";

test("clipboard actions preserve Markdown verbatim and report unsupported, denied and empty cases", async () => {
  const copied=[];await copyDocumentText("## **标题**\n正文",{writeText:async text=>copied.push(text)});
  assert.deepEqual(copied,["## **标题**\n正文"]);
  await assert.rejects(copyDocumentText("文字",null),/剪贴板/);
  await assert.rejects(copyDocumentText("文字",{writeText:async()=>{throw Error("permission denied")}}),/denied/);
  await assert.rejects(copyDocumentText("  ",{writeText:async()=>assert.fail("empty text must not touch the clipboard")}),/没有可复制/);
});

test("Word export freezes its request before asynchronous work and preserves the Markdown mode", async () => {
  const snapshot={title:"导出时的标题",text:"导出时的正文",markdown:true};let sent,finish;
  const pending=fetchWordDocument(snapshot,async(url,options)=>{assert.equal(url,"/api/export/docx");sent=JSON.parse(options.body);return new Promise(resolve=>finish=resolve)});
  snapshot.title="另一个工程";snapshot.text="后来的修改";
  finish({ok:true,blob:async()=>new Blob(["synthetic docx"])});await pending;
  assert.deepEqual(sent,{title:"导出时的标题",text:"导出时的正文",format:"markdown"});
});

test("Word export reports network, non-JSON error and interrupted response failures", async () => {
  const snapshot={title:"示例",text:"正文"};
  await assert.rejects(fetchWordDocument(snapshot,async()=>{throw Error("offline")}),/未能连接/);
  await assert.rejects(fetchWordDocument(snapshot,async()=>({ok:false,json:async()=>{throw Error("bad json")}})),/生成失败/);
  await assert.rejects(fetchWordDocument(snapshot,async()=>({ok:false,json:async()=>({error:"磁盘空间不足"})})),/磁盘空间不足/);
  await assert.rejects(fetchWordDocument(snapshot,async()=>({ok:true,blob:async()=>{throw Error("body aborted")}})),/接收未完成/);
});

test("a stalled Word response times out and aborts without waiting indefinitely", async () => {
  let signal;
  await assert.rejects(fetchWordDocument({title:"示例",text:"正文"},async(_,options)=>{signal=options.signal;return{ok:true,blob:()=>new Promise(()=>{})}},{timeoutMs:10}),/等待超时/);
  assert.equal(signal.aborted,true);
});

function previewFixture() {
  const doc={createElement:tag=>new Node(tag)};
  class Node {
    constructor(tag){this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.dataset={};this.value=""}
    append(...items){this.children.push(...items)}
    replaceChildren(...items){this.children=[];this.value="";this.append(...items)}
    set textContent(value){this.children=[];this.value=String(value)}
    get textContent(){return this.value+this.children.map(child=>typeof child==="string"?child:child.textContent).join("")}
    set innerHTML(_){assert.fail("model text must never be interpreted as HTML")}
  }
  return {article:doc.createElement("article"),contents:doc.createElement("nav")};
}

test("reading preview formats the same bold subset as exports and builds clean heading labels", () => {
  const {article,contents}=previewFixture();
  renderDocumentPreview("# **研究方法**\n\n保留**限定条件**。\n\n- **访谈**与观察\n\n> **说明**：仅依据原文。",article,contents);
  assert.equal(contents.children[0].textContent,"研究方法");
  assert.equal(article.children[0].children[0].tagName,"STRONG");
  assert.equal(article.textContent,"研究方法保留限定条件。访谈与观察说明：仅依据原文。");
});

test("reading preview leaves HTML and code literals as text and gives an empty-document recovery hint", () => {
  const {article,contents}=previewFixture();
  const hostile='<img src=x onerror="alert(1)">';
  renderDocumentPreview(`**${hostile}**\n\n\`\`\`html\n<script>alert(1)</script>\n\`\`\``,article,contents);
  assert.equal(article.children[0].children[0].tagName,"STRONG");
  assert.equal(article.children[0].textContent,hostile);
  assert.equal(article.children[1].tagName,"PRE");
  assert.match(article.children[1].textContent,/<script>/);
  renderDocumentPreview("",article,contents);
  assert.match(article.textContent,/切换到编辑/);assert.equal(contents.textContent,"暂无目录");
});
