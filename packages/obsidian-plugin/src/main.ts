// Publy Obsidian plugin — client A: write in Obsidian, publish through a Publy server.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Plugin, ItemView, WorkspaceLeaf, Notice, PluginSettingTab, App, Setting, TFile, requestUrl, Modal, setIcon } from "obsidian";
import {
  renderMarkdown,
  renderCards,
  setPngRenderer,
  setFontDir,
  generateTitleCover,
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


// --- i18n ------------------------------------------------------------------
// Bilingual UI (zh/en). Preference comes from settings ("auto" follows the
// Obsidian interface language). Command/menu names bake in at load, so a
// language change asks for a reload to take full effect.
type Lang = "zh" | "en";
let LANG_PREF: "auto" | Lang = "auto";
const STRINGS: Record<string, { zh: string; en: string }> = {
  cmdPublish: { zh: "发布当前笔记", en: "Publish current note" },
  cmdSchedule: { zh: "定时发布…", en: "Publish at scheduled time…" },
  cmdPreview: { zh: "预览排版（自动：文章/图片消息）", en: "Preview (auto: article or image-post cards)" },
  cmdPreviewBrowser: { zh: "在浏览器中预览排版 HTML", en: "Preview rendered HTML in browser" },
  cmdCopy: { zh: "复制排版富文本（粘贴到公众号编辑器）", en: "Copy rendered rich text (paste into WeChat editor)" },
  cmdHistory: { zh: "打开发布历史与待发任务", en: "Open publish history & scheduled jobs" },
  cmdSwitch: { zh: "切换公众号账号", en: "Switch WeChat account" },
  ribbon: { zh: "Publy: 发布当前笔记", en: "Publy: publish current note" },
  ribbonPreview: { zh: "Publy: 预览当前笔记", en: "Publy: preview current note" },
  menuPublish: { zh: "Publy: 发布到公众号草稿箱", en: "Publy: Publish to WeChat drafts" },
  menuPreview: { zh: "Publy: 预览排版", en: "Publy: Preview typeset" },
  menuCopy: { zh: "Publy: 复制排版富文本", en: "Publy: Copy rich text" },
  viewPreview: { zh: "Publy 预览", en: "Publy Preview" },
  viewHistory: { zh: "Publy 发布历史", en: "Publy History" },
  btnRefresh: { zh: "↻ 刷新", en: "↻ Refresh" },
  btnCopy: { zh: "复制 rich text", en: "Copy rich text" },
  btnPublish: { zh: "发布 → 公众号草稿箱", en: "Publish → WeChat drafts" },
  pillDraft: { zh: "草稿预览", en: "Draft preview" },
  previewHint: { zh: "打开一篇笔记，这里会实时预览它的公众号排版。", en: "Open a note — its WeChat-ready typeset shows up here, live." },
  noTitle: { zh: "(无标题)", en: "(untitled)" },
  setLang: { zh: "界面语言", en: "Language" },
  setAutoPreview: { zh: "打开笔记时自动预览", en: "Auto-preview on note open" },
  setAutoPreviewDesc: { zh: "每个笔记打开时自动渲染公众号排版预览（高频预览零交互）；预览面板已开时切换笔记自动跟随；重度用户也可在 设置→快捷键 里为「预览当前笔记」绑热键", en: "Render the WeChat preview automatically as each note opens; with the panel open, switching notes follows along; heavy users can also bind a hotkey to 'Preview current note' in Settings → Hotkeys" },
  setLangDesc: { zh: "自动跟随 Obsidian 界面语言；命令名需重载插件后更新", en: "Auto follows the Obsidian UI language; command names update after reload" },
  langAuto: { zh: "自动", en: "Auto" },
  langReload: { zh: "Publy: 界面语言已保存——命令名等将在重载插件后完全生效", en: "Publy: language saved — command names update fully after reload" },
  intro: {
    zh: "三步开始发布：① 服务开通账号（自托管或购买托管）拿 Server 地址和 API key → ② 填在下面，点「测试连接」确认 → ③ 打开任意笔记，点左侧 send 图标发布（不配置也能用：预览排版、复制 rich text，均纯本地）。",
    en: "Three steps to publish: (1) get a Server URL + API key (self-hosted or hosted) -> (2) fill them below and hit Test connection -> (3) open any note and click the send ribbon icon (preview & copy work locally with zero config).",
  },
  guideLink: { zh: "使用手册", en: "Guide" },
  buyLink: { zh: "购买托管服务", en: "Get the hosted service" },
  setServer: { zh: "Server 地址", en: "Server URL" },
  setServerDesc: { zh: "Publy 服务地址，带协议，例如 https://publy-api.example.com", en: "Publy server URL incl. protocol, e.g. https://publy-api.example.com" },
  setKey: { zh: "API key", en: "API key" },
  setKeyDesc: { zh: "只保存在本机 vault 配置里", en: "Stored only in this vault's plugin data" },
  setAccount: { zh: "公众号账号名", en: "WeChat account" },
  setAccountDesc: { zh: "服务端绑定的账号名；配置好后自动列出 key 名下的账号", en: "Account bound on the server; auto-lists your accounts once configured" },
  setAccountFallback: { zh: "my-account（配置服务后可下拉选择）", en: "my-account (configure the server to get a dropdown)" },
  setMedia: { zh: "媒体目录", en: "Media folder" },
  setMediaDesc: { zh: "本地图片查找目录；留空 = 自动跟随 vault 附件设置", en: "Where local images live; empty = follow the vault attachment setting" },
  setMediaPlaceholder: { zh: "自动（vault 附件目录）", en: "Auto (vault attachment folder)" },
  setTheme: { zh: "主题", en: "Theme" },
  setThemeDesc: { zh: "文章排版主题；terminal 主题用深色代码高亮", en: "Article theme; terminal uses a dark code scheme" },
  setConn: { zh: "连接", en: "Connection" },
  setConnDesc: { zh: "检查服务可达性、API key 与套餐配额", en: "Check reachability, API key and plan quota" },
  btnTest: { zh: "测试连接", en: "Test connection" },
  testing: { zh: "测试中…", en: "Testing…" },
  badServerUrl: { zh: "❌ Server 地址格式不对（要带 https:// 或 http://）", en: "❌ Server URL looks wrong (include https:// or http://)" },
  needKey: { zh: "❌ 先填 API key", en: "❌ Enter the API key first" },
  keyInvalid: { zh: "❌ key 无效或被停用（服务返回 {code}）", en: "❌ Key invalid or disabled (server said {code})" },
  connOk: { zh: "✅ 连接正常 — {usage}", en: "✅ Connected — {usage}" },
  connOkNoAccount: { zh: " · 还没填公众号账号名，发布时会用服务端默认账号", en: " · no account set; the server default will be used" },
  planAdmin: { zh: "管理员 key（无限额）", en: "admin key (no quota)" },
  planUsage: { zh: "套餐 {plan} · 本月 {used}/{limit} 篇", en: "plan {plan} · {used}/{limit} posts this month" },
  connFail: { zh: "❌ 连接失败：{msg} — 请检查 Server 地址与 API key", en: "❌ Connection failed: {msg} — check the Server URL and API key" },
  noActiveNote: { zh: "Publy: 没有活动笔记", en: "Publy: no active note" },
  errNoActiveNote: { zh: "没有活动笔记", en: "no active note" },
  healthBad: { zh: "health 响应异常", en: "unexpected health response" },
  coverExplicit: { zh: "封面：自选图片", en: "cover: your pick" },
  coverPickTitle: { zh: "选择这篇的封面", en: "Pick a cover for this note" },
  coverAutoTile: { zh: "自动标题卡", en: "Auto title card" },
  btnConfirm: { zh: "确定", en: "OK" },
  coverFirst: { zh: "封面：正文首图", en: "cover: first image" },
  coverAuto: { zh: "封面：自动标题卡", en: "cover: auto title card" },
  ensureConfigured: { zh: "Publy: 还差一步——在设置里填 Server 地址和 API key（可用「测试连接」验证）", en: "Publy: almost there — set the Server URL and API key in settings (Test connection verifies it)" },
  inFlight: { zh: "Publy: 已有一篇在发布中——稍等，完成后会弹结果", en: "Publy: a publish is already running — the result will pop shortly" },
  rendering: { zh: "Publy: 渲染中…", en: "Publy: rendering…" },
  uploading: { zh: "Publy: 上传到公众号…", en: "Publy: uploading to WeChat…" },
  renderFail: { zh: "Publy: 渲染失败 — {msg}", en: "Publy: render failed — {msg}" },
  publishFail: { zh: "Publy: 发布失败 — {msg}", en: "Publy: publish failed — {msg}" },
  publishOk: { zh: "✅《{title}》已进公众号草稿箱（{sec} 秒）", en: "✅ [{title}] is in your WeChat drafts ({sec}s)" },
  scheduledOk: { zh: "🕒《{title}》已排期 {when} — 在「发布历史」里可取消", en: "🕒 [{title}] scheduled for {when} — cancel it in History" },
  deduped: { zh: "Publy: 10 分钟内已发过《{title}》——本次跳过（防重复）", en: "Publy: [{title}] was just published — skipped as duplicate" },
  netFail: { zh: "Publy: 发布失败 — {msg}", en: "Publy: publish failed — {msg}" },
  badServer: { zh: "Publy: Server 地址格式不对——需要带协议，例如 https://publy-api.example.com", en: "Publy: Server URL is malformed — include the protocol, e.g. https://publy-api.example.com" },
  copyHasImages: { zh: "Publy: 笔记含本地图片，复制路径仅保留文字排版（图片请用发布功能或手动插图）", en: "Publy: the note has local images — rich-text copy keeps text only (publish to include them)" },
  copyOk: { zh: "Publy: 已复制排版 rich text — 到公众号编辑器 Ctrl+V 粘贴", en: "Publy: rich text copied — paste into the WeChat editor with Ctrl+V" },
  wasmDown: { zh: "Publy: 卡片渲染器不可用（wasm 初始化失败）——文章发布不受影响", en: "Publy: card renderer unavailable (wasm init failed) — article publishing is unaffected" },
  cardsRendering: { zh: "Publy: 正在渲染图片消息卡片…", en: "Publy: rendering image-post cards…" },
  cardsFail: { zh: "Publy: 图片消息卡片渲染失败 — {msg}", en: "Publy: card rendering failed — {msg}" },
  wasmInitFail: { zh: "Publy: 卡片渲染器初始化失败（文章功能不受影响）——详情见开发者控制台", en: "Publy: card renderer failed to init (articles unaffected) — see the developer console" },
  histLoading: { zh: "加载中…", en: "Loading…" },
  histLoadFail: { zh: "加载失败：{msg} — 检查「测试连接」里的地址与 key", en: "Failed to load: {msg} — check URL & key under Test connection" },
  histNeedConfig: { zh: "配置 Server 和 API key 后，这里会显示发布历史与待发的定时任务。", en: "Once the Server URL and API key are set, publish history and scheduled jobs show up here." },
  histTitle: { zh: "发布历史", en: "History" },
  histJobs: { zh: "待发任务（{n}）", en: "Scheduled ({n})" },
  histJobsEmpty: { zh: "没有待发的定时任务。右键笔记或命令面板可排期。", en: "Nothing scheduled. Right-click a note or use the command palette to schedule." },
  histRecent: { zh: "最近记录", en: "Recent" },
  histEmpty: { zh: "还没有发布记录。", en: "No publishes yet." },
  btnCancel: { zh: "取消", en: "Cancel" },
  cancelOk: { zh: "已取消待发任务", en: "Scheduled job cancelled" },
  cancelFail: { zh: "取消失败：{msg}", en: "Cancel failed: {msg}" },
  typeImagePost: { zh: "图片消息", en: "image post" },
  typeArticle: { zh: "文章", en: "article" },
  acctFetchFail: { zh: "获取账号列表失败：{msg}", en: "Failed to list accounts: {msg}" },
  acctNone: { zh: "这个 key 名下没有公众号账号——先在服务端绑定（购买页 /v1/bind 或 publy account add）", en: "No WeChat accounts under this key — bind one first (/v1/bind on the purchase page, or publy account add)" },
  acctSwitched: { zh: "已切换到「{name}」", en: "Switched to [{name}]" },
  acctModalTitle: { zh: "切换公众号账号", en: "Switch WeChat account" },
  acctCurrent: { zh: "{name}（当前）", en: "{name} (current)" },
  acctSwitchBtn: { zh: "切换", en: "Switch" },
  schedTitle: { zh: "定时发布", en: "Schedule publish" },
  schedDesc: { zh: "到点由 Publy 服务自动发布到公众号草稿箱；配额在执行时计。", en: "The Publy server publishes to your WeChat drafts at the chosen time; quota counts at execution." },
  schedBtn: { zh: "排期", en: "Schedule" },
  schedInvalid: { zh: "时间无效或已过去——重新选一个未来时间", en: "That time is invalid or in the past — pick a future time" },
  browseLocal: { zh: "从本机选择图片…", en: "Pick an image from this computer…" },
  coverLocal: { zh: "本机图片", en: "Local image" },
  localCoverLost: { zh: "本机封面图已失效——请重新选择", en: "Local cover image lost — pick it again" },
  tipRefresh: { zh: "重新渲染预览", en: "Re-render the preview" },
  tipCopy: { zh: "复制排版 rich text", en: "Copy rendered rich text" },
  tipWidthMobile: { zh: "手机宽（390px）——公众号读者大多在手机", en: "Mobile width (390px) — most WeChat readers are on phones" },
  tipWidthDesktop: { zh: "桌面宽（700px）", en: "Desktop width (700px)" },
  tipTheme: { zh: "文章主题（切换即时重渲染）", en: "Article theme (re-renders instantly)" },
  pubRunning: { zh: "发布中…", en: "Publishing…" },
  resultOk: { zh: "已进草稿箱", en: "In your WeChat drafts" },
  resultScheduled: { zh: "已排期", en: "Scheduled" },
  resultDeduped: { zh: "10 分钟内已发过，本次跳过（防重复）", en: "Just published — skipped as duplicate" },
  resultFail: { zh: "发布失败", en: "Publish failed" },
  emptyOpenHint: { zh: "打开一篇笔记，这里会实时预览它的公众号排版", en: "Open a note — its WeChat-ready typeset shows up here, live" },
};

function t(key: string, vars?: Record<string, string | number>): string {
  let lang: Lang = LANG_PREF === "auto"
    ? (typeof window !== "undefined" &&
       String((window as unknown as { moment?: { locale?: () => string } }).moment?.locale?.() ?? "en").toLowerCase().startsWith("zh") ? "zh" : "en")
    : LANG_PREF;
  let out = STRINGS[key]?.[lang] ?? STRINGS[key]?.zh ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split("{" + k + "}").join(String(v));
  return out;
}

const VIEW_TYPE_PUBLY_PREVIEW = "publy-preview";
const PUBLY_HISTORY_VIEW = "publy-history";

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
  lang: "auto" | "zh" | "en";
  /** open the preview panel automatically as each markdown note opens */
  autoPreview: boolean;
  /** preview panel width: 390px "mobile" (the WeChat norm) or 700px "desktop" */
  previewWidth: "mobile" | "desktop";
  /** file path -> last cover choice ("auto" or attachment name) */
  lastCover: Record<string, string>;
}

