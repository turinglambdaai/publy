// Bundle the Obsidian plugin. @publy/core + @publy/shared are inlined;
// @resvg/resvg-wasm JS is bundled and its .wasm is inlined as binary so the
// released main.js is a single self-contained file (Obsidian review friendly:
// no native binaries). Fonts ship beside main.js for offline card rendering.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ship bundled GB2312 font subsets beside main.js (card rendering, offline)
fs.rmSync(path.join(here, "dist", "fonts"), { recursive: true, force: true });
fs.cpSync(path.join(here, "..", "core", "fonts"), path.join(here, "dist", "fonts"), { recursive: true });
// the wasm renderer replaced the native module — never ship node_modules
fs.rmSync(path.join(here, "dist", "node_modules"), { recursive: true, force: true });

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@resvg/resvg-js"],
  loader: { ".wasm": "binary" },
  format: "cjs",
  target: "es2022",
  platform: "node",
  outfile: path.join(here, "dist", "main.js"),
  sourcemap: false,
  logLevel: "info",
});
