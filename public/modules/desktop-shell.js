// Only the Windows host opts in. Browser and macOS layouts remain unchanged.
export function installDesktopShell(doc = document, host = window) {
  if (host.classmateDesktop?.platform !== "windows" || !host.classmateDesktop.frameless || !host.chrome?.webview) return false;
  if (doc.body.classList.contains("windows-desktop")) return true;
  const live = doc.body.classList.contains("live-page");
  const oldHeader = doc.querySelector(live ? ".live-topbar" : ".topbar");
  if (!oldHeader) return false;
  const make = (tag, className, text) => { const node = doc.createElement(tag); node.className = className; if (text) node.textContent = text; return node; };
  const caption = make("header", "desktop-caption"), sidebar = make("nav", "desktop-sidebar");
  sidebar.setAttribute("aria-label", "课堂工作区");
  const brand = oldHeader.querySelector(".brand");
  if (brand) { brand.removeAttribute("href"); brand.removeAttribute("aria-label"); brand.tabIndex = -1; caption.append(brand); }
  const title = make("span", "desktop-project", live ? "实时录音转写" : "未命名课堂");
  caption.append(title);
  const status = doc.querySelector(live ? "#liveHeaderStatus" : ".save-indicator") || doc.querySelector("#saveStatus");
  if (status) caption.append(status);
  if (!live) for (const id of ["saveVersionButton", "apiSettingsButton"]) { const button = doc.getElementById(id); if (button) caption.append(button); }
  const commands = make("div", "desktop-window-controls");
  commands.setAttribute("role", "group"); commands.setAttribute("aria-label", "窗口操作");
  commands.setAttribute("data-window-chrome", "");
  for (const [name, symbol, command] of [["最小化", "−", "minimize"], ["最大化", "□", "toggle-maximize"], ["关闭并缩至托盘", "×", "close"]]) {
    const button = make("button", `desktop-window-button desktop-${command}`, symbol);
    button.type = "button"; button.setAttribute("aria-label", name); button.title = name;
    button.onclick = () => host.chrome.webview.postMessage(`window:${command}`);
    commands.append(button);
  }
  if (live) {
    const back = oldHeader.querySelector(".live-back-button");
    if (back) sidebar.append(back); // Keep the existing recording-leave handler.
  } else {
    for (const id of ["newTaskButton", "historyButton"]) { const button = doc.getElementById(id); if (button) sidebar.append(button); }
    const stage = make("small", "desktop-nav-label", "当前工程");
    sidebar.append(stage);
    const navigation = doc.getElementById("workspaceStageNav");
    if (navigation) sidebar.append(navigation); // Reuse the real view-switching controls.
    const utilities = make("div", "desktop-sidebar-utilities");
    for (const id of ["focusModeButton", "runtimeLogButton", "windowsUpdateButton"]) { const button = doc.getElementById(id); if (button) utilities.append(button); }
    sidebar.append(utilities);
    const project = doc.getElementById("currentProjectTitle");
    const updateTitle = () => { title.textContent = project.textContent || "未命名课堂"; title.title = title.textContent; };
    if (project) { updateTitle(); new host.MutationObserver(updateTitle).observe(project, { childList: true, subtree: true, characterData: true }); }
  }
  host.chrome.webview.addEventListener("message", event => {
    if (!["window:maximized", "window:normal"].includes(event.data)) return;
    const maximized = event.data === "window:maximized";
    const button = commands.querySelector(".desktop-toggle-maximize");
    button.textContent = maximized ? "❐" : "□";
    button.setAttribute("aria-label", maximized ? "还原窗口" : "最大化"); button.title = maximized ? "还原窗口" : "最大化";
    doc.body.classList.toggle("desktop-maximized", maximized);
  });
  doc.body.prepend(caption, sidebar, commands); doc.body.classList.add("windows-desktop");
  oldHeader.hidden = true;
  host.chrome.webview.postMessage("window:ready");
  return true;
}
if (typeof document !== "undefined") installDesktopShell();
