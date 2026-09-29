#!/usr/bin/env node
// publy CLI — the agent-era client for the Publy publishing pipeline.

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { exec, execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { Attachment, JobInfo, PublishRequest, PublishResponse } from "@publy/shared";
import { captionToHtml, parseSource, publishType, renderCards, renderMarkdown, stripMarkdown } from "@publy/core";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
) as { version: string };

const CONFIG_PATH = process.env.PUBLY_CONFIG ?? path.join(os.homedir(), ".publy", "config.json");

export interface CliAccount {
  name: string;
  app_id?: string;
  theme?: string;
  author?: string;
}

export interface CliConfig {
  server?: string;
  api_key?: string;
  default_account?: string;
  media_dirs?: string[];
  /** SSH tunnel for networks that break large POSTs */
  tunnel?: { ssh_target: string; local_port: number; remote_port: number; /** base url to use when the tunnel is up (default http://127.0.0.1:<local_port>) */ server?: string };
  accounts?: CliAccount[];
}

export function loadConfig(): CliConfig {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  return JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
}

function saveConfig(config: CliConfig): void {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n");
}

function resolveMediaDirs(explicit: string[], config: CliConfig): string[] {
  return [...explicit, ...(config.media_dirs ?? [])];
}

function openInBrowser(file: string): void {
  const cmd =
    process.platform === "win32"
      ? `start "" "${file}"`
      : process.platform === "darwin"
        ? `open "${file}"`
        : `xdg-open "${file}"`;
  exec(cmd, () => {});
}

function isPortListening(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1", timeout: 800 });
    socket.on("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.on("error", () => resolve(false));
    socket.on("timeout", () => {
      socket.destroy();
      resolve(false);
    });
  });
}

