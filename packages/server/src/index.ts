// Publy publishing server (protocol v1) + commercial control plane.
//
// Auth model:
//   admin key (server.json apiKey) — full access, no quota
//   user key (publy_…)             — publish to owned accounts, monthly quota
//
// Commercial loop: /purchase page → payment provider → callback → auto key
// issuance; /admin console for the operator. See docs/business.md.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import type { JobInfo, PublishRequest, PublishResponse } from "@publy/shared";
import { publishToWechat, MaterialCache, TokenManager, WechatError, PublishError, type AccountCredential } from "@publy/core";
import { Store, PLAN_LIMITS, type AccountRow, type Plan, type UserRow } from "./store.js";
import { createProvider } from "./payments.js";
import { purchasePage, adminPage } from "./pages.js";

export interface ServerAccount {
  name: string;
  appId: string;
  appSecret: string;
  webhook?: string;
}

export interface ServerConfig {
  port: number;
  /** admin key: full access, no quota (the operator) */
  apiKey: string;
  accounts: ServerAccount[];
  dataDir?: string;
  /** public base url used for payment callbacks, e.g. https://publy-api.jrtx.site */
  publicUrl?: string;
  payments?: {
    provider?: "alipay" | "xunhupay" | "manual";
    alipay?: { appId?: string; privateKey?: string; alipayPublicKey?: string };
    xunhupay?: { appId?: string; secret?: string };
  };
}

const DEFAULT_CONFIG_PATH = path.join(os.homedir(), ".publy", "server.json");

