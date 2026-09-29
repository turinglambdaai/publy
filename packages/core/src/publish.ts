// Server-side publish: turn a PublishRequest into WeChat API calls.
// Both the self-hosted server and the cloud control plane call into this.

import fs from "node:fs";
import path from "node:path";
import type { Attachment, PublishRequest } from "@publy/shared";
import { ATTACHMENT_SCHEME, PublishResponse } from "@publy/shared";
import { TokenManager, uploadImageMaterial, draftAdd, WechatError } from "./wechat.js";

export interface AccountCredential {
  name: string;
  appId: string;
  appSecret: string;
}

export class PublishError extends Error {
  constructor(public code: string, message: string) {
    super(message);
    this.name = "PublishError";
  }
}

export function credentialFor(accounts: AccountCredential[], ref: string): AccountCredential {
  const hit = accounts.find((a) => a.name === ref || a.appId === ref);
  if (!hit) {
    throw new PublishError("ACCOUNT_NOT_FOUND", `Unknown account "${ref}"`);
  }
  return hit;
}

async function upload(
  token: string,
  att: Attachment,
  filename?: string,
): Promise<{ mediaId: string; url: string }> {
  const buffer = Buffer.from(att.data, "base64");
  if (buffer.length === 0) {
    throw new PublishError("EMPTY_ATTACHMENT", `Attachment ${att.name} is empty`);
  }
  return uploadImageMaterial(token, buffer, filename ?? att.name, att.contentType ?? "image/jpeg");
}

export async function publishToWechat(
  req: PublishRequest,
  cred: AccountCredential,
  tokenManager: TokenManager,
): Promise<PublishResponse> {
  const token = await tokenManager.get(cred.appId, cred.appSecret);
  const byName = new Map((req.images ?? []).map((a) => [a.name, a]));

  if (req.type === "image_post") {
    return publishImagePost(req, cred, token, byName);
  }
  return publishArticle(req, cred, token, byName);
}

async function publishArticle(
  req: PublishRequest,
  cred: AccountCredential,
  token: string,
  byName: Map<string, Attachment>,
): Promise<PublishResponse> {
  let html = req.html ?? "";

  // upload content images, replace attachment:// refs with wechat CDN urls
  const refs = [...html.matchAll(new RegExp(`${ATTACHMENT_SCHEME}([^"']+?)`, "g"))].map((m) => m[1]);
  const unique = [...new Set(refs)];
  const urlByName = new Map<string, string>();
  for (const name of unique) {
    const att = byName.get(name);
    if (!att) throw new PublishError("ATTACHMENT_MISSING", `HTML references unknown attachment "${name}"`);
    const { url } = await upload(token, att);
    urlByName.set(name, url);
  }
  for (const [name, url] of urlByName) {
    html = html.replaceAll(`${ATTACHMENT_SCHEME}${name}`, url);
  }

  // cover: explicit cover attachment, else first uploaded content image's media_id
  let thumbMediaId = "";
  if (req.cover) {
    const att = byName.get(req.cover);
    if (!att) throw new PublishError("ATTACHMENT_MISSING", `Cover attachment "${req.cover}" not found`);
    thumbMediaId = (await upload(token, att, "cover.jpg")).mediaId;
  }
  if (!thumbMediaId) {
    const first = unique[0];
    if (first) {
      const { mediaId } = await upload(token, byName.get(first)!, "cover.jpg");
      thumbMediaId = mediaId;
    }
  }
  if (!thumbMediaId) {
    throw new PublishError("NO_COVER", "Provide a cover or at least one image in the body");
  }

  const mediaId = await draftAdd(token, {
    title: req.title,
    content: html,
    thumb_media_id: thumbMediaId,
    author: req.author ?? "",
    digest: req.digest ?? "",
    content_source_url: req.contentSourceUrl ?? "",
    need_open_comment: req.needOpenComment ? 1 : 0,
    only_fans_can_comment: req.onlyFansCanComment ? 1 : 0,
  });
  return { mediaId };
}

async function publishImagePost(
  req: PublishRequest,
  cred: AccountCredential,
  token: string,
  byName: Map<string, Attachment>,
): Promise<PublishResponse> {
  const images = req.images ?? [];
  if (images.length === 0) {
    throw new PublishError("NO_IMAGES", "image_post requires at least one image");
  }
  const imageList: { image_media_id: string }[] = [];
  for (const att of images) {
    const { mediaId } = await upload(token, att);
    imageList.push({ image_media_id: mediaId });
  }
  const thumbMediaId = req.cover ? (await upload(token, byName.get(req.cover)!, "cover.jpg")).mediaId : imageList[0].image_media_id;

  const mediaId = await draftAdd(token, {
    title: req.title,
    content: req.html ?? "",
    thumb_media_id: thumbMediaId,
    author: req.author ?? "",
    article_type: "newspic",
    image_info: { image_list: imageList },
    need_open_comment: req.needOpenComment ? 1 : 0,
    only_fans_can_comment: req.onlyFansCanComment ? 1 : 0,
  });
  return { mediaId };
}

export { WechatError };
