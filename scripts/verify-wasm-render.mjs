// Integration check: the exact renderer path the Obsidian plugin uses at
// onload — resvg-wasm (no native binding) + bundled GB2312 subsets + core card
// engine. Mirrors packages/obsidian-plugin/src/main.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const wasmPkg = path.resolve(here, "../packages/obsidian-plugin/node_modules/@resvg/resvg-wasm");
const { initWasm, Resvg } = await import(`file:///${wasmPkg.split(path.sep).join("/")}/index.mjs`);
const wasm = fs.readFileSync(path.join(wasmPkg, "index_bg.wasm"));
await initWasm(wasm);

const coreDir = path.resolve(here, "../packages/core");
const core = await import(`file:///${path.join(coreDir, "dist", "index.js").split(path.sep).join("/")}`);
const { setPngRenderer, renderCards } = core;

const fontFiles = ["NotoSansSC-subset-Regular.otf", "NotoSansSC-subset-Bold.otf"].map((f) =>
  path.join(coreDir, "fonts", f),
);
setPngRenderer((svg, fitWidth) => {
  const resvg = new Resvg(svg, {
    font: { loadSystemFonts: false, fontFiles },
    ...(fitWidth ? { fitTo: { mode: "width", value: fitWidth } } : {}),
  });
  return Buffer.from(resvg.render().asPng());
});

const sample = fs.readFileSync(path.resolve(here, "../packages/cli/samples/card-sample.md"), "utf-8");
const outDir = fs.mkdtempSync(path.join(process.env.TEMP ?? "/tmp", "publy-wasm-test-"));
const result = await renderCards(sample, { theme: "naive", outDir });
console.log("cards:", result.cards.length, "lint ok:", result.lint.ok);
const png = fs.readFileSync(result.cards[0].file);
console.log("png:", png.length, "bytes,", png.readUInt32BE(16) + "x" + png.readUInt32BE(20));
