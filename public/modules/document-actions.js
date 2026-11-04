export async function copyDocumentText(text, clipboard) {
  if (!String(text || "").trim()) throw Error("当前没有可复制的文字");
  if (!clipboard?.writeText) throw Error("当前窗口暂不支持剪贴板写入");
  await clipboard.writeText(String(text));
}

export async function fetchWordDocument({ title, text, markdown = false }, fetcher = fetch, { timeoutMs = 30000 } = {}) {
  // Serialize before awaiting: edits and project switches must not change an
  // export that the user has already requested.
  const body = JSON.stringify({ title, text, ...(markdown ? { format: "markdown" } : {}) });
  const controller = new AbortController(); let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => { reject(Error("Word 导出等待超时，请重试或先导出 Markdown")); controller.abort(); }, timeoutMs); });
  const work = async () => {
    let response;
    try { response = await fetcher("/api/export/docx", { method: "POST", headers: { "Content-Type": "application/json" }, body, signal: controller.signal }); }
    catch { throw Error("未能连接本机服务，请重试导出"); }
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw Error(result?.error || "Word 文件生成失败，请重试导出");
    }
    try { return await response.blob(); }
    catch { throw Error("Word 文件接收未完成，请重试导出"); }
  };
  try { return await Promise.race([work(), timeout]); }
  finally { clearTimeout(timer); }
}
