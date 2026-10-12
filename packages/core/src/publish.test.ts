// Tests: attachment:// ref extraction for article publishing.

import { test } from "node:test";
import assert from "node:assert/strict";
import { ATTACHMENT_SCHEME } from "@publy/shared";
import { extractAttachmentRefs } from "./publish.js";

test("extracts full attachment names, not just the first character", () => {
  // regression: a lazy `+?` in the ref regex stopped after one character, so
  // every name came back truncated and the upload failed with ATTACHMENT_MISSING
  const html = `<img src="${ATTACHMENT_SCHEME}aracom-stack.svg">`;
  assert.deepEqual(extractAttachmentRefs(html), ["aracom-stack.svg"]);
});

test("extracts every ref in order and keeps dots, dashes and CJK in names", () => {
  const html = [
    `<img src="${ATTACHMENT_SCHEME}fig-01.png" alt="a">`,
    `<a href="${ATTACHMENT_SCHEME}总线带宽.xlsx">x</a>`,
    `<img src='${ATTACHMENT_SCHEME}v2-2024.webp'>`,
  ].join("");
  assert.deepEqual(extractAttachmentRefs(html), ["fig-01.png", "总线带宽.xlsx", "v2-2024.webp"]);
});

test("returns empty for html without attachment refs", () => {
  assert.deepEqual(extractAttachmentRefs('<p>plain <b>html</b></p>'), []);
});

test("keeps duplicate refs (caller dedupes)", () => {
  const html = `<img src="${ATTACHMENT_SCHEME}a.png"><img src="${ATTACHMENT_SCHEME}a.png">`;
  assert.deepEqual(extractAttachmentRefs(html), ["a.png", "a.png"]);
});
