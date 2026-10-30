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

// --- math (TeX) -------------------------------------------------------------

const MATH_SAMPLE = `---
title: 公式测试
---

行内质能方程 $E=mc^2$ 出现在句中。

$$
\\int_0^1 x^2 \\, dx = \\frac{1}{3}
$$
`;

test("renderMarkdown rasterizes inline and block TeX into attachments", () => {
  const result = renderMarkdown(MATH_SAMPLE, { theme: "claude" });
  const mathRefs = result.attachments.filter((a) => a.name.startsWith("formula-"));
  assert.equal(mathRefs.length, 2, `expected 2 formula attachments, got ${mathRefs.length}`);
  assert.ok(result.html.includes("attachment://formula-"), "attachment ref missing in html");
  for (const a of mathRefs) {
    const png = fs.readFileSync(a.path);
    assert.ok(png.length > 500, "formula png suspiciously small");
    // png magic
    assert.deepEqual([...png.slice(0, 4)], [0x89, 0x50, 0x4e, 0x47], "not a PNG");
    assert.equal(a.contentType, "image/png");
  }
  assert.ok(!result.html.includes("data-tex"), "placeholder attrs leaked into output");
  // inline formula rides the text line, block formula is centered
  assert.ok(result.html.includes("display: inline-block"), "inline formula must stay inline");
  assert.match(result.html, /vertical-align:\s*-?\d+(\.\d+)?px/);
  assert.match(result.html, /display:\s*block;\s*margin:\s*12px auto;\s*width:\s*\d+(\.\d+)?px/);
});

test("renderMarkdown dedupes repeated formulas into one attachment", () => {
  const md = "同式两次 $E=mc^2$ 与 $E=mc^2$。";
  const result = renderMarkdown(`---\ntitle: t\n---\n\n${md}`, { theme: "claude" });
  const mathRefs = result.attachments.filter((a) => a.name.startsWith("formula-"));
  assert.equal(mathRefs.length, 1, "same TeX should hash to one attachment");
  const refs = result.html.match(/attachment:\/\/formula-[0-9a-f]+\.png/g) ?? [];
  assert.equal(refs.length, 2, "both occurrences should reference it");
});

test("renderMarkdown falls back to raw TeX when the formula is invalid", () => {
  const md = "坏公式 $\\frac{$ 测试";
  const result = renderMarkdown(`---\ntitle: t\n---\n\n${md}`, { theme: "claude" });
  assert.ok(result.warnings.some((w) => w.startsWith("Math not rendered")), "warning missing");
  assert.ok(result.html.includes("<code"), "raw TeX fallback missing");
});

// Security regression: untrusted note HTML must not become active clipboard,
// browser-preview or WeChat-draft markup. Theme CSS is applied separately.
test("renderMarkdown removes active raw HTML and unsafe URL attributes", () => {
  const source = [
    "<script>alert('evil-marker')</script>",
    '<iframe src="https://example.test/frame"></iframe>',
    '<img src="javascript:alert(1)" onerror="evil-marker()">',
    '<a href="javascript:alert(1)" onclick="evil-marker()">unsafe anchor</a>',
    '<span style="background-image:url(https://example.test/track)">visible span</span>',
    '<img src="data:image/svg+xml;base64,PHN2Zz4=" alt="blocked svg">',
    '<p><strong>allowed bold</strong> content</p>',
    '[Safe link](https://example.test/safe)',
  ].join("\\n\\n");
  const result = renderMarkdown(source, { theme: "claude", footnote: false });
  assert.doesNotMatch(result.html, /<script|<iframe|<svg|evil-marker|onclick|onerror|javascript:|data:image\\/svg\\+xml|background-image:\\s*url/i);
  assert.match(result.html, /allowed bold/);
  assert.match(result.html, /visible span/);
  assert.match(result.html, /https:\\/\\/example\\.test\\/safe/);
});
