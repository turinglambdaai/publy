// Publy Obsidian plugin — client A: write in Obsidian, publish through a Publy server.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, TFile, requestUrl } from "obsidian";
import {
  renderMarkdown,
  renderCards,
  setPngRenderer,
  setFontDir,
} from "@publy/core";
import { initWasm, Resvg as WasmResvg } from "@resvg/resvg-wasm";
// theme/highlight css inlined as text by esbuild (loader ".css": "text")
import claudeThemeCss from "../../core/themes/claude.css";
import mediumThemeCss from "../../core/themes/medium.css";
import wechatThemeCss from "../../core/themes/wechat.css";
import inkThemeCss from "../../core/themes/ink.css";
import techThemeCss from "../../core/themes/tech.css";
import roseThemeCss from "../../core/themes/rose.css";
import officialThemeCss from "../../core/themes/official.css";
import fortuneThemeCss from "../../core/themes/fortune.css";
import terminalThemeCss from "../../core/themes/terminal.css";
import newsThemeCss from "../../core/themes/news.css";
import hljsGithubCss from "highlight.js/styles/github.css";
import hljsGithubDarkCss from "highlight.js/styles/github-dark.css";

const THEME_CSS: Record<string, string> = {
  claude: claudeThemeCss,
  medium: mediumThemeCss,
  wechat: wechatThemeCss,
  ink: inkThemeCss,
  tech: techThemeCss,
  rose: roseThemeCss,
  official: officialThemeCss,
  fortune: fortuneThemeCss,
  terminal: terminalThemeCss,
  news: newsThemeCss,
};

const VIEW_TYPE_PUBLY_PREVIEW = "publy-preview";

interface PublySettings {
  server: string;
  apiKey: string;
  account: string;
  mediaDir: string;
  theme: string;
}

const DEFAULT_SETTINGS: PublySettings = {
  server: "",
  apiKey: "",
  account: "",
  mediaDir: "",
  theme: "claude",
};

interface PublishResponse {
  mediaId?: string;
  code?: string;
  message?: string;
}

/** In-app preview leaf: article HTML or image-post card strip. */
class PublyPreviewView extends ItemView {
  constructor(leaf: WorkspaceLeaf) {
    super(leaf);
  }
  getViewType(): string { return VIEW_TYPE_PUBLY_PREVIEW; }
  getDisplayText(): string { return "Publy 预览"; }
  getIcon(): string { return "send"; }
  async onOpen(): Promise<void> { /* content set by setHtml */ }
  async onClose(): Promise<void> { /* nothing */ }
  setHtml(html: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createEl("div");
    wrap.style.background = "#ddd";
    wrap.style.padding = "18px";
    const page = wrap.createEl("div");
    page.style.maxWidth = "700px";
    page.style.margin = "0 auto";
    page.style.background = "#fff";
    page.style.minHeight = "60vh";
    page.innerHTML = html;
  }
  setCards(cards: { base64: string }[], caption: string): void {
    this.contentEl.empty();
    const wrap = this.contentEl.createEl("div");
    wrap.style.padding = "18px";
    const strip = wrap.createEl("div");
    strip.style.display = "flex";
    strip.style.gap = "12px";
    strip.style.overflowX = "auto";
    strip.style.paddingBottom = "10px";
    for (const c of cards) {
      const img = strip.createEl("img");
      img.src = "data:image/png;base64," + c.base64;
      img.style.height = "430px";
      img.style.borderRadius = "10px";
      img.style.boxShadow = "0 6px 24px rgba(0,0,0,.35)";
    }
    const cap = wrap.createEl("div");
    cap.style.marginTop = "14px";
    cap.style.fontSize = "14px";
    cap.style.lineHeight = "1.7";
    cap.style.whiteSpace = "pre-wrap";
    cap.textContent = caption;
  }
}

export default class PublyPlugin extends Plugin {
  settings: PublySettings;
  wasmOk = false;

