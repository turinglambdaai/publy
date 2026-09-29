// Publy self-hosted publishing server (protocol v1).
// Deployed on a machine with a stable egress IP whitelisted in the WeChat MP console.
// Features: immediate + scheduled publishing, idempotency, audit log, webhooks.

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import Fastify from "fastify";
import type { JobInfo, PublishRequest, PublishResponse } from "@publy/shared";
import { publishToWechat, accountStoreFromArray, MaterialCache, TokenManager, WechatError, PublishError, type AccountStore, type AccountCredential } from "@publy/core";

export interface ServerAccount {
  name: string;
  appId: string;
  appSecret: string;
  /** optional URL notified of publish results for this account */
  webhook?: string;
}

export interface ServerConfig {
  port: number;
  apiKey: string;
  accounts: ServerAccount[];
  /** dir for token cache, material cache, audit log and jobs (default: beside the config) */
  dataDir?: string;
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
  };
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // retries of the same publish dedupe for 10 minutes
const JOB_MAX_ATTEMPTS = 3;
const JOB_RETRY_DELAY_MS = 5 * 60 * 1000;

interface StoredJob {
  id: string;
  runAt: number; // epoch ms
  body: PublishRequest;
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

export function buildApp(config: ServerConfig) {
  const app = Fastify({ bodyLimit: 30 * 1024 * 1024 });
  const dataDir = config.dataDir ?? path.join(os.homedir(), ".publy", "server-data");
  fs.mkdirSync(dataDir, { recursive: true });

  const accounts: AccountStore = accountStoreFromArray(config.accounts);
  const tokens = new TokenManager(dataDir);
  const materials = new MaterialCache(dataDir);

  // idempotency store: key → { mediaId, at }; survives restarts
  const idempotencyFile = path.join(dataDir, "idempotency.json");
  let idempotency: Record<string, { mediaId: string; at: number }> = {};
  try {
    idempotency = JSON.parse(fs.readFileSync(idempotencyFile, "utf-8"));
  } catch {
    /* first run */
  }
  const saveIdempotency = () => fs.writeFileSync(idempotencyFile, JSON.stringify(idempotency), { mode: 0o600 });

  // audit log: one JSON line per publish attempt
  const historyFile = path.join(dataDir, "history.jsonl");
  const audit = (entry: Record<string, unknown>) => {
    fs.appendFileSync(historyFile, JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  };
  const readHistory = (limit: number) => {
    try {
      const lines = fs.readFileSync(historyFile, "utf-8").trim().split("\n");
      return lines.slice(-limit).map((l) => JSON.parse(l));
    } catch {
      return [];
    }
  };

  // webhook: fire-and-forget POST, never blocks the response
  const notifyWebhook = (accountName: string, event: string, extra: Record<string, unknown>) => {
    const hook = config.accounts.find((a) => a.name === accountName)?.webhook;
    if (!hook) return;
    fetch(hook, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ event, account: accountName, ts: new Date().toISOString(), ...extra }),
      signal: AbortSignal.timeout(5000),
    }).catch(() => {
      /* best effort */
    });
  };

  // --- scheduled jobs -------------------------------------------------------

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
    const cred: AccountCredential | undefined = accounts.resolve(body.account);
    try {
      if (!cred) throw new PublishError("ACCOUNT_NOT_FOUND", `Unknown account "${body.account}"`);
      const result = await publishToWechat(body, cred, tokens, materials);
      job.status = "done";
      job.result = result;
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
      const now = Date.now();
      for (const job of Object.values(jobs)) {
        if (job.status === "pending" && job.nextAttemptAt <= now) {
          void runJob(job);
        }
      }
    },
    30_000,
  );
  scheduler.unref();

  // --- routes ---------------------------------------------------------------

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const key = req.headers["x-api-key"];
    if (!config.apiKey || key !== config.apiKey) {
      await reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid API key" });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "publy-server", protocol: "v1" }));

  app.get("/verify", async () => ({ ok: true, accounts: accounts.list() }));

  app.post<{ Body: PublishRequest }>("/v1/publish", async (req, reply) => {
    const body = req.body;
    if (!body || typeof body !== "object") {
      return reply.code(400).send({ code: "BAD_REQUEST", message: "JSON body required" });
    }
    if (!body.account) return reply.code(400).send({ code: "BAD_REQUEST", message: '"account" is required' });
    if (!body.title) return reply.code(400).send({ code: "BAD_REQUEST", message: '"title" is required' });
    if (body.type !== "article" && body.type !== "image_post") {
      return reply.code(400).send({ code: "BAD_REQUEST", message: '"type" must be "article" or "image_post"' });
    }

    // scheduled publish: store a job, return its handle
    if (body.publishAt) {
      const runAt = new Date(body.publishAt).getTime();
      if (Number.isNaN(runAt) || runAt < Date.now() - 60_000) {
        return reply.code(400).send({ code: "BAD_REQUEST", message: `invalid publishAt "${body.publishAt}"` });
      }
      const id = crypto.randomUUID();
      jobs[id] = { id, runAt, body, status: "pending", attempts: 0, nextAttemptAt: runAt };
      saveJobs();
      audit({ event: "scheduled", account: body.account, type: body.type, title: body.title, runAt: new Date(runAt).toISOString(), jobId: id });
      return { jobId: id, runAt: new Date(runAt).toISOString(), scheduled: true };
    }

    const key = body.idempotencyKey;
    if (key) {
      const hit = idempotency[key];
      if (hit && Date.now() - hit.at < IDEMPOTENCY_TTL_MS) {
        audit({ event: "deduped", key, account: body.account, title: body.title });
        return { mediaId: hit.mediaId, deduped: true };
      }
    }

    try {
      const cred = accounts.resolve(body.account);
      if (!cred) {
        return reply.code(400).send({ code: "ACCOUNT_NOT_FOUND", message: `Unknown account "${body.account}"` });
      }
      const result: PublishResponse = await publishToWechat(body, cred, tokens, materials);
      if (key) {
        idempotency[key] = { mediaId: result.mediaId, at: Date.now() };
        saveIdempotency();
      }
      audit({ event: "published", account: body.account, type: body.type, title: body.title, mediaId: result.mediaId, key });
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
    const limit = Math.min(Math.max(parseInt(req.query.limit ?? "50", 10) || 50, 1), 500);
    return { history: readHistory(limit) };
  });

  app.get("/v1/jobs", async () => ({
    jobs: Object.values(jobs)
      .sort((a, b) => a.runAt - b.runAt)
      .map(jobInfo),
  }));

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

  return app;
}

export async function main(argv: string[] = process.argv.slice(2)): Promise<void> {
  const configIdx = argv.indexOf("--config");
  const configPath = configIdx >= 0 ? argv[configIdx + 1] : undefined;
  const config = loadServerConfig(configPath);
  const app = buildApp(config);
  await app.listen({ port: config.port, host: "0.0.0.0" });
  console.log(`publy-server listening on :${config.port}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
