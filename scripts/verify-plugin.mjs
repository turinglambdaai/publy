// Plugin acceptance: loads the BUILT plugin from a vault-like layout with a
// stubbed obsidian/electron environment, runs onload + the main command paths,
// and asserts the observable effects. Run after `pnpm -r build`:
//
//   node scripts/verify-plugin.mjs [vault-plugin-dir]
//
// With an argument, the prepared plugin dir is used as-is (vault layout).

import fs from "node:fs";
import Module from "node:module";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const distDir = path.join(repoRoot, "packages", "obsidian-plugin", "dist");
const pluginDir = process.argv[2] ?? fs.mkdtempSync(path.join(os.tmpdir(), "publy-plugin-verify-"));

// prepare the vault plugin dir from dist (same layout as a real install)
for (const f of ["main.js", "manifest.json", "versions.json"]) {
  fs.copyFileSync(path.join(distDir, f), path.join(pluginDir, f));
}
fs.rmSync(path.join(pluginDir, "node_modules"), { recursive: true, force: true });
if (fs.existsSync(path.join(distDir, "node_modules"))) {
  fs.cpSync(path.join(distDir, "node_modules"), path.join(pluginDir, "node_modules"), { recursive: true });
}
if (fs.existsSync(path.join(distDir, "fonts"))) {
  fs.cpSync(path.join(distDir, "fonts"), path.join(pluginDir, "fonts"), { recursive: true });
}

// --- stubs -------------------------------------------------------------------

const calls = [];

class Component {
  empty() { this.children = []; }
  createEl() { return { children: [], style: {} }; }
  appendChild() {}
}

class ItemView {
  constructor() { this.contentEl = new Component(); }
  getViewType() { return "publy-preview"; }
  getDisplayText() { return "Publy 预览"; }
  getIcon() { return "send"; }
  async onOpen() {}
  async onClose() {}
  setHtml(html) { calls.push("view.setHtml(" + html.length + " chars)"); }
  setCards(cards, caption) { calls.push("view.setCards(" + cards.length + " cards)"); }
  renderMessage(text) { calls.push("view.renderMessage:" + String(text).slice(0, 40)); }
  renderLoading() { calls.push("view.renderLoading"); }
  renderHistory(jobs, entries) { calls.push("view.renderHistory(jobs=" + jobs.length + ",entries=" + entries.length + ")"); }
}
class WorkspaceLeaf {
  constructor() { this.view = null; }
  async setViewState(state) {
    this.view = new ItemView(this);
    this.view.getViewType = () => state.type;
  }
}
class Plugin {
  constructor(app, manifest) { this.app = app; this.manifest = manifest; }
  async loadData() { return {}; }
  async saveData() {}
  addRibbonIcon() { calls.push("ribbon"); }
  addCommand(cmd) { calls.push("command:" + cmd.id); this.app.commands.commands[cmd.id] = { callback: cmd.callback }; }
  addSettingTab() { calls.push("settingsTab"); }
  registerView() {}
  registerEvent() {}
  addStatusBarItem() { calls.push("statusbar"); return { setText: (t) => calls.push("status:" + t) }; }
}
class Notice {
  constructor(msg) { calls.push("notice:" + String(msg).slice(0, 140)); }
  setMessage(msg) { return this; }
  hide() {}
}
class PluginSettingTab {
  constructor() { this.containerEl = new Component(); }
  display() {}
}
class App {
  constructor(vaultContentByPath) {
    this.vaultContentByPath = vaultContentByPath;
    this.commands = { commands: {} };
    this.workspace = {
      activeFile: null,
      getActiveFile: () => this.workspace.activeFile,
      setActiveFile: (f) => { this.workspace.activeFile = f; },
      getLeavesOfType: () => [],
      on: () => {},
      getRightLeaf: () => this.leaf,
      revealLeaf: () => {},
      cachedRead: async (file) => this.vaultContentByPath[file.path] ?? "",
      adapter: { getBasePath: () => os.tmpdir() },
    };
    this.vault = this.workspace;
    this.leaf = new WorkspaceLeaf();
    this.leaf.view = new ItemView(this.leaf);
  }
}
class Setting {
  setName() { return this; }
  setDesc() { return this; }
  addText() { return this; }
  addDropdown() { return this; }
  addButton() { return this; }
}
class Modal {
  constructor() { this.contentEl = new Component(); }
  open() { calls.push("modal.open"); }
  close() {}
  onOpen() {}
  onClose() {}
}
class TFile { path = ""; }
const stub = { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, TFile, Modal, requestUrl: async () => ({ json: {}, status: 200 }) };

// intercept module loading for obsidian/electron
const origLoad = Module._load;
Module._load = function (request, parent, isMain) {
  if (request === "obsidian") return stub;
  if (request === "electron") return { shell: { openPath: async (p) => { calls.push("shell.openPath:" + p); return ""; } } };
  return origLoad.apply(this, arguments);
};

// --- drive the plugin --------------------------------------------------------

const mainJs = path.join(pluginDir, "main.js");
const req = createRequire(import.meta.url);
const mod = req(path.resolve(mainJs));
const PluginCls = mod.default;
if (typeof PluginCls !== "function") throw new Error("no default export");

const articleSample = fs.readFileSync(path.join(repoRoot, "packages", "cli", "samples", "article-sample.md"), "utf8");
const cardSample = fs.readFileSync(path.join(repoRoot, "packages", "cli", "samples", "card-sample.md"), "utf8");
const app = new App({
  "samples/article-sample.md": articleSample,
  "samples/card-sample.md": cardSample,
});
const inst = new PluginCls(app, { dir: pluginDir, id: "publy", name: "Publy", version: "0.1.0" });

const fail = (msg) => { console.error("FAIL:", msg); console.error("calls:", calls.join(" | ")); process.exit(1); };

await inst.onload();
if (!calls.includes("ribbon")) fail("ribbon not registered");
if (!calls.some((c) => c.startsWith("command:"))) fail("commands not registered");

// article render into the in-app preview view
app.workspace.activeFile = { path: "samples/article-sample.md" };
await inst.previewCurrentNote(); // smart dispatch -> article
if (!calls.some((c) => c.startsWith("view.setHtml("))) fail("article preview did not render — calls: " + calls.join(" | "));

// card deck render into the in-app preview view (wasm + satori + harfbuzzjs)
app.workspace.activeFile = { path: "samples/card-sample.md" };
await inst.previewCurrentNote(); // smart dispatch -> card deck
if (!calls.some((c) => c.startsWith("view.setCards("))) fail("card preview did not render — calls: " + calls.join(" | "));

// history view renders from the (stub) server API
inst.settings = { ...inst.settings, server: "https://stub.test", apiKey: "k", account: "a" };
await inst.openHistory();
if (!calls.some((c) => c.startsWith("view.renderHistory("))) fail("history did not render — calls: " + calls.join(" | "));

// publish path: stub server 200s → success toast with title + duration
app.workspace.activeFile = { path: "samples/article-sample.md", stat: { mtime: Date.now() } };
await inst.publishCurrentNote();
if (!calls.some((c) => c.includes("已进公众号草稿箱"))) fail("publish success toast missing — calls: " + calls.join(" | "));
const dupes = calls.filter((c) => c.includes("已进公众号草稿箱")).length;
if (dupes !== 1) fail("unexpected publish toast count: " + dupes);

console.log("PASS — onload, article preview, card deck preview, history, publish");
