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
  return t === "image" || t === "image_post" ? "image_post" : "article";
}
