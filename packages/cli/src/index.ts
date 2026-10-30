#!/usr/bin/env node
// publy CLI — the agent-era client for the Publy publishing pipeline.

import crypto from "node:crypto";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Command } from "commander";
import type { Attachment, JobInfo, PublishRequest, PublishResponse } from "@publy/shared";
import { blockingMediaWarning, captionToHtml, lintCards, parseCardSource, parseSource, publishType, renderCards, renderMarkdown, stripMarkdown } from "@publy/core";

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
  // A user-controlled file path must never be interpolated into shell code.
  // The program+argv invocation works with spaces, Unicode and characters
  // such as &, quotes or apostrophes in Typora filenames.
  const command = process.platform === "win32"
    ? "rundll32.exe"
    : process.platform === "darwin" ? "open" : "xdg-open";
  const args = process.platform === "win32"
    ? ["url.dll,FileProtocolHandler", file]
    : [file];
  const child = spawn(command, args, { detached: true, stdio: "ignore", shell: false });
  child.on("error", () => console.error("publy: cannot open browser automatically; open the preview file manually."));
  child.unref();
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

/** Offline safety-first preflight for any file-based Markdown editor.
 * The source document remains where it is. This function makes no server
 * calls, and does not publish or alter the source file.
 */
async function cmdCheck(file: string, opts: Record<string, any>): Promise<void> {
  const source = path.resolve(file);
  const problems: string[] = [];
  const warnings: string[] = [];
  let title = path.basename(source, path.extname(source));
  let type: "article" | "image_post" = "article";
  let attachments = 0;
  let cardCount: number | undefined;
  let inputError = false;
  let renderError = false;

  let readableFile = false;
  try { readableFile = fs.statSync(source).isFile(); } catch { /* no file or inaccessible */ }
  if (!readableFile) {
    problems.push("File not found: choose an existing .md file in your editor.");
    inputError = true;
  } else if (!/\.(?:md|markdown)$/i.test(source)) {
    problems.push("Unsupported file: select a Markdown (.md or .markdown) document.");
    inputError = true;
  } else {
    try {
      const raw = fs.readFileSync(source, "utf8");
      const parsed = parseSource(raw);
      type = publishType(parsed.meta);
      title = parsed.meta.title?.trim() || title;
      if (type === "image_post" && parsed.meta.mode?.toLowerCase() === "cards") {
        const cards = parseCardSource(raw);
        const lint = lintCards(cards.sections, cards.caption);
        cardCount = cards.sections.length;
        problems.push(...lint.problems);
      } else {
        // Local rendering shares the same asset resolution as real publish.
        // Check does not require login, an API key or a running server.
        let mediaDirs: string[] = [];
        try { mediaDirs = resolveMediaDirs(opts.mediaDir ?? [], loadConfig()); }
        catch { warnings.push("Local config could not be read; checking source-relative images only."); }
        const rendered = renderMarkdown(raw, {
          baseDir: path.dirname(source),
          mediaDirs,
          theme: opts.theme,
          customThemePath: opts.customTheme,
          highlight: opts.highlight,
          footnote: opts.footnote !== false,
          footer: opts.footer,
        });
        attachments = rendered.attachments.length;
        warnings.push(...rendered.warnings);
        for (const warning of rendered.warnings) {
          if (blockingMediaWarning(warning)) {
            problems.push(warning);
          }
        }
        if (type === "article" && !rendered.cover && attachments === 0) {
          problems.push("Missing cover: add a local image or a cover: path before submitting a draft.");
        }
        if (type === "image_post" && attachments === 0) {
          problems.push("No local images found for the image post.");
        }
      }
    } catch {
      // Avoid echoing the raw YAML/parser exception: it can include snippets
      // of a private note or an embedded credential.
      renderError = true;
      problems.push("Cannot inspect this document. Check its Markdown frontmatter and rendering options.");
    }
  }

  const ok = problems.length === 0;
  const report = {
    ok, kind: "local-preflight", source, title, type,
    attachmentCount: attachments, ...(cardCount === undefined ? {} : { cardCount }),
    problems, warnings, networkUsed: false, submitted: false,
  };
  if (opts.json) {
    console.log(JSON.stringify(report));
  } else {
    console.log((ok ? "✓ Ready for manual review" : "✗ Fix before submitting") + ": " + title);
    console.log("Source: " + source);
    console.log("Content: " + type + (cardCount === undefined ? ` | local attachments: ${attachments}` : ` | cards: ${cardCount}`));
    for (const problem of problems) console.error("fix: " + problem);
    for (const warning of warnings.filter((w) => !problems.includes(w))) console.error("warn: " + warning);
    console.log("Local check only — no draft has been submitted.");
  }
  if (!ok) process.exitCode = inputError ? 2 : renderError ? 3 : 4;
}

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