  async onload(): Promise<void> {
    // WASM PNG renderer (community-plugin safe: no native binaries).
    // Graceful degradation: if wasm init fails, article publish/preview still
    // work — only the card renderer is unavailable.
    try {
      const pluginDir = this.manifest.dir;
      const wasmFile = path.join(pluginDir, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm");
      // BufferSource path — Node fetch() cannot read file:// URLs
      await initWasm(fs.readFileSync(wasmFile));
      const fontDir = path.join(pluginDir, "fonts");
      const fontFiles = ["NotoSansSC-subset-Regular.otf", "NotoSansSC-subset-Bold.otf"]
        .map((f) => path.join(fontDir, f))
        .filter((p) => fs.existsSync(p));
      setFontDir(fontDir);
      setPngRenderer((svg, fitWidth) => {
        const resvg = new WasmResvg(svg, {
          font: { loadSystemFonts: false, fontFiles },
          ...(fitWidth ? { fitTo: { mode: "width", value: fitWidth } } : {}),
        });
        return Buffer.from(resvg.render().asPng());
      });
      this.wasmOk = true;
    } catch (err) {
      this.wasmOk = false;
      console.error("[publy] wasm renderer unavailable:", err);
      new Notice("Publy: 卡片渲染器初始化失败（文章功能不受影响）——详情见开发者控制台");
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE_PUBLY_PREVIEW, (leaf: WorkspaceLeaf) => new PublyPreviewView(leaf));

    this.addRibbonIcon("send", "Publy: publish current note", () => this.publishCurrentNote());

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note",
      callback: () => this.publishCurrentNote(),
    });

    this.addCommand({
      id: "preview-current-note",
      name: "Preview rendered article (in-app)",
      callback: () => this.previewArticleInApp(),
    });

    this.addCommand({
      id: "preview-current-note-browser",
      name: "Preview rendered HTML in browser",
      callback: () => this.previewInBrowser(() => this.renderCurrent()),
    });

    this.addCommand({
      id: "preview-card-deck",
      name: "Image-post cards: preview in app (mode: cards notes)",
      callback: () => this.previewCardDeck(),
    });

    this.addCommand({
      id: "copy-rendered-html",
      name: "Copy rendered rich text (paste into WeChat editor)",
      callback: () => this.copyRenderedHtml(),
    });

