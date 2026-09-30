// Auto-generated title cover: when a note has no cover and no images, the
// server renders a clean title card (2.35:1) from the note title using the
// bundled GB2312 subset fonts — so every publishable note has a cover.

import fs from "node:fs";
import path from "node:path";
import { Resvg } from "@resvg/resvg-js";
import { bundledFontDir } from "./fonts.js";

const W = 1175;
const H = 500;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function subsetFontFiles(): string[] | null {
  const dir = bundledFontDir();
  if (!dir) return null;
  const files = ["NotoSansSC-subset-Bold.otf", "NotoSansSC-subset-Regular.otf"].map((f) => path.join(dir, f)).filter((p) => fs.existsSync(p));
  return files.length > 0 ? files : null;
}

/** Deterministic title card. Returns null when CJK fonts are unavailable. */
export function generateTitleCover(title: string, accent = "#b75c3d", bg = "#f8f6f0"): Buffer | null {
  const fontFiles = subsetFontFiles();
  if (!fontFiles) return null;

  // wrap into lines of <= 12 chars, at most 3 lines (28 chars usable)
  const clean = title.replace(/\s+/g, " ").trim().slice(0, 28);
  const lines: string[] = [];
  let rest = clean;
  while (rest.length > 0) {
    lines.push(rest.slice(0, 12));
    rest = rest.slice(12);
  }
  if (lines.length === 0) lines.push("未命名");

  const fontSize = 76;
  const lineH = Math.round(fontSize * 1.35);
  const startY = Math.round(H / 2) - ((lines.length - 1) * lineH) / 2 + Math.round(fontSize * 0.3);
  const texts = lines
    .map((l, i) => `<text x="110" y="${startY + i * lineH}" font-family="Noto Sans CJK SC, Noto Sans SC" font-weight="700" font-size="${fontSize}" fill="#2b2b2b">${escapeXml(l)}</text>`)
    .join("");

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <rect width="${W}" height="${H}" fill="${bg}"/>
  <rect x="0" y="0" width="${W}" height="12" fill="${accent}"/>
  <rect x="110" y="${startY + lines.length * lineH + 6}" width="120" height="10" rx="5" fill="${accent}"/>
  ${texts}
</svg>`;

  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: W },
    font: { loadSystemFonts: false, fontFiles },
  });
  return Buffer.from(resvg.render().asPng());
}
