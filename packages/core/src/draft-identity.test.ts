import { test } from "node:test";
import assert from "node:assert/strict";
import type { PublishRequest } from "@publy/shared";
import { draftIdempotencyKey } from "./draft-identity.js";

const fixture = (): PublishRequest => ({
  account: "official-account-A",
  type: "article",
  title: "A draft",
  html: "<p>alpha</p>",
  images: [{ name: "photo.png", contentType: "image/png", data: Buffer.from("photo A").toString("base64") }],
  cover: "photo.png",
  digest: "Preview",
  needOpenComment: true,
});

test("exact same WeChat draft payload keeps one request identity across retries", () => {
  const first = fixture();
  const key = draftIdempotencyKey(first);
  assert.match(key, /^[0-9a-f]{32}$/);
  assert.equal(key, draftIdempotencyKey(structuredClone(first)));
  const retried = { ...first, idempotencyKey: "ignored" };
  assert.equal(key, draftIdempotencyKey(retried));
});

test("same-length different content never silently deduplicates a real draft", () => {
  const original = fixture();
  const changed = { ...original, html: "<p>omega</p>" };
  assert.equal(original.html?.length, changed.html.length);
  assert.notEqual(draftIdempotencyKey(original), draftIdempotencyKey(changed));
});

test("changed image bytes matter even if filename, type and length are identical", () => {
  const original = fixture();
  const changed: PublishRequest = {
    ...original,
    images: [{ ...original.images![0], data: Buffer.from("photo B").toString("base64") }],
  };
  assert.equal(original.images![0].data.length, changed.images![0].data.length);
  assert.notEqual(draftIdempotencyKey(original), draftIdempotencyKey(changed));
});

test("all publication decisions affecting the resulting draft must change identity", () => {
  const original = fixture();
  const key = draftIdempotencyKey(original);
  const changes: PublishRequest[] = [
    { ...original, account: "official-account-B" },
    { ...original, type: "image_post" },
    { ...original, title: "B draft" },
    { ...original, cover: "other.png" },
    { ...original, coverMode: "auto" },
    { ...original, author: "Someone" },
    { ...original, digest: "Changed" },
    { ...original, needOpenComment: false },
    { ...original, onlyFansCanComment: true },
    { ...original, publishAt: "2026-11-10T12:00:00.000Z" },
    { ...original, contentSourceUrl: "https://example.com" },
    { ...original, images: [...original.images!, original.images![0]] },
  ];
  for (const change of changes) {
    assert.notEqual(draftIdempotencyKey(change), key, JSON.stringify(change).slice(0, 120));
  }
});

test("length delimiters prevent field-boundary aliasing", () => {
  const a = { ...fixture(), account: "xy", title: "z" };
  const b = { ...fixture(), account: "x", title: "yz" };
  assert.notEqual(draftIdempotencyKey(a), draftIdempotencyKey(b));
});
