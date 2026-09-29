// Generate theme preview images for the theme-store gallery.
// Article themes: render sample -> HTML -> Edge headless screenshot.
// Card themes: render sample -> card PNGs (used directly).
// Usage: node scripts/generate-theme-previews.mjs <outDir>

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(here, "..");
const cli = path.join(repoRoot, "packages", "cli", "dist", "index.js");
const outDir = path.resolve(process.argv[2] ?? path.join(os.tmpdir(), "publy-theme-previews"));
fs.mkdirSync(outDir, { recursive: true });

function run(cmd, args, opts = {}) {
  execFileSync(cmd, args, { stdio: ["ignore", "pipe", "pipe"], ...opts });
}

function findEdge() {
  const candidates = [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  throw new Error("Edge not found for headless screenshots");
}

const articleSample = path.join(repoRoot, "docs", "samples", "article-sample.md");
const cardSample = path.join(repoRoot, "docs", "samples", "card-sample.md");

// --- article themes ---
const wrap = (body) =>
  `<!DOCTYPE html><html><head><meta charset="utf-8"><style>body{margin:0;background:#8a8a8a;display:flex;justify-content:center}#wrap{max-width:760px;width:100%}</style></head><body><div id="wrap">${body}</div></body></html>`;

for (const theme of ["claude", "medium"]) {
  const htmlFile = path.join(outDir, `${theme}.html`);
  run("node", [cli, "render", articleSample, "--theme", theme, "-o", htmlFile]);
  const shot = path.join(outDir, `${theme}-shot.html`);
  fs.writeFileSync(shot, wrap(fs.readFileSync(htmlFile, "utf-8")));
  const png = path.join(outDir, `${theme}.png`);
  fs.rmSync(png, { force: true });
  run(findEdge(), [
    "--headless=new", "--disable-gpu", "--hide-scrollbars", "--force-device-scale-factor=1",
    "--window-size=900,2100",
    `--screenshot=${png}`,
    `file:///${shot.split(path.sep).join("/")}`,
  ]);
  // Edge is multi-process: the launcher may exit before the screenshot lands
  const deadline = Date.now() + 20000;
  while (!fs.existsSync(png) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 300));
  }
  if (!fs.existsSync(png)) throw new Error(`Edge screenshot did not produce ${png}`);
  const size = fs.statSync(png).size;
  console.log(`${theme}.png  ${(size / 1024).toFixed(0)} KB`);
}

// --- card themes ---
for (const theme of ["naive", "claude"]) {
  const cardDir = path.join(outDir, `cards-${theme}`);
  fs.rmSync(cardDir, { recursive: true, force: true });
  run("node", [cli, "card", cardSample, "--theme", theme, "--out", cardDir]);
  // use the cover card as the gallery preview
  const cover = fs
    .readdirSync(cardDir)
    .find((f) => f.startsWith("card-01"));
  fs.copyFileSync(path.join(cardDir, cover), path.join(outDir, `card-${theme}.png`));
  console.log(`card-${theme}.png  copied from ${cover}`);
}

console.log("done →", outDir);
