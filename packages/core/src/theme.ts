// Theme loading. Built-in themes ship as CSS files scoped under #publy.
// CSS variables are resolved to literal values because the WeChat editor
// strips <style> blocks and does not support var().

import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const pkgDir = path.dirname(fileURLToPath(import.meta.url));

export interface Theme {
  id: string;
  css: string;
}

export const BUILTIN_THEMES = ["claude", "medium"] as const;

function resolveVars(css: string): string {
  // strip comments first: a trailing comment line would otherwise swallow the
  // first variable that follows it (bit both claude and medium backgrounds)
  const vars = new Map<string, string>();
  const clean = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const rootMatch = clean.match(/:root\s*{([^}]*)}/);
  if (rootMatch) {
    for (const line of rootMatch[1].split(";")) {
      const m = line.trim().match(/^(--[\w-]+)\s*:\s*(.+)$/);
      if (m) vars.set(m[1], m[2].trim());
    }
  }
  let out = css;
  // resolve simple var(--x) references (no fallback syntax needed by builtin themes)
  for (const [name, value] of vars) {
    out = out.replaceAll(`var(${name})`, value);
  }
  // drop the :root block entirely
  out = out.replace(/:root\s*{[^}]*}\s*/g, "");
  return out;
}

export function loadTheme(id: string): Theme {
  const themesDir = path.resolve(pkgDir, "../themes");
  const file = path.join(themesDir, `${id}.css`);
  if (!fs.existsSync(file)) {
    throw new Error(`Unknown theme "${id}". Built-in themes: ${BUILTIN_THEMES.join(", ")}`);
  }
  return { id, css: resolveVars(fs.readFileSync(file, "utf-8")) };
}

/** Load a user-supplied CSS file as a one-off theme (same variable resolution). */
export function loadThemeFromCss(cssFile: string): Theme {
  return { id: "custom", css: resolveVars(fs.readFileSync(cssFile, "utf-8")) };
}

/** highlight.js theme css, with the base .hljs block background removed so the
 *  article theme's code block styling stays authoritative. */
export function loadHighlightCss(id: string): string {
  const hljsRoot = path.dirname(require.resolve("highlight.js/package.json"));
  const cssPath = path.join(hljsRoot, "styles", `${id}.css`);
  if (!fs.existsSync(cssPath)) {
    const available = fs
      .readdirSync(path.join(hljsRoot, "styles"))
      .filter((f) => f.endsWith(".css") && !f.includes(".min."))
      .map((f) => f.replace(/\.css$/, ""));
    throw new Error(`Unknown highlight theme "${id}". Available: ${available.join(", ")}`);
  }
  let css = fs.readFileSync(cssPath, "utf-8");
  css = css.replace(/(^|\n)\s*\.hljs\s*\{[^}]*\}/g, "$1");
  return css;
}
