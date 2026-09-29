// Publy self-hosted publishing server (protocol v1).
// Deployed on a machine with a stable egress IP whitelisted in the WeChat MP console.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import type { PublishRequest, PublishResponse } from "@publy/shared";
import { publishToWechat, accountStoreFromArray, MaterialCache, TokenManager, WechatError, PublishError, type AccountStore } from "@publy/core";

export interface ServerAccount {
  name: string;
  appId: string;
  appSecret: string;
}

export interface ServerConfig {
  port: number;
  apiKey: string;
  accounts: ServerAccount[];
  /** dir for the token cache, material cache and audit log (default: beside the config) */
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
    port: raw.port ?? 8082,
    apiKey: raw.apiKey,
    accounts: raw.accounts,
    dataDir: raw.dataDir ?? path.join(path.dirname(file), "server-data"),
  };
}

const IDEMPOTENCY_TTL_MS = 10 * 60 * 1000; // retries of the same publish dedupe for 10 minutes

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
      return result;
    } catch (err) {
      audit({ event: "failed", account: body.account, type: body.type, title: body.title, error: (err as Error).message });
      if (err instanceof PublishError) {
        return reply.code(400).send({ code: err.code, message: err.message });
      }
      if (err instanceof WechatError) {
        return reply.code(502).send({ code: `WECHAT_${err.errcode}`, message: err.message });
      }
      throw err;
    }
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

import { pathToFileURL } from "node:url";

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
