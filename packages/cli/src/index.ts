#!/usr/bin/env node
// publy CLI — the agent-era client for the Publy publishing pipeline.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Command } from "commander";
import type { Attachment, PublishRequest, PublishResponse } from "@publy/shared";
import { renderMarkdown } from "@publy/core";

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

function resolveMediaDirs(explicit: string[], config: CliConfig): string[] {
  return [...explicit, ...(config.media_dirs ?? [])];
}

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

async function cmdPublish(file: string, opts: Record<string, any>): Promise<void> {
  const config = loadConfig();
  const server = opts.server ?? config.server;
  const apiKey = opts.apiKey ?? config.api_key;
  if (!server || !apiKey) {
    console.error('publy: server/api_key not configured. Run `publy config` or pass --server/--api-key.');
    process.exit(5);
  }

  const raw = fs.readFileSync(file, "utf-8");
  const baseDir = path.dirname(path.resolve(file));
  const rendered = renderMarkdown(raw, {
    theme: opts.theme,
    highlight: opts.highlight,
    mediaDirs: resolveMediaDirs(opts.mediaDir ?? [], config),
    baseDir,
    footnote: opts.footnote !== false,
    footer: opts.footer,
  });
  for (const w of rendered.warnings) console.error(`warn: ${w}`);

  const accountName = opts.account ?? config.default_account ?? config.accounts?.[0]?.name;
  if (!accountName) {
    console.error("publy: no account specified (--account or default_account in config)");
    process.exit(1);
  }
  const account = config.accounts?.find((a) => a.name === accountName);
  const title = opts.title || rendered.title || path.basename(file, path.extname(file));

  // attachments: rendered body images, plus an explicit cover
  const attachments: Attachment[] = rendered.attachments.map((a) => ({
    name: a.name,
    data: fs.readFileSync(a.path).toString("base64"),
    contentType: a.contentType,
  }));
  let coverName: string | undefined;
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

  const payload: PublishRequest = {
    account: accountName,
    type: rendered.type,
    title,
    html: rendered.html,
    images: attachments,
    cover: coverName,
    author: opts.author ?? rendered.meta.author ?? account?.author,
    digest: rendered.meta.digest,
    needOpenComment: true,
  };

  const res = await fetch(new URL("/v1/publish", server).toString(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": apiKey },
    body: JSON.stringify(payload),
  });
  const body = (await res.json()) as Partial<PublishResponse> & { code?: string; message?: string };
  if (!res.ok) {
    console.error(`publy: publish failed (${res.status}) ${body.code ?? ""}: ${body.message ?? "unknown error"}`);
    process.exit(5);
  }

  if (opts.json) {
    console.log(JSON.stringify({ ok: true, account: accountName, title, mediaId: body.mediaId }));
  } else {
    console.log(`已发布到 ${accountName} 草稿箱，Media ID: ${body.mediaId}`);
  }
}

export function createProgram(): Command {
  const program = new Command();
  program.name("publy").description("Publish Markdown to WeChat Official Accounts").version(pkg.version);

  const common = (cmd: Command) =>
    cmd
      .option("-f, --file <path>", "markdown file")
      .option("-t, --theme <id>", "article theme", "claude")
      .option("--highlight <id>", "code highlight theme", "github")
      .option("--media-dir <dir>", "asset dir for Obsidian-style references (repeatable)", (v: string, prev: string[]) => [...prev, v], [] as string[])
      .option("--footer <text>", "footer text appended after the body")
      .option("--no-footnote", "disable link-to-footnote conversion");

  program
    .command("render")
    .description("Render markdown to inline-styled WeChat HTML")
    .argument("<file>")
    .option("-o, --out <path>", "write html to file instead of stdout")
    .action(async (file: string, opts) => cmdRender(file, opts));

  common(program.commands.find((c) => c.name() === "render")!);

  program
    .command("publish")
    .description("Render and publish via a Publy server")
    .argument("<file>")
    .option("--account <name>", "target account (defaults to config)")
    .option("--title <title>", "override article title")
    .option("--cover <path>", "override cover image path")
    .option("--author <name>", "override author byline")
    .option("--server <url>", "publy server base url")
    .option("--api-key <key>", "server api key")
    .option("--json", "machine-readable output")
    .action(async (file: string, opts) => cmdPublish(file, opts));

  common(program.commands.find((c) => c.name() === "publish")!);

  return program;
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  createProgram().parseAsync(process.argv).catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
