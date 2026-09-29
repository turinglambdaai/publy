// CJK font management for card rendering. Satori needs font buffers to
// convert text into paths; we download Noto Sans SC once into ~/.publy/fonts
// and cache it. A --font-file override exists for offline/branded setups.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const pkgDir = path.dirname(fileURLToPath(import.meta.url));

export interface FontSpec {
  family: string;
  weight: 400 | 700;
  /** remote url (downloaded & cached) or absolute local path */
  file: string;
  style?: "normal" | "italic";
}

const FONT_DIR = path.join(os.homedir(), ".publy", "fonts");

const NOTO_BASE_CDN = "https://cdn.jsdelivr.net/gh/googlefonts/noto-cjk@main/Sans/OTF/SimplifiedChinese";
const NOTO_BASE_GH = "https://raw.githubusercontent.com/googlefonts/noto-cjk/main/Sans/OTF/SimplifiedChinese";

export const NOTO_SANS_SC: FontSpec[] = [
  { family: "Noto Sans SC", weight: 400, file: `${NOTO_BASE_CDN}/NotoSansCJKsc-Regular.otf` },
  { family: "Noto Sans SC", weight: 700, file: `${NOTO_BASE_CDN}/NotoSansCJKsc-Bold.otf` },
];

function localPathFor(url: string): string {
  const name = url.split("/").pop()!;
  return path.join(FONT_DIR, name);
}

async function download(url: string): Promise<Buffer> {
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return Buffer.from(await res.arrayBuffer());
  } catch (err) {
    const fallback = url.replace(NOTO_BASE_CDN, NOTO_BASE_GH);
    if (fallback !== url) return download(fallback);
    throw err;
  }
}

/** Resolve a FontSpec to a local file path, downloading when remote. */
export async function ensureFontFile(spec: FontSpec): Promise<string> {
  if (path.isAbsolute(spec.file) && fs.existsSync(spec.file)) return spec.file;
  fs.mkdirSync(FONT_DIR, { recursive: true });
  const local = localPathFor(spec.file);
  if (fs.existsSync(local) && fs.statSync(local).size > 0) return local;
  const buf = await download(spec.file);
  if (buf.length < 1024) throw new Error(`Font download too small (${buf.length}B): ${spec.file}`);
  fs.writeFileSync(local, buf);
  return local;
}

export async function loadSatoriFonts(
  specs: FontSpec[],
): Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" | "italic" }[]> {
  const fonts = await Promise.all(
    specs.map(async (spec): Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" | "italic" }> => ({
      name: spec.family,
      data: await fs.promises.readFile(await ensureFontFile(spec)),
      weight: spec.weight,
      style: spec.style ?? "normal",
    })),
  );
  return fonts;
}

/**
 * Bundled GB2312+ASCII subsets ship with the package for instant card
 * rendering; the full OTFs are the fallback for out-of-subset glyphs.
 * Resolution works both in the repo (packages/core/fonts) and the bundled
 * npm package (fonts/ beside dist).
 */
export function bundledSubsetDir(): string | null {
  const candidates = [
    path.resolve(pkgDir, "../fonts"),
    path.resolve(pkgDir, "../../fonts"),
  ];
  for (const dir of candidates) {
    if (fs.existsSync(path.join(dir, "NotoSansSC-subset-Regular.otf"))) return dir;
  }
  return null;
}

export function loadSatoriFontsWithFallback(specs: FontSpec[]): Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" | "italic" }[]> {
  const subsetDir = bundledSubsetDir();
  if (subsetDir) {
    return Promise.all(
      specs.map(async (spec): Promise<{ name: string; data: Buffer; weight: 400 | 700; style: "normal" | "italic" }> => {
        const subsetName = spec.weight === 700 ? "NotoSansSC-subset-Bold.otf" : "NotoSansSC-subset-Regular.otf";
        const subsetFile = path.join(subsetDir, subsetName);
        if (fs.existsSync(subsetFile)) {
          return { name: spec.family, data: await fs.promises.readFile(subsetFile), weight: spec.weight, style: "normal" };
        }
        return { name: spec.family, data: await fs.promises.readFile(await ensureFontFile(spec)), weight: spec.weight, style: "normal" };
      }),
    );
  }
  return loadSatoriFonts(specs);
}
