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
  fs.writeFileSync(path.join(project, "assets", "photo.jpg"), "synthetic");
  const goodPath = path.join(project, "article.md");
  const goodSource = "---\ntitle: User Article\n---\n\n# Hello\n\n![photo](assets/photo.jpg)";
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
  assert.ok(previewHtml.includes("data:image/jpeg;base64,"), "local image must be embedded");
  assert.ok(!previewHtml.includes("attachment://photo.jpg"), "local attachment reference must be replaced");
  assert.equal(fs.readFileSync(goodPath, "utf8"), goodSource, "preview must not alter source");

  const missingPath = path.join(project, "broken.md");
  fs.writeFileSync(missingPath, "# Broken\n\n![photo](missing/other.jpg)");
  const missing = run(missingPath);
  assert.equal(missing.code, 4);
  assert.equal(missing.report.ok, false);
  assert.ok(missing.report.problems.some((p) => p.includes("missing/other.jpg")));

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
