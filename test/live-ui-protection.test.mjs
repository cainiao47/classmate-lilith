import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import vm from "node:vm";
import { webcrypto } from "node:crypto";
import { liveProtection } from "../public/modules/workspace-lifecycle.js";

test("live page wires navigation, native exit and updates to the same dirty recording state",async()=>{
  const source=(await fs.readFile(new URL("../public/live.js",import.meta.url),"utf8")).replace(/^import .*;\r?\n/gm,"");
  const handlers=new Map(),elements=new Map();
  const context=vm.createContext({liveProtection,crypto:webcrypto,URLSearchParams,location:{search:""},
    document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,{value:"",disabled:false,addEventListener(){},textContent:"",className:""});return elements.get(selector)},querySelectorAll(){return[]}},
    fetch:()=>new Promise(()=>{}),reportUpdateActivity:()=>({flush:async()=>{}}),setTimeout:()=>0,clearTimeout(){},
    addEventListener:(name,handler)=>handlers.set(name,handler)});
  context.window=context;vm.runInContext(source,context);
  for(const phase of ["requesting","connecting","recording","paused","finalizing"]){
    vm.runInContext(`phase=${JSON.stringify(phase)};window.classmatePrepareExit()`,context);assert.equal(context.classmateExitStatus,"blocked");
    let warned=false;handlers.get("beforeunload")({preventDefault(){warned=true}});assert.equal(warned,true);
  }
  vm.runInContext('phase="done";recordingBlob={size:10};savedTaskId="task-saved";liveRevision=2;liveSavedRevision=1;window.classmatePrepareExit()',context);
  assert.equal(context.classmateExitStatus,"blocked");
  vm.runInContext('liveSavedRevision=2;window.classmatePrepareExit()',context);assert.equal(context.classmateExitStatus,"ready");
  context.fetch=async()=>({ok:true,json:async()=>({saved:true})});
  vm.runInContext('ensureImportedJob=async()=>({id:"transcription-fake",result:{}});liveRevision=3;elements.transcript.value="编辑稿"',context);
  const save=vm.runInContext('createHistoryTask()',context);
  vm.runInContext('liveRevision=4',context);await save;
  assert.equal(vm.runInContext('protection().dirty',context),true,"edits arriving during a save must not be marked saved");
});

test("recovery UI restores audio and text without recognition, saves their association, and protects later edits",async()=>{
  const source=(await fs.readFile(new URL("../public/live.js",import.meta.url),"utf8")).replace(/^import .*;\r?\n/gm,"");
  const elements=new Map(),writes=[],backups=[];
  const element=()=>({value:"",disabled:false,hidden:false,style:{},className:"",textContent:"",children:[],classList:{toggle(){}},addEventListener(){},scrollIntoView(){},
    querySelector(){return element()},replaceChildren(){this.children=[]},append(...children){this.children.push(...children)}});
  const context=vm.createContext({liveProtection,crypto:webcrypto,Blob,URLSearchParams,location:{search:""},confirm:()=>true,
    document:{querySelector(selector){if(!elements.has(selector))elements.set(selector,element());return elements.get(selector)},querySelectorAll(){return[]},createElement:element},
    fetch:()=>new Promise(()=>{}),reportUpdateActivity:()=>({flush:async()=>{}}),setTimeout:()=>0,clearTimeout(){},addEventListener(){},
    createLiveBackup(){const backup={checkpoints:0,stopped:false,attach(){},checkpoint(){this.checkpoints++},flush:async()=>true,complete:async()=>true,stop(){this.stopped=true}};backups.push(backup);return backup;}});
  context.window=context;vm.runInContext(source,context);vm.runInContext('configuredForLive=()=>false',context);
  const id="live-00000000-0000-0000-0000-000000000000";
  let record={id,extension:"webm",bytes:123,persistedChunks:2,topic:"恢复主题",keywords:"示例术语",provider:"alibaba",model:"qwen3-asr-flash-realtime",language:"zh",text:"恢复的文稿",segments:[],durationMs:1234};
  context.fetch=async(url,options)=>{
    writes.push({url,options});
    const value=url===`/api/live-recordings/${id}`?record:url==="/api/live-recordings"?{recordings:[]}:url.includes("/upload?")?{filePath:"isolated-recording.webm"}:url.endsWith("/live-result")?{id:"transcription-restored",result:{}}:{saved:true};
    return {ok:true,json:async()=>value,blob:async()=>new Blob(["synthetic-audio"],{type:"audio/webm"})};
  };
  context.recordingId=id;await vm.runInContext('restoreRecording(recordingId)',context);
  assert.equal(elements.get("#liveTranscript").value,"恢复的文稿");
  assert.equal(vm.runInContext('phase',context),"done");
  assert.equal(vm.runInContext('elapsedMs()',context),1234);
  assert.equal(vm.runInContext('protection().dirty',context),true);
  assert.equal(elements.get("#liveDownloadAudio").disabled,false);
  assert.equal(elements.get("#liveStart").disabled,true,"restoring local data must not require or automatically start an online provider");
  await vm.runInContext('createHistoryTask()',context);
  const task=JSON.parse(writes.find(item=>item.url.startsWith("/api/tasks/")).options.body);
  assert.equal(task.liveRecordingRecoveryId,id);assert.equal(task.transcriptionMeta.jobId,"transcription-restored");
  assert.equal(vm.runInContext('protection().dirty',context),false);
  elements.get("#liveTranscript").value="保存后的修改";elements.get("#liveTranscript").oninput();
  assert.equal(backups[0].checkpoints,1);assert.equal(vm.runInContext('protection().dirty',context),true);
  // A failed replacement must not stop the current recovery writer or erase text.
  context.fetch=async()=>({ok:false,json:async()=>({error:"read failed"})});
  await vm.runInContext('restoreRecording(recordingId)',context);
  assert.equal(backups[0].stopped,false);assert.equal(elements.get("#liveTranscript").value,"保存后的修改");
  elements.get("#liveTranscript").value="";elements.get("#liveTranscript").oninput();
  assert.equal(vm.runInContext('backupSnapshot().text',context),"","clearing edited text must not resurrect old recognition segments");
  assert.ok(!writes.some(item=>/\/api\/(live$|correct|rewrite|transcription\/jobs$)/.test(item.url)));
});
