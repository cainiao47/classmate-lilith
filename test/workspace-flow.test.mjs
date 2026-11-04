import assert from "node:assert/strict";
import test from "node:test";
import { workspaceStageState, preferredWorkspaceStage, processingActionLabel, projectProgressLabel } from "../public/modules/workspace-flow.js";
import { liveCompletion } from "../public/modules/live-status.js";
import { restoreTaskState } from "../public/modules/task-state.js";

const ready = { source: "原始稿", review: "校订稿", status: "completed", settingsLoaded: true, textReady: true };

test("workspace prerequisites distinguish empty input, missing service, paused and stale review", () => {
  assert.match(workspaceStageState({ settingsLoaded: true }).editReason, /没有原文/);
  assert.match(workspaceStageState({ source: "文字", settingsLoaded: true }).editReason, /配置文字/);
  assert.match(workspaceStageState({ source: "文字" }).editReason, /正在读取/);
  assert.equal(workspaceStageState(ready).proseReason, "");
  for (const status of ["paused", "failed", "running"]) {
    assert.match(workspaceStageState({ ...ready, status }).proseReason, /校订尚未完成/);
  }
  assert.match(workspaceStageState({ ...ready, reviewStale: true }).proseReason, /重新校订/);
  assert.match(workspaceStageState({ ...ready, busy: true }).proseReason, /当前任务正在处理/);
});

test("pending human review remains visible without forcing users to confirm every item", () => {
  const state = workspaceStageState({ ...ready, pending: 5 });
  assert.equal(state.ready, true);
  assert.equal(state.proseReason, "");
  assert.equal(state.badges.review, "5 项待核对");
  assert.equal(workspaceStageState({ ...ready, prose: "旧整理稿", proseStale: true }).badges.prose, "需更新");
});

test("recognition interruption, missing finish acknowledgement and no text cannot show a successful completion", () => {
  assert.equal(liveCompletion({ text: "已识别", confirmed: true }).state, "ready");
  for (const input of [{ text: "部分文字", interrupted: true, confirmed: true }, { text: "部分文字", confirmed: false }, { text: "", confirmed: true }]) {
    const state = liveCompletion(input);
    assert.equal(state.state, "error"); assert.ok(state.warning);
    assert.doesNotMatch(state.label, /转写完成/);
  }
});

test("reopening interrupted work prioritizes its recovery stage over the presence of old text", () => {
  assert.equal(preferredWorkspaceStage({ ...ready, prose: "旧整理稿", status: "paused" }), "edit");
  assert.equal(preferredWorkspaceStage({ ...ready, prose: "旧整理稿", reviewStale: true }), "edit");
  assert.equal(preferredWorkspaceStage({ ...ready, proseStatus: "failed" }), "prose");
  assert.equal(preferredWorkspaceStage({ ...ready, prose: "整理稿" }), "prose");
  assert.equal(preferredWorkspaceStage(ready), "review");
  assert.equal(preferredWorkspaceStage({...ready,proseEdited:true}), "prose");
  assert.equal(workspaceStageState({...ready,proseEdited:true}).badges.prose,"文稿为空");
});

test("resume labels require matching input instead of promising a resume after input changes", () => {
  for (const kind of ["review", "prose"]) {
    const paused = { kind, status: "paused", sourceMatches: true, hasText: true };
    assert.match(processingActionLabel(paused), /^继续/);
    assert.match(processingActionLabel({ ...paused, sourceMatches: false }), /^重新/);
    assert.match(processingActionLabel({ ...paused, status: "completed" }), /^重新/);
  }
  assert.match(workspaceStageState({ ...ready, busy: true, importingText: true }).editReason, /正在读取文字/);
});

test("restoring a terminated stream exposes a paused task while preserving completed text", () => {
  const task=restoreTaskState({id:"task-interrupted",status:"running",proseStatus:"running",workingText:"已完成的校订部分",proseText:"已完成的整理部分"});
  assert.equal(task.status,"paused"); assert.equal(task.proseStatus,"paused");
  assert.equal(task.running,false); assert.equal(task.proseRunning,false);
  assert.equal(task.workingText,"已完成的校订部分"); assert.equal(task.proseText,"已完成的整理部分");
});

test("project history distinguishes interrupted proofreading from unfinished prose", () => {
  assert.equal(projectProgressLabel({status:"paused",proseStatus:"completed",hasProse:true}),"校订已暂停");
  assert.equal(projectProgressLabel({status:"completed",proseStatus:"paused",hasProse:true}),"整理已暂停");
  assert.equal(projectProgressLabel({status:"completed",proseStatus:"failed"}),"整理待重试");
  assert.equal(projectProgressLabel({status:"completed",proseStatus:"completed",hasProse:true}),"已有整理稿");
});
