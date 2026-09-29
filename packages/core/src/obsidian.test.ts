// Tests: Obsidian syntax preprocessing.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { preprocessObsidian } from "./obsidian.js";

function withMediaDir(fn: (dir: string) => void): void {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-test-"));
  try {
    fn(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("embed resolves against media dir and keeps alt", () => {
  withMediaDir((dir) => {
    fs.writeFileSync(path.join(dir, "pic.png"), "x");
    const { body, assets, missing } = preprocessObsidian("![[pic.png|说明|650]]", [dir]);
    assert.equal(missing.length, 0);
    assert.equal(assets.length, 1);
    assert.match(body, /!\[说明\]\(.*pic\.png\)/);
  });
});

test("embed without alt falls back to file base name", () => {
  withMediaDir((dir) => {
    fs.writeFileSync(path.join(dir, "pic.png"), "x");
    const { body } = preprocessObsidian("![[pic.png]]", [dir]);
    assert.match(body, /!\[pic\]\(/);
  });
});

test("wikilink collapses to alias / target", () => {
  const a = preprocessObsidian("[[Some/Note|alias]]", []);
  assert.equal(a.body, "alias");
  const b = preprocessObsidian("[[Note]]", []);
  assert.equal(b.body, "Note");
});

test("missing asset is reported, body keeps reference", () => {
  const { missing, body } = preprocessObsidian("![[nope.png]]", []);
  assert.deepEqual(missing, ["nope.png"]);
  assert.match(body, /!\[nope\]\(nope\.png\)/);
});
