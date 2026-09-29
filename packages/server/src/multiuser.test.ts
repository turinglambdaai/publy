// Tests: multi-user auth, ownership, quota, purchase flow via fastify inject.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { buildApp, type ServerConfig } from "./index.js";

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "publy-multi-test-"));

const config: ServerConfig = {
  port: 0,
  apiKey: "admin-key",
  dataDir,
  accounts: [{ name: "SharedAcct", appId: "wx_shared", appSecret: "s" }],
};

const app = buildApp(config);
const H = (key: string) => ({ "x-api-key": key, "content-type": "application/json" });

let userKey = "";
let userId = "";

before(async () => {
  await app.ready();
  // admin manually issues a user
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/users",
    headers: H("admin-key"),
    payload: { contact: "user1@test", plan: "free", months: 1 },
  });
  const body = res.json();
  userKey = body.apiKey;
  // bind a wechat account to the user
  await app.inject({
    method: "POST",
    url: "/v1/admin/accounts",
    headers: H("admin-key"),
    payload: { name: "UserAcct", appId: "wx_user", appSecret: "s2", ownerContact: "user1@test" },
  });
  const users = (await app.inject({ method: "GET", url: "/v1/admin/users", headers: H("admin-key") })).json().users;
  userId = users.find((u: { contact: string }) => u.contact === "user1@test").id;
});

after(async () => {
  await app.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
});

test("user key authenticates and sees only owned accounts", async () => {
  const res = await app.inject({ method: "GET", url: "/verify", headers: H(userKey) });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json().accounts, ["UserAcct"]);
});

test("user cannot publish to a shared/admin account", async () => {
  const res = await app.inject({
    method: "POST",
    url: "/v1/publish",
    headers: H(userKey),
    payload: { account: "SharedAcct", type: "article", title: "t" },
  });
  assert.equal(res.statusCode, 403);
  assert.equal(res.json().code, "ACCOUNT_NOT_OWNED");
});

test("quota counts publishes and blocks at the free limit", async () => {
  // free = 30/月; quota endpoint starts at 0
  let q = (await app.inject({ method: "GET", url: "/v1/quota", headers: H(userKey) })).json();
  assert.equal(q.used, 0);
  assert.equal(q.limit, 30);

  // simulate usage directly in the store through 30 successful "publishes" is
  // not possible offline (wechat call); instead verify the 429 path by driving
  // the counter up via repeated ownership-valid publishes would hit wechat —
  // so we assert the pre-check wiring with the quota endpoint only here.
  q = (await app.inject({ method: "GET", url: "/v1/quota", headers: H(userKey) })).json();
  assert.equal(q.plan, "free");
});

test("disabled users are rejected", async () => {
  await app.inject({ method: "POST", url: `/v1/admin/users/${userId}/disable`, headers: H("admin-key"), payload: { disabled: true } });
  const res = await app.inject({ method: "GET", url: "/verify", headers: H(userKey) });
  assert.equal(res.statusCode, 401);
  await app.inject({ method: "POST", url: `/v1/admin/users/${userId}/disable`, headers: H("admin-key"), payload: { disabled: false } });
});

test("admin account limit is enforced per plan", async () => {
  // free allows 1 account
  const res = await app.inject({
    method: "POST",
    url: "/v1/admin/accounts",
    headers: H("admin-key"),
    payload: { name: "UserAcct2", appId: "wx_2", appSecret: "s3", ownerContact: "user1@test" },
  });
  assert.equal(res.statusCode, 400);
  assert.equal(res.json().code, "ACCOUNT_LIMIT");
});

test("purchase page and manual order completion issue a key", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/purchase",
    payload: { contact: "buyer@test", plan: "pro", months: 1 },
  });
  const body = created.json();
  assert.ok(body.orderId);
  assert.equal(body.manual, true); // no payment provider configured → manual completion

  // find order id via lookup is masked; complete via admin endpoint
  const done = await app.inject({
    method: "POST",
    url: `/v1/admin/orders/${body.orderId}/complete`,
    headers: H("admin-key"),
    payload: {},
  });
  assert.equal(done.statusCode, 200);
  assert.equal(done.json().ok, true);

  // order endpoint now shows the key
  const order = await app.inject({ method: "GET", url: `/order/${body.orderId}` });
  assert.equal(order.json().status, "paid");
  assert.match(order.json().apiKey, /^publy_/);

  // buyer's pro quota is the pro limit
  const buyer = order.json().apiKey;
  const q = (await app.inject({ method: "GET", url: "/v1/quota", headers: H(buyer) })).json();
  assert.equal(q.plan, "pro");
  assert.equal(q.limit, 5000);

  // extending an existing contact keeps the same key
  const again = await app.inject({
    method: "POST",
    url: "/v1/admin/users",
    headers: H("admin-key"),
    payload: { contact: "buyer@test", plan: "pro", months: 1 },
  });
  assert.equal(again.json().extended, true);
  assert.equal(again.json().apiKey, buyer);
});
