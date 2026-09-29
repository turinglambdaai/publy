// Markdown → inline-styled HTML for the WeChat editor.

import fs from "node:fs";
import path from "node:path";
import MarkdownIt from "markdown-it";
import hljs from "highlight.js";
import * as cheerio from "cheerio";
import juice from "juice";
import { ATTACHMENT_SCHEME } from "@publy/shared";
import { parseSource, publishType, type SourceMeta } from "./frontmatter.js";
import { preprocessObsidian, resolveAsset } from "./obsidian.js";
import { loadTheme, loadHighlightCss } from "./theme.js";
import { svgToPng } from "./svg.js";

export interface RenderOptions {
  theme?: string;
  highlight?: string;
  /** dirs searched for Obsidian-style asset references */
  mediaDirs?: string[];
  /** dir of the source file; assets resolve relative to it first */
  baseDir?: string;
  /** convert links to end-of-article footnotes (default true) */
  footnote?: boolean;
  /** text appended after the body, separated by a rule */
  footer?: string;
}

export interface Attachment {
  name: string;
  path: string;
  contentType: string;
}

export interface RenderResult {
  html: string;
  title: string;
  meta: SourceMeta;
  type: "article" | "image_post";
  /** resolved cover path (from frontmatter), if any */
  cover?: string;
  attachments: Attachment[];
  warnings: string[];
}

const CONTENT_TYPES: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
};

function highlight(code: string, lang: string): string {
  const language = lang && hljs.getLanguage(lang) ? lang : "plaintext";
  try {
    return hljs.highlight(code, { language }).value;
  } catch {
    return MarkdownIt().utils.escapeHtml(code);
  }
}

class AttachmentCollector {
  attachments: Attachment[] = [];
  private used = new Set<string>();

  add(filePath: string): string {
    let base = path.basename(filePath);
    const ext = path.extname(base).toLowerCase();
    let name = base;
    let n = 2;
    while (this.used.has(name)) {
      name = `${path.basename(base, ext)}-${n}${ext}`;
      n++;
    }
    this.used.add(name);
    this.attachments.push({
      name,
      path: filePath,
      contentType: CONTENT_TYPES[ext] ?? "image/jpeg",
    });
    return name;
  }
}

export function renderMarkdown(raw: string, opts: RenderOptions = {}): RenderResult {
  const warnings: string[] = [];
  const { meta, body } = parseSource(raw);
  const baseDir = opts.baseDir ?? process.cwd();
  const mediaDirs = [...(opts.mediaDirs ?? []), baseDir];
  const themeId = opts.theme ?? meta.theme ?? "claude";

  // 1. Obsidian syntax → standard markdown
  const pre = preprocessObsidian(body, mediaDirs);
  if (pre.missing.length > 0) {
    warnings.push(`Assets not found: ${pre.missing.join(", ")}`);
  }

  // 2. markdown → html fragment
  const md = new MarkdownIt({ html: true, breaks: false, highlight });
  const bodyHtml = md.render(pre.body);
  const theme = loadTheme(themeId);
  const hljsCss = loadHighlightCss(opts.highlight ?? "github");

  // 3. DOM post-processing
  const $ = cheerio.load(bodyHtml, null, false);
  const collector = new AttachmentCollector();

  // 3a. links → footnotes (WeChat strips plain <a> for most accounts)
  const footnoteEnabled = opts.footnote !== false;
  const notes: { n: number; label: string; href: string }[] = [];
  if (footnoteEnabled) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") ?? "";
      if (!/^https?:\/\//.test(href)) return;
      const label = $(el).text().trim();
      if (!label) return;
      const n = notes.push({ n: notes.length + 1, label, href }) ;
      $(el).replaceWith(`${escapeText(label)}<sup>[${n}]</sup>`);
    });
  }

  // 3b. images: svg → png, local files → attachment refs
  $("img").each((_, el) => {
    const src = $(el).attr("src");
    if (!src || src.startsWith("http") || src.startsWith("data:")) return;
    let filePath = decodeURIComponent(src);
    if (!path.isAbsolute(filePath)) {
      const resolved = resolveAsset(path.basename(filePath), mediaDirs);
      if (!resolved) {
        warnings.push(`Image not found: ${src}`);
        return;
      }
      filePath = resolved;
    }
    if (!fs.existsSync(filePath)) {
      warnings.push(`Image not found: ${filePath}`);
      return;
    }
    if (filePath.toLowerCase().endsWith(".svg")) {
      try {
        filePath = svgToPng(filePath);
      } catch (e) {
        warnings.push(`SVG conversion failed for ${filePath}: ${(e as Error).message}`);
        return;
      }
    }
    const name = collector.add(filePath);
    $(el).attr("src", `${ATTACHMENT_SCHEME}${name}`);
  });

  // 3c. footnote section
  if (footnoteEnabled && notes.length > 0) {
    const items = notes
      .map((note) => `<p><sup>[${note.n}]</sup> ${escapeText(note.label)}：${note.href}</p>`)
      .join("");
    $.root().append(`<div class="publy-footnotes"><p><strong>引用链接</strong></p>${items}</div>`);
  }
  if (opts.footer) {
    $.root().append(`<hr/><p>${opts.footer}</p>`);
  }

  const inner = $.html();

  // 4. assemble + inline styles
  const styled = `<div id="publy">${inner}</div>`;
  const full = `<html><head><style>${theme.css}\n${hljsCss}</style></head><body>${styled}</body></html>`;
  const inlined = juice(full, { removeStyleTags: true });
  const $out = cheerio.load(inlined);
  // outerHTML keeps the wrapper's inline styles (background, font-size) — the
  // WeChat editor pastes this div as-is.
  const html = $out.html("#publy") ?? "";

  // 5. cover resolution (frontmatter only; CLI/plugin may override)
  let cover: string | undefined;
  if (meta.cover) {
    if (path.isAbsolute(meta.cover) && fs.existsSync(meta.cover)) {
      cover = meta.cover;
    } else {
      const name = path.basename(meta.cover);
      cover = resolveAsset(name, mediaDirs) ?? undefined;
      if (!cover) warnings.push(`Cover not found: ${meta.cover}`);
    }
  }

  return {
    html,
    title: meta.title ?? "",
    meta,
    type: publishType(meta),
    cover,
    attachments: collector.attachments,
    warnings,
  };
}

function escapeText(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
