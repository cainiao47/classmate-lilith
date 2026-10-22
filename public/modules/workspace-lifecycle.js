// A transition owns the workspace until saving and loading have both finished.
export function createWorkspaceGate({ busy, save, pending = () => {}, notify = () => {} }) {
  let changing = false;
  return {
    get pending() { return changing; },
    async run(change) {
      if (changing) return false;
      if (busy()) { notify("当前任务尚未结束，请先暂停处理或结束转写，再切换工程。"); return false; }
      changing = true; pending(true);
      try {
        await save();
        if (busy()) throw new Error("任务正在处理，尚未切换工程。");
        await change();
        return true;
      } catch (error) {
        notify(error.message || "保存或打开失败，当前工程未切换。");
        return false;
      } finally { changing = false; pending(false); }
    }
  };
}

export function resultValidity({ hasReview, status, savedHash, currentHash, hasProse, proseChanged }) {
  const reviewStale = Boolean(hasReview && (status === "stale" || (savedHash && savedHash !== currentHash)));
  const proseStale = Boolean(hasProse && (reviewStale || proseChanged));
  return { reviewStale, proseStale };
}

export function liveProtection({ phase, hasRecording, savedTaskId, revision = 0, savedRevision = 0, saving = false }) {
  const busy = saving || ["requesting", "connecting", "recording", "paused", "finalizing"].includes(phase);
  const dirty = Boolean(hasRecording && (!savedTaskId || revision > savedRevision));
  return { busy, dirty, warn: busy || dirty,
    message: busy ? "录音或保存尚未结束，请先结束录音并保存，再离开。" : dirty ? "录音或文稿修改尚未保存，请先保存再离开。" : "" };
}