const DEFAULT_SETTINGS: PublySettings = {
  server: "",
  apiKey: "",
  account: "",
  mediaDir: "",
  theme: "claude",
  lang: "auto",
  autoPreview: false,
  previewWidth: "desktop",
  lastCover: {},
};

interface PublishResponse {
  mediaId?: string;
  code?: string;
  message?: string;
  scheduled?: boolean;
  jobId?: string;
  runAt?: string;
  coverSource?: "cover" | "first-image" | "auto";
}

interface HistoryEntry {
  ts: string;
  event: string;
  account?: string;
  title?: string;
  type?: string;
  mediaId?: string;
  error?: string;
}

interface JobEntry {
  id: string;
  runAt: string;
  status: string;
  account?: string;
  type?: string;
  title?: string;
  error?: string;
}

/** In-app preview leaf: article HTML or image-post card strip, with a small
 *  action toolbar (refresh / copy / publish) so the preview is a cockpit,
 *  not a dead end. */
class PublyPreviewView extends ItemView {
  plugin: PublyPlugin;
  /** re-renders the current preview; set on every render by the plugin */
  refresh: (() => Promise<void>) | null = null;
  private publishBtn: HTMLButtonElement | null = null;
  private resultEl: HTMLElement | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PublyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType(): string { return VIEW_TYPE_PUBLY_PREVIEW; }
  getDisplayText(): string { return t("viewPreview"); }
  getIcon(): string { return "send"; }
  async onOpen(): Promise<void> {
    // after a restart the restored leaf would sit empty — populate it with
    // whatever note is active (or a hint until one is)
    this.app.workspace.onLayoutReady(() => {
      const active = this.app.workspace.getActiveFile();
      if (active) void this.plugin.previewCurrentNote(active);
      else this.renderHint();
    });
  }
  renderHint(): void {
    this.contentEl.empty();
    this.resultEl = null;
    this.publishBtn = null;
    const d = this.contentEl.createEl("div");
    d.addClass("publy-empty");
    const icon = d.createEl("div");
    icon.addClass("publy-empty-icon");
    setIcon(icon, "send");
    d.createEl("div").setText(t("emptyOpenHint"));
  }
  async onClose(): Promise<void> { /* nothing */ }