    this.addSettingTab(new PublySettingTab(this.app, this));
  }

  async onunload(): Promise<void> {
    /* nothing persistent */
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
  }

  private currentFile(): TFile | null {
    return this.app.workspace.getActiveFile();
  }

  private basePath(): string {
    return (this.app.vault.adapter as { getBasePath?: () => string }).getBasePath?.() ?? "";
  }

  private mediaDirs(): string[] {
    const dirs: string[] = [];
    if (this.settings.mediaDir) dirs.push(this.settings.mediaDir);
    dirs.push(this.basePath());
    return dirs.filter(Boolean);
  }

  private renderOptions() {
    return {
      baseDir: this.basePath(),
      mediaDirs: this.mediaDirs(),
      theme: this.settings.theme || "claude",
      themeCss: THEME_CSS[this.settings.theme || "claude"] ?? claudeThemeCss,
      highlightCss: this.settings.theme === "terminal" ? hljsGithubDarkCss : hljsGithubCss,
    };
  }

  private async renderCurrent(): Promise<string> {
    const file = this.currentFile();
    if (!file) throw new Error("no active note");
    const raw = await this.app.vault.cachedRead(file);
    const rendered = renderMarkdown(raw, this.renderOptions());
    for (const w of rendered.warnings) console.warn("[publy] " + w);
    return rendered.html;
  }

  private async activatePreviewView(): Promise<PublyPreviewView> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(VIEW_TYPE_PUBLY_PREVIEW)[0] as WorkspaceLeaf | undefined;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: VIEW_TYPE_PUBLY_PREVIEW, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf.view as PublyPreviewView;
  }

  private async previewArticleInApp(): Promise<void> {
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    try {
      const html = await this.renderCurrent();
      const view = await this.activatePreviewView();
      view.setHtml(html);
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async previewCardDeck(): Promise<void> {
    if (!this.wasmOk) {
      new Notice("Publy: 卡片渲染器不可用（wasm 初始化失败）——文章发布不受影响");
      return;
    }
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    const raw = await this.app.vault.cachedRead(file);
    new Notice("Publy: 正在渲染图片消息卡片…");
    try {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-cards-"));
      const result = await renderCards(raw, { outDir });
      const cards = result.cards.map((c) => ({
        base64: fs.readFileSync(c.file).toString("base64"),
      }));
      const view = await this.activatePreviewView();
      view.setCards(cards, result.caption);
      if (!result.lint.ok) {
        new Notice(`Publy lint: ${result.lint.problems[0] ?? "check the preview"}`);
      }
    } catch (err) {
      new Notice(`Publy: 图片消息卡片渲染失败 — ${(err as Error).message}`);
    }
  }

  /** zero-config publish path: rich text on the clipboard, pasted into the
   *  WeChat editor by hand — no server, no AppSecret, no IP whitelist */
  private async copyRenderedHtml(): Promise<void> {
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    const raw = await this.app.vault.cachedRead(file);
    try {
      const rendered = renderMarkdown(raw, this.renderOptions());
      for (const w of rendered.warnings) console.warn("[publy] " + w);
      if (rendered.attachments.length > 0) {
        new Notice("Publy: 笔记含本地图片，复制路径仅保留文字排版（图片请用发布功能或手动插图）");
      }
      const item = new ClipboardItem({
        "text/html": new Blob([rendered.html], { type: "text/html" }),
        "text/plain": new Blob([file.basename], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      new Notice("Publy: 已复制排版 rich text — 到公众号编辑器 Ctrl+V 粘贴");
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async previewInBrowser(render: () => Promise<string>): Promise<void> {
    try {
      const html = await render();
      const { shell } = require("electron") as typeof import("electron").shell;
      const out = os.tmpdir() + `/publy-preview-${Date.now()}.html`;
      fs.writeFileSync(out, html);
      shell.openPath(out);
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async publishCurrentNote(): Promise<void> {
    const file = this.currentFile();
    if (!file) {
      new Notice("Publy: no active note");
      return;
    }
    if (!this.settings.server || !this.settings.apiKey) {
      new Notice("Publy: 先在设置里填写 Server 和 API key");
      return;
    }
    const raw = await this.app.vault.cachedRead(file);
    new Notice("Publy: 渲染中…");
    let html: string;
    let payloadAttachments: { name: string; data: string; contentType: string }[];
    let coverName: string | undefined;
    let type: "article" | "image_post";
    let title: string;
    try {
      const rendered = renderMarkdown(raw, this.renderOptions());
      for (const w of rendered.warnings) console.warn("[publy] " + w);
      payloadAttachments = rendered.attachments.map((a) => ({
        name: a.name,
        data: fs.readFileSync(a.path).toString("base64"),
        contentType: a.contentType,
      }));
      if (rendered.cover) {
        const existing = rendered.attachments.find((a) => a.path === rendered.cover);
        coverName = existing?.name;
      }
      html = rendered.html;
      type = rendered.type;
      title = rendered.title || file.basename;
    } catch (err) {
      new Notice(`Publy: 渲染失败 — ${(err as Error).message}`);
      return;
    }

    new Notice("Publy: 上传到公众号…");
    try {
      const res = await requestUrl({
        url: new URL("/v1/publish", this.settings.server).toString(),
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.settings.apiKey },
        body: JSON.stringify({
          account: this.settings.account,
          type,
          title,
          html,
          images: payloadAttachments,
          cover: coverName,
          author: rendered.meta.author,
        }),
      });
      const body = res.json as PublishResponse;
      if (!res.status || res.status >= 400) {
        new Notice(`Publy: 发布失败 — ${body.code ?? res.status}: ${body.message ?? ""}`);
        return;
      }
      new Notice(`Publy: ✅ 草稿箱就绪 — media ${body.mediaId}`);
    } catch (err) {
      new Notice(`Publy: 发布失败 — ${(err as Error).message}（公司网络请确认隧道已启动）`);
    }
  }
}

// placeholder to keep the helper referenced without dead-code churn
function rendered_author(): string | undefined {
  return undefined;
}

class PublySettingTab extends PluginSettingTab {
  plugin: PublyPlugin;

  constructor(app: App, plugin: PublyPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName("Server URL").addText((text) =>
      text.setPlaceholder("https://your-server").setValue(this.plugin.settings.server).onChange(async (v) => {
        this.plugin.settings.server = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("API key").addText((text) =>
      text.setPlaceholder("x-api-key").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Account").addText((text) =>
      text.setPlaceholder("account name on the server").setValue(this.plugin.settings.account).onChange(async (v) => {
        this.plugin.settings.account = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Media directory").addText((text) =>
      text.setPlaceholder("absolute path to attachment folder").setValue(this.plugin.settings.mediaDir).onChange(async (v) => {
        this.plugin.settings.mediaDir = v;
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("Theme").addDropdown((drop) =>
      drop
        .addOptions(Object.keys(THEME_CSS).map((t) => [t, t]).reduce((o, [k, v]) => ({ ...o, [k]: v }), {}))
        .setValue(this.plugin.settings.theme || "claude")
        .onChange(async (v) => {
          this.plugin.settings.theme = v;
          await this.plugin.saveSettings();
        }),
    );
  }
}
