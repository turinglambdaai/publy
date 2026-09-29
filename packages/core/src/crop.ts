// Cover crop to the WeChat article cover ratio (2.35:1) without pulling in
// an image library: embed the raster in an SVG viewport and let the PNG
// renderer crop.

import { getPngRenderer } from "./png.js";

const TARGET_RATIO = 2.35; // width / height
const OUT_WIDTH = 1175;
const OUT_HEIGHT = 500;

export function cropCoverTo235(buffer: Buffer, contentType: string): Buffer {
  const dataUri = `data:${contentType};base64,${buffer.toString("base64")}`;
  const imgW = 1000;
  const imgH = imgW / TARGET_RATIO; // window height such that window is 2.35:1
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${OUT_WIDTH}" height="${OUT_HEIGHT}" viewBox="0 0 ${imgW} ${imgH}">
  <image href="${dataUri}" x="0" y="0" width="${imgW}" height="${imgH}" preserveAspectRatio="xMidYMid slice"/>
</svg>`;
  return getPngRenderer()(svg, OUT_WIDTH);
}
