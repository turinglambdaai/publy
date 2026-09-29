// Frontmatter parsing for publy markdown sources.

import matter from "gray-matter";

export interface SourceMeta {
  title?: string;
  cover?: string;
  /** "article" (default) | "image" | "image_post" */
  type?: string;
  theme?: string;
  author?: string;
  digest?: string;
  /** xiaolvshu caption (image posts) */
  caption?: string;
  /** xiaolvshu hashtags, rendered as #tag in the caption */
  tags?: string[];
  /** xiaolvshu card mode: "cards" implies an image post */
  mode?: string;
}

export interface ParsedSource {
  meta: SourceMeta;
  body: string;
}

export function parseSource(raw: string): ParsedSource {
  const { data, content } = matter(raw);
  return { meta: data as SourceMeta, body: content };
}

export function publishType(meta: SourceMeta): "article" | "image_post" {
  const t = (meta.type ?? "").toLowerCase();
  if (t === "image" || t === "image_post") return "image_post";
  // cards mode is inherently a xiaolvshu image post even without an explicit type
  if ((meta.mode ?? "").toLowerCase() === "cards") return "image_post";
  return "article";
}