  /** dim the publish button while a publish runs (spinner + label swap) */
  setPublishing(busy: boolean): void {
    if (!this.publishBtn) return;
    this.publishBtn.toggleClass("is-busy", busy);
    this.publishBtn.disabled = busy;
    const label = this.publishBtn.querySelector(".publy-btn-label");
    if (label) label.textContent = busy ? t("pubRunning") : t("btnPublish");
    // spinner element is toggled via CSS (.publy-spin shown when is-busy)
    let spin = this.publishBtn.querySelector(".publy-spin");
    if (busy && !spin) {
      spin = this.publishBtn.createEl("span");
      spin.addClass("publy-spin");
      this.publishBtn.prepend(spin);
    } else if (!busy) {
      spin?.remove();
    }
  }

  /** colored feedback strip between toolbar and canvas (ok / scheduled / error) */
  setPublishResult(kind: "ok" | "scheduled" | "error" | "deduped", text: string): void {
    this.resultEl?.remove();
    const bar = this.contentEl.createEl("div");
    bar.addClass("publy-result");
    bar.addClass(kind === "ok" ? "is-ok" : kind === "scheduled" ? "is-scheduled" : kind === "deduped" ? "is-scheduled" : "is-error");
    const icon = bar.createEl("span");
    icon.addClass("publy-result-icon");
    setIcon(icon, kind === "ok" ? "check-circle-2" : kind === "scheduled" ? "clock" : kind === "deduped" ? "copy-x" : "x-circle");
    bar.createEl("span").setText(text);
    this.contentEl.prepend(bar);
    this.resultEl = bar;
    window.setTimeout(() => {
      bar.addClass("publy-fade-out");
      window.setTimeout(() => bar.remove(), 300);
    }, 6000);
  }

  private toolbar(): void {
    const bar = this.contentEl.createEl("div");
    bar.addClass("publy-toolbar");

    const ghost = (icon: string, tip: string, fn: () => void) => {
      const b = bar.createEl("button");
      b.addClass("publy-btn");
      b.setAttribute("aria-label", tip);
      b.setAttribute("title", tip);
      setIcon(b, icon);
      b.addEventListener("click", fn);
      return b;
    };
    ghost("refresh-cw", t("tipRefresh"), () => void this.refresh?.());
    ghost("copy", t("tipCopy"), () => void this.plugin.copyRenderedHtml());

    // mobile / desktop width pill — WeChat readers are mostly on phones
    const pill = bar.createEl("div");
    pill.addClass("publy-segpill");
    const widthMode = () => this.plugin.settings.previewWidth ?? "desktop";
    const seg = (mode: "mobile" | "desktop", icon: string, tip: string) => {
      const s = pill.createEl("button");
      s.addClass("publy-seg");
      s.setAttribute("aria-label", tip);
      s.setAttribute("title", tip);
      setIcon(s, icon);
      s.toggleClass("is-active", widthMode() === mode);
      s.addEventListener("click", () => {
        this.plugin.settings.previewWidth = mode;
        void this.plugin.saveSettings();
        for (const el of pill.querySelectorAll(".publy-seg")) el.removeClass("is-active");
        s.addClass("is-active");
        this.canvasEl()?.toggleClass("is-mobile", mode === "mobile");
        this.paperEl()?.toggleClass("is-mobile", mode === "mobile");
      });
    };
    seg("mobile", "smartphone", t("tipWidthMobile"));
    seg("desktop", "monitor", t("tipWidthDesktop"));

    const spacer = bar.createEl("div");
    spacer.addClass("publy-spacer");

    // theme quick switch — re-renders instantly, same as the setting page
    const sel = bar.createEl("select");
    sel.addClass("publy-select");
    sel.setAttribute("title", t("tipTheme"));
    for (const [id, label] of Object.entries(THEME_LABELS)) {
      const opt = sel.createEl("option");
      opt.value = id;
      opt.textContent = label;
    }
    sel.value = this.plugin.settings.theme || "claude";
    sel.addEventListener("change", () => {
      this.plugin.settings.theme = sel.value;
      void this.plugin.saveSettings();
      void this.refresh?.();
    });

    const publish = bar.createEl("button");
    publish.addClass("publy-btn");
    publish.addClass("publy-btn-primary");
    setIcon(publish, "send");
    publish.createEl("span").addClass("publy-btn-label");
    (publish.querySelector(".publy-btn-label") as HTMLElement).textContent = t("btnPublish");
    publish.addEventListener("click", () => void this.plugin.publishCurrentNote());
    this.publishBtn = publish;
  }

  private canvasEl(): HTMLElement | null {
    return this.contentEl.querySelector(".publy-canvas");
  }
  private paperEl(): HTMLElement | null {
    return this.contentEl.querySelector(".publy-paper");
  }

