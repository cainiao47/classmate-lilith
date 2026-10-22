import test from "node:test";
import assert from "node:assert/strict";
import { renderDocumentPreview } from "../public/modules/workspace-ui.js";

function documentFixture(){
  const doc={createElement(tag){return{tagName:tag.toUpperCase(),ownerDocument:doc,textContent:"",children:[],dataset:{},append(...items){this.children.push(...items)},replaceChildren(){this.children=[]}}}};
  return doc;
}
test("document preview creates chapter navigation without interpreting model HTML",()=>{
  const doc=documentFixture(),article=doc.createElement("article"),toc=doc.createElement("nav");
  renderDocumentPreview('# 标题\n\n## 章节\n\n<img src=x onerror="alert(1)">\n\n- 第一项\n- 第二项\n\n```\n<script>bad()</script>\n```',article,toc);
  assert.deepEqual(article.children.map(e=>e.tagName),["H1","H2","P","UL","PRE"]);
  assert.equal(toc.children.length,2);assert.equal(toc.children[1].href,"#prose-heading-2");
  assert.match(article.children[2].textContent,/<img/);assert.match(article.children[4].textContent,/<script>/);
  assert.equal(article.children[3].children.length,2);
  renderDocumentPreview("普通段落",article,toc);assert.equal(article.children.length,1);assert.equal(toc.children[0].textContent,"正文没有章节标题");
});
