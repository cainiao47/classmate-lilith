import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { TaskStore } from "../lib/task-store.mjs";

test("task store owns task, version, and shared transcription lifecycle", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "lilith-task-store-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));
  const removedJobs = [];
  const store = new TaskStore({
    tasksDir: path.join(root, "tasks"),
    versionsDir: path.join(root, "versions"),
    transcriptionManager: { async remove(id) { removedJobs.push(id); return { deleted: true, audioDeleted: true }; } }
  });
  const first = "task-first-0001";
  const second = "task-second-002";
  await store.save(first, { title: "第一课", sourceText: "正文", transcriptionMeta: { jobId: "transcription-shared" } });
  await store.save(second, { title: "第二课", sourceText: "正文", transcriptionMeta: { jobId: "transcription-shared" } });
  assert.equal((await store.list()).length, 2);
  assert.equal((await store.list()).every((task) => task.hasAudio), true);

  await store.rename(first, "农村社会学课程工程");
  assert.equal((await store.get(first)).title, "农村社会学课程工程");
  assert.equal((await store.get(first)).projectTitle, "农村社会学课程工程");

  const version = await store.createVersion(first, { versionLabel: "人工核对后", sourceText: "正文" });
  await store.renameVersion(first, version.id, "定稿前");
  assert.equal((await store.getVersion(first, version.id)).versionLabel, "定稿前");

  const firstRemoval = await store.remove(first);
  assert.equal(firstRemoval.trashed, true);
  assert.deepEqual(removedJobs, []);
  const secondRemoval = await store.remove(second);
  assert.equal(secondRemoval.audioDeleted, false);
  assert.deepEqual(removedJobs, []);
  assert.equal((await store.list()).length, 0);
  assert.equal((await store.list({trash:true})).length, 2);
  await store.restoreDeleted(first);
  assert.equal((await store.get(first)).title, "农村社会学课程工程");
  assert.equal((await store.getVersion(first, version.id)).versionLabel, "定稿前");
});

test("restoring a historical version first preserves current state in a durable independent snapshot", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-restore-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new TaskStore({tasksDir:path.join(root,"tasks"),versionsDir:path.join(root,"versions")});
  const id="task-restore-example";
  await store.save(id,{sourceText:"旧原文",workingText:"旧校订",projectTitle:"自定义名称"});
  const old=await store.createVersion(id,await store.get(id));
  await store.save(id,{sourceText:"最新原文",workingText:"人工修改",proseText:"最新整理",transcriptionMeta:{jobId:"transcription-demo"}});
  const result=await store.restoreVersion(id,old.id);
  assert.equal(result.task.sourceText,"旧原文");assert.equal(result.task.projectTitle,"自定义名称");
  assert.equal(result.task.versionId,undefined);
  const backup=await store.getVersion(id,result.backup.id);
  assert.equal(backup.workingText,"人工修改");assert.equal(backup.proseText,"最新整理");assert.equal(backup.transcriptionMeta.jobId,"transcription-demo");
  assert.match(backup.versionLabel,/恢复前自动备份/);
  await assert.rejects(store.restoreVersion(id,"version-missing"));
  assert.equal((await store.get(id)).sourceText,"旧原文");
});

test("failed recovery snapshot creation never overwrites the working task", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-restore-failed-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new TaskStore({tasksDir:path.join(root,"tasks"),versionsDir:path.join(root,"versions")});
  const id="task-failed-restore";await store.save(id,{sourceText:"历史"});
  const old=await store.createVersion(id,await store.get(id));await store.save(id,{sourceText:"必须保留"});
  store.createVersionActive=async()=>{throw Error("backup failed")};
  await assert.rejects(store.restoreVersion(id,old.id),/backup failed/);
  assert.equal((await store.get(id)).sourceText,"必须保留");
});

test("deleting a project retains audio referenced only by another project's saved version", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-shared-version-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  let removed=false;const store=new TaskStore({tasksDir:path.join(root,"tasks"),versionsDir:path.join(root,"versions"),transcriptionManager:{remove:async()=>{removed=true;return{deleted:true,audioDeleted:true}}}});
  const first="task-current-audio",second="task-version-only";
  await store.save(first,{transcriptionMeta:{jobId:"shared-audio"}});await store.save(second,{sourceText:"new"});
  await store.createVersion(second,{transcriptionMeta:{jobId:"shared-audio"}});
  assert.equal((await store.remove(first)).audioDeleted,false);assert.equal(removed,false);
});

