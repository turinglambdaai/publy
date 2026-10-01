// PNG rendering seam: svg string → png buffer.
// Default backend is the native @resvg/resvg-js binding (lazy-required so
// environments without the binding — e.g. the Obsidian plugin — never load
// it). Sandboxed environments inject a WASM renderer via setPngRenderer.

import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import type { ResvgRenderOptions } from "@resvg/resvg-js";

export type PngRenderer = (svg: string, fitWidth?: number) => Buffer;

let renderer: PngRenderer | null = null;

/** require relative to this module — works in real ESM (import.meta) and in
 *  esbuild-cjs bundles (__dirname); returns null when neither is available. */
function nodeRequire(): NodeRequire | null {
  try {
    return createRequire(fileURLToPath(import.meta.url));
  } catch {
    try {
      if (typeof __dirname !== "undefined") return createRequire(__dirname);
    } catch {
      /* fall through */
    }
    return null;
  }
}

function nativeRenderer(): PngRenderer {
  const req = nodeRequire();
  if (!req) throw new Error("native @resvg/resvg-js unavailable in this environment");
  const { Resvg } = req("@resvg/resvg-js") as typeof import("@resvg/resvg-js");
  return (svg: string, fitWidth?: number) => {
    const opts: Record<string, unknown> = { font: { loadSystemFonts: true } };
    if (fitWidth) opts.fitTo = { mode: "width", value: fitWidth };
    return Buffer.from(new Resvg(svg, opts as ResvgRenderOptions).render().asPng());
  };
}

export function getPngRenderer(): PngRenderer {
  if (!renderer) renderer = nativeRenderer();
  return renderer;
}

export function setPngRenderer(r: PngRenderer): void {
  renderer = r;
}
