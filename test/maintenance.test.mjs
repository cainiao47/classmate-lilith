import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { SettingsStore } from '../settings-store.mjs';
import { TerminologyStore } from '../lib/terminology-store.mjs';
import { writeJsonAtomic, writeFileAtomic } from '../lib/json-file.mjs';
import { readNdjson } from '../public/modules/ndjson-stream.js';
import { createDocx } from '../lib/docx.mjs';
import { TaskStore } from '../lib/task-store.mjs';
import vm from 'node:vm';
async function folder(t){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'lilith-maintenance-'));t.after(()=>fs.rm(dir,{recursive:true,force:true}));return dir;}
test('concurrent settings patches keep unrelated changes',async t=>{
  const dir=await folder(t),store=new SettingsStore({file:path.join(dir,'settings.json')});
  await Promise.all([store.save({deepseekTextModel:'first-model'}),store.save({openaiTextModel:'second-model'})]);
  const loaded=await store.load();assert.equal(loaded.deepseekTextModel,'first-model');assert.equal(loaded.openaiTextModel,'second-model');
});
test('mismatched project files cannot be opened or restored over a working project',async t=>{
  const dir=await folder(t),tasksDir=path.join(dir,'tasks'),versionsDir=path.join(dir,'versions');await fs.mkdir(tasksDir);
  const store=new TaskStore({tasksDir,versionsDir});const file=path.join(tasksDir,'task-example.json');await fs.writeFile(file,JSON.stringify({id:'task-other',sourceText:'retain'}));
  await assert.rejects(store.get('task-example'),/不匹配/);assert.match(await fs.readFile(file,'utf8'),/retain/);
});
test('late version-list responses cannot populate a different project',async()=>{
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');
  const fragment=source.slice(source.indexOf('let versionsRequest=0;'),source.indexOf('function applyTaskToWorkspace'));
  const list={children:[],replaceChildren(){this.children=[]},append(x){this.children.push(x)}};let resolveOld;
  const context=vm.createContext({state:{taskId:'task-old'},$:()=>list,document:{createElement:()=>({})},fetch:()=>new Promise(r=>{resolveOld=r;})});
  vm.runInContext(fragment,context);const pending=vm.runInContext('refreshVersions()',context);
  context.state.taskId='task-new';list.children.push({textContent:'new task list'});
  resolveOld({ok:true,json:async()=>({versions:[]})});await pending;
  assert.equal(list.children.length,1);assert.equal(list.children[0].textContent,'new task list');
});
test('manual version saving retains its original project and deep snapshot across an asynchronous save',async()=>{
  const source=await fs.readFile(new URL('../public/app.js',import.meta.url),'utf8');const fn=source.split(/\r?\n/).find(x=>x.startsWith('async function saveManualVersion()'));
  let releaseSave;const writes=[],chunks=['original'];
  const context=vm.createContext({state:{taskId:'task-before'},currentVersionStage:()=> '校订稿',requestName:async()=> 'example',taskData:()=>({correctedChunks:chunks}),clone:x=>JSON.parse(JSON.stringify(x)),saveTask:()=>new Promise(resolve=>{releaseSave=resolve}),fetch:async(url,options)=>{writes.push({url,body:JSON.parse(options.body)});return{ok:true,json:async()=>({})}},toast(){},el:{historyDrawer:{classList:{contains:()=>false}}}});
  vm.runInContext(fn,context);const pending=vm.runInContext('saveManualVersion()',context);await new Promise(resolve=>setImmediate(resolve));
  chunks[0]='later';context.state.taskId='task-after';releaseSave();await pending;
  assert.equal(writes[0].url,'/api/tasks/task-before/versions');assert.equal(writes[0].body.correctedChunks[0],'original');
});
test('concurrent terminology additions survive and corrupt libraries are never silently overwritten',async t=>{
  const file=path.join(await folder(t),'terms.json'),store=new TerminologyStore({file});await store.initialize();
  await Promise.all([store.upsertTerm({canonical:'甲'}),store.upsertTerm({canonical:'乙'})]);
  assert.deepEqual((await store.load()).terms.map(x=>x.canonical).sort(),['乙','甲']);
  await fs.writeFile(file,'broken original');await assert.rejects(store.upsertTerm({canonical:'丙'}));assert.equal(await fs.readFile(file,'utf8'),'broken original');
});
test('atomic write failures preserve the destination and clean temporary files',async t=>{
  const dir=await folder(t),file=path.join(dir,'task.json');await writeJsonAtomic(file,{original:true});
  const cyclic={};cyclic.self=cyclic;await assert.rejects(writeJsonAtomic(file,cyclic));
  await assert.rejects(writeFileAtomic(file,{}));assert.deepEqual(JSON.parse(await fs.readFile(file,'utf8')),{original:true});
  assert.deepEqual(await fs.readdir(dir),['task.json']);
});
test('a rejected or malformed progress stream cancels upstream and releases its reader',async()=>{
  let cancelled=false;const body=new ReadableStream({start(c){c.enqueue(new TextEncoder().encode('null\n'));},cancel(){cancelled=true;}});
  await assert.rejects(readNdjson(new Response(body),()=>{}),/无效/);assert.equal(cancelled,true);assert.equal(body.locked,false);
});
test('Word XML excludes invalid controls and unpaired surrogates while preserving emoji and text',()=>{
  const data=createDocx('标题\u0000','正文\u0001😀\ud800').toString('utf8');
  const start=data.indexOf('<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document');
  const xml=data.slice(start,data.indexOf('</w:document>',start));assert.ok(start>0);
  assert.match(xml,/正文😀/);assert.doesNotMatch(xml,/[\u0000\u0001\ufffd]/);
});
