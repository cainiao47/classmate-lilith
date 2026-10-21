export class UpdateActivity {
  constructor({ now = () => Date.now() } = {}) { this.now = now; this.clients = new Map(); this.requests = 0; }
  report(input) {
    if (typeof input.id !== "string" || !/^[a-z0-9-]{8,80}$/i.test(input.id)) throw new Error("页面编号无效。");
    if (input.closed) this.clients.delete(input.id);
    else this.clients.set(input.id, { seen: this.now(), dirty: Boolean(input.dirty), busy: Boolean(input.busy), kind: input.kind === "live" ? "live" : "main" });
  }
  reasons() {
    const reasons = new Set();
    if (this.requests) reasons.add("后台请求尚未结束");
    for (const [id, client] of this.clients) {
      if (this.now() - client.seen > 180_000) { this.clients.delete(id); continue; }
      if (client.busy) reasons.add(client.kind === "live" ? "实时录音尚未结束或保存" : "转写或整理任务正在进行");
      if (client.dirty) reasons.add(client.kind === "live" ? "实时录音尚未保存" : "有页面修改尚未保存");
    }
    return [...reasons];
  }
}
