// Shared publication safety rules for the CLI and Obsidian plugin.
// The renderer describes media problems; each client must enforce the
// *same* fail-closed contract before sending a WeChat draft.
export function blockingMediaWarning(warning: string): boolean {
  return /^(?:Assets not found:|Image not found:|Cover not found:|SVG conversion failed|Math not rendered|Remote image not uploaded:|Embedded data image not uploaded:)/i.test(warning);
}
