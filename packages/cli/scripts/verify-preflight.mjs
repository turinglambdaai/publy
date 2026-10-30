// Synthetic end-to-end CLI smoke: the user need not install Typora/Obsidian,
// configure a server, or grant access to their notes to run preflight.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const entrypoint = path.resolve(here, "..", "dist", "index.js");
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-check-smoke-"));
const run = (file) => {
  const result = spawnSync(process.execPath, [entrypoint, "check", file, "--json"], {
    encoding: "utf8",
    env: { ...process.env, PUBLY_CONFIG: path.join(dir, "no-such-config.json") },
    timeout: 25000,
  });
  if (result.error) throw result.error;
  let report;
  try { report = JSON.parse(result.stdout.trim()); }
  catch { throw new Error("Invalid JSON preflight output: " + result.stdout + " / " + result.stderr); }
  assert.equal(report.kind, "local-preflight");
  assert.equal(report.networkUsed, false);
  assert.equal(report.submitted, false);
  return { code: result.status, report };
};

try {
  const project = path.join(dir, "project");
  fs.mkdirSync(path.join(project, "assets"), { recursive: true });
  // Use real PNG bytes: a placeholder string would falsely prove that the
  // browser can display a broken image. This is the same 1×1 fixture used by
  // the core renderer's cover-crop tests.
  const tinyPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    "base64",
  );
  fs.writeFileSync(path.join(project, "assets", "photo.png"), tinyPng);
  const goodPath = path.join(project, "article.md");
  const goodSource = "---\ntitle: User Article\n---\n\n# Hello\n\n![photo](assets/photo.png)";
  fs.writeFileSync(goodPath, goodSource);
  const good = run(goodPath);
  assert.equal(good.code, 0);
  assert.equal(good.report.ok, true);
  assert.equal(good.report.attachmentCount, 1);
  assert.equal(good.report.title, "User Article");
  assert.equal(fs.readFileSync(goodPath, "utf8"), goodSource, "preflight must not change source");

  // CLI browser preview must resolve local images without any remote server,
  // leaving both the source and the original asset file untouched.
  const previewPath = path.join(dir, "offline-preview.html");
  const preview = spawnSync(process.execPath,
    [entrypoint, "preview", goodPath, "--no-open", "--out", previewPath],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: path.join(dir, "no-such-config.json") } });
  assert.equal(preview.status, 0, preview.stderr);
  const previewHtml = fs.readFileSync(previewPath, "utf8");
  const embeddedPrefix = "data:image/png;base64,";
  assert.ok(previewHtml.includes(embeddedPrefix), "local image must be embedded");
  assert.ok(!previewHtml.includes("attachment://photo.png"), "local attachment reference must be replaced");
  assert.ok(previewHtml.includes("Content-Security-Policy"), "preview must enforce a no-network CSP");
  assert.ok(previewHtml.includes("default-src 'none'"), "preview must deny unlisted resource loads");
  assert.ok(previewHtml.includes("img-src data:"), "embedded local images must remain visible");
  assert.ok(previewHtml.includes("connect-src 'none'"), "preview must not connect to a server");
  const encoded = previewHtml.slice(previewHtml.indexOf(embeddedPrefix) + embeddedPrefix.length).split('"')[0];
  const embeddedBytes = Buffer.from(encoded, "base64");
  assert.deepEqual(embeddedBytes, tinyPng, "preview must embed the exact PNG bytes without mutation");
  assert.equal(fs.readFileSync(goodPath, "utf8"), goodSource, "preview must not alter source");

  const missingPath = path.join(project, "broken.md");
  fs.writeFileSync(missingPath, "# Broken\n\n![photo](missing/other.jpg)");
  const missing = run(missingPath);
  assert.equal(missing.code, 4);
  assert.equal(missing.report.ok, false);
  assert.ok(missing.report.problems.some((p) => p.includes("missing/other.jpg")));

  // A user must never receive a WeChat draft with silently dropped media.
  // A deliberately unreachable local endpoint makes any accidental submit
  // fail differently, without calling an external service in this smoke.
  const fakeConfig = path.join(dir, "fake-publish-config.json");
  fs.writeFileSync(fakeConfig, JSON.stringify({
    server: "http://127.0.0.1:9", api_key: "fixture-key",
    default_account: "fixture", accounts: [{ name: "fixture" }],
  }));
  const publishWith = (source) => spawnSync(process.execPath,
    [entrypoint, "publish", source, "--account", "fixture"],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: fakeConfig } });
  const blocked = publishWith(missingPath);
  assert.equal(blocked.status, 4, blocked.stderr);
  assert.match(blocked.stderr, /draft NOT sent/);
  assert.match(blocked.stderr, /Image not found:/);
  assert.doesNotMatch(blocked.stderr, /outcome UNKNOWN|publish failed \(/);
  const badCover = path.join(project, "missing-cover.md");
  fs.writeFileSync(badCover, "---\ncover: assets/absent.png\n---\n\n# Missing cover\n\n![valid](assets/photo.png)");
  const blockedCover = publishWith(badCover);
  assert.equal(blockedCover.status, 4, blockedCover.stderr);
  assert.match(blockedCover.stderr, /Cover not found/);

  const noCoverArticle = path.join(project, "no-cover.md");
  fs.writeFileSync(noCoverArticle, "# Text only\n\nNo image and no cover");
  const blockedNoCover = publishWith(noCoverArticle);
  assert.equal(blockedNoCover.status, 4, blockedNoCover.stderr);
  assert.match(blockedNoCover.stderr, /Missing cover:/);

  const emptyImagePost = path.join(project, "empty-image-post.md");
  fs.writeFileSync(emptyImagePost, "---\ntype: image\n---\n\nJust some words");
  const blockedImagePost = publishWith(emptyImagePost);
  assert.equal(blockedImagePost.status, 4, blockedImagePost.stderr);
  assert.match(blockedImagePost.stderr, /No local images found/);

  // Local previews may contain unresolved media while the author fixes the
  // note. They must call that out in the rendered page, not only on stderr.
  const brokenPreviewPath = path.join(dir, "broken-preview.html");
  const brokenPreview = spawnSync(process.execPath,
    [entrypoint, "preview", missingPath, "--no-open", "--out", brokenPreviewPath],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: fakeConfig } });
  assert.equal(brokenPreview.status, 0, brokenPreview.stderr);
  const brokenHtml = fs.readFileSync(brokenPreviewPath, "utf8");
  assert.match(brokenHtml, /Missing draft media/);
  assert.ok(brokenHtml.includes("missing/other.jpg"), "preview should list the missing image path");
  assert.match(brokenHtml, /Preview only, not submitted/);

  // The local cover is valid, but external body images still must NOT
  // silently enter an incomplete WeChat draft. Query tokens are private.
  const remoteOnly = path.join(project, "external-body-image.md");
  const privateToken = "synthetic-secret-in-url";
  fs.writeFileSync(remoteOnly,
    "---\ncover: assets/photo.png\n---\n\n![External](https://example.test/photo.png?token=" + privateToken + ")");
  const remoteResult = run(remoteOnly);
  assert.equal(remoteResult.code, 4);
  assert.ok(remoteResult.report.problems.some((w) => w.includes("Remote image not uploaded")));
  assert.ok(!JSON.stringify(remoteResult.report).includes(privateToken));
  const blockedRemote = publishWith(remoteOnly);
  assert.equal(blockedRemote.status, 4, blockedRemote.stderr);
  assert.match(blockedRemote.stderr, /Remote image not uploaded/);
  assert.ok(!blockedRemote.stderr.includes(privateToken), "credential URL must not appear in diagnostics");

  const cardsPath = path.join(project, "cards.md");
  fs.writeFileSync(cardsPath,
    "---\nmode: cards\ncaption: synthetic test\n---\n\n## cover\nTitle\n\n## point\nDetail\n\n## ending\nThanks");
  const cards = run(cardsPath);
  assert.equal(cards.code, 0);
  assert.equal(cards.report.type, "image_post");
  assert.equal(cards.report.cardCount, 3);

  // Do not leak private YAML values or parser internals into an agent JSON
  // preflight response; malformed sources are safely recoverable errors.
  const secret = "synthetic-secret-marker-do-not-print";
  const corrupt = path.join(project, "malformed.md");
  fs.writeFileSync(corrupt, "---\nprivate_key: " + secret + "\nunsupported: [broken\n---\n# hi");
  const malformed = run(corrupt);
  assert.equal(malformed.code, 3);
  assert.equal(malformed.report.ok, false);
  assert.ok(malformed.report.problems.some((p) => p.includes("Cannot inspect")));
  assert.ok(!JSON.stringify(malformed.report).includes(secret));

  const wrong = path.join(project, "not-markdown.txt");
  fs.writeFileSync(wrong, "plain text");
  assert.equal(run(wrong).code, 2);
  assert.equal(run(path.join(project, "absent.md")).code, 2);
  console.log("PASS — editor-neutral local preflight, JSON, assets, cards, non-mutating source and error exits");
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