  setHtml(html: string, meta?: { title?: string; author?: string; account?: string }): void {
    this.contentEl.empty();
    this.resultEl = null;
    this.toolbar();
    // themed canvas + elevated white paper (WeChat renders on white regardless
    // of the app theme, so the page itself stays white in dark mode too)
    const canvas = this.contentEl.createEl("div");
    canvas.addClass("publy-canvas");
    if ((this.plugin.settings.previewWidth ?? "desktop") === "mobile") canvas.addClass("is-mobile");
    const page = canvas.createEl("div");
    page.addClass("publy-paper");
    if ((this.plugin.settings.previewWidth ?? "desktop") === "mobile") page.addClass("is-mobile");
    // WeChat-article header: title, then account/author meta, hairline, body —
    // system font stack shared with the product's web pages
    page.style.fontFamily = '-apple-system, BlinkMacSystemFont, "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", sans-serif';
    if (meta?.title || meta?.account) {
      const title = page.createEl("h1");
      title.addClass("publy-title");
      title.setText(meta.title || t("noTitle"));
      const metaRow = page.createEl("div");
      metaRow.addClass("publy-meta-row");
      if (meta.account) {
        const avatar = metaRow.createEl("span");
        avatar.addClass("publy-avatar");
        avatar.textContent = meta.account.slice(0, 1).toUpperCase();
        const name = metaRow.createEl("span");
        name.addClass("publy-account");
        name.textContent = meta.account;
      }
      if (meta.author) {
        const a = metaRow.createEl("span");
        a.addClass("publy-author");
        a.textContent = meta.author;
      }
      const pill = metaRow.createEl("span");
      pill.addClass("publy-pill");
      pill.textContent = t("pillDraft");
      const hr = page.createEl("div");
      hr.addClass("publy-hairline");
    }
    const body = page.createEl("div");
    body.innerHTML = html;
  }
  setCards(cards: { base64: string }[], caption: string): void {
    this.contentEl.empty();
    this.resultEl = null;
    this.toolbar();
    const canvas = this.contentEl.createEl("div");
    canvas.addClass("publy-canvas");
    // centered when the deck fits, scrollable when it does not
    const strip = canvas.createEl("div");
    strip.addClass("publy-strip");
    for (const c of cards) {
      const img = strip.createEl("img");
      img.src = "data:image/png;base64," + c.base64;
    }
    const cap = canvas.createEl("div");
    cap.addClass("publy-caption");
    cap.textContent = caption;
  }
}

/** Publish history + scheduled jobs leaf. */
class PublyHistoryView extends ItemView {
  plugin: PublyPlugin;
  /** re-fetches and re-renders; set by the plugin on every render */
  refresh: (() => Promise<void>) | null = null;

  constructor(leaf: WorkspaceLeaf, plugin: PublyPlugin) {
    super(leaf);
    this.plugin = plugin;
  }
  getViewType(): string { return PUBLY_HISTORY_VIEW; }
  getDisplayText(): string { return t("viewHistory"); }
  getIcon(): string { return "history"; }
  async onOpen(): Promise<void> { await this.plugin.openHistory(); }
  async onClose(): Promise<void> { /* nothing */ }

  renderMessage(text: string): void {
    this.contentEl.empty();
    const d = this.contentEl.createEl("div");
    d.addClass("publy-view-msg");
    d.setText(text);
  }

  renderLoading(): void {
    this.renderMessage(t("histLoading"));
  }

  renderHistory(jobs: JobEntry[], entries: HistoryEntry[], onCancelJob: (id: string) => void): void {
    this.contentEl.empty();
    const bar = this.contentEl.createEl("div");
    bar.addClass("publy-panel-head");
    const title = bar.createEl("div");
    title.addClass("publy-panel-title");
    title.setText(t("histTitle"));
    const refreshBtn = bar.createEl("button");
    refreshBtn.addClass("publy-btn");
    setIcon(refreshBtn, "refresh-cw");
    refreshBtn.setAttribute("title", t("tipRefresh"));
    refreshBtn.addEventListener("click", () => void this.refresh?.());

    const fmt = (iso: string) => {
      try {
        return new Date(iso).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
      } catch {
        return iso;
      }
    };
    const typeLabel = (kind?: string) => (kind === "image_post" ? t("typeImagePost") : t("typeArticle"));
    const div = (parent: HTMLElement, cls?: string): HTMLElement => {
      const d = parent.createEl("div");
      if (cls) d.addClass(cls);
      return d;
    };
    const section = (text: string): void => {
      div(this.contentEl, "publy-section").setText(text);
    };

    const pending = jobs.filter((j) => j.status === "pending");
    section(t("histJobs", { n: pending.length }));
    if (pending.length === 0) {
      div(this.contentEl, "publy-muted-line").setText(t("histJobsEmpty"));
    }
    for (const j of pending) {
      const tl = div(this.contentEl, "publy-timeline");
      const item = div(tl, "publy-tl-item");
      item.addClass("is-wait");
      const icon = item.createEl("span");
      icon.addClass("publy-tl-icon");
      setIcon(icon, "clock");
      const main = div(item, "publy-tl-main");
      div(main, "publy-tl-title").setText(j.title ?? t("noTitle"));
      div(main, "publy-tl-sub").setText(`${fmt(j.runAt)} · ${j.account ?? "?"} · ${typeLabel(j.type)}`);
      const cancel = item.createEl("button");
      cancel.addClass("publy-btn");
      cancel.textContent = t("btnCancel");
      cancel.addEventListener("click", () => onCancelJob(j.id));
    }

    section(t("histRecent"));
    if (entries.length === 0) {
      div(this.contentEl, "publy-muted-line").setText(t("histEmpty"));
    }
    const tl = div(this.contentEl, "publy-timeline");
    for (const e of entries.slice().reverse()) {
      const isOk = e.event === "published";
      const isFail = e.event === "failed";
      const isSched = e.event === "scheduled";
      const item = div(tl, "publy-tl-item");
      item.addClass(isOk ? "is-ok" : isFail ? "is-fail" : isSched ? "is-wait" : "is-fail");
      const icon = item.createEl("span");
      icon.addClass("publy-tl-icon");
      setIcon(icon, isOk ? "check-circle-2" : isFail ? "x-circle" : isSched ? "clock" : "ban");
      const main = div(item, "publy-tl-main");
      div(main, "publy-tl-title").setText(e.title ?? t("noTitle"));
      const sub = e.event === "failed" && e.error ? `${fmt(e.ts)} · ${e.error}` : `${fmt(e.ts)} · ${e.account ?? "?"} · ${typeLabel(e.type)}`;
      div(main, "publy-tl-sub").setText(sub);
    }
  }
}

const IMAGE_EXT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
};

function imageContentType(p: string): string {
  return IMAGE_EXT_TYPES[path.extname(p).toLowerCase()] ?? "image/png";
}

async function fileToBase64(f: File): Promise<string> {
  const buf = new Uint8Array(await f.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) {
    bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

/** native file picker via <input type="file"> — the community-plugin-safe way
 *  (electron.remote is banned by Obsidian's review rules, and the HTML input
 *  works everywhere). Resolves with the chosen files; [] when cancelled. */
function pickLocalImageFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/png,image/jpeg,image/webp,image/gif";
    input.multiple = true;
    input.style.display = "none";
    let settled = false;
    const done = (files: File[]) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(input.files ? Array.from(input.files) : []));
    input.addEventListener("cancel", () => done([]));
    document.body.appendChild(input);
    input.click();
  });
}

/** Simple list picker for switching accounts. */
class AccountModal extends Modal {
  private names: string[];
  private current: string;
  private onPick: (name: string) => void;

  constructor(app: App, names: string[], current: string, onPick: (name: string) => void) {
    super(app);
    this.names = names;
    this.current = current;
    this.onPick = onPick;
  }

