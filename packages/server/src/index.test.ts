// Tests: server protocol via fastify inject (no sockets, no real WeChat calls).

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp, type ServerConfig } from "./index.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-server-test-"));

const config: ServerConfig = {
  port: 0,
  apiKey: "test-key",
  dataDir,
  accounts: [{ name: "TestAcct", appId: "wx_dummy", appSecret: "dummy" }],
};

const app = buildApp(config);

before(async () => {
  await app.ready();
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("health is reachable without auth", async () => {
  const res = await app.inject({ method: "GET", url: "/health" });
  assert.equal(res.statusCode, 200);
  assert.equal(res.json().service, "publy-server");
});

test("auth rejects wrong key and accepts the right one", async () => {
  const bad = await app.inject({ method: "GET", url: "/verify", headers: { "x-api-key": "wrong" } });
  assert.equal(bad.statusCode, 401);
  const good = await app.inject({ method: "GET", url: "/verify", headers: { "x-api-key": "test-key" } });
  assert.equal(good.statusCode, 200);
  assert.deepEqual(good.json().accounts, ["TestAcct"]);
});

test("publish validates required fields", async () => {
  const headers = { "x-api-key": "test-key", "content-type": "application/json" };
  const noAccount = await app.inject({ method: "POST", url: "/v1/publish", headers, payload: { type: "article", title: "t" } });
  assert.equal(noAccount.statusCode, 400);
  const noTitle = await app.inject({ method: "POST", url: "/v1/publish", headers, payload: { account: "TestAcct", type: "article" } });
  assert.equal(noTitle.statusCode, 400);
  const badType = await app.inject({ method: "POST", url: "/v1/publish", headers, payload: { account: "TestAcct", type: "weird", title: "t" } });
  assert.equal(badType.statusCode, 400);
});

test("publish with unknown account returns ACCOUNT_NOT_FOUND", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/publish",
    headers: { "x-api-key": "test-key", "content-type": "application/json" },
    payload: { account: "Nope", type: "article", title: "t" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "ACCOUNT_NOT_FOUND");
});

test("scheduled publish stores a job and can be cancelled", async () => {
  const runAt = new Date(Date.now() + 3600_000).toISOString();
  const created = await app.inject({
    method: "POST",
    url: "/v1/publish",
    headers: { "x-api-key": "test-key", "content-type": "application/json" },
    payload: { account: "TestAcct", type: "article", title: "scheduled", publishAt: runAt, images: [{ name: "a.png", data: "aGk=" }] },
  });
  assert.equal(created.statusCode, 200);
  const { jobId, scheduled } = created.json();
  assert.ok(scheduled);
  assert.ok(jobId);

  const list = await app.inject({ method: "GET", url: "/v1/jobs", headers: { "x-api-key": "test-key" } });
  assert.equal(list.statusCode, 200);
  assert.ok(list.json().jobs.some((j: { id: string }) => j.id === jobId));

  const cancel = await app.inject({ method: "DELETE", url: `/v1/jobs/${jobId}`, headers: { "x-api-key": "test-key" } });
  assert.equal(cancel.statusCode, 200);
  assert.equal(cancel.json().ok, true);
});

test("schedule rejects past dates", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/publish",
    headers: { "x-api-key": "test-key", "content-type": "application/json" },
    payload: { account: "TestAcct", type: "article", title: "t", publishAt: "2000-01-01T00:00:00Z" },
  });
  assert.equal(res.statusCode, 400);
});

test("history returns an array", async () => {
  const res = await app.inject({ method: "GET", url: "/v1/history?limit=5", headers: { "x-api-key": "test-key" } });
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.json().history));
});
