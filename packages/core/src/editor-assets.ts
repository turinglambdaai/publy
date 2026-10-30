// Resolve image/cover paths from any file-based Markdown editor, without
// modifying the user's source or guessing based on a shared basename.
// Obsidian ![[embeds]] have a separate vault lookup in obsidian.ts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAsset } from "./obsidian.js";

export interface EditorAssetOptions {
  baseDir: string;
  mediaDirs?: string[];
  /** Typora's optional YAML typora-root-url, e.g. /path/to/project. */
  typoraRootUrl?: string;
}

function existingFile(candidate: string): string | null {
  try {
    return fs.statSync(candidate).isFile() ? candidate : null;
  } catch {
    return null;
  }
}

/**
 * Standard Markdown paths are relative to the source document first. This
 * preserves namespaced assets like assets/a/logo.png vs assets/b/logo.png.
 *
 * For Typora's /assets/image.png with a local typora-root-url, that explicit
 * root takes precedence over OS-absolute paths. We do not download remote
 * assets or silently replace missing nested paths with same-name files.
 */
export function resolveEditorAsset(reference: string, opts: EditorAssetOptions): string | null {
  let source: string;
  try {
    source = decodeURIComponent(reference.trim());
  } catch {
    return null;
  }
  if (!source || /^(?:https?:|data:|attachment:)/i.test(source)) return null;

  if (/^file:\/\//i.test(source)) {
    try {
      return existingFile(fileURLToPath(source));
    } catch {
      return null;
    }
  }

  if (source.startsWith("/") && typeof opts.typoraRootUrl === "string") {
    let root = opts.typoraRootUrl.trim();
    if (/^file:\/\//i.test(root)) {
      try { root = fileURLToPath(root); } catch { root = ""; }
    }
    // A Typora root must refer to a local filesystem path. Never fetch HTTP
    // URLs or allow a remote URL to influence local file resolution.
    if (root && !/^[a-z][a-z0-9+.-]*:/i.test(root)) {
      const rootDir = path.resolve(opts.baseDir, root);
      const relative = source.replace(/^\/+/, "");
      const target = path.resolve(rootDir, relative);
      // Treat this as a rooted namespace, not arbitrary path traversal.
      if (target.startsWith(rootDir + path.sep) || target === rootDir) {
        const file = existingFile(target);
        if (file) return file;
      }
    }
  }

  if (path.isAbsolute(source)) return existingFile(source);

  const searchDirs = [opts.baseDir, ...(opts.mediaDirs ?? [])];
  for (const dir of searchDirs) {
    const file = existingFile(path.resolve(dir, source));
    if (file) return file;
  }
  // Bare basenames remain compatible with old Obsidian/media-dir layouts.
  // Explicit nested paths should NEVER resolve to a different same-name file.
  if (path.basename(source) === source) {
    return resolveAsset(source, searchDirs);
  }
  return null;
}
