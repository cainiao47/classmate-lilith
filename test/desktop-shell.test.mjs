import test from "node:test";
import assert from "node:assert/strict";
import { installDesktopShell } from "../public/modules/desktop-shell.js";
import { createDialogFocus } from "../public/modules/workspace-ui.js";

// Small DOM fixture: retaining the original buttons is essential because the
// workspace owns their save, history, settings and recording-leave handlers.
function fixture({ live = false } = {}) {
  class Element {
    constructor(tag = "div") {
      this.tagName = tag; this.children = []; this.attributes = {}; this.textContent = "";
      this.className = ""; this.id = "";
      this.classList = {
        contains: name => this.className.split(" ").includes(name),
        add: name => { if (!this.classList.contains(name)) this.className += ` ${name}`; },
        toggle: (name, on) => { this.className = this.className.split(" ").filter(value => value !== name).join(" "); if (on) this.classList.add(name); }
      };
    }
    append(...nodes) { for (const node of nodes) { if (node.parent) node.parent.children = node.parent.children.filter(child => child !== node); node.parent = this; this.children.push(node); } }
    prepend(...nodes) { this.append(...nodes); this.children = [...nodes, ...this.children.filter(node => !nodes.includes(node))]; }
    setAttribute(name, value) { this.attributes[name] = value; }
    hasAttribute(name) { return Object.hasOwn(this.attributes, name); }
    removeAttribute(name) { delete this.attributes[name]; }
    contains(node) { return node === this || this.children.some(child => child.contains(node)); }
    focus() { doc.activeElement = this; }
    querySelectorAll(selector) { return this.children.flatMap(node => [...(selector.startsWith(".") && node.classList.contains(selector.slice(1)) || selector.startsWith("#") && node.id === selector.slice(1) ? [node] : []), ...node.querySelectorAll(selector)]); }
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
    get hash() { return this.href; }
    getBoundingClientRect() { return { top: this.top ?? 200, height: this.height ?? 100 }; }
  }
  const doc = { body: new Element("body"), createElement: tag => new Element(tag) };
  doc.querySelector = selector => doc.body.querySelector(selector);
  doc.getElementById = id => doc.querySelector(`#${id}`);
  doc.addEventListener = () => {};
  if (live) doc.body.classList.add("live-page");
  const header = new Element("header"); header.className = live ? "live-topbar" : "topbar";
  const brand = new Element("a"); brand.className = "brand"; header.append(brand); doc.body.append(header);
  const controls = {};
  for (const id of ["saveStatus", "liveHeaderStatus", "saveVersionButton", "apiSettingsButton", "newTaskButton", "historyButton", "focusModeButton", "runtimeLogButton", "windowsUpdateButton", "currentProjectTitle", "transcriptionWorkspace", "editorWorkspace", "resultCard", "workspaceStageNav"]) {
    const node = new Element("button"); node.id = id; controls[id] = node; header.append(node);
  }
  const back = new Element("a"); back.className = "live-back-button"; back.href = "/"; header.append(back);
  const messages = [], events = {}, observers = [];
  const host = {
    classmateDesktop: { platform: "windows", frameless: true },
    chrome: { webview: { postMessage: message => messages.push(message), addEventListener: (name, callback) => { events[`web:${name}`] = callback; } } },
    addEventListener: (name, callback) => { events[name] = callback; },
    MutationObserver: class { constructor(callback) { observers.push(callback); } observe() {} }
  };
  return { doc, host, controls, header, messages, events, observers, back };
}

test("ordinary browsers, macOS and unsupported Windows hosts retain their original layout", () => {
  for (const host of [{}, { classmateDesktop: { platform: "macos", frameless: true } }, { classmateDesktop: { platform: "windows", frameless: false } }]) {
    const { doc, header } = fixture();
    assert.equal(installDesktopShell(doc, host), false);
    assert.equal(header.hidden, undefined);
    assert.equal(doc.querySelector(".desktop-caption"), null);
  }
});

test("desktop shell preserves existing actions and real stage navigation, follows project title and installs only once", () => {
  const { doc, host, controls, header, messages, events, observers } = fixture();
  let saved = 0; controls.saveVersionButton.onclick = () => saved++;
  assert.equal(installDesktopShell(doc, host), true);
  assert.equal(header.hidden, true);
  const caption = doc.querySelector(".desktop-caption"), sidebar = doc.querySelector(".desktop-sidebar");
  assert.equal(caption.querySelector("#saveVersionButton"), controls.saveVersionButton);
  controls.saveVersionButton.onclick(); assert.equal(saved, 1);
  assert.equal(sidebar.querySelector("#newTaskButton"), controls.newTaskButton);
  assert.equal(sidebar.querySelector("#historyButton"), controls.historyButton);
  controls.currentProjectTitle.textContent = "社会学讲座"; observers[0]();
  assert.equal(caption.querySelector(".desktop-project").textContent, "社会学讲座");
  assert.equal(sidebar.querySelector("#workspaceStageNav"), controls.workspaceStageNav);
  assert.equal(events.scroll, undefined, "stage selection must not be inferred from page scrolling");
  assert.deepEqual(messages, ["window:ready"]);
  installDesktopShell(doc, host);
  assert.equal(doc.body.querySelectorAll(".desktop-caption").length, 1);
  assert.deepEqual(messages, ["window:ready"]);
});

test("native commands are fixed strings and maximize state updates the accessible label", () => {
  const { doc, host, events, messages } = fixture(); installDesktopShell(doc, host);
  for (const name of ["minimize", "toggle-maximize", "close"]) doc.querySelector(`.desktop-${name}`).onclick();
  assert.deepEqual(messages, ["window:ready", "window:minimize", "window:toggle-maximize", "window:close"]);
  events["web:message"]({ data: "window:maximized" });
  assert.equal(doc.querySelector(".desktop-toggle-maximize").attributes["aria-label"], "还原窗口");
  events["web:message"]({ data: { command: "close" } });
  assert.equal(doc.body.classList.contains("desktop-maximized"), true);
  events["web:message"]({ data: "window:normal" });
  assert.equal(doc.querySelector(".desktop-toggle-maximize").attributes["aria-label"], "最大化");
});

test("live shell retains the existing leave-recording safeguard", () => {
  const { doc, host, back } = fixture({ live: true }); let checked = false;
  back.onclick = () => { checked = true; };
  installDesktopShell(doc, host);
  assert.equal(doc.querySelector(".desktop-sidebar").querySelector(".live-back-button"), back);
  back.onclick(); assert.equal(checked, true);
  assert.equal(doc.querySelector(".desktop-project").textContent, "实时录音转写");
});

test("opening settings keeps native window buttons available while workspace actions remain modal", () => {
  const { doc, host } = fixture(); installDesktopShell(doc, host);
  const dialog = doc.createElement("section"), backdrop = doc.createElement("div");
  doc.body.append(dialog, backdrop);
  const focus = createDialogFocus(doc); focus.open(dialog, backdrop, () => {}, dialog);
  assert.equal(doc.querySelector(".desktop-window-controls").inert, false);
  assert.equal(doc.querySelector(".desktop-caption").inert, true);
  assert.equal(doc.querySelector(".desktop-sidebar").inert, true);
  focus.close(dialog);
  assert.ok(!doc.querySelector(".desktop-sidebar").inert);
});
