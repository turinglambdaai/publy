// Tests: card source parsing, lint rules and real rendering (bundled subset fonts).

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCardSource, lintCards, renderCards, CARD_WIDTH, CARD_HEIGHT } from "./cards.js";

const SAMPLE = `---
title: t
caption: ok
---

## cover
标题

## point
论点
正文

## ending
关注我
`;

test("parseCardSource extracts sections and caption", () => {
  const { sections, caption } = parseCardSource(SAMPLE);
  assert.deepEqual(sections.map((s) => s.kind), ["cover", "point", "ending"]);
  assert.equal(caption, "ok");
});

test("parseCardSource without sections throws", () => {
  assert.throws(() => parseCardSource("---\ntitle: t\n---\nno sections"), /No card sections/);
});

test("lint accepts a well-formed deck", () => {
  const { sections } = parseCardSource(SAMPLE);
  assert.equal(lintCards(sections, "ok").ok, true);
});

test("lint rejects over-long caption", () => {
  const { sections } = parseCardSource(SAMPLE);
  const result = lintCards(sections, "长".repeat(1001));
  assert.equal(result.ok, false);
  assert.ok(result.problems.some((p) => p.includes("1000")));
});

test("lint requires cover and ending", () => {
  const result = lintCards([{ kind: "point", lines: ["x"] }], "ok");
  assert.equal(result.ok, false);
  assert.equal(result.problems.length, 3); // count + cover + ending
});

test("renderCards produces real PNGs via bundled subset fonts", async () => {
  const os = await import("node:os");
  const fs = await import("node:fs");
  const path = await import("node:path");
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-render-test-"));
  const result = await renderCards(SAMPLE, { theme: "naive", outDir });
  assert.equal(result.cards.length, 3);
  for (const card of result.cards) {
    const buf = fs.readFileSync(card.file);
    // PNG magic + IHDR dimensions 1080x1440
    assert.deepEqual([...buf.subarray(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    assert.equal(buf.readUInt32BE(16), CARD_WIDTH);
    assert.equal(buf.readUInt32BE(20), CARD_HEIGHT);
  }
  assert.equal(result.lint.ok, true);
});
