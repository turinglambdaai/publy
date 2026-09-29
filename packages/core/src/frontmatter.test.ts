// Tests: frontmatter parsing and publish-type inference.

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSource, publishType } from "./frontmatter.js";

test("publishType defaults to article", () => {
  assert.equal(publishType({}), "article");
  assert.equal(publishType({ type: "article" }), "article");
});

test("publishType: type image and image_post", () => {
  assert.equal(publishType({ type: "image" }), "image_post");
  assert.equal(publishType({ type: "image_post" }), "image_post");
});

test("publishType: mode cards implies image_post without explicit type", () => {
  assert.equal(publishType({ mode: "cards" }), "image_post");
  assert.equal(publishType({ mode: "Cards" }), "image_post");
});

test("publishType: explicit article wins over mode cards", () => {
  assert.equal(publishType({ type: "article", mode: "cards" }), "article");
});

test("parseSource splits frontmatter and body", () => {
  const { meta, body } = parseSource("---\ntitle: T\ntags: [a, b]\n---\n\nHello **world**");
  assert.equal(meta.title, "T");
  assert.deepEqual(meta.tags, ["a", "b"]);
  assert.match(body, /Hello \*\*world\*\*/);
});

test("parseSource tolerates missing frontmatter", () => {
  const { meta, body } = parseSource("Just text");
  assert.equal(meta.title, undefined);
  assert.equal(body.trim(), "Just text");
});