/** Embed private/local images inside the temporary preview, never sending
 * bytes to a remote image host or leaving attachment:// references broken.
 * The actual publish HTML continues to use the server attachment protocol.
 */
function inlineLocalPreviewImages(html: string, attachments: readonly { name: string; path: string; contentType: string }[]): string {
  let output = html;
  for (const media of attachments) {
    const ref = `attachment://${media.name}`;
    if (!output.includes(ref)) continue;
    const encoded = fs.readFileSync(media.path).toString("base64");
    output = output.split(ref).join(`data:${media.contentType};base64,${encoded}`);
  }
  return output;
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
  const sourcePath = path.resolve(file);
  if (opts.out && !/\.html?$/i.test(String(opts.out))) {
    console.error("publy: preview output must be an .html file; the Markdown source is never overwritten.");
    process.exitCode = 2;
    return;
  }
  const out = opts.out
    ? path.resolve(opts.out)
    : path.join(fs.mkdtempSync(path.join(os.tmpdir(), "publy-preview-")), "index.html");
  if (fs.existsSync(out)) {
    if (fs.realpathSync(out) === fs.realpathSync(sourcePath)) {
      console.error("publy: preview output resolves to the original document; source must stay unchanged.");
      process.exitCode = 2;
      return;
    }
    if (!opts.force) {
      console.error("publy: preview file already exists; choose a different --out path or pass --force to replace an existing HTML preview.");
      process.exitCode = 2;
      return;
    }
  }
  const preview = inlineLocalPreviewImages(result.html, result.attachments);
  const warnings = result.warnings.filter(blockingMediaWarning);
  // The preview is intentionally allowed to show incomplete sources: that is
  // how a writer fixes a note. But missing media must be VISIBLE in the page,
  // not only hidden in terminal stderr while a seemingly finished article
  // appears underneath.
  const warningPanel = warnings.length
    ? `<section role="alert" style="border:2px solid #b42318;background:#fff4f2;color:#7a271a;padding:14px 18px;border-radius:10px;margin:12px 0"><strong>草稿素材未就绪 / Missing draft media</strong><p style="margin:8px 0">下列问题必须在投递公众号草稿前修复：</p><ul>${warnings.map((w) => `<li>${escapeHtml(w)}</li>`).join("")}</ul></section>`
    : "";
  const localHeader = `<header style="padding:12px 16px;background:#e7f1ff;border-radius:9px;color:#123962;margin-bottom:12px;font:14px system-ui,sans-serif" role="status"><strong>Publy · 本地预览</strong> — 此内容尚未投递到公众号草稿箱 / Preview only, not submitted</header>`;
  fs.writeFileSync(
    out,
    `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; script-src 'none'; object-src 'none'; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(result.title || "preview")}</title></head><body style="margin:0;background:#ddd;display:flex;justify-content:center"><main style="max-width:578px;width:100%;padding:14px 8px;box-sizing:border-box">${localHeader}${warningPanel}${preview}</main></body></html>`,
    { flag: opts.force ? "w" : "wx", mode: 0o600 },
  );
  // Existing HTML files may have previously had permissive access rights.
  // Keep the copied local note and image bytes private on Unix.
  if (process.platform !== "win32") fs.chmodSync(out, 0o600);
  console.error(`preview → ${out}`);
  if (opts.open !== false) openInBrowser(out);
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
  const allowed = ["server", "api_key", "default_account", "media_dirs"];
  if (!allowed.includes(key)) {
    console.error(`publy: unknown config key "${key}" (allowed: ${allowed.join(", ")})`);
    process.exit(1);
  }
  // media_dirs is a string[] — accept comma-separated dirs; everything else is a plain string
  (config as Record<string, unknown>)[key] = key === "media_dirs"
    ? value.split(",").map((s) => s.trim()).filter(Boolean)
    : value;
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
  // surfaced on stderr and echoed in --json so agents don't miss silent
  // failures like "attachment missing from media_dirs, image dropped"
  const warnings: string[] = [];
  const emitWarnings = (ws: readonly string[]) => {
    for (const w of ws) {
      console.error(`warn: ${w}`);
      warnings.push(w);
    }
  };

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
      emitWarnings(rendered.warnings);
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
    emitWarnings(rendered.warnings);
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

  // Failed image references must stop before any HTTP POST. An explicit
  // --cover wins over stale source frontmatter, so suppress that one warning
  // only after the override file has been validated in the article branch.
  const blockers = warnings.filter((warning) =>
    blockingMediaWarning(warning) &&
    !(type === "article" && opts.cover && warning.startsWith("Cover not found:")),
  );
  // The official WeChat draft requires a usable cover for articles and at
  // least one image for text-mode image posts. The regular preflight already
  // reports these, so publish must enforce the same invariant.
  if (type === "article" && !coverName && images.length === 0) {
    blockers.push("Missing cover: provide --cover, cover: frontmatter or a local body image.");
  }
  if (type === "image_post" && images.length === 0) {
    blockers.push("No local images found for image-post draft.");
  }
  if (blockers.length) {
    console.error("publy: draft NOT sent; fix the missing or unrenderable media first:");
    for (const warning of blockers) console.error("fix: " + warning);
    console.error("Run `publy check <file>` to inspect local problems, then preview before retrying.");
    process.exitCode = 4;
    return;
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
  let netErr: unknown = null;
  try {
    result = await postPublish(server);
  } catch (err) {
    netErr = err;
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
    // network-level failure: the server may or may not have delivered the
    // draft — outcome unknown, never treated as permission to re-send (#7).
    // Surface the underlying cause and the request identity so an agent can
    // reconcile with `publy publish-result <key>` instead of re-publishing.
    const cause = (netErr as Error | null)?.cause as { code?: string; message?: string } | undefined;
    const detail = cause?.code ?? cause?.message ?? (netErr as Error | null)?.message ?? "";
    console.error(`publy: cannot reach server ${server}${detail ? ` (${detail})` : ""}`);
    console.error(`publy: check --server / config server, or run \`publy tunnel\` when a tunnel is configured (e.g. TLS failures on the public domain)`);
    console.error(`publy: outcome UNKNOWN — the draft may already exist. Query before retrying: publy publish-result ${idempotencyKey}`);
    process.exit(5);
  }
  const { res, body } = result;
  if (!res.ok) {
    console.error(`publy: publish failed (${res.status}) ${body.code ?? ""}: ${body.message ?? "unknown error"}`);
    process.exit(5);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, account: accountName, type, title, mediaId: body.mediaId, deduped: body.deduped ?? false, scheduled: Boolean(body.jobId), jobId: body.jobId, runAt: body.runAt, requestId: body.requestId ?? idempotencyKey, warnings }));
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

  const checkCmd = program.command("check")
    .description("Check a Markdown document and local media before publishing (offline; no server required)")
    .argument("<file>")
    .option("--json", "machine-readable preflight result");
  common(checkCmd);
  checkCmd.action(async (file: string, opts) => cmdCheck(file, opts));

  const renderCmd = program.command("render").description("Render markdown to inline-styled WeChat HTML").argument("<file>").option("-o, --out <path>", "write html to file instead of stdout");
  common(renderCmd);
  renderCmd.action(async (file: string, opts) => cmdRender(file, opts));

  const previewCmd = program.command("preview").description("Render a self-contained local preview with images")
    .argument("<file>")
    .option("-o, --out <path>", "write the local preview to a chosen HTML file")
    .option("--no-open", "do not open a browser after writing the preview")
    .option("--force", "explicitly replace an existing .html preview output");
  common(previewCmd);
  previewCmd.action(async (file: string, opts) => cmdPreview(file, opts));

  const cardCmd = program
    .command("card")
    .description("Render image-post card deck (3:4 PNGs) from a sectioned markdown file")
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

  // reconcile a lost publish by its idempotency key (#7): answers whether the
  // draft landed without ever re-sending the publish itself
  program
    .command("publish-result")
    .description("query whether a publish with the given idempotency key landed (timeout recovery)")
    .argument("<key>")
    .option("--server <url>", "publy server base url")
    .option("--api-key <key>", "server api key")
    .option("--json", "machine-readable output")
    .action(async (key: string, opts: Record<string, any>) => {
      const config = loadConfig();
      const server = opts.server ?? config.server;
      const apiKey = opts.apiKey ?? config.api_key;
      if (!server || !apiKey) {
        console.error("publy: server/api_key not configured.");
        process.exit(5);
      }
      const res = await fetch(new URL(`/v1/publish-result/${encodeURIComponent(key)}`, server).toString(), {
        headers: { "x-api-key": apiKey },
      });
      const body = (await res.json()) as { status?: string; mediaId?: string; account?: string; title?: string } & { code?: string; message?: string };
      if (!res.ok) {
        console.error(`publy: ${body.code ?? res.status}: ${body.message ?? ""}`);
        process.exit(5);
      }
      if (opts.json) {
        console.log(JSON.stringify(body));
      } else if (body.status === "confirmed") {
        console.log(`已确认：《${body.title ?? "?"}》在 ${body.account ?? "?"} 草稿箱，Media ID: ${body.mediaId}`);
      } else {
        console.log("结果未知：服务端没有这次请求的记录（超出幂等窗口或未送达）。可用原幂等键重试，或到公众号草稿箱确认。");
        process.exit(4);
      }
    });

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
  // interrupted jobs never auto-rerun after a crash (#8); the owner retries
  // explicitly — the original idempotency key rides along, so a lost run that
  // actually delivered reconciles instead of duplicating
  jobsCmd
    .command("retry")
    .argument("<id>")
    .description("re-admit an interrupted/failed job (idempotency-checked)")
    .action(async (id: string) => {
      const config = loadConfig();
      const res = await fetch(new URL(`/v1/jobs/${encodeURIComponent(id)}/retry`, config.server!).toString(), {
        method: "POST",
        headers: { "x-api-key": config.api_key! },
      });
      const body = (await res.json()) as { ok?: boolean; job?: JobInfo } & { code?: string; message?: string };
      if (res.ok && body.ok) {
        console.log(`job ${body.job?.id.slice(0, 8)} re-admitted (${body.job?.status})`);
      } else {
        console.error(`failed: ${body.code ?? res.status} ${body.message ?? ""}`);
        process.exit(5);
      }
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

  program
    .command("quota")
    .description("show your plan and this month's usage")
    .action(async () => {
      const config = loadConfig();
      const res = await fetch(new URL("/v1/quota", config.server!).toString(), { headers: { "x-api-key": config.api_key! } });
      const body = (await res.json()) as { admin?: boolean; plan?: string; used?: number; limit?: number; expiresAt?: number; unlimited?: boolean } & { code?: string };
      if (!res.ok) {
        console.error(`publy: ${body.code ?? res.status}`);
        process.exit(5);
      }
      if (body.unlimited) {
        console.log("admin key：无配额限制");
      } else {
        const expiry = body.expiresAt ? `，Pro 到期 ${new Date(body.expiresAt).toLocaleDateString()}` : "";
        console.log(`套餐 ${body.plan}：本月已用 ${body.used} / ${body.limit}${expiry}`);
        console.log(`购买/升级：${new URL("/", config.server!).toString()}`);
      }
    });

  const configCmd = program.command("config").description("Manage ~/.publy/config.json");
  configCmd
    .command("set")
    .argument("<key>")
    .argument("<value>")
    .description("set server / api_key / default_account / media_dirs (comma-separated)")
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

// resolve argv[1] through symlinks before comparing: npm -g installs the bin
// as a symlink while import.meta.url is the real path — without realpath they
// never match and the CLI silently exits with no output
const invokedAs = process.argv[1]
  ? pathToFileURL(fs.realpathSync(path.resolve(process.argv[1]))).href
  : "";
if (import.meta.url === invokedAs) {
  createProgram().parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
