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

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "es2022",
  outfile: path.join(here, "dist", "main.js"),
  sourcemap: false,
  external: ["obsidian", "electron", "@resvg/resvg-js", "satori", "harfbuzzjs"],
  loader: { ".css": "text" },
  logLevel: "info",
});
