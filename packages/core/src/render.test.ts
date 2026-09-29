// Tests: markdown rendering pipeline and cover cropping.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderMarkdown, captionToHtml, stripMarkdown } from "./render.js";
import { cropCoverTo235 as crop } from "./crop.js";

const SAMPLE = `---
title: 渲染测试
---

# 标题

正文 **加粗** 与 \`code\`。

[链接文字](https://example.com/a)
`;

test("renderMarkdown inlines styles and converts links to footnotes", () => {
  const result = renderMarkdown(SAMPLE, { theme: "claude" });
  assert.equal(result.title, "渲染测试");
  assert.ok(result.html.includes('id="publy"'));
  assert.ok(!result.html.includes("var(--"), "unresolved css var");
  assert.match(result.html, /加粗/);
  assert.ok(result.html.includes("publy-footnotes"), "footnote section missing");
  assert.ok(result.html.includes("[1]"), "footnote marker missing");
});

test("renderMarkdown --no-footnote keeps anchors", () => {
  const result = renderMarkdown(SAMPLE, { theme: "claude", footnote: false });
  assert.ok(!result.html.includes("publy-footnotes"));
  assert.ok(result.html.includes("<a"));
});

test("custom theme css wins over theme id", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-test-"));
  const cssFile = path.join(dir, "mine.css");
  fs.writeFileSync(cssFile, ":root {\n  --accent: #112233;\n}\n#publy { color: var(--accent); }");
  const result = renderMarkdown(SAMPLE, { customThemePath: cssFile });
  assert.ok(result.html.includes("#112233"));
});

test("captionToHtml renders inline markdown with line breaks", () => {
  const html = captionToHtml("第一行 **粗体**\n第二行");
  assert.match(html, /<p>第一行 <strong>粗体<\/strong><br>\n第二行<\/p>/);
});

test("stripMarkdown removes syntax", () => {
  const s = stripMarkdown("# 标题\n\n**粗** 和 `code` 还有 [链](https://x.y)");
  assert.equal(s, "标题 粗 和 code 还有 链");
});

test("cropCoverTo235 returns a 1175x500 PNG", () => {
  // 1x1 red PNG
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  const out = crop(png, "image/png");
  assert.deepEqual([...out.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  assert.equal(out.readUInt32BE(16), 1175);
  assert.equal(out.readUInt32BE(20), 500);
});
