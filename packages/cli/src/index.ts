#!/usr/bin/env node
// publy CLI — the agent-era client for the Publy publishing pipeline.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { exec } from "node:child_process";
import { Command } from "commander";
import type { Attachment, PublishRequest, PublishResponse } from "@publy/shared";
import { parseSource, publishType, renderCards, renderMarkdown } from "@publy/core";

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

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function textToHtml(text: string): string {
  return text
    .split(/\n{2,}/)
    .filter((p) => p.trim())
    .map((p) => `<p>${escapeHtml(p.trim()).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

// ---------------------------------------------------------------------------

async function cmdRender(file: string, opts: Record<string, any>): Promise<void> {
  const raw = fs.readFileSync(file, "utf-8");
  const result = renderMarkdown(raw, {
    theme: opts.theme,
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
  return { html: textToHtml(captionText), images, coverName: images[0]?.name };
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
      html = textToHtml(cardResult.caption);
      coverName = images[0]?.name;
    } else {
      const rendered = renderMarkdown(raw, {
        theme: opts.theme,
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

  const payload: PublishRequest = {
    account: accountName,
    type,
    title,
    html,
    images,
    cover: coverName,
    author: opts.author ?? parsed.meta.author ?? account?.author,
    digest: parsed.meta.digest,
    needOpenComment: true,
    idempotencyKey,
  };

  const res = await fetch(new URL("/v1/publish", server).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as Partial<PublishResponse> & { code?: string; message?: string; deduped?: boolean };
  if (!res.ok) {
    console.error(`publy: publish failed (${res.status}) ${body.code ?? ""}: ${body.message ?? "unknown error"}`);
    process.exit(5);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, account: accountName, type, title, mediaId: body.mediaId, deduped: body.deduped ?? false }));
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
    .option("--server <url>", "publy server base url")
    .option("--api-key <key>", "server api key")
    .option("--json", "machine-readable output");
  common(publishCmd);
  publishCmd.action(async (file: string, opts) => cmdPublish(file, opts));

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
  themeCmd.command("ls").description("list built-in themes and registry entries").action(async () => {
    const { BUILTIN_THEMES, BUILTIN_CARD_THEMES } = await import("@publy/core");
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

  return program;
}

import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  createProgram().parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
