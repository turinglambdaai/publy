// Publy self-hosted publishing server (protocol v1).
// Deployed on a machine with a stable egress IP whitelisted in the WeChat MP console.

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Fastify from "fastify";
import type { PublishRequest } from "@publy/shared";
import { publishToWechat, credentialFor, TokenManager, WechatError, PublishError } from "@publy/core";

export interface ServerAccount {
  name: string;
  appId: string;
  appSecret: string;
}

export interface ServerConfig {
  port: number;
  apiKey: string;
  accounts: ServerAccount[];
  /** dir for the access-token cache */
  cacheDir?: string;
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
    cacheDir: raw.cacheDir,
  };
}

export function buildApp(config: ServerConfig) {
  const app = Fastify({ bodyLimit: 30 * 1024 * 1024 });
  const tokens = new TokenManager(config.cacheDir ?? path.join(path.dirname(process.env.PUBLY_SERVER_CONFIG ?? DEFAULT_CONFIG_PATH), "server-cache"));

  app.addHook("onRequest", async (req, reply) => {
    if (req.url === "/health") return;
    const key = req.headers["x-api-key"];
    if (!config.apiKey || key !== config.apiKey) {
      await reply.code(401).send({ code: "UNAUTHORIZED", message: "Invalid API key" });
    }
  });

  app.get("/health", async () => ({ status: "ok", service: "publy-server", protocol: "v1" }));

  app.get("/verify", async () => ({ ok: true, accounts: config.accounts.map((a) => a.name) }));

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
    try {
      const cred = credentialFor(config.accounts, body.account);
      const result = await publishToWechat(body, cred, tokens);
      return result;
    } catch (err) {
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

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1].replace(/\\/g, "/")}`).href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
