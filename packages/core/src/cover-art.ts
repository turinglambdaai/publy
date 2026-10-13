// Auto-generated title cover: when a note has no cover and no images, a clean
// title card (2.35:1) is rendered from the note title using the bundled
// GB2312 subset fonts — so every publishable note has a cover.
//
// Rendering goes through the png seam (native resvg on the CLI/server, the
// injected wasm renderer inside the plugin), so the plugin can preview the
// exact same card the server would generate. `titleCoverSvg` is exported for
// exactly that preview use.

import fs from "node:fs";
import path from "node:path";
import { bundledFontDir } from "./fonts.js";
import { getPngRenderer, setPngFontBuffers } from "./png.js";

const W = 1175;
const H = 500;

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** Deterministic title card. Returns null when CJK fonts are unavailable. */
// register the bundled CJK subsets with the native seam once — systems
// without Noto Sans CJK would otherwise render the card with tofu
let fontsRegistered = false;
function ensureBundledFonts(): void {
  if (fontsRegistered) return;
  fontsRegistered = true;
  try {
    const dir = bundledFontDir();
    if (!dir) return;
    const files = ["NotoSansSC-subset-Bold.otf", "NotoSansSC-subset-Regular.otf"]
      .map((f) => path.join(dir, f))
      .filter((p) => fs.existsSync(p));
    if (files.length > 0) setPngFontBuffers(files.map((f) => fs.readFileSync(f)));
  } catch {
    /* system fonts will do */
  }
}

/** The title card as SVG (2.35:1) — used by the plugin's cover picker to show
 *  the real card before publish, not a style approximation. */
export function titleCoverSvg(title: string, accent = "#b75c3d", bg = "#f8f6f0"): string {
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

  return svg;
}

/** Rasterize the title card through the png seam. Returns null when no
 *  renderer is available (then callers fall back to whatever they can show). */
export function generateTitleCover(title: string, accent = "#b75c3d", bg = "#f8f6f0"): Buffer | null {
  try {
    ensureBundledFonts();
    return getPngRenderer()(titleCoverSvg(title, accent, bg), W);
  } catch {
    return null;
  }
}
