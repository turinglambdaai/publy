// Cover crop to the WeChat article cover ratio (2.35:1) without pulling in
// an image library: embed the raster in an SVG viewport and let resvg crop.

import { Resvg } from "@resvg/resvg-js";

const TARGET_RATIO = 2.35; // width / height
const OUT_WIDTH = 1175;
const OUT_HEIGHT = 500;

export function cropCoverTo235(buffer: Buffer, contentType: string): Buffer {
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
  // read intrinsic size from the rendered SVG by using a huge viewBox first is
  // wasteful; instead we scale the window mathematically from the ratio alone:
  // place the image at 1000 units wide and derive the window from the ratio.
  const imgW = 1000;
  const imgH = imgW / TARGET_RATIO; // window height such that window is 2.35:1
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_WIDTH}" height="${OUT_HEIGHT}" viewBox="0 0 ${imgW} ${imgH}">
  <image href="${dataUri}" x="0" y="0" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
  const resvg = new Resvg(svg, { fitTo: { mode: "width", value: OUT_WIDTH } });
  return Buffer.from(resvg.render().asPng());
}
