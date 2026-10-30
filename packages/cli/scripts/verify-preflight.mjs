// Synthetic end-to-end CLI smoke: the user need not install Typora/Obsidian,
// configure a server, or grant access to their notes to run preflight.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";

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

  // Agent contract discovery is offline and truthful: don't claim JSON
  // support for operations that still only offer human-oriented output.
  const cli = (...args) => spawnSync(process.execPath, [entrypoint, ...args],
    { encoding: "utf8", timeout: 40000, env: { ...process.env,
      PUBLY_CONFIG: path.join(dir, "no-such-config.json") } });
  const capabilities = cli("capabilities", "--json");
  assert.equal(capabilities.status, 0, capabilities.stderr);
  const contract = JSON.parse(capabilities.stdout);
  assert.equal(contract.schemaVersion, 1);
  assert.equal(contract.destination, "wechat-official-account-drafts");
  assert.equal(contract.noPublicSend, true);
  assert.deepEqual(contract.firstClassEditors, ["Typora", "Obsidian"]);
  assert.ok(contract.commands.some((c) => c.name === "preview" && c.json === true && c.network === false));
  assert.ok(contract.commands.some((c) => c.name === "jobs list" && c.json === true));
  assert.ok(contract.commands.some((c) => c.name === "publish" && c.effect === "create-wechat-draft"));

  const agentPreview = cli("preview", goodPath, "--json");
  assert.equal(agentPreview.status, 0, agentPreview.stderr);
  const previewReport = JSON.parse(agentPreview.stdout);
  assert.equal(previewReport.schemaVersion, 1);
  assert.equal(previewReport.kind, "local-preview");
  assert.equal(previewReport.ok, true);
  assert.equal(previewReport.type, "article");
  assert.equal(previewReport.networkUsed, false);
  assert.equal(previewReport.submitted, false);
  assert.ok(fs.existsSync(previewReport.output));
  assert.ok(previewReport.output.endsWith(".html"));
  assert.equal(fs.readFileSync(goodPath, "utf8"), goodSource);
  fs.rmSync(path.dirname(previewReport.output), { recursive: true, force: true });

  const badPreview = cli("preview", path.join(project, "absent.md"), "--json");
  assert.equal(badPreview.status, 2, badPreview.stderr);
  const badReport = JSON.parse(badPreview.stdout);
  assert.equal(badReport.ok, false);
  assert.equal(badReport.code, "INPUT_INVALID");
  assert.equal(badReport.submitted, false);

  // An Agent needs account aliases to choose a destination, never the
  // WeChat App ID or the caller's long-lived API key.
  const aliasesConfig = path.join(dir, "agent-aliases.json");
  const secretKey = "test-secret-must-not-enter-machine-output";
  const appId = "wx-internal-app-id";
  fs.writeFileSync(aliasesConfig, JSON.stringify({
    server: "https://invalid.local", api_key: secretKey,
    default_account: "Work",
    accounts: [{ name: "Work", app_id: appId, theme: "claude" }],
  }));
  const aliases = spawnSync(process.execPath,
    [entrypoint, "account", "list", "--json"],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: aliasesConfig } });
  assert.equal(aliases.status, 0, aliases.stderr);
  const aliasData = JSON.parse(aliases.stdout);
  assert.equal(aliasData.kind, "accounts");
  assert.equal(aliasData.defaultAccount, "Work");
  assert.deepEqual(aliasData.accounts, [{ name: "Work", theme: "claude" }]);
  assert.ok(!aliases.stdout.includes(secretKey));
  assert.ok(!aliases.stdout.includes(appId));

  const missingPublishServer = cli("publish", goodPath, "--json");
  assert.equal(missingPublishServer.status, 5, missingPublishServer.stderr);
  const missingServerReport = JSON.parse(missingPublishServer.stdout);
  assert.equal(missingServerReport.ok, false);
  assert.equal(missingServerReport.status, "not_submitted");
  assert.equal(missingServerReport.code, "SERVER_NOT_CONFIGURED");
  assert.equal(missingServerReport.submitted, false);

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


  // Typora can persist Chinese names with legacy %u escapes and local image
  // roots. No Typora plugin/process or vault copying is needed.
  const typoraRoot = path.join(project, "Typora project");
  const typoraMedia = path.join(typoraRoot, "blog", "assets");
  fs.mkdirSync(typoraMedia, { recursive: true });
  const typoraPhoto = path.join(typoraMedia, "封面 图片.png");
  fs.writeFileSync(typoraPhoto, tinyPng);
  const typoraFile = path.join(project, "这是 Typora 原稿.md");
  const typoraSource = [
    "---",
    "title: 这是 Typora 的原稿",
    "typora-root-url: " + JSON.stringify(typoraRoot.split(path.sep).join("/")),
    "typora-copy-images-to: assets/pasted",
    "cover: /blog/assets/%u5C01%u9762%20%u56FE%u7247.png",
    "---",
    "",
    "![正文图](/blog/assets/%u5C01%u9762%20%u56FE%u7247.png)",
  ].join("\n");
  fs.writeFileSync(typoraFile, typoraSource);
  const typoraCheck = run(typoraFile);
  assert.equal(typoraCheck.code, 0);
  assert.equal(typoraCheck.report.ok, true);
  assert.equal(typoraCheck.report.attachmentCount, 1);
  assert.equal(typoraCheck.report.title, "这是 Typora 的原稿");
  const typoraPreviewPath = path.join(dir, "Typora 预览.html");
  const typoraPreview = spawnSync(process.execPath,
    [entrypoint, "preview", typoraFile, "--no-open", "--out", typoraPreviewPath],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: path.join(dir, "no-such-config.json") } });
  assert.equal(typoraPreview.status, 0, typoraPreview.stderr);
  assert.ok(fs.readFileSync(typoraPreviewPath, "utf8").includes("data:image/png;base64,"));
  assert.equal(fs.readFileSync(typoraFile, "utf8"), typoraSource, "Typora source must remain exactly unchanged");

  // Typora can also save absolute file:/// image links, including Chinese
  // paths. They must resolve to the exact same local bytes, without exporting
  // a clickable file:// link into the WeChat HTML.
  const fileUriArticle = path.join(project, "Typora file URI.md");
  const localFileUrl = pathToFileURL(typoraPhoto).href;
  const fileUriRaw = "---\ncover: " + JSON.stringify(localFileUrl) +
    "\n---\n\n![absolute](" + localFileUrl + ")";
  fs.writeFileSync(fileUriArticle, fileUriRaw);
  const fileUriCheck = run(fileUriArticle);
  assert.equal(fileUriCheck.code, 0);
  assert.equal(fileUriCheck.report.attachmentCount, 1);
  const fileUriOut = path.join(dir, "file-uri-review.html");
  const fileUriPreview = spawnSync(process.execPath,
    [entrypoint, "preview", fileUriArticle, "--no-open", "--out", fileUriOut],
    { encoding: "utf8", timeout: 25000 });
  assert.equal(fileUriPreview.status, 0, fileUriPreview.stderr);
  const fileUriHtml = fs.readFileSync(fileUriOut, "utf8");
  assert.ok(fileUriHtml.includes("data:image/png;base64,"));
  assert.ok(!fileUriHtml.includes("file:///"));
  assert.equal(fs.readFileSync(fileUriArticle, "utf8"), fileUriRaw);

  // Customer-specified output must never clobber existing HTML or the .md.
  const overwriteRefused = spawnSync(process.execPath,
    [entrypoint, "preview", typoraFile, "--no-open", "--out", typoraPreviewPath],
    { encoding: "utf8", timeout: 25000 });
  assert.equal(overwriteRefused.status, 2, overwriteRefused.stderr);
  assert.match(overwriteRefused.stderr, /already exists/);
  const overwriteAllowed = spawnSync(process.execPath,
    [entrypoint, "preview", typoraFile, "--no-open", "--force", "--out", typoraPreviewPath],
    { encoding: "utf8", timeout: 25000 });
  assert.equal(overwriteAllowed.status, 0, overwriteAllowed.stderr);
  const sourceAsOutput = spawnSync(process.execPath,
    [entrypoint, "preview", typoraFile, "--no-open", "--out", typoraFile, "--force"],
    { encoding: "utf8", timeout: 25000 });
  assert.equal(sourceAsOutput.status, 2);
  assert.equal(fs.readFileSync(typoraFile, "utf8"), typoraSource);
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(typoraPreviewPath).mode & 0o077, 0, "local image preview is private");
  }

  // The raw HTML export path must uphold the same "never alter the
  // original Typora file" guarantee as the HTML preview.
  const renderOut = path.join(dir, "rendered.html");
  const renderWith = (...args) => spawnSync(process.execPath,
    [entrypoint, "render", typoraFile, "--out", ...args],
    { encoding: "utf8", timeout: 25000 });
  const firstRender = renderWith(renderOut);
  assert.equal(firstRender.status, 0, firstRender.stderr);
  assert.ok(fs.readFileSync(renderOut, "utf8").includes("attachment://"));
  assert.equal(renderWith(renderOut).status, 2, "existing exported HTML needs explicit confirmation");
  assert.equal(renderWith(renderOut, "--force").status, 0);
  assert.equal(renderWith(typoraFile, "--force").status, 2, "raw rendering cannot overwrite .md");
  assert.equal(fs.readFileSync(typoraFile, "utf8"), typoraSource);

  // Default previews are generated into isolated random temp folders, not a
  // guessable shared timestamp path. --no-open is safe for automated review.
  const ephemeral = spawnSync(process.execPath, [entrypoint, "preview", typoraFile, "--no-open"],
    { encoding: "utf8", timeout: 25000 });
  assert.equal(ephemeral.status, 0, ephemeral.stderr);
  const previewLine = ephemeral.stderr.split("\n").find((line) => line.startsWith("preview → "));
  assert.ok(previewLine, "preview path should be reported");
  const tempPreview = previewLine.slice("preview → ".length).trim();
  assert.ok(fs.existsSync(tempPreview));
  assert.ok(path.basename(tempPreview) === "index.html");
  assert.ok(path.basename(path.dirname(tempPreview)).startsWith("publy-preview-"));
  if (process.platform !== "win32") {
    assert.equal(fs.statSync(tempPreview).mode & 0o077, 0);
    assert.equal(fs.statSync(path.dirname(tempPreview)).mode & 0o077, 0);
  }
  fs.rmSync(path.dirname(tempPreview), { recursive: true, force: true });

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
  const noCoverReview = cli("preview", noCoverArticle, "--json");
  assert.equal(noCoverReview.status, 4, noCoverReview.stderr);
  const noCoverJson = JSON.parse(noCoverReview.stdout);
  assert.equal(noCoverJson.ok, false);
  assert.equal(noCoverJson.submitted, false);
  assert.ok(noCoverJson.problems.some((p) => p.startsWith("Missing cover:")));
  fs.rmSync(path.dirname(noCoverJson.output), { recursive: true, force: true });

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

  const blockedJson = spawnSync(process.execPath,
    [entrypoint, "publish", missingPath, "--json", "--account", "fixture"],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: fakeConfig } });
  assert.equal(blockedJson.status, 4, blockedJson.stderr);
  const mediaFailure = JSON.parse(blockedJson.stdout);
  assert.equal(mediaFailure.kind, "publish-result");
  assert.equal(mediaFailure.status, "not_submitted");
  assert.equal(mediaFailure.code, "MEDIA_NOT_READY");
  assert.equal(mediaFailure.submitted, false);
  assert.ok(mediaFailure.problems.some((p) => p.includes("missing/other.jpg")));

  const unknownJson = spawnSync(process.execPath,
    [entrypoint, "publish", goodPath, "--json", "--account", "fixture"],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: fakeConfig } });
  assert.equal(unknownJson.status, 5, unknownJson.stderr);
  const uncertain = JSON.parse(unknownJson.stdout);
  assert.equal(uncertain.kind, "publish-result");
  assert.equal(uncertain.status, "unknown");
  assert.equal(uncertain.submitted, null);
  assert.match(uncertain.requestId, /^[a-f0-9]{32}$/);
  assert.ok(!uncertain.problems?.length);
  
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
  assert.equal(cards.report.attachmentCount, 3, "preflight must verify real PNG cards");
  assert.equal(cards.report.ok, true);

  // The image-post preview must show the same rasterized PNG cards as
  // publish, never ordinary Markdown/HTML pretending to be card output.
  const cardAgentOut = path.join(dir, "agent-cards.html");
  const cardAgentPreview = cli("preview", cardsPath, "--json", "--out", cardAgentOut);
  assert.equal(cardAgentPreview.status, 0, cardAgentPreview.stderr);
  const cardAgent = JSON.parse(cardAgentPreview.stdout);
  assert.equal(cardAgent.kind, "local-preview");
  assert.equal(cardAgent.type, "image_post");
  assert.equal(cardAgent.mode, "cards");
  assert.equal(cardAgent.submitted, false);
  assert.ok(fs.readFileSync(cardAgent.output, "utf8").includes("data:image/png;base64,"));

  const cardsOut = path.join(dir, "card-review.html");
  const cardPreview = spawnSync(process.execPath,
    [entrypoint, "preview", cardsPath, "--no-open", "--out", cardsOut],
    { encoding: "utf8", timeout: 40000,
      env: { ...process.env, PUBLY_CONFIG: path.join(dir, "no-such-config.json") } });
  assert.equal(cardPreview.status, 0, cardPreview.stderr);
  const cardsHtml = fs.readFileSync(cardsOut, "utf8");
  assert.match(cardsHtml, /WeChat image post card preview/);
  assert.equal((cardsHtml.match(/data:image\/png;base64,/g) ?? []).length, 3);
  assert.ok(cardsHtml.includes("synthetic test"), "preview must show image-post caption");
  assert.ok(cardsHtml.includes("Preview only, not submitted"));
  assert.ok(cardsHtml.includes("Content-Security-Policy"));
  assert.equal(fs.readFileSync(cardsPath, "utf8").includes("## cover"), true);

  const invalidCards = path.join(project, "invalid-cards.md");
  fs.writeFileSync(invalidCards,
    "---\nmode: cards\ncaption: invalid deck\n---\n\n## cover\nFirst only\n\n## ending\nSecond");
  const invalidCheck = run(invalidCards);
  assert.equal(invalidCheck.code, 4, "invalid card deck must fail preflight");
  assert.equal(invalidCheck.report.ok, false);
  assert.ok(invalidCheck.report.problems.some((problem) => problem.includes("3")));
  const invalidOut = path.join(dir, "invalid-card-preview.html");
  const invalidPreview = spawnSync(process.execPath,
    [entrypoint, "preview", invalidCards, "--no-open", "--out", invalidOut],
    { encoding: "utf8", timeout: 40000 });
  assert.equal(invalidPreview.status, 0, invalidPreview.stderr);
  const invalidHtml = fs.readFileSync(invalidOut, "utf8");
  assert.match(invalidHtml, /Missing draft media/);
  assert.match(invalidHtml, /图片数量须为 3/);

  // Do not leak private YAML values or parser internals into an agent JSON
  // preflight response; malformed sources are safely recoverable errors.
  const secret = "synthetic-secret-marker-do-not-print";
  const corrupt = path.join(project, "malformed.md");
  fs.writeFileSync(corrupt, "---\nprivate_key: " + secret + "\nunsupported: [broken\n---\n# hi");
  const corruptPublish = spawnSync(process.execPath,
    [entrypoint, "publish", corrupt, "--json", "--account", "fixture"],
    { encoding: "utf8", timeout: 25000, env: { ...process.env, PUBLY_CONFIG: fakeConfig } });
  assert.equal(corruptPublish.status, 3, corruptPublish.stderr);
  const corruptResult = JSON.parse(corruptPublish.stdout);
  assert.equal(corruptResult.code, "RENDER_FAILED");
  assert.equal(corruptResult.submitted, false);
  assert.ok(!corruptPublish.stderr.includes(secret), "private frontmatter should not leak to stderr");
  assert.ok(!corruptPublish.stdout.includes(secret), "private frontmatter should not leak to JSON");
  const invalidPreview = cli("preview", corrupt, "--json");
  assert.equal(invalidPreview.status, 3);
  const invalidPreviewJson = JSON.parse(invalidPreview.stdout);
  assert.equal(invalidPreviewJson.code, "RENDER_FAILED");
  assert.equal(invalidPreviewJson.submitted, false);
  assert.ok(!invalidPreview.stdout.includes(secret));
  assert.ok(!invalidPreview.stderr.includes(secret));

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
