// Minimal WeChat MP API client: access token, permanent image material, draft.
// Only official endpoints; no account simulation.

import fs from "node:fs";
import path from "node:path";

const TOKEN_URL = "https://api.weixin.qq.com/cgi-bin/token";
const ADD_MATERIAL_URL = "https://api.weixin.qq.com/cgi-bin/material/add_material";
const DRAFT_ADD_URL = "https://api.weixin.qq.com/cgi-bin/draft/add";

export class WechatError extends Error {
  constructor(public errcode: number, public errmsg: string) {
    super(`${errcode}: ${errmsg}`);
    this.name = "WechatError";
  }
}

function assertOk(data: any): void {
  if (data && typeof data === "object" && "errcode" in data && data.errcode !== 0) {
    throw new WechatError(data.errcode, data.errmsg ?? "");
  }
}

interface TokenCache {
  [appId: string]: { accessToken: string; expireAt: number };
}

/** File-backed token cache with in-flight dedupe (600 s buffer before expiry). */
export class TokenManager {
  private cache: TokenCache = {};
  private inflight = new Map<string, Promise<string>>();
  private file: string;

  constructor(cacheDir: string) {
    fs.mkdirSync(cacheDir, { recursive: true });
    this.file = path.join(cacheDir, "token.json");
    try {
      this.cache = JSON.parse(fs.readFileSync(this.file, "utf-8"));
    } catch {
      /* first run */
    }
  }

  private save(): void {
    fs.writeFileSync(this.file, JSON.stringify(this.cache, null, 2), { mode: 0o600 });
  }

  async get(appId: string, appSecret: string): Promise<string> {
    const now = Date.now() / 1000;
    const hit = this.cache[appId];
    if (hit && hit.expireAt > now + 600) return hit.accessToken;

    const pending = this.inflight.get(appId);
    if (pending) return pending;

    const p = (async () => {
      const url = `${TOKEN_URL}?grant_type=client_credential&appid=${encodeURIComponent(appId)}&secret=${encodeURIComponent(appSecret)}`;
      const res = await fetch(url);
      const data = await res.json() as any;
      assertOk(data);
      this.cache[appId] = {
        accessToken: data.access_token,
        expireAt: now + (data.expires_in ?? 7200),
      };
      this.save();
      return data.access_token as string;
    })().finally(() => this.inflight.delete(appId));

    this.inflight.set(appId, p);
    return p;
  }
}

export async function uploadImageMaterial(
  accessToken: string,
  buffer: Buffer,
  filename: string,
  contentType: string,
): Promise<{ mediaId: string; url: string }> {
  const form = new FormData();
  const blob = new Blob([new Uint8Array(buffer)], { type: contentType });
  form.append("media", blob, filename);
  const res = await fetch(`${ADD_MATERIAL_URL}?access_token=${encodeURIComponent(accessToken)}&type=image`, {
    method: "POST",
    body: form,
  });
  const data = await res.json() as any;
  assertOk(data);
  const url: string = (data.url ?? "").replace(/^http:\/\//i, "https://");
  return { mediaId: data.media_id, url };
}

export async function draftAdd(accessToken: string, article: Record<string, unknown>): Promise<string> {
  const res = await fetch(`${DRAFT_ADD_URL}?access_token=${encodeURIComponent(accessToken)}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ articles: [article] }),
  });
  const data = await res.json() as any;
  assertOk(data);
  if (!data.media_id) throw new Error(`draft/add returned no media_id: ${JSON.stringify(data)}`);
  return data.media_id as string;
}
