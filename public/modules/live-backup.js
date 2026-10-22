// A failed acknowledgement retains the same fragment/index for retry. Do not
// shift the queue until the server confirms its durable write.
export function createLiveBackup({ fetchImpl = (...args) => fetch(...args), snapshot, onStatus = () => {}, onError = () => {},
  schedule = callback => setTimeout(callback, 3000), cancel = id => clearTimeout(id) }) {
  let id = "", nextIndex = 0, count = 0, queue = [], dirty = false, running = null, retry = null, closed = false, failed = false;
  let lastSavedAt = "";
  const status = () => onStatus({ id, count, pending: queue.length, failed, lastSavedAt });
  async function request(url, options) {
    const response = await fetchImpl(url, { ...options, signal: AbortSignal.timeout(10_000) });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw Error(payload.error || "本机录音恢复点写入失败。");
    return payload;
  }
  function drain() {
    if (running) return running;
    if (!id || closed) return Promise.resolve(false);
    running = (async () => {
      try {
        while (queue.length || dirty) {
          if (queue.length) {
            const part = queue[0];
            const saved = await request(`/api/live-recordings/${id}/chunks/${part.index}`, { method: "POST", body: part.blob });
            queue.shift(); count = saved.persistedChunks;
          }
          // Capture the current metadata only after the fragment is acknowledged.
          // Edits arriving during PATCH set dirty again and are never marked saved.
          dirty = false;
          try {
            const saved = await request(`/api/live-recordings/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(snapshot()) });
            lastSavedAt = saved.updatedAt;
          } catch (error) { dirty = true; throw error; }
          failed = false; status();
        }
        return true;
      } catch (error) {
        failed = true; status(); onError(error);
        if (retry === null && !closed) retry = schedule(() => { retry = null; drain(); });
        return false;
      } finally { running = null; }
    })();
    return running;
  }
  return {
    get id() { return id; },
    async start(metadata) {
      if (id) throw Error("录音恢复点已经启动。");
      const saved = await request("/api/live-recordings", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(metadata) });
      id = saved.id; lastSavedAt = saved.updatedAt; status(); return id;
    },
    attach(recording) { id = recording.id; count = recording.persistedChunks; nextIndex = count; lastSavedAt = recording.updatedAt; status(); },
    append(blob) {
      if (!id || closed || !blob.size) return;
      queue.push({ index: nextIndex++, blob }); dirty = true; status(); drain();
    },
    checkpoint() { if (!id || closed) return; dirty = true; drain(); },
    async flush() {
      if (retry !== null) { cancel(retry); retry = null; }
      if (!dirty && !queue.length && !running) return true;
      return drain();
    },
    async complete(taskId) {
      if (!id || !await this.flush()) return false;
      await request(`/api/live-recordings/${id}/complete`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ taskId }) });
      if (retry !== null) cancel(retry); retry = null;
      return true;
    },
    stop() { closed = true; if (retry !== null) cancel(retry); retry = null; }
  };
}
