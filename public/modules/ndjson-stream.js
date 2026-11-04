export async function readNdjson(response, onEvent) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `请求失败（HTTP ${response.status}）`);
  }
  if (!response.body?.getReader) throw new Error("服务没有返回可读取的数据流。");

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let completed = false;
  const processLine = (line) => {
    if (!line.trim()) return;
    let event;
    try { event = JSON.parse(line); } catch {
      throw new Error("服务返回了损坏的进度数据，已保留当前完成部分。");
    }
    if (!event || typeof event !== "object" || Array.isArray(event) || typeof event.type !== "string") throw new Error("服务返回了无效的进度事件。");
    onEvent(event);
    if (event.type === "done") completed = true;
  };

  let ended = false;
  try {
  while (true) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
    const lines = buffer.split("\n");
    buffer = lines.pop() || "";
    for (const line of lines) processLine(line);
    if (done) { ended = true; break; }
  }
  processLine(buffer);
  if (!completed) throw new Error("与服务的连接提前结束，任务未被标记为完成；已经收到的进度仍会保留。");
  } finally {
    if (!ended) reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
