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

const THEME_LABELS: Record<string, string> = {
  claude: "Claude 暖橙",
  medium: "Medium 简白",
  wechat: "微信编辑器",
  ink: "水墨",
  tech: "科技",
  rose: "玫瑰",
  official: "公众号官方",
  fortune: "财经报刊",
  terminal: "终端（深色代码）",
  news: "新闻早报",
};

const VIEW_TYPE_PUBLY_PREVIEW = "publy-preview";

// Obsidian evaluates plugin bundles with a synthetic module context
// (module.filename = null, __dirname = electron.asar/renderer), so package
// requires — top-level or relative — can never resolve. Node builtins still
// work, so bootstrap the real resolver via createRequire and load the wasm
// glue packages from the plugin dir by absolute path at runtime.
type ResvgModule = typeof import("@resvg/resvg-wasm");
let resvgModule: ResvgModule | null = null;

function loadPluginModule<T>(pluginDir: string, rel: string): T {
  const { createRequire } = require("node:module");
  const req = createRequire(path.join(pluginDir, "manifest.json"));
  return req(path.join(pluginDir, rel)) as T;
}

// manifest.dir is vault-relative in real Obsidian; createRequire and fs both
// need absolute paths (and process.cwd() is the install dir, not the vault).
function absolutePluginDir(plugin: Plugin): string {
  const dir = plugin.manifest.dir ?? "";
  return path.isAbsolute(dir)
    ? dir
    : path.join((plugin.app.vault.adapter as unknown as { getBasePath(): string }).getBasePath(), dir);
}

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

/** In-app preview leaf: article HTML or image-post card strip, with a small
 *  action toolbar (refresh / copy / publish) so the preview is a cockpit,
 *  not a dead end. */
class PublyPreviewView extends ItemView {
  plugin: PublyPlugin;
  /** re-renders the current preview; set on every render by the plugin */
  refresh: (() => Promise<void>) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PublyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType(): string { return VIEW_TYPE_PUBLY_PREVIEW; }
  getDisplayText(): string { return "Publy 预览"; }
  getIcon(): string { return "send"; }
  async onOpen(): Promise<void> { /* content set by setHtml */ }
  async onClose(): Promise<void> { /* nothing */ }

  private toolbar(): void {
    const bar = this.contentEl.createEl("div");
    bar.style.cssText = "display:flex;gap:8px;align-items:center;padding:10px 18px 0";
    const btn = (label: string, fn: () => void) => {
      const b = bar.createEl("button");
      b.textContent = label;
      b.style.cssText = "font-size:13px;cursor:pointer";
      b.addEventListener("click", fn);
    };
    btn("↻ 刷新", () => void this.refresh?.());
    btn("复制 rich text", () => void this.plugin.copyRenderedHtml());
    btn("发布 → 公众号草稿箱", () => void this.plugin.publishCurrentNote());
  }

  setHtml(html: string): void {
    this.contentEl.empty();
    this.toolbar();
    const wrap = this.contentEl.createEl("div");
    wrap.style.cssText = "background:#ddd;padding:18px";
    const page = wrap.createEl("div");
    page.style.cssText = "max-width:700px;margin:0 auto;background:#fff;min-height:60vh";
    page.innerHTML = html;
  }
  setCards(cards: { base64: string }[], caption: string): void {
    this.contentEl.empty();
    this.toolbar();
    const wrap = this.contentEl.createEl("div");
    wrap.style.cssText = "padding:18px";
    const strip = wrap.createEl("div");
    strip.style.cssText = "display:flex;gap:12px;overflow-x:auto;padding-bottom:10px";
    for (const c of cards) {
      const img = strip.createEl("img");
      img.src = "data:image/png;base64," + c.base64;
      img.style.height = "430px";
      img.style.borderRadius = "10px";
      img.style.boxShadow = "0 6px 24px rgba(0,0,0,.35)";
    }
    const cap = wrap.createEl("div");
    cap.style.cssText = "margin-top:14px;font-size:14px;line-height:1.7;white-space:pre-wrap";
    cap.textContent = caption;
  }
}

export default class PublyPlugin extends Plugin {
  settings: PublySettings;
  wasmOk = false;
  statusBarItem: HTMLElement | null = null;