export function loadServerConfig(configPath?: string): ServerConfig {
  const file = configPath ?? process.env.PUBLY_SERVER_CONFIG ?? DEFAULT_CONFIG_PATH;
  const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
  if (!raw.apiKey) throw new Error(`server config ${file} is missing "apiKey"`);
  if (!Array.isArray(raw.accounts) || raw.accounts.length === 0) {
    throw new Error(`server config ${file} must declare at least one account`);
  }
  for (const a of raw.accounts) {
    if (!a.name || !a.appId || !a.appSecret) {
      throw new Error(`account entries need "name", "appId", "appSecret" (account: ${a.name ?? "?"})`);
    }
  }
  return {
    port: raw.port ?? 8081,
    apiKey: raw.apiKey,
    accounts: raw.accounts,
    dataDir: raw.dataDir ?? path.join(path.dirname(file), "server-data"),
    publicUrl: raw.publicUrl,
    payments: raw.payments,
  };
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000;
const JOB_MAX_ATTEMPTS = 3;
const JOB_RETRY_DELAY_MS = 5 * 60 * 1000;

interface StoredJob {
  id: string;
  runAt: number;
  body: PublishRequest;
  /** set when scheduled by a user key; quota applies at execution */
  userId: string | null;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  nextAttemptAt: number;
  result?: PublishResponse;
  error?: string;
}

function jobInfo(j: StoredJob): JobInfo {
  return {
    id: j.id,
    runAt: new Date(j.runAt).toISOString(),
    status: j.status,
    attempts: j.attempts,
    account: j.body.account,
    type: j.body.type,
    title: j.body.title,
    error: j.error,
    mediaId: j.result?.mediaId,
  };
}

/** resolved caller: admin, or a user row */
type Caller = { admin: true } | { admin: false; user: UserRow };

export function buildApp(config: ServerConfig) {
  const app = Fastify({ bodyLimit: 30 * 1024 * 1024 });
  const dataDir = config.dataDir ?? path.join(os.homedir(), ".publy", "server-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const store = new Store(dataDir);
  app.addHook("onClose", async () => store.close());
  const tokens = new TokenManager(dataDir);
  const materials = new MaterialCache(dataDir);

  const publicUrl = (config.publicUrl ?? `http://localhost:${config.port}`).replace(/\/$/, "");

  // account resolution: admin owns server.json accounts + everything in db;
  // users own only their db accounts
  function resolveAccount(ref: string, caller: Caller): AccountCredential | null {
    if (!caller.admin) {
      const owned = store.findAccount(ref);
      if (owned && owned.ownerUserId === caller.user.id) return owned;
      return null;
    }
    const shared = config.accounts.find((a) => a.name === ref || a.appId === ref);
    if (shared) return { name: shared.name, appId: shared.appId, appSecret: shared.appSecret };
    const row = store.findAccount(ref);
    return row ?? null;
  }

  function planLimit(user: UserRow): number {
    return store.isProActive(user) ? PLAN_LIMITS.pro.monthlyPublishes : PLAN_LIMITS.free.monthlyPublishes;
  }

  // webhook: fire-and-forget POST, never blocks the response
  const notifyWebhook = (accountName: string, event: string, extra: Record<string, unknown>) => {
    const hookUrl = config.accounts.find((a) => a.name === accountName)?.webhook;
    if (!hookUrl) return;
    fetch(hookUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, account: accountName, ts: new Date().toISOString(), ...extra }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      /* best effort */
    });
  };

  // --- scheduled jobs --------------------------------------------------------

  const jobsFile = path.join(dataDir, "jobs.json");
  let jobs: Record<string, StoredJob> = {};
  try {
    jobs = JSON.parse(fs.readFileSync(jobsFile, "utf-8"));
  } catch {
    /* first run */
  }
  const saveJobs = () => fs.writeFileSync(jobsFile, JSON.stringify(jobs, null, 2), { mode: 0o600 });

  async function runJob(job: StoredJob): Promise<void> {
    job.status = "running";
    saveJobs();
    const body = job.body;
    const caller: Caller = job.userId ? { admin: false, user: store.findUserById(job.userId)! } : { admin: true };
    const cred = resolveAccount(body.account, caller);
    try {
      if (!cred) throw new PublishError("ACCOUNT_NOT_FOUND", `Unknown account "${body.account}"`);
      if (!caller.admin) {
        const user = caller.user;
        if (user.disabledAt) throw new PublishError("USER_DISABLED", "account disabled");
        const limit = planLimit(user);
        const used = store.getUsage(user);
        if (used >= limit) throw new PublishError("QUOTA_EXCEEDED", `monthly limit ${limit} reached`);
      }
      const result = await publishToWechat(body, cred, tokens, materials);
      job.status = "done";
      job.result = result;
      if (!caller.admin) store.incrementUsage(caller.user.id);
      audit({ event: "scheduled-published", account: body.account, type: body.type, title: body.title, mediaId: result.mediaId, jobId: job.id });
      notifyWebhook(body.account, "publish", { title: body.title, mediaId: result.mediaId, jobId: job.id, scheduled: true });
    } catch (err) {
      job.attempts += 1;
      job.error = (err as Error).message;
      audit({ event: "scheduled-failed", account: body.account, title: body.title, jobId: job.id, attempts: job.attempts, error: job.error });
      if (job.attempts >= JOB_MAX_ATTEMPTS) {
        job.status = "failed";
        notifyWebhook(body.account, "failed", { title: body.title, jobId: job.id, error: job.error, scheduled: true });
      } else {
        job.status = "pending";
        job.nextAttemptAt = Date.now() + JOB_RETRY_DELAY_MS * job.attempts;
      }
    }
    saveJobs();
  }

  const scheduler = setInterval(
    () => {
      for (const job of Object.values(jobs)) {
        if (job.status === "pending" && job.nextAttemptAt <= Date.now()) void runJob(job);
      }
    },
    30_000,
  );
  scheduler.unref();

  // --- audit -----------------------------------------------------------------

  const historyFile = path.join(dataDir, "history.jsonl");
  const audit = (entry: Record<string, unknown>) => {
    fs.appendFileSync(historyFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  };
  const readHistory = (limit: number) => {
    try {
      return fs
        .readFileSync(historyFile, "utf-8")
        .trim()
        .split("\n")
        .slice(-limit)
        .map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  // --- auth ------------------------------------------------------------------

  function auth(callerKey: string | undefined): Caller | null {
    if (!callerKey) return null;
    if (config.apiKey && callerKey === config.apiKey) return { admin: true };
    const user = store.findUserByKey(callerKey);
    if (!user || user.disabledAt) return null;
    return { admin: false, user };
  }

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health" || req.url === "/" || req.url.startsWith("/purchase") || req.url.startsWith("/order/") || req.url.startsWith("/lookup") || req.url.startsWith("/pay/")) return;
    const caller = auth(req.headers["x-api-key"] as string | undefined);
    if (!caller) {
      await reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid API key" });
      return;
    }
    (req as unknown as { caller: Caller }).caller = caller;
  });

  // --- public storefront (no auth) -------------------------------------------

  app.get("/health", async () => ({ status: "ok", service: "publy-server", protocol: "v1" }));
  app.get("/", async (_req, reply) => reply.type("text/html").send(purchasePage()));
  app.get("/admin", async (_req, reply) => reply.type("text/html").send(adminPage()));

  const payments = createProvider(config.payments, store, (order) => {
    audit({ event: "purchase-paid", contact: order.contact, plan: order.plan, months: order.months, orderId: order.id });
  });
  console.log(`[payments] provider: ${payments.provider.name}`);
  const pollThrottle = new Map<string, number>();

  app.post<{ Body: { contact?: string; plan?: string; months?: number } }>("/purchase", async (req, reply) => {
    const { contact, plan, months } = req.body ?? {};
    if (!contact || !/^\S{1,64}$/.test(contact)) return reply.code(400).send({ code: "BAD_REQUEST", message: "contact required" });
    if (plan !== "pro" || ![1, 12].includes(Number(months))) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "plan must be pro with months 1 or 12" });
    }
    const amountFen = months === 12 ? 39000 : 3900;
    const order = store.createOrder(contact, "pro", Number(months), amountFen, payments.provider.name);
    try {
      const payment = await payments.provider.createPayment(
        order,
        `${publicUrl}/pay/xunhupay/notify`,
        `${publicUrl}/order/${order.id}`,
      );
      if (payment) return { orderId: order.id, payUrl: payment.payUrl };
      return { orderId: order.id, manual: true };
    } catch (err) {
      return reply.code(502).send({ code: "PAYMENT_PROVIDER_ERROR", message: (err as Error).message });
    }
  });

  app.get<{ Params: { id: string } }>("/order/:id", async (req, reply) => {
    const order = store.findOrder((req.params as { id: string }).id);
    if (!order) return reply.code(404).send({ code: "NOT_FOUND", message: "no such order" });
    if (order.status !== "paid") {
      // lazy active query: providers with polling (alipay) settle orders here,
      // throttled so page polling doesn't hammer the gateway
      if (payments.provider.pollOrder && !pollThrottle.has(order.id)) {
        pollThrottle.set(order.id, Date.now());
        try {
          if ((await payments.provider.pollOrder(order)) === "paid") payments.completeOrder(order.id);
        } catch {
          /* gateway hiccup — stay pending, next poll retries */
        } finally {
          setTimeout(() => pollThrottle.delete(order.id), 4000);
        }
      }
    }
    const fresh = store.findOrder(order.id)!;
    if (fresh.status !== "paid") return { orderId: fresh.id, status: fresh.status };
    const user = store.findUserByContact(fresh.contact);
    return { orderId: fresh.id, status: "paid", apiKey: user?.apiKey, plan: user?.plan, expiresAt: user?.expiresAt };
  });

  app.get<{ Querystring: { contact?: string } }>("/lookup", async (req) => {
    const contact = (req.query as { contact?: string }).contact ?? "";
    const user = store.findUserByContact(contact);
    if (!user) return { keys: [] };
    return { keys: [user.apiKey.slice(-4)], plan: user.plan, expiresAt: user.expiresAt };
  });

  app.post<{ Body: Record<string, unknown> }>("/pay/xunhupay/notify", async (req, reply) => {
    const orderId = payments.provider.verifyNotify(req.body);
    if (!orderId) return reply.code(400).send({ code: "BAD_SIGNATURE" });
    const done = payments.completeOrder(orderId);
    if (!done || done.status !== "paid") return reply.code(400).send({ code: "FULFILLMENT_FAILED" });
    audit({ event: "purchase-completed", orderId, contact: done.contact });
    return "success";
  });

  // --- user routes -------------------------------------------------------------

  app.get("/verify", async (req) => {
    const caller = (req as unknown as { caller: Caller }).caller;
    return caller.admin
      ? { ok: true, admin: true, accounts: [...config.accounts.map((a) => a.name), ...store.listAccounts().map((a) => a.name)] }
      : { ok: true, accounts: store.listAccounts().filter((a) => a.ownerUserId === caller.user.id).map((a) => a.name) };
  });

  app.get("/v1/quota", async (req) => {
    const caller = (req as unknown as { caller: Caller }).caller;
    if (caller.admin) return { admin: true, unlimited: true };
    const limit = planLimit(caller.user);
    return { plan: caller.user.plan, used: store.getUsage(caller.user), limit, expiresAt: caller.user.expiresAt || undefined };
  });

  app.post<{ Body: PublishRequest }>("/v1/publish", async (req, reply) => {
    const caller = (req as unknown as { caller: Caller }).caller;
    const body = req.body;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "JSON body required" });
    }
    if (!body.account) return reply.code(400).send({ code: "BAD_REQUEST", message: '"account" is required' });
    if (!body.title) return reply.code(400).send({ code: "BAD_REQUEST", message: '"title" is required' });
    if (body.type !== "article" && body.type !== "image_post") {
      return reply.code(400).send({ code: "BAD_REQUEST", message: '"type" must be "article" or "image_post"' });
    }

    // ownership for user keys
    if (!caller.admin) {
      const owned = store.findAccount(body.account);
      if (!owned || owned.ownerUserId !== caller.user.id) {
        return reply.code(403).send({ code: "ACCOUNT_NOT_OWNED", message: `Account "${body.account}" is not bound to your user` });
      }
    }

    // quota pre-check for user keys
    if (!caller.admin) {
      const limit = planLimit(caller.user);
      if (store.getUsage(caller.user) >= limit) {
        return reply.code(429).send({ code: "QUOTA_EXCEEDED", message: `monthly limit ${limit} reached — upgrade at ${publicUrl}` });
      }
    }

    const key = body.idempotencyKey;
    if (key) {
      const hit = idempotency[key];
      if (hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS) {
        audit({ event: "deduped", key, account: body.account, title: body.title });
        return { mediaId: hit.mediaId, deduped: true };
      }
    }

    if (body.publishAt) {
      const runAt = new Date(body.publishAt).getTime();
      if (Number.isNaN(runAt) || runAt < Date.now() - 60_000) {
        return reply.code(400).send({ code: "BAD_REQUEST", message: `invalid publishAt "${body.publishAt}"` });
      }
      const id = crypto.randomUUID();
      jobs[id] = { id, runAt, body, userId: caller.admin ? null : caller.user.id, status: "pending", attempts: 0, nextAttemptAt: runAt };
      saveJobs();
      audit({ event: "scheduled", account: body.account, type: body.type, title: body.title, runAt: new Date(runAt).toISOString(), jobId: id });
      return { jobId: id, runAt: new Date(runAt).toISOString(), scheduled: true };
    }

    try {
      const cred = resolveAccount(body.account, caller);
      if (!cred) {
        const code = caller.admin ? "ACCOUNT_NOT_FOUND" : "ACCOUNT_NOT_OWNED";
        return reply.code(caller.admin ? 400 : 403).send({ code, message: `Unknown/unowned account "${body.account}"` });
      }
      const result: PublishResponse = await publishToWechat(body, cred, tokens, materials);
      if (key) {
        idempotency[key] = { mediaId: result.mediaId, at: Date.now() };
        saveIdempotency();
      }
      if (!caller.admin) store.incrementUsage(caller.user.id);
      audit({ event: "published", account: body.account, type: body.type, title: body.title, mediaId: result.mediaId, key, user: caller.admin ? "admin" : caller.user.contact });
      notifyWebhook(body.account, "publish", { title: body.title, mediaId: result.mediaId });
      return result;
    } catch (err) {
      audit({ event: "failed", account: body.account, type: body.type, title: body.title, error: (err as Error).message });
      notifyWebhook(body.account, "failed", { title: body.title, error: (err as Error).message });
      if (err instanceof PublishError) {
        return reply.code(400).send({ code: err.code, message: err.message });
      }
      if (err instanceof WechatError) {
        return reply.code(502).send({ code: `WECHAT_${err.errcode}`, message: err.message });
      }
      throw err;
    }
  });

  app.get<{ Querystring: { limit?: string } }>("/v1/history", async (req) => {
    const limit = Math.min(Math.max(parseInt((req.query as { limit?: string }).limit ?? "50", 10) || 50, 1), 500);
    return { history: readHistory(limit) };
  });

  app.get("/v1/jobs", async () => ({ jobs: Object.values(jobs).sort((a, b) => a.runAt - b.runAt).map(jobInfo) }));

  app.get<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const job = jobs[(req.params as { id: string }).id];
    if (!job) return reply.code(404).send({ code: "NOT_FOUND", message: "no such job" });
    return jobInfo(job);
  });

  app.delete<{ Params: { id: string } }>("/v1/jobs/:id", async (req, reply) => {
    const job = jobs[(req.params as { id: string }).id];
    if (!job) return reply.code(404).send({ code: "NOT_FOUND", message: "no such job" });
    if (job.status !== "pending") {
      return reply.code(400).send({ code: "NOT_CANCELLABLE", message: `job is ${job.status}` });
    }
    job.status = "cancelled";
    saveJobs();
    audit({ event: "cancelled", jobId: job.id, account: job.body.account, title: job.body.title });
    return { ok: true };
  });

  // --- admin routes ----------------------------------------------------------

  function requireAdmin(req: unknown): boolean {
    return ((req as unknown as { caller: Caller }).caller as Caller).admin;
  }

  app.get("/v1/admin/users", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(403).send({ code: "FORBIDDEN", message: "admin only" });
    return {
      users: store.listUsers().map((u) => ({
        id: u.id,
        contact: u.contact,
        plan: u.plan,
        expiresAt: u.expiresAt || undefined,
        used: store.getUsage(u),
        limit: planLimit(u),
        disabled: Boolean(u.disabledAt),
        apiKey: u.apiKey,
        createdAt: u.createdAt,
      })),
    };
  });

  app.post<{ Body: { contact?: string; plan?: string; months?: number } }>("/v1/admin/users", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(403).send({ code: "FORBIDDEN", message: "admin only" });
    const { contact, plan, months } = req.body ?? {};
    if (!contact) return reply.code(400).send({ code: "BAD_REQUEST", message: "contact required" });
    const existing = store.findUserByContact(contact);
    if (existing) {
      if (plan === "pro") store.extendPro(existing.id, Number(months) || 1);
      return { ok: true, extended: true, apiKey: existing.apiKey, expiresAt: store.findUserById(existing.id)?.expiresAt };
    }
    const user = store.createUser(contact, (plan as Plan) ?? "free", Number(months) || 1);
    audit({ event: "admin-created", contact, plan });
    return { ok: true, apiKey: user.apiKey, userId: user.id };
  });

  app.post<{ Params: { id: string }; Body: { disabled?: boolean } }>("/v1/admin/users/:id/disable", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(403).send({ code: "FORBIDDEN", message: "admin only" });
    const user = store.findUserById((req.params as { id: string }).id);
    if (!user) return reply.code(404).send({ code: "NOT_FOUND", message: "no such user" });
    store.setDisabled(user.id, Boolean((req.body as { disabled?: boolean }).disabled));
    audit({ event: "admin-disabled", contact: user.contact, disabled: Boolean((req.body as { disabled?: boolean }).disabled) });
    return { ok: true };
  });

  app.post<{ Body: { name?: string; appId?: string; appSecret?: string; ownerContact?: string } }>("/v1/admin/accounts", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(403).send({ code: "FORBIDDEN", message: "admin only" });
    const { name, appId, appSecret, ownerContact } = req.body ?? {};
    if (!name || !appId || !appSecret) {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "name / appId / appSecret required" });
    }
    const owner = ownerContact ? store.findUserByContact(ownerContact) : null;
    if (ownerContact && !owner) return reply.code(400).send({ code: "BAD_REQUEST", message: `unknown owner contact "${ownerContact}"` });
    if (owner) {
      const limit = PLAN_LIMITS[store.isProActive(owner) ? "pro" : "free"].accounts;
      if (store.countAccountsOwnedBy(owner.id) >= limit) {
        return reply.code(400).send({ code: "ACCOUNT_LIMIT", message: `plan limit is ${limit} account(s)` });
      }
    }
    store.upsertAccount({ name, appId, appSecret, ownerUserId: owner?.id ?? null });
    audit({ event: "admin-account-added", name, owner: ownerContact ?? "shared" });
    return { ok: true };
  });

  app.post<{ Params: { id: string } }>("/v1/admin/orders/:id/complete", async (req, reply) => {
    if (!requireAdmin(req)) return reply.code(403).send({ code: "FORBIDDEN", message: "admin only" });
    const done = payments.completeOrder((req.params as { id: string }).id);
    if (!done) return reply.code(404).send({ code: "NOT_FOUND", message: "no such order" });
    return { ok: done.status === "paid", order: done };
  });

  // --- idempotency ------------------------------------------------------------

  const idempotencyFile = path.join(dataDir, "idempotency.json");
  let idempotency: Record<string, { mediaId: string; at: number }> = {};
  try {
    idempotency = JSON.parse(fs.readFileSync(idempotencyFile, "utf-8"));
  } catch {
    /* first run */
  }
  const saveIdempotency = () => fs.writeFileSync(idempotencyFile, JSON.stringify(idempotency), { mode: 0o600 });

  return app;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configIdx = argv.indexOf("--config");
  const configPath = configIdx >= 0 ? argv[configIdx + 1] : undefined;
  const config = loadServerConfig(configPath);
  const app = buildApp(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`publy-server listening on :${config.port} (purchase page: ${config.publicUrl ?? "http://localhost:" + config.port}/ )`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
