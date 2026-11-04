export const WORKSPACE_STAGES = Object.freeze([
  { id: "intake", label: "素材导入", description: "选择录音、实时录音，或直接使用已有文字。" },
  { id: "edit", label: "原文校订", description: "检查原文，补充课程语境，再开始校订。" },
  { id: "review", label: "人工复核", description: "对照原文核对疑点；修改记录可随时查看。" },
  { id: "prose", label: "书面整理", description: "选择成稿形式，生成、编辑并导出书面整理稿。" }
]);

export function preferredWorkspaceStage(s) {
  if (s.reviewStale || ["paused", "failed", "running"].includes(s.status)) return "edit";
  if (s.prose || s.proseEdited || ["paused", "failed", "running"].includes(s.proseStatus)) return "prose";
  if (s.review) return "review";
  return s.source ? "edit" : "intake";
}

export function processingActionLabel({ kind, running, status, sourceMatches, hasText, hasProgress }) {
  const name = kind === "review" ? "校订" : "整理";
  if (running) return `${name}中…`;
  const resume = sourceMatches && !["completed", "stale"].includes(status) && (hasProgress || ["paused", "failed", "running"].includes(status));
  if (resume) return `继续${name}`;
  return hasText ? kind === "review" ? "重新校订" : "重新生成" : kind === "review" ? "开始校订" : "生成整理稿";
}

export function projectProgressLabel(task) {
  const review = { draft: "待校订", running: "校订中断，待继续", paused: "校订已暂停", stale: "原文已变化", failed: "校订待重试" };
  if (task.status !== "completed") return review[task.status] || "待校订";
  return { running: "整理中断，待继续", paused: "整理已暂停", failed: "整理待重试" }[task.proseStatus] || (task.hasProse ? "已有整理稿" : "已完成校订");
}

// Status and prerequisites are independent of the selected view. Browsing an
// earlier stage never resets results or starts a paid task.
export function workspaceStageState(value) {
  const s = { source: "", draft: "", review: "", prose: "", pending: 0, ...value };
  const busy = Boolean(s.busy), ready = Boolean(s.review && s.status === "completed" && !s.reviewStale);
  const textReason = !s.settingsLoaded ? "正在读取文字服务设置…" : !s.textReady ? "尚未配置文字处理服务，请先前往设置。" : "";
  const editReason = s.importingText ? "正在读取文字文件，请稍候；已有原文尚未替换。" : busy ? "当前任务正在处理，完成或暂停后可继续。" : !s.source.trim() ? "还没有原文，请导入文字或采用转写稿。" : textReason;
  const proseReason = busy ? "当前任务正在处理，完成或暂停后可继续。" : !s.review ? "尚未生成校订稿，请先完成原文校订。" : s.reviewStale ? "原文或设置已变化，请先重新校订。旧稿仍保留。" : !ready ? "校订尚未完成，请返回继续校订。" : textReason;
  return {
    ready, editReason, proseReason,
    intakeReason: busy ? "素材正在处理，请稍候。" : s.source.trim() ? "原文已就绪，可以进入校订。" : s.draft.trim() ? "转写稿已就绪，采用后进入校订；已有原文时会先询问。" : "先选择一种素材来源；已有文字可跳过语音转写。",
    badges: {
      intake: s.source || s.draft ? "素材就绪" : "选择来源",
      edit: s.running ? "校订中" : s.reviewStale ? "需更新" : ready ? "已校订" : s.status === "paused" ? "已暂停" : s.status === "failed" ? "待重试" : "待校订",
      review: !s.review ? "待生成" : s.pending ? `${s.pending} 项待核对` : "无待确认项",
      prose: s.proseRunning ? "整理中" : !s.prose.trim() && s.proseEdited ? "文稿为空" : s.proseStale ? "需更新" : s.proseStatus === "paused" ? "已暂停" : s.proseStatus === "failed" ? "待重试" : s.proseStatus === "completed" && s.prose ? "已生成" : "待生成"
    }
  };
}

