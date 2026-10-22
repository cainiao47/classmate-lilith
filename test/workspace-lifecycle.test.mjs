import test from "node:test";
import assert from "node:assert/strict";
import { createWorkspaceGate, resultValidity, liveProtection } from "../public/modules/workspace-lifecycle.js";

test("workspace transitions await the final save and reject overlapping transitions", async () => {
  let finishSave, changed=0;const pending=[];
  const gate=createWorkspaceGate({busy:()=>false,save:()=>new Promise(resolve=>finishSave=resolve),pending:value=>pending.push(value)});
  const first=gate.run(()=>changed++);
  assert.equal(changed,0);assert.equal(gate.pending,true);
  assert.equal(await gate.run(()=>changed++),false);
  finishSave();assert.equal(await first,true);assert.equal(changed,1);assert.deepEqual(pending,[true,false]);
});
test("busy work or failed saving never replaces the workspace", async () => {
  let changed=false,saves=0;const messages=[];
  const gate=createWorkspaceGate({busy:()=>true,save:async()=>saves++,notify:x=>messages.push(x)});
  assert.equal(await gate.run(()=>changed=true),false);assert.equal(saves,0);
  const broken=createWorkspaceGate({busy:()=>false,save:async()=>{throw Error("disk full")},notify:x=>messages.push(x)});
  assert.equal(await broken.run(()=>changed=true),false);assert.equal(changed,false);assert.equal(broken.pending,false);assert.match(messages.at(-1),/disk full/);
});
test("a job starting during final save prevents the transition", async () => {
  let busy=false,changed=false;
  const gate=createWorkspaceGate({busy:()=>busy,save:async()=>{busy=true}});
  assert.equal(await gate.run(()=>changed=true),false);assert.equal(changed,false);
});
test("upstream input changes invalidate both review and prose without deleting old content", () => {
  assert.deepEqual(resultValidity({hasReview:true,status:"completed",savedHash:"old",currentHash:"new",hasProse:true,proseChanged:false}),{reviewStale:true,proseStale:true});
  assert.deepEqual(resultValidity({hasReview:true,status:"completed",savedHash:"same",currentHash:"same",hasProse:true,proseChanged:true}),{reviewStale:false,proseStale:true});
  assert.deepEqual(resultValidity({hasReview:false,hasProse:false}),{reviewStale:false,proseStale:false});
});
test("all active recording and saving phases protect navigation and exit", () => {
  for(const phase of ["requesting","connecting","recording","paused","finalizing"]){assert.equal(liveProtection({phase}).warn,true,phase)}
  assert.equal(liveProtection({phase:"done",saving:true}).busy,true);
  assert.equal(liveProtection({phase:"idle"}).warn,false);
});
test("saving a recording does not hide later transcript or context edits", () => {
  const saved={phase:"done",hasRecording:true,savedTaskId:"task-demo",revision:3,savedRevision:3};
  assert.equal(liveProtection(saved).warn,false);
  assert.equal(liveProtection({...saved,revision:4}).dirty,true);
  assert.equal(liveProtection({...saved,savedTaskId:""}).dirty,true);
});
