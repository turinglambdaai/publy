// Generate theme preview images for the theme-store gallery.
//
// Article themes: render the sample via `publy render`, wrap it in a window
// chrome (traffic lights + title), measure the exact content height with a
// headless dump-dom pass, screenshot at that height (no background band),
// then composite rounded corners via resvg.
// Card themes: render the sample deck via `publy card`; the cover card is the
// preview (already clean 3:4 output).
//
// Usage: node scripts/generate-theme-previews.mjs <outDir>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Resvg } from "@resvg/resvg-js";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "publy-theme-previews"));
fs.mkdirSync(outDir, { recursive: true });

const CONTENT_WIDTH = 760;
const HEADER_HEIGHT = 44;
/** Fixed viewport height: a deliberate product-shot crop, not a full-page dump.
 *  Tune once against docs/samples/article-sample.md; the clip edge is intentional. */
const WINDOW_HEIGHT = 1150;

function findEdge() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Edge not found for headless screenshots");
}

function run(cmd, args) {
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"] });
}

/** Run Edge; --dump-dom writes to stdout, so capture it into outFile ourselves. */
function edgeWait(args, outFile, timeoutMs = 20000, { captureStdout = false } = {}) {
  fs.rmSync(outFile, { force: true });
  if (captureStdout) {
    const stdout = execFileSync(findEdge(), args, { stdio: ["ignore", "pipe", "pipe"] });
    fs.writeFileSync(outFile, stdout);
    return;
  }
  run(findEdge(), args);
  const deadline = Date.now() + timeoutMs;
  while (!fs.existsSync(outFile)) {
    if (Date.now() > deadline) throw new Error(`Edge did not produce ${outFile}`);
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }
}

const articleSample = path.join(repoRoot, "docs", "samples", "article-sample.md");
const cardSample = path.join(repoRoot, "docs", "samples", "card-sample.md");

// --- article themes ---------------------------------------------------------

function windowChrome(theme, contentHtml) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { width: ${CONTENT_WIDTH}px; background: #ffffff; }
    .titlebar {
      height: ${HEADER_HEIGHT}px; background: #1f1f1f;
      display: flex; align-items: center; padding: 0 14px; gap: 8px;
    }
    .dot { width: 12px; height: 12px; border-radius: 6px; }
    .title { margin-left: 10px; color: #9a9a9a; font: 13px -apple-system, "Segoe UI", sans-serif; }
    .content > div { min-height: 10px; }
  </style></head><body>
    <div class="titlebar">
      <span class="dot" style="background:#ff5f57"></span><span class="dot" style="background:#febc2e"></span><span class="dot" style="background:#28c840"></span>
      <span class="title">Publy · ${theme} theme</span>
    </div>
    <div class="content" style="height: ${WINDOW_HEIGHT - HEADER_HEIGHT}px; overflow: hidden;">${contentHtml}</div>
  </body></html>`;
}

function roundCorners(pngPath, width, height, radius = 14) {
  const b64 = fs.readFileSync(pngPath).toString("base64");
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
    <defs><clipPath id="r"><rect width="${width}" height="${height}" rx="${radius}"/></clipPath></defs>
    <g clip-path="url(#r)">
      <image href="data:image/png;base64,${b64}" width="${width}" height="${height}"/>
      <rect width="${width}" height="${height}" rx="${radius}" fill="none" stroke="#3a3a3a" stroke-width="1"/>
    </g>
  </svg>`;
  const out = new Resvg(svg, { fitTo: { mode: "width", value: width } });
  fs.writeFileSync(pngPath, out.render().asPng());
}

for (const theme of ["claude", "medium"]) {
  // 1. render article HTML
  const htmlFile = path.join(outDir, `${theme}.html`);
  run("node", [cli, "render", articleSample, "--theme", theme, "-o", htmlFile]);

  // 2. wrap in window chrome with a fixed-height viewport
  const wrapped = path.join(outDir, `${theme}-shot.html`);
  fs.writeFileSync(wrapped, windowChrome(theme, fs.readFileSync(htmlFile, "utf-8")));
  const wrappedUrl = `file:///${wrapped.split(path.sep).join("/")}`;

  // 3. screenshot the window
  const rawPng = path.join(outDir, `${theme}.png`);
  edgeWait([
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    `--window-size=${CONTENT_WIDTH},${WINDOW_HEIGHT}`,
    `--screenshot=${rawPng}`,
    wrappedUrl,
  ], rawPng);

  // 4. rounded corners
  roundCorners(rawPng, CONTENT_WIDTH, WINDOW_HEIGHT);
  const size = fs.statSync(rawPng).size;
  console.log(`${theme}.png  ${CONTENT_WIDTH}x${WINDOW_HEIGHT}  ${(size / 1024).toFixed(0)} KB`);
}

// --- card themes ------------------------------------------------------------

for (const theme of ["naive", "claude"]) {
  const cardDir = path.join(outDir, `cards-${theme}`);
  fs.rmSync(cardDir, { recursive: true, force: true });
  run("node", [cli, "card", cardSample, "--theme", theme, "--out", cardDir]);
  const cover = fs.readdirSync(cardDir).find((f) => f.startsWith("card-01"));
  fs.copyFileSync(path.join(cardDir, cover), path.join(outDir, `card-${theme}.png`));
  console.log(`card-${theme}.png  copied from ${cover}`);
}

console.log("done →", outDir);