  onOpen(): void {
    this.contentEl.createEl("h3").setText(t("acctModalTitle"));
    for (const n of this.names) {
      const row = this.contentEl.createEl("div");
      row.addClass("publy-acct-row");
      if (n === this.current) row.addClass("is-current");
      row.addEventListener("click", () => {
        if (n === this.current) return;
        this.close();
        this.onPick(n);
      });
      const name = row.createEl("span");
      name.addClass("publy-acct-name");
      name.setText(n);
      if (n === this.current) {
        setIcon(row, "check");
      } else {
        const b = row.createEl("button");
        b.addClass("publy-btn");
        b.textContent = t("acctSwitchBtn");
        b.addEventListener("click", (ev) => {
          ev.stopPropagation();
          this.close();
          this.onPick(n);
        });
      }
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

/** Pick this publish's cover: any body image, or the auto title card. */
class CoverPickerModal extends Modal {
  private plugin: PublyPlugin;
  private file: TFile;
  private candidates: { name: string; path: string; contentType: string }[];
  private onPick: (choice: string | null) => void;
  private chosen: string;
  private picked = false;

  constructor(app: App, plugin: PublyPlugin, file: TFile, candidates: { name: string; path: string; contentType: string }[], current: string, onPick: (choice: string | null) => void) {
    super(app);
    this.plugin = plugin;
    this.file = file;
    this.candidates = candidates;
    this.chosen = current;
    this.onPick = onPick;
  }

  onOpen(): void {
    this.contentEl.createEl("h3").setText(t("coverPickTitle"));
    const grid = this.contentEl.createEl("div");
    grid.addClass("publy-cover-grid");
    const tiles: [HTMLElement, string][] = [];
    const paint = () => {
      for (const [el, key] of tiles) el.toggleClass("is-chosen", key === this.chosen);
    };
    const makeTile = (key: string, build: (box: HTMLElement) => void, label: string): HTMLElement => {
      const el = grid.createEl("div");
      el.addClass("publy-cover-tile");
      // 2.35:1 crop thumbnail — what the cover actually looks like after the
      // server's center-crop, not the raw image
      const box = el.createEl("div");
      box.addClass("publy-cover-crop");
      build(box);
      const lab = el.createEl("div");
      lab.addClass("publy-cover-label");
      lab.setText(label);
      el.addEventListener("click", () => {
        this.chosen = key;
        paint();
      });
      tiles.push([el, key]);
      return el;
    };
    for (const c of this.candidates.slice(0, 12)) {
      let dataUri = "";
      try {
        dataUri = `data:${c.contentType};base64,${fs.readFileSync(c.path).toString("base64")}`;
      } catch {
        dataUri = "";
      }
      makeTile(c.name, (box) => {
        if (dataUri) {
          const im = box.createEl("img");
          im.src = dataUri;
        } else {
          box.setText("?");
        }
      }, c.name);
    }
    // the auto title card, rendered for real with this note's own title — the
    // same card the server would generate (fonts ship with the plugin)
    makeTile("auto", (box) => {
      const png = generateTitleCover(this.file.basename);
      if (png) {
        const im = box.createEl("img");
        im.src = "data:image/png;base64," + png.toString("base64");
      } else {
        const d = box.createEl("div");
        d.style.cssText = "width:100%;height:100%;display:flex;align-items:center;justify-content:center;background:#f8f6f0;color:#b75c3d;font-weight:600;font-size:12px;text-align:center;padding:4px;line-height:1.4";
        d.setText(this.file.basename);
      }
    }, t("coverAutoTile"));
    paint();

    // pick any image from this computer — articles without body images still
    // deserve a real cover. Content-addressed keys (local-<hash>) live in the
    // session registry; electron.remote is banned by Obsidian review rules.
    const browseRow = this.contentEl.createEl("div");
    browseRow.style.cssText = "margin-top:8px";
    const browse = browseRow.createEl("button");
    browse.addClass("publy-btn");
    browse.textContent = t("browseLocal");
    browse.addEventListener("click", async () => {
      const files = await pickLocalImageFiles();
      let added = false;
      for (const f of files) {
        const data = await fileToBase64(f);
        const key = "local-" + crypto.createHash("sha1").update(data).digest("hex").slice(0, 10);
        const contentType = f.type || imageContentType(f.name);
        this.plugin.localImages.set(key, { name: f.name, data, contentType });
        if (tiles.some(([, k]) => k === key)) continue;
        const el = makeTile(key, (box) => {
          const im = box.createEl("img");
          im.src = `data:${contentType};base64,${data}`;
        }, f.name);
        grid.prepend(el);
        this.chosen = key;
        added = true;
      }
      if (added) paint();
    });

    const row = this.contentEl.createEl("div");
    row.addClass("publy-modal-row");
    const cancel = row.createEl("button");
    cancel.addClass("publy-btn");
    cancel.textContent = t("btnCancel");
    cancel.addEventListener("click", () => this.close());
    const ok = row.createEl("button");
    ok.addClass("publy-btn");
    ok.addClass("publy-btn-primary");
    ok.textContent = t("btnConfirm");
    ok.addEventListener("click", () => {
      this.picked = true;
      this.close();
      this.onPick(this.chosen);
    });
  }

  onClose(): void {
    if (!this.picked) this.onPick(null);
    this.contentEl.empty();
  }
}

/** Pick a local date+time for scheduled publishing. */
class ScheduleModal extends Modal {
  private onSubmit: (iso: string | null) => void;

  constructor(app: App, onSubmit: (iso: string | null) => void) {
    super(app);
    this.onSubmit = onSubmit;
  }

  onOpen(): void {
    this.contentEl.createEl("h3").setText(t("schedTitle"));
    const desc = this.contentEl.createEl("p");
    desc.addClass("publy-sched-desc");
    desc.setText(t("schedDesc"));
    const input = this.contentEl.createEl("input");
    input.type = "datetime-local";
    input.addClass("publy-sched-input");
    const min = new Date(Date.now() + 60_000);
    const pad = (n: number) => String(n).padStart(2, "0");
    input.min = `${min.getFullYear()}-${pad(min.getMonth() + 1)}-${pad(min.getDate())}T${pad(min.getHours())}:${pad(min.getMinutes())}`;
    const row = this.contentEl.createEl("div");
    row.addClass("publy-modal-row");
    const ok = row.createEl("button");
    ok.addClass("publy-btn");
    ok.addClass("publy-btn-primary");
    ok.textContent = t("schedBtn");
    ok.addEventListener("click", () => {
      const iso = input.value ? new Date(input.value).toISOString() : null;
      if (input.value && (Number.isNaN(new Date(input.value).getTime()) || new Date(input.value).getTime() < Date.now() - 60_000)) {
        new Notice(t("schedInvalid"));
        return;
      }
      this.close();
      this.onSubmit(iso);
    });
    const cancel = row.createEl("button");
    cancel.addClass("publy-btn");
    cancel.textContent = t("btnCancel");
    cancel.addEventListener("click", () => this.close());
  }

  onClose(): void {
    this.contentEl.empty();
  }
}

export default class PublyPlugin extends Plugin {
  settings: PublySettings;
  wasmOk = false;
  statusBarItem: HTMLElement | null = null;
  /** session-local registry of images picked from this computer for covers
   *  (key: local-<sha1 of content>) — no file paths are kept, only payload */
  localImages = new Map<string, { name: string; data: string; contentType: string }>();
  /** the note the in-app preview currently shows (for live re-render) */
  private livePreviewPath: string | null = null;
  /** one publish at a time — double-clicks must not create duplicate drafts */
  private publishInFlight = false;

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
      // the wasm resvg build silently loads NOTHING from fontFiles (paths) —
      // raw buffers work. family mappings route the generic families external
      // diagrams request (sans-serif/monospace/…) to the shipped subsets
      const fontBuffers = fontFiles.map((f) => new Uint8Array(fs.readFileSync(f)));
      setPngRenderer((svg, fitWidth) => {
        const resvg = new resvgModule!.Resvg(svg, {
          font: {
            fontBuffers,
            defaultFontFamily: "Noto Sans SC",
            sansSerifFamily: "Noto Sans SC",
            serifFamily: "Noto Sans SC",
            monospaceFamily: "Noto Sans SC",
            cursiveFamily: "Noto Sans SC",
            fantasyFamily: "Noto Sans SC",
          },
          ...(fitWidth ? { fitTo: { mode: "width", value: fitWidth } } : {}),
        });
        return Buffer.from(resvg.render().asPng());
      });
      this.wasmOk = true;
    } catch (err) {
      this.wasmOk = false;
      console.error("[publy] wasm renderer unavailable:", err);
      new Notice(t("wasmInitFail"));
    }

    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    LANG_PREF = this.settings.lang ?? "auto";

    this.registerView(VIEW_TYPE_PUBLY_PREVIEW, (leaf: WorkspaceLeaf) => new PublyPreviewView(leaf, this));
    this.registerView(PUBLY_HISTORY_VIEW, (leaf: WorkspaceLeaf) => new PublyHistoryView(leaf, this));
    this.statusBarItem = this.addStatusBarItem();

    // live preview: while the preview leaf is open it always shows the active
    // note — switching notes re-renders, saving re-renders (~0.9s debounce).
    // autoPreview extends this to zero-interaction: opening any note brings
    // the panel up by itself.
    let liveTimer: number | undefined;
    const previewOpen = () => this.app.workspace.getLeavesOfType(VIEW_TYPE_PUBLY_PREVIEW).length > 0;
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        const open = previewOpen();
        if (!open && !this.settings.autoPreview) return;
        if (open && file.path === this.livePreviewPath) return;
        void this.previewCurrentNote(file);
      }),
    );
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (!previewOpen()) return;
        if (!(file instanceof TFile) || file.path !== this.livePreviewPath) return;
        window.clearTimeout(liveTimer);
        liveTimer = window.setTimeout(() => void this.previewCurrentNote(file as TFile), 900);
      }),
    );

    // right-click any note → publish / preview / copy for THAT note
    this.registerEvent(
      this.app.workspace.on("file-menu", (menu, file) => {
        if (!(file instanceof TFile) || file.extension !== "md") return;
        menu.addItem((item) => {
          item.setTitle(t("menuPublish")).setIcon("send").onClick(() => void this.publishCurrentNote(file));
        });
        menu.addItem((item) => {
          item.setTitle(t("menuPreview")).setIcon("eye").onClick(() => void this.previewCurrentNote(file));
        });
        menu.addItem((item) => {
          item.setTitle(t("menuCopy")).setIcon("copy").onClick(() => void this.copyRenderedHtml(file));
        });
      }),
    );

    this.addRibbonIcon("send", t("ribbon"), () => this.publishCurrentNote());

    this.addCommand({
      id: "publish-current-note",
      name: t("cmdPublish"),
      callback: () => this.publishCurrentNote(),
    });

    this.addCommand({
      id: "publish-scheduled",
      name: t("cmdSchedule"),
      callback: () => void this.publishScheduled(),
    });

    this.addCommand({
      id: "preview-current-note",
      name: t("cmdPreview"),
      callback: () => this.previewCurrentNote(),
    });

    this.addCommand({
      id: "preview-current-note-browser",
      name: t("cmdPreviewBrowser"),
      callback: () => this.previewInBrowser(() => this.renderCurrent()),
    });

    this.addCommand({
      id: "copy-rendered-html",
      name: t("cmdCopy"),
      callback: () => this.copyRenderedHtml(),
    });

    this.addCommand({
      id: "show-history",
      name: t("cmdHistory"),
      callback: () => void this.openHistory(),
    });

    this.addCommand({
      id: "switch-account",
      name: t("cmdSwitch"),
      callback: () => void this.switchAccount(),
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
    new Notice(t("ensureConfigured"));
    const setting = (this.app as unknown as { setting?: { open: () => void; openTabById: (id: string) => void } }).setting;
    setting?.open();
    setting?.openTabById("publy");
    return false;
  }

  private status(text: string): void {
    this.statusBarItem?.setText(text);
  }

  /** the open preview panel, if any — publish progress mirrors into it */
  private previewView(): PublyPreviewView | null {
    const leaf = this.app.workspace.getLeavesOfType(VIEW_TYPE_PUBLY_PREVIEW)[0] as WorkspaceLeaf | undefined;
    return (leaf?.view as PublyPreviewView | undefined) ?? null;
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
    if (!f) throw new Error(t("errNoActiveNote"));
    const raw = await this.app.vault.cachedRead(f);
    const rendered = renderMarkdown(raw, this.renderOptions());
    for (const w of rendered.warnings) console.warn("[publy] " + w);
    return this.inlineImages(rendered.html, rendered.attachments);
  }

  /** preview-only: core emits attachment://<name> refs that publishing swaps
   *  for WeChat CDN urls; nothing local can load that scheme, so inline the
   *  files as data uris for display */
  private inlineImages(html: string, attachments: { name: string; path: string; contentType: string }[]): string {
    let out = html;
    for (const a of attachments) {
      try {
        const b64 = fs.readFileSync(a.path).toString("base64");
        out = out.split(`attachment://${a.name}`).join(`data:${a.contentType};base64,${b64}`);
      } catch (err) {
        console.warn("[publy] failed to inline image:", a.path, err);
      }
    }
    return out;
  }

  private async activateView(viewType: string): Promise<ItemView> {
    const { workspace } = this.app;
    let leaf = workspace.getLeavesOfType(viewType)[0] as WorkspaceLeaf | undefined;
    if (!leaf) {
      leaf = workspace.getRightLeaf(false);
      await leaf.setViewState({ type: viewType, active: true });
    }
    workspace.revealLeaf(leaf);
    return leaf.view as ItemView;
  }

  /** authenticated GET against the configured server; throws on config/HTTP errors */
  async apiGet<T>(path: string): Promise<T> {
    const base = new URL(this.settings.server);
    const res = await requestUrl({
      url: new URL(path, base).toString(),
      method: "GET",
      headers: { "x-api-key": this.settings.apiKey },
    });
    if (res.status >= 400) throw new Error(`HTTP ${res.status}`);
    return res.json as T;
  }

  async openHistory(): Promise<void> {
    const view = (await this.activateView(PUBLY_HISTORY_VIEW)) as PublyHistoryView;
    if (!this.ensureConfigured()) {
      view.renderMessage(t("histNeedConfig"));
      return;
    }
    view.renderLoading();
    view.refresh = () => this.openHistory();
    try {
      const [hist, jobs] = await Promise.all([
        this.apiGet<{ history?: HistoryEntry[] }>("/v1/history?limit=50"),
        this.apiGet<{ jobs?: JobEntry[] }>("/v1/jobs"),
      ]);
      view.renderHistory(jobs.jobs ?? [], hist.history ?? [], (id) => void this.cancelJob(id));
    } catch (err) {
      view.renderMessage(t("histLoadFail", { msg: (err as Error).message }));
    }
  }

  async cancelJob(id: string): Promise<void> {
    try {
      const base = new URL(this.settings.server);
      const res = await requestUrl({
        url: new URL(`/v1/jobs/${id}`, base).toString(),
        method: "DELETE",
        headers: { "x-api-key": this.settings.apiKey },
      });
      if (res.status >= 400) {
        new Notice(t("cancelFail", { msg: String((res.json as { message?: string } | null)?.message ?? res.status) }));
      } else {
        new Notice(t("cancelOk"));
      }
    } catch (err) {
      new Notice(`取消失败：${(err as Error).message}`);
    }
    await this.openHistory();
  }

  /** account picker over the accounts the key owns on the server */
  async switchAccount(): Promise<void> {
    if (!this.ensureConfigured()) return;
    let names: string[] = [];
    try {
      const r = await this.apiGet<{ accounts?: { name: string }[] }>("/v1/accounts");
      names = (r.accounts ?? []).map((a) => a.name);
    } catch (err) {
      new Notice(t("acctFetchFail", { msg: (err as Error).message }));
      return;
    }
    if (names.length === 0) {
      new Notice(t("acctNone"));
      return;
    }
    const pick = (name: string) => {
      this.settings.account = name;
      void this.saveSettings();
      new Notice(t("acctSwitched", { name }));
    };
    if (names.length === 1) {
      pick(names[0]);
      return;
    }
    new AccountModal(this.app, names, this.settings.account, pick).open();
  }

  /** one preview command: picks article or image-post cards from frontmatter.
   *  public: the preview-view toolbar and the theme dropdown call back into it. */
  async previewCurrentNote(file?: TFile): Promise<void> {
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice(t("noActiveNote"));
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    this.livePreviewPath = f.path;
    if (this.detectIsCards(raw)) {
      await this.previewCardDeck(f, raw);
      return;
    }
    try {
      const rendered = renderMarkdown(raw, this.renderOptions());
      for (const w of rendered.warnings) console.warn("[publy] " + w);
      const view = (await this.activateView(VIEW_TYPE_PUBLY_PREVIEW)) as PublyPreviewView;
      view.refresh = () => this.previewCurrentNote(f);
      view.setHtml(this.inlineImages(rendered.html, rendered.attachments), {
        title: rendered.title || f.basename,
        author: rendered.meta.author,
        account: this.settings.account || undefined,
      });
    } catch (err) {
      new Notice(`Publy: ${(err as Error).message}`);
    }
  }

  private async previewCardDeck(file?: TFile, rawArg?: string): Promise<void> {
    if (!this.wasmOk) {
      new Notice(t("wasmDown"));
      return;
    }
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice(t("noActiveNote"));
      return;
    }
    const raw = rawArg ?? (await this.app.vault.cachedRead(f));
    new Notice(t("cardsRendering"));
    try {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-cards-"));
      const result = await renderCards(raw, { outDir });
      const cards = result.cards.map((c) => ({
        base64: fs.readFileSync(c.file).toString("base64"),
      }));
      const view = (await this.activateView(VIEW_TYPE_PUBLY_PREVIEW)) as PublyPreviewView;
      view.refresh = () => this.previewCardDeck(f);
      view.setCards(cards, result.caption);
      if (!result.lint.ok) {
        new Notice(`Publy lint: ${result.lint.problems[0] ?? "check the preview"}`);
      }
    } catch (err) {
      new Notice(t("cardsFail", { msg: (err as Error).message }));
    }
  }

  /** public: the preview-view toolbar calls back into it */
  async copyRenderedHtml(file?: TFile): Promise<void> {
    const f = file ?? this.currentFile();
    if (!f) {
      new Notice(t("noActiveNote"));
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    try {
      const rendered = renderMarkdown(raw, this.renderOptions());
      for (const w of rendered.warnings) console.warn("[publy] " + w);
      if (rendered.attachments.length > 0) {
        new Notice(t("copyHasImages"));
      }
      const item = new ClipboardItem({
        "text/html": new Blob([rendered.html], { type: "text/html" }),
        "text/plain": new Blob([f.basename], { type: "text/plain" }),
      });
      await navigator.clipboard.write([item]);
      new Notice(t("copyOk"));
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
    await this.doPublish(file ?? this.currentFile(), undefined);
  }

  /** pick a time, then hand the note to the server's job queue */
  async publishScheduled(): Promise<void> {
    const f = this.currentFile();
    if (!f) {
      new Notice(t("noActiveNote"));
      return;
    }
    new ScheduleModal(this.app, (iso) => {
      if (iso) void this.doPublish(f, iso);
    }).open();
  }

  private async doPublish(fileArg: TFile | null, publishAt?: string): Promise<void> {
    const f = fileArg;
    if (!f) {
      new Notice(t("noActiveNote"));
      return;
    }
    if (this.publishInFlight) {
      new Notice(t("inFlight"));
      return;
    }
    this.publishInFlight = true;
    try {
      await this.doPublishInner(f, publishAt);
    } finally {
      this.publishInFlight = false;
    }
  }

  private async doPublishInner(f: TFile, publishAt?: string): Promise<void> {
    if (!this.ensureConfigured()) return;
    let publishUrl: URL;
    try {
      publishUrl = new URL("/v1/publish", this.settings.server);
    } catch {
      new Notice(t("badServer"));
      return;
    }
    const raw = await this.app.vault.cachedRead(f);
    this.status(t("rendering"));
    const view = this.previewView();
    view?.setPublishing(true);
    // one sticky progress toast for the whole run — transient toasts vanish
    // mid-publish and reads as "nothing happened", inviting double-clicks
    const progress = new Notice(t("rendering"), 0);
    let html: string;
    let payloadAttachments: { name: string; data: string; contentType: string }[];
    let coverName: string | undefined;
    let explicitCover = false;
    let coverMode: "auto" | undefined;
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
        if (existing) {
          coverName = existing.name;
          explicitCover = true;
        }
      }
      html = rendered.html;
      type = rendered.type;
      title = rendered.title || f.basename;
      author = rendered.meta.author;
    } catch (err) {
      progress.hide();
      this.status("");
      view?.setPublishing(false);
      view?.setPublishResult("error", t("resultFail") + " — " + (err as Error).message);
      new Notice(t("renderFail", { msg: (err as Error).message }));
      return;
    }

    // no explicit cover -> the user picks: body images, a file from this
    // computer, or the auto title card (shown as a real render). Applies to
    // image-less articles too — silence must never choose the cover.
    if (type === "article" && !explicitCover) {
      const last = this.settings.lastCover?.[f.path];
      const known = (k: string) =>
        k === "auto" || payloadAttachments.some((c) => c.name === k) || this.localImages.has(k) || fs.existsSync(k);
      const pre = last && known(last) ? last : payloadAttachments[0]?.name ?? "auto";
      const choice = await new Promise<string | null>((resolve) => {
        new CoverPickerModal(this.app, this, f, payloadAttachments, pre, resolve).open();
      });
      if (choice === null) {
        progress.hide();
        this.status("");
        view?.setPublishing(false);
        return;
      }
      this.settings.lastCover = { ...(this.settings.lastCover ?? {}), [f.path]: choice };
      await this.saveSettings();
      if (choice === "auto") {
        coverMode = "auto";
      } else if (choice.startsWith("local-")) {
        // a file picked from this computer (content-addressed in the session
        // registry) — rides the payload like a body image
        const img = this.localImages.get(choice);
        if (!img) {
          progress.hide();
          this.status("");
          view?.setPublishing(false);
          new Notice(t("localCoverLost"));
          return;
        }
        payloadAttachments.push({ name: img.name, data: img.data, contentType: img.contentType });
        coverName = img.name;
      } else {
        coverName = choice;
      }
    }

    progress.setMessage(t("uploading"));
    this.status(t("uploading"));
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
          ...(coverMode ? { coverMode } : {}),
          // server dedupes on this within 10 min — a double-click cannot
          // create a second identical draft even if it slips past the lock
          idempotencyKey: "obs-" + crypto
            .createHash("sha1")
            .update([f.path, f.stat.mtime, type, title, html.length, publishAt ?? ""].join("|"))
            .digest("hex"),
          ...(publishAt ? { publishAt } : {}),
        }),
      });
      const body = res.json as PublishResponse;
      progress.hide();
      this.status("");
      view?.setPublishing(false);
      if (!res.status || res.status >= 400) {
        const msg = `${body.code ?? res.status}: ${body.message ?? ""}`;
        view?.setPublishResult("error", t("resultFail") + " — " + msg);
        new Notice(t("publishFail", { msg }), 8000);
        return;
      }
      if (body.deduped) {
        view?.setPublishResult("deduped", `${t("resultDeduped")} ·《${title}》`);
        new Notice(t("deduped", { title }), 6000);
        return;
      }
      if (body.scheduled) {
        const when = body.runAt ? new Date(body.runAt).toLocaleString("zh-CN") : "";
        view?.setPublishResult("scheduled", `${t("resultScheduled")} ·《${title}》${when ? " · " + when : ""}`);
        new Notice(t("scheduledOk", { title, when }), 6000);
        void this.openHistory();
        return;
      }
      const coverLabel = body.coverSource === "cover" ? t("coverExplicit")
        : body.coverSource === "auto" ? t("coverAuto")
        : t("coverFirst");
      const who = this.settings.account ? ` · ${this.settings.account}` : "";
      view?.setPublishResult("ok", `${t("resultOk")} ·《${title}》${who} · ${coverLabel} · ${((Date.now() - t0) / 1000).toFixed(1)}s`);
      new Notice(`${t("publishOk", { title, sec: ((Date.now() - t0) / 1000).toFixed(1) })} · ${coverLabel}`, 6000);
    } catch (err) {
      progress.hide();
      this.status("");
      view?.setPublishing(false);
      view?.setPublishResult("error", t("resultFail") + " — " + (err as Error).message);
      new Notice(t("netFail", { msg: (err as Error).message }), 8000);
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

    new Setting(containerEl).setName(t("setLang")).setDesc(t("setLangDesc")).addDropdown((drop) =>
      drop
        .addOptions({ auto: t("langAuto"), zh: "中文", en: "English" })
        .setValue(this.plugin.settings.lang ?? "auto")
        .onChange(async (v) => {
          this.plugin.settings.lang = v as "auto" | "zh" | "en";
          LANG_PREF = this.plugin.settings.lang;
          await this.plugin.saveSettings();
          new Notice(t("langReload"), 6000);
          this.display();
        }),
    );

    new Setting(containerEl).setName(t("setAutoPreview")).setDesc(t("setAutoPreviewDesc")).addToggle((tgl) =>
      tgl.setValue(this.plugin.settings.autoPreview ?? false).onChange(async (v) => {
        this.plugin.settings.autoPreview = v;
        await this.plugin.saveSettings();
        if (v) void this.plugin.previewCurrentNote();
      }),
    );

    // setup guide — the first thing a new user sees
    const intro = containerEl.createEl("div");
    intro.style.cssText =
      "background:var(--background-secondary);border-radius:8px;padding:12px 16px;margin-bottom:14px;font-size:13px;line-height:1.9";
    intro.createEl("div").setText(t("intro"));
    const links = intro.createEl("div");
    const mkLink = (text: string, url: string) => {
      const a = links.createEl("a");
      a.textContent = text;
      a.href = url;
      a.target = "_blank";
    };
    mkLink(t("guideLink"), "https://publy.jrtx.site");
    links.appendText(" · ");
    mkLink(t("buyLink"), "https://publy-api.jrtx.site/");
    links.style.marginTop = "4px";

    new Setting(containerEl).setName(t("setServer")).setDesc(t("setServerDesc")).addText((text) =>
      text.setPlaceholder("https://…").setValue(this.plugin.settings.server).onChange(async (v) => {
        this.plugin.settings.server = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName(t("setKey")).setDesc(t("setKeyDesc")).addText((text) => {
      text.setPlaceholder("publy_…").setValue(this.plugin.settings.apiKey).onChange(async (v) => {
        this.plugin.settings.apiKey = v.trim();
        await this.plugin.saveSettings();
      });
      text.inputEl.type = "password";
    });
    const acctSetting = new Setting(containerEl).setName(t("setAccount")).setDesc(t("setAccountDesc"));
    void (async () => {
      try {
        const r = await this.plugin.apiGet<{ accounts?: { name: string }[] }>("/v1/accounts");
        const names = (r.accounts ?? []).map((a) => a.name);
        if (names.length === 0) throw new Error("no accounts");
        const opts: Record<string, string> = {};
        for (const n of names) opts[n] = n;
        acctSetting.addDropdown((drop) =>
          drop
            .addOptions(opts)
            .setValue(names.includes(this.plugin.settings.account) ? this.plugin.settings.account : names[0])
            .onChange(async (v) => {
              this.plugin.settings.account = v;
              await this.plugin.saveSettings();
            }),
        );
        if (!names.includes(this.plugin.settings.account)) {
          this.plugin.settings.account = names[0];
          await this.plugin.saveSettings();
        }
      } catch {
        acctSetting.addText((text) =>
          text.setPlaceholder(t("setAccountFallback")).setValue(this.plugin.settings.account).onChange(async (v) => {
            this.plugin.settings.account = v.trim();
            await this.plugin.saveSettings();
          }),
        );
      }
    })();
    new Setting(containerEl).setName(t("setMedia")).setDesc(t("setMediaDesc")).addText((text) =>
      text.setPlaceholder(t("setMediaPlaceholder")).setValue(this.plugin.settings.mediaDir).onChange(async (v) => {
        this.plugin.settings.mediaDir = v.trim();
        await this.plugin.saveSettings();
      }),
    );
    new Setting(containerEl).setName(t("setTheme")).setDesc(t("setThemeDesc")).addDropdown((drop) =>
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
      .setName(t("setConn"))
      .setDesc(t("setConnDesc"))
      .addButton((btn) =>
        btn.setButtonText(t("btnTest")).setCta().onClick(() => {
          void this.testConnection(connResult);
        }),
      );
  }

  private async testConnection(resultEl: HTMLElement): Promise<void> {
    const s = this.plugin.settings;
    resultEl.setText(t("testing"));
    let base: URL;
    try {
      base = new URL(s.server);
    } catch {
      resultEl.setText(t("badServerUrl"));
      return;
    }
    if (!s.apiKey) {
      resultEl.setText(t("needKey"));
      return;
    }
    try {
      const health = await requestUrl({ url: new URL("/health", base).toString(), method: "GET" });
      if ((health.json as { status?: string } | null)?.status !== "ok") throw new Error(t("healthBad"));
      const quota = await requestUrl({
        url: new URL("/v1/quota", base).toString(),
        method: "GET",
        headers: { "x-api-key": s.apiKey },
      });
      if (quota.status === 401 || quota.status === 403) {
        resultEl.setText(t("keyInvalid", { code: quota.status }));
        return;
      }
      const q = quota.json as { plan?: string; used?: number; limit?: number; admin?: boolean; unlimited?: boolean };
      const usage = q.admin ? t("planAdmin") : t("planUsage", { plan: q.plan ?? "?", used: q.used ?? "?", limit: q.limit ?? "?" });
      resultEl.setText(t("connOk", { usage }) + (s.account ? "" : t("connOkNoAccount")));
    } catch (err) {
      resultEl.setText(t("connFail", { msg: (err as Error).message }));
    }
  }
}
