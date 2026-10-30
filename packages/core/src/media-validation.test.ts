import { test } from "node:test";
import assert from "node:assert/strict";
import { blockingMediaWarning } from "./media-validation.js";

test("CLI and Obsidian share the same fail-closed asset warning policy", () => {
  for (const warning of [
    "Assets not found: missing.png",
    "Image not found: assets/pic.png",
    "Cover not found: covers/title.png",
    "SVG conversion failed for asset.svg",
    "Math not rendered (mathjax-full unavailable)",
    "Remote image not uploaded: save the HTTP(S) image locally before publishing.",
    "Embedded data image not uploaded: save the image as a local file before publishing.",
  ]) {
    assert.equal(blockingMediaWarning(warning), true, warning);
  }
  for (const warning of ["Long paragraph", "Typora local source", ""]) {
    assert.equal(blockingMediaWarning(warning), false, warning);
  }
});
