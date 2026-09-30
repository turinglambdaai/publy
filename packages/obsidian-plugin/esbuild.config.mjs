// Bundle the Obsidian plugin. @publy/core + @publy/shared are inlined;
// @resvg/resvg-wasm stays EXTERNAL and its package (CJS glue + index_bg.wasm)
// is copied beside main.js — its initWasm() resolves the wasm from there.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ship bundled GB2312 font subsets beside main.js (card rendering, offline)
fs.rmSync(path.join(here, "dist", "fonts"), { recursive: true, force: true });
fs.cpSync(path.join(here, "..", "core", "fonts"), path.join(here, "dist", "fonts"), { recursive: true });
// resvg-wasm package (CJS glue + index_bg.wasm) beside main.js
const wasmDest = path.join(here, "dist", "node_modules", "@resvg", "resvg-wasm");
fs.rmSync(path.join(here, "dist", "node_modules"), { recursive: true, force: true });
fs.mkdirSync(path.dirname(wasmDest), { recursive: true });
fs.cpSync(path.join(here, "node_modules", "@resvg", "resvg-wasm"), wasmDest, { recursive: true });
fs.copyFileSync(path.join(here, "node_modules", "harfbuzzjs", "hb.wasm"), path.join(here, "dist", "hb.wasm"));
fs.cpSync(path.join(here, "node_modules", "harfbuzzjs", "hb.wasm"), path.join(here, "dist", "hb.wasm"));

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: path.join(here, "dist", "main.js"),
  sourcemap: false,
  external: ["obsidian", "electron", "@resvg/resvg-js", "@resvg/resvg-wasm"],
  loader: { ".css": "text" },
  logLevel: "info",
});