export function installWorkspaceFlow({ getState, actions, doc = document, host = window }) {
  const main = doc.querySelector(".workspace");
  if (!main) return null;
  const make = (tag, className, text) => {
    const node = doc.createElement(tag); node.className = className;
    if (text) node.textContent = text;
    return node;
  };
  const button = (label, className, click) => {
    const node = make("button", className, label); node.type = "button"; node.onclick = click; return node;
  };
  const nav = make("nav", "workspace-stage-nav"); nav.id = "workspaceStageNav"; nav.setAttribute("aria-label", "工作阶段");
  const heading = make("header", "flow-heading");
  const projectName = make("div", "flow-project-name");
  const eyebrow = make("span", "flow-eyebrow"), title = make("h1", ""), description = make("p", "");
  title.tabIndex = -1; heading.append(projectName, eyebrow, title, description, doc.getElementById("focusModeButton"));
  const activity = make("div", "flow-activity"); activity.hidden = true; activity.setAttribute("role", "status");
  const activityCopy = make("span", "");
  activity.append(activityCopy, button("查看进度", "secondary-button", () => show(getState().proseRunning ? "prose" : "edit")));
  const empty = make("section", "flow-empty"); empty.id = "workspaceStageEmpty"; empty.hidden = true;
  empty.append(make("strong", "", "这里还没有校订结果"), make("p", "", "先在原文校订中完成处理，再来核对疑点和生成书面整理稿。"), button("前往原文校订 →", "primary-button", () => show("edit")));
  const choices = make("section", "source-choices"); choices.setAttribute("aria-label", "素材来源");
  const fileChoice = button("", "source-choice", () => { chooseSource("file"); doc.getElementById("audioInput").click(); });
  fileChoice.append(make("span", "source-icon", "♫"), make("strong", "", "导入录音或视频"), make("small", "", "选择本机文件，在线识别为文字"));
  const liveChoice = doc.getElementById("liveTranscriptionButton");
  liveChoice.className = "source-choice"; liveChoice.replaceChildren(make("span", "source-icon", "●"), make("strong", "", "实时录音转写"), make("small", "", "从麦克风录音，边录边转写"));
  const textChoice = button("", "source-choice", () => { show("edit"); doc.getElementById("sourceText").focus(); });
  textChoice.append(make("span", "source-icon", "文"), make("strong", "", "导入或粘贴文字"), make("small", "", "已有 TXT、Markdown 或字幕，直接校订"));
  choices.append(fileChoice, liveChoice, textChoice);
  const asrHint = make("p", "flow-action-hint"); asrHint.id = "transcriptionActionHint"; asrHint.setAttribute("role", "status");
  doc.getElementById("transcriptionWorkspace").append(asrHint);
  const footer = make("footer", "flow-footer");
  const footerCopy = make("div", "flow-footer-copy"), reason = make("span", "flow-action-hint"); reason.id = "workspaceActionHint"; reason.setAttribute("role", "status");
  const settings = button("前往设置", "text-button", () => actions.settings());
  footerCopy.append(reason, settings);
  const previous = button("上一步", "secondary-button", () => show(WORKSPACE_STAGES[Math.max(0, WORKSPACE_STAGES.findIndex(item => item.id === stage) - 1)].id));
  const intakeActions = make("div", "flow-actions"); intakeActions.dataset.flowActions = "intake";
  const adopt = button("进入原文校订 →", "primary-button", () => {
    const s = getState(); if (!s.source.trim() && s.draft.trim()) actions.accept(); else show("edit");
  }); intakeActions.append(adopt);
  const editActions = doc.querySelector(".editor-execution-row"); editActions.dataset.flowActions = "edit"; editActions.classList.add("flow-actions");
  const inspect = button("查看校订稿 →", "secondary-button", () => show("review")); editActions.prepend(inspect);
  const reviewActions = make("div", "flow-actions"); reviewActions.dataset.flowActions = "review";
  const write = button("进入书面整理 →", "primary-button", () => show("prose")); reviewActions.append(write);
  const proseActions = make("div", "flow-actions"); proseActions.dataset.flowActions = "prose";
  proseActions.append(doc.getElementById("proseButton"), doc.getElementById("proseCancel"));
  const keepVersion = button("保留当前版本", "secondary-button flow-version-fallback", () => doc.getElementById("saveVersionButton").click()); keepVersion.title = "保留一个以后可恢复的完整工作版本；日常修改仍会自动保存。";
  footer.append(footerCopy, previous, keepVersion, intakeActions, editActions, reviewActions, proseActions);
  const navButtons = new Map();
  for (const [index, item] of WORKSPACE_STAGES.entries()) {
    const node = button("", "workspace-stage-button", () => show(item.id)); node.dataset.workspaceStage = item.id;
    const label = make("span", "stage-label", item.label), badge = make("small", "stage-state");
    node.append(make("span", "stage-number", String(index + 1)), label, badge); nav.append(node); navButtons.set(item.id, { node, badge });
  }
  main.prepend(nav, heading, activity, choices, empty); main.append(footer);
  const exitFocus = button("退出专注模式", "focus-exit", () => doc.getElementById("focusModeButton").click());
  doc.body.append(exitFocus);
  doc.body.classList.add("workspace-flow");
  let stage = "intake", taskId = null;
  function chooseSource(mode) { doc.body.dataset.sourceMode = mode; fileChoice.setAttribute("aria-pressed", String(mode === "file")); }
  function refresh() {
    const s = getState(), status = workspaceStageState(s);
    if (s.taskId !== taskId) {
      taskId = s.taskId;
      chooseSource(s.draft || s.hasAudio ? "file" : "choose");
      stage = preferredWorkspaceStage(s);
      applyStage(false);
    }
    for (const [id, item] of navButtons) item.badge.textContent = status.badges[id];
    projectName.textContent = s.projectName || "未命名课堂";
    reason.textContent = stage === "intake" ? status.intakeReason : stage === "edit" ? status.editReason || "原文和语境确认后，开始校订。" : stage === "review" ? !s.review ? "请先完成原文校订。" : !status.ready ? status.proseReason : s.pending ? `还有 ${s.pending} 项待核对，可先复核，也可稍后回来处理。` : "当前没有待确认项，可以进入书面整理，也可直接导出校订稿。" : status.proseReason || (s.proseStale ? "校订稿或成稿形式已变化，请重新生成；旧整理稿仍可查看。" : s.pending ? `还有 ${s.pending} 项未核对；生成前建议先确认。` : "整理稿独立保存；可切换阅读与编辑，导出 TXT、Markdown 或 Word。");
    const returnToEdit = stage === "prose" && !status.ready;
    const configureText = !s.busy && s.settingsLoaded && !s.textReady && (stage === "edit" && s.source.trim() || stage === "prose" && status.ready);
    settings.hidden = !(returnToEdit || configureText);
    settings.textContent = returnToEdit ? "返回原文校订" : "前往设置";
    settings.onclick = () => returnToEdit ? show("edit") : actions.settings();
    adopt.disabled = s.busy || !(s.source.trim() || s.draft.trim());
    adopt.textContent = !s.source.trim() && s.draft.trim() ? "采用转写稿，进入校订 →" : "进入原文校订 →";
    inspect.hidden = !s.review; write.disabled = !status.ready;
    keepVersion.disabled = Boolean(s.busy || !(s.source || s.draft || s.review || s.prose));
    doc.getElementById("saveVersionButton").disabled = keepVersion.disabled;
    doc.getElementById("polishButton").disabled = Boolean(status.editReason);
    doc.getElementById("polishButton").title = status.editReason;
    doc.getElementById("proseButton").disabled = Boolean(status.proseReason);
    doc.getElementById("proseButton").title = status.proseReason;
    asrHint.textContent = s.transcribing ? "正在转写；完成后先核对转写稿，再采用到原文。" : s.draft ? "已有转写草稿，可检查并采用；如需重新转写，请另选录音文件。" : !s.hasAudio ? "请选择录音或视频文件。" : !s.asrReady ? "所选识别服务尚未配置密钥，请点击“配置识别服务”。" : "文件已就绪，可以开始转写。";
    empty.hidden = !(["review", "prose"].includes(stage) && !s.review);
    activity.hidden = !(s.running || s.proseRunning);
    activityCopy.textContent = s.proseRunning ? "书面整理进行中，已完成的内容会自动保存。" : "原文校订进行中，已完成的内容会自动保存。";
    fileChoice.disabled = liveChoice.inert = Boolean(s.busy);
    textChoice.disabled = false;
  }
  function applyStage(focus) {
    doc.body.dataset.workspaceStage = stage;
    const item = WORKSPACE_STAGES.find(item => item.id === stage);
    eyebrow.textContent = `第 ${WORKSPACE_STAGES.indexOf(item) + 1} 步 / 共 4 步`;
    title.textContent = item.label; description.textContent = item.description;
    for (const [id, item] of navButtons) {
      if (id === stage) item.node.setAttribute("aria-current", "step"); else item.node.removeAttribute("aria-current");
    }
    for (const group of [intakeActions, editActions, reviewActions, proseActions]) group.hidden = group.dataset.flowActions !== stage;
    previous.hidden = stage === "intake";
    previous.textContent = `返回${WORKSPACE_STAGES[Math.max(0, WORKSPACE_STAGES.findIndex(item => item.id === stage) - 1)].label}`;
    actions.tab(stage === "prose" ? "prose" : "review");
    doc.getElementById("exportMenu").hidden = true; doc.getElementById("proseExportMenu").hidden = true;
    if (focus) { host.scrollTo({ top: 0, behavior: "auto" }); title.focus({ preventScroll: true }); }
  }
  function show(id, { focus = true } = {}) {
    if (!WORKSPACE_STAGES.some(item => item.id === id)) return false;
    stage = id; applyStage(focus); refresh(); return true;
  }
  refresh(); applyStage(false);
  return { show, refresh, openTask() { taskId = null; refresh(); applyStage(true); }, get stage() { return stage; } };
}
