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
  /** image-post caption (image posts) */
  caption?: string;
  /** image-post hashtags, rendered as #tag in the caption */
  tags?: string[];
  /** image-post card mode: "cards" implies an image post */
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
  // explicit type always wins (escape hatch); mode inference only fills the gap
  const t = (meta.type ?? "").toLowerCase();
  if (t) return t === "image" || t === "image_post" ? "image_post" : "article";
  if ((meta.mode ?? "").toLowerCase() === "cards") return "image_post";
  return "article";
}