  async onload(): Promise<void> {
    // WASM PNG renderer (community-plugin safe: no native binaries).
    // Graceful degradation: if wasm init fails, article publish/preview still
    // work — only the card renderer is unavailable.
    try {
      const pluginDir = absolutePluginDir(this);
      resvgModule = loadPluginModule<ResvgModule>(pluginDir, path.join("node_modules", "@resvg", "resvg-wasm", "index.js"));
      const wasmFile = path.join(pluginDir, "node_modules", "@resvg", "resvg-wasm", "index_bg.wasm");
      // BufferSource path — Node fetch() cannot read file:// URLs.
      // Already-initialized is success: resvg's module state survives plugin
      // disable/enable (require cache), so a second onload must not fail.
      try {
        await resvgModule.initWasm(fs.readFileSync(wasmFile));
      } catch (err) {
        if (!/already initialized/i.test(String((err as Error)?.message ?? err))) throw err;
      }
      // satori imports harfbuzzjs at bundle-eval time; the esbuild shim defers
      // it behind a promise bridge, armed here with the real plugin dir.
      const gp = globalThis as { __publyHarfbuzzBridge?: (p: Promise<unknown>) => void };
      if (gp.__publyHarfbuzzBridge) {
        gp.__publyHarfbuzzBridge(
          Promise.resolve(loadPluginModule<unknown>(pluginDir, path.join("node_modules", "harfbuzzjs", "index.js"))),
        );
      }
      const fontDir = path.join(pluginDir, "fonts");
      const fontFiles = ["NotoSansSC-subset-Regular.otf", "NotoSansSC-subset-Bold.otf"]
        .map((f) => path.join(fontDir, f))
        .filter((p) => fs.existsSync(p));
      setFontDir(fontDir);
      setPngRenderer((svg, fitWidth) => {
        const resvg = new resvgModule!.Resvg(svg, {
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

    this.registerView(VIEW_TYPE_PUBLY_PREVIEW, (leaf: WorkspaceLeaf) => new PublyPreviewView(leaf, this));
    this.statusBarItem = this.addStatusBarItem();

    // right-click any note → publish / preview / copy for THAT note
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item.setTitle("Publy: 发布到公众号草稿箱").setIcon("send").onClick(() => void this.publishCurrentNote(file));
        });
        menu.addItem((item) => {
          item.setTitle("Publy: 预览排版").setIcon("eye").onClick(() => void this.previewCurrentNote(file));
        });
        menu.addItem((item) => {
          item.setTitle("Publy: 复制 rich text").setIcon("copy").onClick(() => void this.copyRenderedHtml(file));
        });
      }),
    );

    this.addRibbonIcon("send", "Publy: 发布当前笔记", () => this.publishCurrentNote());

    this.addCommand({
      id: "publish-current-note",
      name: "Publish current note",
      callback: () => this.publishCurrentNote(),
    });

    this.addCommand({
      id: "preview-current-note",
      name: "Preview (auto: article or image-post cards)",
      callback: () => this.previewCurrentNote(),
    });

    this.addCommand({
      id: "preview-current-note-browser",
      name: "Preview rendered HTML in browser",
      callback: () => this.previewInBrowser(() => this.renderCurrent()),
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
    dirs.push(this.autoMediaDir());
    dirs.push(this.basePath());
    return [...new Set(dirs.filter(Boolean))];
  }

  /** resolve the vault's own attachment setting, so local images resolve with
   *  zero configuration */
  private autoMediaDir(): string {
    try {
      const cfg = (this.app.vault as unknown as { getConfig?: (k: string) => string }).getConfig?.("attachmentFolderPath");
      if (!cfg || cfg === "/" || cfg === ".") return this.basePath();
      return path.isAbsolute(cfg) ? cfg : path.join(this.basePath(), cfg);
    } catch {
      return this.basePath();
    }
  }

  /** frontmatter peek: explicit `type` wins, `mode: cards` fills the gap —
   *  same precedence as core's publishType() */
  private detectIsCards(raw: string): boolean {
    const m = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!m) return false;
    const fm = m[1];
    const t = fm.match(/^type:\s*(\S+)/m)?.[1];
    if (t) return t === "image" || t === "image_post";
    return (fm.match(/^mode:\s*(\S+)/m)?.[1] ?? "").toLowerCase() === "cards";
  }

  /** publish needs server + key; everything else (preview/copy) is local-only.
   *  When unconfigured, open the settings tab right at the guide. */
  private ensureConfigured(): boolean {
    if (this.settings.server && this.settings.apiKey) return true;
    new Notice("Publy: 还差一步——在设置里填 Server 地址和 API key（可用「测试连接」验证）");
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById("publy");
    return false;
  }

  private status(text: string): void {
    this.statusBarItem?.setText(text);
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

  private async renderCurrent(file?: TFile): Promise<string> {
    const f = file ?? this.currentFile();
    if (!f) throw new Error("没有活动笔记");
    const raw = await this.app.vault.cachedRead(f);
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

  /** one preview command: picks article or image-post cards from frontmatter.
   *  public: the preview-view toolbar and the theme dropdown call back into it. */
  async previewCurrentNote(file?: TFile): Promise<void> {
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice("Publy: 没有活动笔记");
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    if (this.detectIsCards(raw)) {
      await this.previewCardDeck(f, raw);
      return;
    }
    try {
      const html = await this.renderCurrent(f);
      const view = await this.activatePreviewView();
      view.refresh = () => this.previewCurrentNote(f);
      view.setHtml(html);
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async previewCardDeck(file?: TFile, rawArg?: string): Promise<void> {
    if (!this.wasmOk) {
      new Notice("Publy: 卡片渲染器不可用（wasm 初始化失败）——文章发布不受影响");
      return;
    }
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice("Publy: 没有活动笔记");
      return;
    }
    const raw = rawArg ?? (await this.app.vault.cachedRead(f));
    new Notice("Publy: 正在渲染图片消息卡片…");
    try {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-cards-"));
      const result = await renderCards(raw, { outDir });
      const cards = result.cards.map((c) => ({
        base64: fs.readFileSync(c.file).toString("base64"),
      }));
      const view = await this.activatePreviewView();
      view.refresh = () => this.previewCardDeck(f);
      view.setCards(cards, result.caption);
      if (!result.lint.ok) {
        new Notice(`Publy lint: ${result.lint.problems[0] ?? "check the preview"}`);
      }
    } catch (err) {
      new Notice(`Publy: 图片消息卡片渲染失败 — ${(err as Error).message}`);
    }
  }

  /** public: the preview-view toolbar calls back into it */
  async copyRenderedHtml(file?: TFile): Promise<void> {
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice("Publy: 没有活动笔记");
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    try {
      const rendered = renderMarkdown(raw, this.renderOptions());
      for (const w of rendered.warnings) console.warn("[publy] " + w);
      if (rendered.attachments.length > 0) {
        new Notice("Publy: 笔记含本地图片，复制路径仅保留文字排版（图片请用发布功能或手动插图）");
      }
      const item = new ClipboardItem({
        "text/html": new Blob([rendered.html], { type: "text/html" }),
        "text/plain": new Blob([f.basename], { type: "text/plain" }),
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

  /** public: the preview-view toolbar calls back into it */
  async publishCurrentNote(file?: TFile): Promise<void> {
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice("Publy: 没有活动笔记");
      return;
    }
    if (!this.ensureConfigured()) return;
    let publishUrl: URL;
    try {
      publishUrl = new URL("/v1/publish", this.settings.server);
    } catch {
      new Notice("Publy: Server 地址格式不对——需要带协议，例如 https://publy-api.example.com");
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    this.status("Publy: 渲染中…");
    let html: string;
    let payloadAttachments: { name: string; data: string; contentType: string }[];
    let coverName: string | undefined;
    let type: "article" | "image_post";
    let title: string;
    let author: string | undefined;
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
      title = rendered.title || f.basename;
      author = rendered.meta.author;
    } catch (err) {
      this.status("");
      new Notice(`Publy: 渲染失败 — ${(err as Error).message}`);
      return;
    }

    this.status("Publy: 上传到公众号…");
    const t0 = Date.now();
    try {
      const res = await requestUrl({
        url: publishUrl.toString(),
        method: "POST",
        headers: { "content-type": "application/json", "x-api-key": this.settings.apiKey },
        body: JSON.stringify({
          account: this.settings.account,
          type,
          title,
          html,
          images: payloadAttachments,
          cover: coverName,
          author,
        }),
      });
      const body = res.json as PublishResponse;
      if (!res.status || res.status >= 400) {
        new Notice(`Publy: 发布失败 — ${body.code ?? res.status}: ${body.message ?? ""}`);
        return;
      }
      new Notice(`✅《${title}》已进公众号草稿箱（${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
    } catch (err) {
      new Notice(`Publy: 发布失败 — ${(err as Error).message}（公司网络请确认隧道已启动）`);
    } finally {
      this.status("");
    }
  }
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

    // setup guide — the first thing a new user sees
    const intro = containerEl.createEl("div");
    intro.style.cssText =
      "background:var(--background-secondary);border-radius:8px;padding:12px 16px;margin-bottom:14px;font-size:13px;line-height:1.9";
    intro.createEl("div").setText("三步开始发布：① 服务开通账号（自托管或购买托管）拿 Server 地址和 API key → ② 填在下面，点「测试连接」确认 → ③ 打开任意笔记，点左侧 send 图标发布（不配置也能用：预览排版、复制 rich text，均纯本地）。");
    const links = intro.createEl("div");
    const mkLink = (text: string, url: string) => {
      const a = links.createEl("a");
      a.textContent = text;
      a.href = url;
      a.target = "_blank";
    };
    mkLink("使用手册", "https://publy.jrtx.site");
    links.appendText(" · ");
    mkLink("购买托管服务", "https://publy-api.jrtx.site/");
    links.style.marginTop = "4px";

    new Setting(containerEl).setName("Server 地址").setDesc("Publy 服务地址，带协议，例如 https://publy-api.example.com").addText((text) =>
      text.setPlaceholder("https://…").setValue(this.plugin.settings.server).onChange(async (v) => {
        this.plugin.settings.server = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("API key").setDesc("只保存在本机 vault 配置里").addText((text) => {
      text.setPlaceholder("publy_…").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });
    new Setting(containerEl).setName("公众号账号名").setDesc("服务端绑定的账号名（publy account add 时的名字）").addText((text) =>
      text.setPlaceholder("my-account").setValue(this.plugin.settings.account).onChange(async (v) => {
        this.plugin.settings.account = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("媒体目录").setDesc("本地图片查找目录；留空 = 自动跟随 vault 附件设置").addText((text) =>
      text.setPlaceholder("自动（vault 附件目录）").setValue(this.plugin.settings.mediaDir).onChange(async (v) => {
        this.plugin.settings.mediaDir = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName("主题").setDesc("文章排版主题；terminal 主题用深色代码高亮").addDropdown((drop) =>
      drop
        .addOptions(THEME_LABELS)
        .setValue(this.plugin.settings.theme || "claude")
        .onChange(async (v) => {
          this.plugin.settings.theme = v;
          await this.plugin.saveSettings();
          // live re-render if the preview is open
          void this.plugin.previewCurrentNote();
        }),
    );
    const connResult = containerEl.createEl("div");
    connResult.style.cssText = "font-size:13px;padding:2px 0 10px";
    new Setting(containerEl)
      .setName("连接")
      .setDesc("检查服务可达性、API key 与套餐配额")
      .addButton((btn) =>
        btn.setButtonText("测试连接").setCta().onClick(() => {
          void this.testConnection(connResult);
        }),
      );
  }

  private async testConnection(resultEl: HTMLElement): Promise<void> {
    const s = this.plugin.settings;
    resultEl.setText("测试中…");
    let base: URL;
    try {
      base = new URL(s.server);
    } catch {
      resultEl.setText("❌ Server 地址格式不对（要带 https:// 或 http://）");
      return;
    }
    if (!s.apiKey) {
      resultEl.setText("❌ 先填 API key");
      return;
    }
    try {
      const health = await requestUrl({ url: new URL("/health", base).toString(), method: "GET" });
      if ((health.json as { status?: string } | null)?.status !== "ok") throw new Error("health 响应异常");
      const quota = await requestUrl({
        url: new URL("/v1/quota", base).toString(),
        method: "GET",
        headers: { "x-api-key": s.apiKey },
      });
      if (quota.status === 401 || quota.status === 403) {
        resultEl.setText(`❌ key 无效或被停用（服务返回 ${quota.status}）`);
        return;
      }
      const q = quota.json as { plan?: string; used?: number; limit?: number; admin?: boolean; unlimited?: boolean };
      const usage = q.admin ? "管理员 key（无限额）" : `套餐 ${q.plan ?? "?"} · 本月 ${q.used ?? "?"}/${q.limit ?? "?"} 篇`;
      resultEl.setText(
        `✅ 连接正常 — ${usage}` + (s.account ? "" : " · 还没填公众号账号名，发布时会用服务端默认账号"),
      );
    } catch (err) {
      resultEl.setText(`❌ 连接失败：${(err as Error).message} — 检查地址与 key；公司网络可能需要先启动隧道（publy tunnel）`);
    }
  }
}