/** Start the configured SSH tunnel (idempotent) and wait for it to answer. */
async function ensureTunnel(config: CliConfig): Promise<boolean> {
  const t = config.tunnel;
  if (!t) return false;
  if (await isPortListening(t.local_port)) return true;
  const args = [
    "-o", "BatchMode=yes", "-o", "ExitOnForwardFailure=yes", "-o", "ServerAliveInterval=30",
    "-f", "-N", "-L", `${t.local_port}:localhost:${t.remote_port}`, t.ssh_target,
  ];
  try {
    execFileSync("ssh", args, { stdio: "ignore" });
  } catch {
    return false;
  }
  for (let i = 0; i < 20; i++) {
    if (await isPortListening(t.local_port)) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// ---------------------------------------------------------------------------

async function cmdRender(file: string, opts: Record<string, any>): Promise<void> {
  const raw = fs.readFileSync(file, "utf-8");
  const result = renderMarkdown(raw, {
    theme: opts.theme,
    customThemePath: opts.customTheme,
    highlight: opts.highlight,
    mediaDirs: resolveMediaDirs(opts.mediaDir ?? [], loadConfig()),
    baseDir: path.dirname(path.resolve(file)),
    footnote: opts.footnote !== false,
    footer: opts.footer,
  });
  for (const w of result.warnings) console.error(`warn: ${w}`);
  if (opts.out) {
    fs.writeFileSync(opts.out, result.html);
    console.error(`rendered → ${opts.out}`);
  } else {
    process.stdout.write(result.html);
  }
}

async function cmdPreview(file: string, opts: Record<string, any>): Promise<void> {
  const raw = fs.readFileSync(file, "utf-8");
  const result = renderMarkdown(raw, {
    theme: opts.theme,
    customThemePath: opts.customTheme,
    highlight: opts.highlight,
    mediaDirs: resolveMediaDirs(opts.mediaDir ?? [], loadConfig()),
    baseDir: path.dirname(path.resolve(file)),
    footnote: opts.footnote !== false,
    footer: opts.footer,
  });
  for (const w of result.warnings) console.error(`warn: ${w}`);
  const out = path.join(os.tmpdir(), `publy-preview-${Date.now()}.html`);
  fs.writeFileSync(
    out,
    `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(result.title || "preview")}</title></head><body style="margin:0;background:#ddd;display:flex;justify-content:center"><div style="max-width:578px;width:100%">${result.html}</div></body></html>`,
  );
  console.error(`preview → ${out}`);
  openInBrowser(out);
}

async function cmdCard(file: string, opts: Record<string, any>): Promise<void> {
  const raw = fs.readFileSync(file, "utf-8");
  const outDir = path.resolve(opts.out ?? path.join(path.dirname(path.resolve(file)), "cards"));
  const result = await renderCards(raw, {
    theme: opts.theme,
    outDir,
    fontFiles: opts.fontFile ?? [],
  });
  for (const w of result.warnings) console.error(`warn: ${w}`);

  if (opts.preview) {
    const { buildPreviewHtml } = await import("@publy/core");
    const previewFile = path.join(outDir, "preview.html");
    fs.writeFileSync(previewFile, buildPreviewHtml(result));
    console.error(`preview → ${previewFile}`);
    openInBrowser(previewFile);
  }

  if (opts.json) {
    console.log(
      JSON.stringify({
        ok: result.lint.ok,
        problems: result.lint.problems,
        caption: result.caption,
        cards: result.cards,
      }),
    );
  } else {
    for (const card of result.cards) console.log(`${card.kind.padEnd(7)} ${card.file}`);
  }
  if (!result.lint.ok && opts.lint !== false) {
    for (const p of result.lint.problems) console.error(`lint: ${p}`);
    process.exit(4);
  }
}

async function cmdConfigSet(key: string, value: string): Promise<void> {
  const config = loadConfig();
  const allowed = ["server", "api_key", "default_account"];
  if (!allowed.includes(key)) {
    console.error(`publy: unknown config key "${key}" (allowed: ${allowed.join(", ")})`);
    process.exit(1);
  }
  (config as Record<string, unknown>)[key] = value;
  saveConfig(config);
  console.log(`${key} = ${key === "api_key" ? "***" : value}`);
}

async function cmdAccountAdd(name: string, opts: Record<string, any>): Promise<void> {
  const config = loadConfig();
  config.accounts ??= [];
  const existing = config.accounts.find((a) => a.name === name);
  const account = { name, app_id: opts.appId, author: opts.author, theme: opts.theme };
  if (existing) Object.assign(existing, account);
  else config.accounts.push(account);
  if (!config.default_account) config.default_account = name;
  saveConfig(config);
  console.log(`account ${name} saved${config.default_account === name ? " (default)" : ""}`);
}

async function cmdThemePreview(name: string): Promise<void> {
  const { BUILTIN_THEMES, BUILTIN_CARD_THEMES, renderMarkdown, renderCards, buildPreviewHtml } = await import("@publy/core");
  // samples ship inside the package; fall back to repo layouts for dev checkouts
  const distDir = path.dirname(fileURLToPath(import.meta.url));
  const sampleDirs = [path.resolve(distDir, "../samples"), path.resolve(distDir, "../../../packages/cli/samples"), path.resolve(distDir, "../../../docs/samples")];
  const sampleDir = sampleDirs.find((d) => fs.existsSync(path.join(d, "card-sample.md")));
  if (!sampleDir) throw new Error("bundled theme samples not found");

  if (name in BUILTIN_CARD_THEMES) {
    const raw = fs.readFileSync(path.join(sampleDir, "card-sample.md"), "utf8");
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-theme-preview-"));
    const result = await renderCards(raw, { theme: name, outDir });
    const previewFile = path.join(outDir, "preview.html");
    fs.writeFileSync(previewFile, buildPreviewHtml(result));
    console.error(`preview → ${previewFile}`);
    openInBrowser(previewFile);
    return;
  }
  if ((BUILTIN_THEMES as readonly string[]).includes(name)) {
    const raw = fs.readFileSync(path.join(sampleDir, "article-sample.md"), "utf8");
    const rendered = renderMarkdown(raw, { theme: name });
    const out = path.join(os.tmpdir(), `publy-theme-preview-${name}-${Date.now()}.html`);
    fs.writeFileSync(out, rendered.html);
    console.error(`preview → ${out}`);
    openInBrowser(out);
    return;
  }
  console.error(`publy: unknown theme "${name}". Use \`publy theme ls\` to list built-ins.`);
  process.exit(1);
}

// ---------------------------------------------------------------------------

/** text-mode image post: body images in order, caption = remaining paragraphs. */
function textModePayload(rendered: ReturnType<typeof renderMarkdown>, raw: string): { html: string; images: Attachment[]; coverName?: string } {
  const { body } = parseSource(raw);
  const captionText = body
    .split("\n")
    .filter((l) => !/^\s*!\[\[|^\s*!\[/.test(l))
    .join("\n")
    .trim();
  const images: Attachment[] = rendered.attachments.map((a) => ({
    name: a.name,
    data: fs.readFileSync(a.path).toString("base64"),
    contentType: a.contentType,
  }));
  return { html: captionToHtml(captionText), images, coverName: images[0]?.name };
}

async function cmdPublish(file: string, opts: Record<string, any>): Promise<void> {
  const config = loadConfig();
  const server = opts.server ?? config.server;
  const apiKey = opts.apiKey ?? config.api_key;
  if (!server || !apiKey) {
    console.error("publy: server/api_key not configured. Run `publy config set server <url>` / `config set api_key <key>` or pass --server/--api-key.");
    process.exit(5);
  }

  const raw = fs.readFileSync(file, "utf-8");
  const baseDir = path.dirname(path.resolve(file));
  const parsed = parseSource(raw);
  const type = publishType(parsed.meta);

  let html: string;
  let images: Attachment[];
  let coverName: string | undefined;
  let title: string;

  if (type === "image_post") {
    const mode = String((parsed.meta as Record<string, unknown>).mode ?? "text").toLowerCase();
    if (mode === "cards") {
      const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-cards-"));
      const cardResult = await renderCards(raw, { theme: opts.theme, outDir });
      if (!cardResult.lint.ok) {
        for (const p of cardResult.lint.problems) console.error(`lint: ${p}`);
        process.exit(4);
      }
      images = cardResult.cards.map((c) => ({
        name: c.name,
        data: fs.readFileSync(c.file).toString("base64"),
        contentType: "image/png",
      }));
      html = captionToHtml(cardResult.caption);
      coverName = images[0]?.name;
    } else {
      const rendered = renderMarkdown(raw, {
        theme: opts.theme,
        customThemePath: opts.customTheme,
        highlight: opts.highlight,
        mediaDirs: resolveMediaDirs(opts.mediaDir ?? [], config),
        baseDir,
        footnote: false,
        footer: opts.footer,
      });
      for (const w of rendered.warnings) console.error(`warn: ${w}`);
      ({ html, images, coverName } = textModePayload(rendered, raw));
    }
    title = opts.title || parsed.meta.title || path.basename(file, path.extname(file));
  } else {
    const rendered = renderMarkdown(raw, {
      theme: opts.theme ?? parsed.meta.theme,
      customThemePath: opts.customTheme,
      highlight: opts.highlight,
      mediaDirs: resolveMediaDirs(opts.mediaDir ?? [], config),
      baseDir,
      footnote: opts.footnote !== false,
      footer: opts.footer,
    });
    for (const w of rendered.warnings) console.error(`warn: ${w}`);
    const attachments: Attachment[] = rendered.attachments.map((a) => ({
      name: a.name,
      data: fs.readFileSync(a.path).toString("base64"),
      contentType: a.contentType,
    }));
    const coverPath = opts.cover || rendered.cover;
    if (coverPath) {
      const resolved = path.isAbsolute(coverPath) ? coverPath : path.resolve(baseDir, coverPath);
      if (!fs.existsSync(resolved)) {
        console.error(`publy: cover not found: ${resolved}`);
        process.exit(2);
      }
      const existing = rendered.attachments.find((a) => a.path === resolved);
      if (existing) {
        coverName = existing.name;
      } else {
        const ext = path.extname(resolved).toLowerCase();
        coverName = path.basename(resolved);
        attachments.unshift({
          name: coverName,
          data: fs.readFileSync(resolved).toString("base64"),
          contentType: ext === ".png" ? "image/png" : "image/jpeg",
        });
      }
    }
    html = rendered.html;
    images = attachments;
    title = opts.title || rendered.title || path.basename(file, path.extname(file));
  }

  const accountName = opts.account ?? config.default_account ?? config.accounts?.[0]?.name;
  if (!accountName) {
    console.error("publy: no account specified (--account or default_account in config)");
    process.exit(1);
  }
  const account = config.accounts?.find((a) => a.name === accountName);

  // content-addressed idempotency key: stable across retries of the same
  // publish, changes when content changes
  const idempotencyKey = crypto
    .createHash("sha256")
    .update(accountName)
    .update(type)
    .update(title)
    .update(String(html.length))
    .update(images.map((i) => i.name).join(","))
    .digest("hex")
    .slice(0, 32);

  // digest: explicit frontmatter, else derived from the first body paragraph
  let digest = parsed.meta.digest;
  if (!digest) {
    const firstParagraph = type === "image_post"
      ? (parsed.meta.caption ?? "")
      : parsed.body.split(/\n{2,}/).map((b) => b.trim()).find((b) => b && !b.startsWith("#") && !b.startsWith("!") && !b.startsWith("---")) ?? "";
    digest = stripMarkdown(firstParagraph).slice(0, 120);
  }

  const payload: PublishRequest = {
    account: accountName,
    type,
    title,
    html,
    images,
    cover: coverName,
    author: opts.author ?? parsed.meta.author ?? account?.author,
    digest,
    needOpenComment: true,
    idempotencyKey,
  };
  if (opts.at) {
    const d = new Date(opts.at);
    if (Number.isNaN(d.getTime())) {
      console.error(`publy: invalid --at datetime "${opts.at}"`);
      process.exit(1);
    }
    payload.publishAt = d.toISOString();
  }

  type PublishResult = Partial<PublishResponse> & { code?: string; message?: string; deduped?: boolean; jobId?: string; runAt?: string };
  async function postPublish(serverUrl: string): Promise<{ res: Response; body: PublishResult }> {
    const res = await fetch(new URL("/v1/publish", serverUrl).toString(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": apiKey },
      body: JSON.stringify(payload),
    });
    return { res, body: (await res.json()) as PublishResult };
  }

  let result: { res: Response; body: PublishResult } | null = null;
  try {
    result = await postPublish(server);
  } catch {
    /* network error — maybe the network blocks large POSTs and a tunnel is configured */
  }
  if (!result && config.tunnel) {
    console.error("publy: server unreachable, bringing up the SSH tunnel…");
    if (await ensureTunnel(config)) {
      const tunnelServer = config.tunnel.server ?? `http://127.0.0.1:${config.tunnel.local_port}`;
      result = await postPublish(tunnelServer);
    }
  }
  if (!result) {
    console.error(`publy: cannot reach server ${server}（若在限制大流量的公司网络内，先 publy tunnel）`);
    process.exit(5);
  }
  const { res, body } = result;
  if (!res.ok) {
    console.error(`publy: publish failed (${res.status}) ${body.code ?? ""}: ${body.message ?? "unknown error"}`);
    process.exit(5);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, account: accountName, type, title, mediaId: body.mediaId, deduped: body.deduped ?? false, scheduled: Boolean(body.jobId), jobId: body.jobId, runAt: body.runAt }));
  } else if (body.jobId) {
    console.log(`已创建定时任务 ${body.jobId}，将在 ${body.runAt} 自动发布到 ${accountName}（publy jobs 查看状态）`);
  } else {
    const deduped = body.deduped ? "（幂等命中，未重复发布）" : "";
    console.log(`已发布到 ${accountName} 草稿箱，Media ID: ${body.mediaId}${deduped}`);
  }
}

// ---------------------------------------------------------------------------

export function createProgram(): Command {
  const program = new Command();
  program.name("publy").description("Publish Markdown to WeChat Official Accounts").version(pkg.version);

  const common = (cmd: Command) =>
    cmd
      .option("-t, --theme <id>", "theme id")
      .option("--custom-theme <path>", "path to a custom theme CSS file (overrides --theme)")
      .option("--highlight <id>", "code highlight theme", "github")
      .option("--media-dir <dir>", "asset dir for Obsidian-style references (repeatable)", (v: string, prev: string[]) => [...prev, v], [] as string[])
      .option("--footer <text>", "footer text appended after the body")
      .option("--no-footnote", "disable link-to-footnote conversion");

  const renderCmd = program.command("render").description("Render markdown to inline-styled WeChat HTML").argument("<file>").option("-o, --out <path>", "write html to file instead of stdout");
  common(renderCmd);
  renderCmd.action(async (file: string, opts) => cmdRender(file, opts));

  const previewCmd = program.command("preview").description("Render and open a local preview in the browser").argument("<file>");
  common(previewCmd);
  previewCmd.action(async (file: string, opts) => cmdPreview(file, opts));

  const cardCmd = program
    .command("card")
    .description("Render xiaolvshu card deck (3:4 PNGs) from a sectioned markdown file")
    .argument("<file>")
    .option("-o, --out <dir>", "output directory (default: <file dir>/cards)")
    .option("--preview", "open a contact-sheet preview in the browser")
    .option("--no-lint", "skip lint enforcement (warnings only)")
    .option("--font-file <path>", "override font (repeatable: regular, bold)", (v: string, prev: string[]) => [...prev, v], [] as string[])
    .option("--json", "machine-readable output");
  common(cardCmd);
  cardCmd.action(async (file: string, opts) => cmdCard(file, opts));

  const publishCmd = program
    .command("publish")
    .description("Render and publish via a Publy server")
    .argument("<file>")
    .option("--account <name>", "target account (defaults to config)")
    .option("--title <title>", "override article title")
    .option("--cover <path>", "override cover image path")
    .option("--author <name>", "override author byline")
    .option("--at <datetime>", "schedule the publish (ISO or \"2026-10-01 09:00\")")
    .option("--server <url>", "publy server base url")
    .option("--api-key <key>", "server api key")
    .option("--json", "machine-readable output");
  common(publishCmd);
  publishCmd.action(async (file: string, opts) => cmdPublish(file, opts));

  program
    .command("tunnel")
    .description("bring up the configured SSH tunnel (config.tunnel) and verify it")
    .action(async () => {
      const config = loadConfig();
      if (!config.tunnel) {
        console.error('publy: no tunnel configured. Add to ~/.publy/config.json:\n  "tunnel": { "ssh_target": "user@host", "local_port": 18081, "remote_port": 8081 }');
        process.exit(1);
      }
      const ok = await ensureTunnel(config);
      const { local_port, remote_port, ssh_target } = config.tunnel;
      console.log(ok
        ? `tunnel up: localhost:${local_port} → ${ssh_target}:${remote_port}`
        : `tunnel FAILED: could not reach ${ssh_target} or bind localhost:${local_port}`);
      process.exit(ok ? 0 : 5);
    });

  const jobsCmd = program.command("jobs").description("manage scheduled publishes");
  jobsCmd.command("list").description("list scheduled jobs").action(async () => {
    const config = loadConfig();
    const res = await fetch(new URL("/v1/jobs", config.server!).toString(), { headers: { "x-api-key": config.api_key! } });
    const body = (await res.json()) as { jobs?: JobInfo[] } & { code?: string; message?: string };
    if (!res.ok) {
      console.error(`publy: ${body.code ?? res.status}: ${body.message ?? ""}`);
      process.exit(5);
    }
    for (const j of body.jobs ?? []) {
      console.log(`${j.id.slice(0, 8)}  ${j.status.padEnd(8)} ${j.runAt}  ${j.title}${j.error ? ` — ${j.error}` : ""}`);
    }
    if (!body.jobs?.length) console.log("(no jobs)");
  });
  jobsCmd
    .command("cancel")
    .argument("<id>")
    .description("cancel a pending job")
    .action(async (id: string) => {
      const config = loadConfig();
      const res = await fetch(new URL(`/v1/jobs/${encodeURIComponent(id)}`, config.server!).toString(), {
        method: "DELETE",
        headers: { "x-api-key": config.api_key! },
      });
      const body = (await res.json()) as { ok?: boolean } & { code?: string; message?: string };
      console.log(res.ok && body.ok ? "cancelled" : `failed: ${body.code ?? res.status} ${body.message ?? ""}`);
      process.exit(res.ok && body.ok ? 0 : 5);
    });

  program
    .command("history")
    .description("show recent publish history from the server audit log")
    .option("-n, --limit <count>", "number of entries", "20")
    .action(async (opts) => {
      const config = loadConfig();
      const res = await fetch(new URL(`/v1/history?limit=${encodeURIComponent(opts.limit)}`, config.server!).toString(), { headers: { "x-api-key": config.api_key! } });
      const body = (await res.json()) as { history?: { ts: string; event: string; account?: string; title?: string; mediaId?: string; error?: string }[] } & { code?: string };
      if (!res.ok) {
        console.error(`publy: ${body.code ?? res.status}`);
        process.exit(5);
      }
      for (const h of body.history ?? []) {
        console.log(`${h.ts}  ${h.event.padEnd(9)} ${(h.account ?? "").padEnd(16)} ${h.title ?? h.error ?? ""} ${h.mediaId ?? ""}`);
      }
    });

  const configCmd = program.command("config").description("Manage ~/.publy/config.json");
  configCmd
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .description("set server / api_key / default_account")
    .action(async (key: string, value: string) => cmdConfigSet(key, value));

  const accountCmd = program.command("account").description("Manage accounts");
  accountCmd
    .command("add")
    .argument("<name>")
    .option("--app-id <id>")
    .option("--author <name>")
    .option("--theme <id>")
    .description("add or update an account")
    .action(async (name: string, opts) => cmdAccountAdd(name, opts));
  accountCmd.command("list").description("list accounts").action(async () => {
    const config = loadConfig();
    for (const a of config.accounts ?? []) {
      console.log(`${a.name === config.default_account ? "*" : " "} ${a.name}  ${a.app_id ?? ""}  theme=${a.theme ?? "-"}`);
    }
  });

  const themeCmd = program.command("theme").description("Manage themes");
  themeCmd.command("ls").description("list built-in themes and registry entries").action(async () => {    const { BUILTIN_THEMES, BUILTIN_CARD_THEMES } = await import("@publy/core");
    console.log("Article themes (built-in):", BUILTIN_THEMES.join(", "));
    console.log("Card themes (built-in):", Object.keys(BUILTIN_CARD_THEMES).join(", "));
    try {
      const res = await fetch("https://raw.githubusercontent.com/turinglambdaai/publy-themes/main/index.json");
      if (res.ok) {
        const registry = (await res.json()) as { themes: { id: string; kind: string; source: string }[] };
        const external = registry.themes.filter((t) => t.source !== "builtin");
        if (external.length) console.log("Registry:", external.map((t) => `${t.id} (${t.kind})`).join(", "));
        else console.log("Registry: no external themes yet");
      }
    } catch {
      /* offline: built-ins only */
    }
  });

  themeCmd
    .command("preview")
    .argument("<name>")
    .description("render the theme sample locally and open it in the browser")
    .action(async (name: string) => cmdThemePreview(name));

  return program;
}

import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createProgram().parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
