import esbuild from "esbuild";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

// Native addon must ship beside main.js for require() to resolve at runtime.
function copyResvg() {
  return {
    name: "copy-resvg",
    setup(build) {
      build.onEnd(() => {
        const outDir = path.join(here, "dist");
        const src = path.join(here, "node_modules", "@resvg", "resvg-js");
        const dest = path.join(outDir, "node_modules", "@resvg", "resvg-js");
        fs.rmSync(dest, { recursive: true, force: true });
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        // ship the whole package: index.js + platform binding + npm/<platform> dir
        fs.cpSync(src, dest, { recursive: true });
        // pnpm layout: the platform package may sit as a sibling — copy it too
        const siblings = fs.readdirSync(path.join(src, "..")).filter((d) => d.startsWith("resvg-js-"));
        for (const s of siblings) {
          const sSrc = path.join(src, "..", s);
          if (fs.statSync(sSrc).isDirectory()) {
            fs.cpSync(sSrc, path.join(outDir, "node_modules", "@resvg", s), { recursive: true });
          }
        }
      });
    },
  };
}

await esbuild.build({
  entryPoints: [path.join(here, "src", "main.ts")],
  bundle: true,
  external: ["obsidian", "electron", "@resvg/resvg-js"],
  format: "cjs",
  target: "es2022",
  platform: "node",
  outfile: path.join(here, "dist", "main.js"),
  sourcemap: false,
  plugins: [copyResvg()],
  logLevel: "info",
});
