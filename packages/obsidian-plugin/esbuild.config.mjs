// Bundle the Obsidian plugin. @publy/core + @publy/shared are inlined;
// the two wasm glue packages stay EXTERNAL, redirected to real files shipped
// beside main.js — Obsidian's plugin require() resolves relative paths but
// rejects bare package names.
import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// ship bundled GB2312 font subsets beside main.js (card rendering, offline)
fs.rmSync(path.join(here, "dist", "fonts"), { recursive: true, force: true });
fs.cpSync(path.join(here, "..", "core", "fonts"), path.join(here, "dist", "fonts"), { recursive: true });
for (const f of ["manifest.json", "versions.json"]) fs.copyFileSync(path.join(here, f), path.join(here, "dist", f));
// wasm glue packages beside main.js:
//   @resvg/resvg-wasm (PNG renderer glue + index_bg.wasm)
//   harfbuzzjs        (satori text-shaping glue + hb.wasm)
const nm = path.join(here, "dist", "node_modules");
fs.rmSync(nm, { recursive: true, force: true });
fs.mkdirSync(nm, { recursive: true });
for (const pkg of ["@resvg/resvg-wasm", "harfbuzzjs"]) {
  fs.cpSync(path.join(here, "node_modules", pkg), path.join(nm, pkg), { recursive: true });
}

// Obsidian's plugin require() does NOT resolve bare package names (only
// obsidian/electron/builtins/relative) — redirect the wasm glue packages
// to their shipped real files, marked external so they load at runtime.
const wasmExternals = {
  name: "publy-wasm-externals",
  setup(build) {
    build.onResolve({ filter: /^@resvg\/resvg-wasm$/ }, () => ({
      path: "./node_modules/@resvg/resvg-wasm/index.js",
      external: true,
    }));
    build.onResolve({ filter: /^harfbuzzjs$/ }, () => ({
      path: "./node_modules/harfbuzzjs/index.js",
      external: true,
    }));
  },
};

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: path.join(here, "dist", "main.js"),
  sourcemap: false,
  external: ["obsidian", "electron", "@resvg/resvg-js", "@resvg/resvg-wasm", "harfbuzzjs"],
  plugins: [wasmExternals],
  loader: { ".css": "text" },
  logLevel: "info",
});