test("history searches all projects and paginates beyond fifty with stable ordering and bounds", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-history-pages-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const tasksDir=path.join(root,"tasks"),store=new TaskStore({tasksDir,versionsDir:path.join(root,"versions")});
  await fs.mkdir(tasksDir,{recursive:true});
  for(let index=0;index<65;index++){
    const id=`task-page-${String(index).padStart(3,"0")}`;
    await fs.writeFile(path.join(tasksDir,`${id}.json`),JSON.stringify({id,title:index===0?"早期田野调查":"课程 "+index,updatedAt:new Date(1_000_000+index*1000).toISOString(),sourceText:"正文"}));
  }
  const first=await store.listPage();assert.equal(first.tasks.length,20);assert.equal(first.total,65);assert.equal(first.pages,4);
  const last=await store.listPage({page:4});assert.equal(last.tasks.length,5);assert.equal(last.tasks.at(-1).id,"task-page-000");
  const found=await store.listPage({query:" 田野 ",page:999});assert.equal(found.total,1);assert.equal(found.page,1);assert.equal(found.tasks[0].title,"早期田野调查");
  assert.equal((await store.listPage({page:-1,pageSize:500})).pageSize,100);
  assert.equal((await store.listPage({query:"不存在"})).total,0);
});

test("soft deletion blocks stale saves and survives interruption without losing versions or recordings", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-trash-recovery-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const options={tasksDir:path.join(root,"tasks"),versionsDir:path.join(root,"versions")},store=new TaskStore(options),id="task-trash-example";
  await store.save(id,{title:"需要保留",sourceText:"最后修改",transcriptionMeta:{jobId:"original-recording"}});
  const version=await store.createVersion(id,{workingText:"旧稿"});
  const current=await store.get(id);
  await store.remove(id);
  await assert.rejects(store.save(id,{sourceText:"迟到的自动保存"}),e=>e.statusCode===410);
  await assert.rejects(store.rename(id,"迟到改名"),e=>e.statusCode===410);
  await assert.rejects(store.removeVersion(id,version.id),e=>e.statusCode===410);
  // Crash after writing the trash marker, before removing its identical active copy.
  await fs.writeFile(store.taskFile(id),JSON.stringify(current));
  const restarted=new TaskStore(options);
  assert.equal((await restarted.listPage()).total,0);
  assert.equal((await restarted.listPage({trash:true,query:"保留"})).total,1);
  await restarted.restoreDeleted(id);
  assert.equal((await restarted.get(id)).sourceText,"最后修改");
  assert.equal((await restarted.get(id)).transcriptionMeta.jobId,"original-recording");
  assert.equal((await restarted.getVersion(id,version.id)).workingText,"旧稿");
  assert.equal((await restarted.listPage({trash:true})).total,0);
});

test("trash backup failures preserve active work and restore never overwrites conflicting records", async t => {
  const root=await fs.mkdtemp(path.join(os.tmpdir(),"lilith-trash-failed-"));t.after(()=>fs.rm(root,{recursive:true,force:true}));
  const store=new TaskStore({tasksDir:path.join(root,"tasks"),versionsDir:path.join(root,"versions")}),id="task-trash-failure";
  await store.save(id,{sourceText:"原工程"});
  await fs.writeFile(store.trashDir,"not a directory");
  await assert.rejects(store.remove(id));
  assert.equal(JSON.parse(await fs.readFile(store.taskFile(id),"utf8")).sourceText,"原工程");
  await fs.unlink(store.trashDir);await store.remove(id);
  await fs.writeFile(store.taskFile(id),JSON.stringify({id,sourceText:"不同的工程内容"}));
  await assert.rejects(store.restoreDeleted(id),/未覆盖/);
  assert.equal(JSON.parse(await fs.readFile(store.taskFile(id),"utf8")).sourceText,"不同的工程内容");
  await fs.access(store.trashFile(id));
});
