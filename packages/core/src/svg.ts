// SVG post-processing: the WeChat editor cannot render <img src="*.svg">,
// and transparent backgrounds render black. Convert every local SVG to a
// white-background PNG via resvg before upload.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { Resvg } from "@resvg/resvg-js";

export function injectWhiteBackground(svg: string): string {
  if (/<rect[^>]*width="100%"/.test(svg)) return svg;
  return svg.replace(/(<svg[^>]*>)/, `$1<rect width="100%" height="100%" fill="white"/>`);
}

export function svgToPng(svgPath: string, targetWidth = 1080): string {
  let svg = fs.readFileSync(svgPath, "utf-8");
  svg = injectWhiteBackground(svg);
  const resvg = new Resvg(svg, {
    fitTo: { mode: "width", value: targetWidth },
    font: { loadSystemFonts: true },
  });
  const png = resvg.render().asPng();
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-svg-"));
  const outName = `${crypto.randomBytes(4).toString("hex")}-${path.basename(svgPath, ".svg")}.png`;
  const outPath = path.join(outDir, outName);
  fs.writeFileSync(outPath, png);
  return outPath;
}
