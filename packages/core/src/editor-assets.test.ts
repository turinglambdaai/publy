// Cross-editor fixture tests: no editor executable or proprietary API required.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { resolveEditorAsset } from "./editor-assets.js";
import { renderMarkdown } from "./render.js";

function fixture(run: (root: string) => void) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "publy-file-editor-"));
  try { run(root); } finally { fs.rmSync(root, { recursive: true, force: true }); }
}
function put(root: string, name: string): string {
  const file = path.join(root, name);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, "synthetic-image");
  return file;
}

test("standard Markdown nested image directories remain distinct, even for same basenames", () => {
  fixture((root) => {
    const first = put(root, "assets/a/logo.png");
    const second = put(root, "assets/b/logo.png");
    const result = renderMarkdown("![a](assets/a/logo.png)\n\n![b](assets/b/logo.png)", { baseDir: root });
    assert.deepEqual(result.warnings, []);
    assert.deepEqual(result.attachments.map((a) => a.path), [first, second]);
    assert.deepEqual(result.attachments.map((a) => a.name), ["logo.png", "logo-2.png"]);
    assert.match(result.html, /attachment:\/\/logo-2\.png/);
  });
});

test("missing named folder never silently resolves another same-name image", () => {
  fixture((root) => {
    put(root, "elsewhere/logo.png");
    const result = renderMarkdown("![logo](assets/missing/logo.png)", { baseDir: root });
    assert.equal(result.attachments.length, 0);
    assert.ok(result.warnings.some((w) => w.includes("assets/missing/logo.png")));
  });
});

test("Typora typora-root-url resolves rooted image references and covers", () => {
  fixture((root) => {
    const actual = put(root, "website/blog/images/card.png");
    const localRoot = path.join(root, "website").replaceAll("\\", "/");
    const raw = [
      "---",
      "title: Typora fixture",
      `typora-root-url: "${localRoot}"`,
      "cover: /blog/images/card.png",
      "---",
      "",
      "![card](/blog/images/card.png)",
    ].join("\n");
    const result = renderMarkdown(raw, { baseDir: root });
    assert.deepEqual(result.warnings, []);
    assert.equal(result.cover, actual);
    assert.deepEqual(result.attachments.map((a) => a.path), [actual]);
  });
});

test("relative cover resolves from note directory and leaves source unchanged", () => {
  fixture((root) => {
    const sourceDir = path.join(root, "notes");
    fs.mkdirSync(sourceDir);
    const cover = put(root, "images/cover.png");
    const raw = "---\ncover: ../images/cover.png\n---\n\n# This is a note";
    const result = renderMarkdown(raw, { baseDir: sourceDir });
    assert.equal(result.cover, cover);
    assert.ok(!result.warnings.some((w) => w.includes("Cover not found")));
    assert.equal(raw.includes("../images/cover.png"), true);
  });
});

test("source-relative local assets beat configured same-name media directories", () => {
  fixture((root) => {
    const sourceDir = path.join(root, "project");
    const fallback = path.join(root, "fallback");
    const expected = put(root, "project/picture.png");
    put(root, "fallback/picture.png");
    assert.equal(resolveEditorAsset("picture.png", { baseDir: sourceDir, mediaDirs: [fallback] }), expected);
  });
});

test("non-local URLs cannot be resolved as local attachment paths", () => {
  fixture((root) => {
    for (const url of ["https://example.test/image.png", "data:image/png;base64,aGVsbG8=", "attachment://image.png"]) {
      assert.equal(resolveEditorAsset(url, { baseDir: root }), null);
    }
  });
});
