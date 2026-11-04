export function liveCompletion({ interrupted = false, confirmed = false, text = "" } = {}) {
  if (!text.trim()) return { label: "录音已结束，当前没有转写文字", warning: "当前文稿没有可用文字。请保存或下载本机录音，稍后可从录音重新转写。", state: "error" };
  if (interrupted || !confirmed) return { label: "录音已结束，转写可能不完整", warning: "识别发生异常或未确认正常结束。已有文字和本机录音可保存，请检查缺失部分；这不代表整段录音已完成识别。", state: "error" };
  return { label: "录音与识别已结束", warning: "", state: "ready" };
}
