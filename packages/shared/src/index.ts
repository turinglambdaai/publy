// Publy wire protocol v1 — shared by CLI, Obsidian plugin, server, and cloud.

export type PublishType = "article" | "image_post";

export interface Attachment {
  /** name used for references from html/cover, e.g. "screenshot.png" */
  name: string;
  /** base64-encoded file content */
  data: string;
  /** content-type, e.g. image/png; server derives from extension when omitted */
  contentType?: string;
}

export interface PublishRequest {
  /** account name or app_id, resolved server-side against its account store */
  account: string;
  type: PublishType;
  title: string;
  /** inline-styled html body; img src may reference attachments via attachment://<name> */
  html?: string;
  /** images uploaded to wechat in order; first item is the cover for image_post */
  images?: Attachment[];
  /** attachment name used as the article cover (thumb_media_id source) */
  cover?: string;
  author?: string;
  digest?: string;
  contentSourceUrl?: string;
  needOpenComment?: boolean;
  onlyFansCanComment?: boolean;
  /** ISO datetime; when set the server queues the publish instead of running it now */
  publishAt?: string;
  /** client-generated key; server dedupes retries */
  idempotencyKey?: string;
}

export interface JobInfo {
  id: string;
  runAt: string;
  status: "pending" | "running" | "done" | "failed" | "cancelled";
  attempts: number;
  account: string;
  type: string;
  title: string;
  error?: string;
  mediaId?: string;
}

export interface PublishResponse {
  mediaId: string;
  /** which cover the draft ended up with: explicit cover, first body image, or generated title card */
  coverSource?: "cover" | "first-image" | "auto";
}

export interface ErrorResponse {
  code: string;
  message: string;
}

/** marker scheme placed in rendered html before server-side upload */
export const ATTACHMENT_SCHEME = "attachment://";
