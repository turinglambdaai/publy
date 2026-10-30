# Typora → Publy → WeChat drafts

[简体中文](typora.zh-CN.md) · English

**Publy reads your existing Markdown file. You keep writing in Typora.**
There is no Typora plugin, replacement editor, synchronized note library,
Markdown import database, or automatic cloud upload in this workflow.
The only publishing destination is **WeChat Official Account drafts**.

## For a Typora writer

1. **Write and save** your `.md` or `.markdown` file in Typora. Keep images
   alongside the note or in your preferred subfolder.
2. In Typora's **Preferences → Editor → Image Insert**, consider setting
   **Use relative path if possible**. If you select **Copy Image File to Folder**
   for pasted images, Typora may write `typora-copy-images-to` into the
   document YAML; *that tells Typora where to save future pasted images.*
   Publy uses the **actual image references in the file**, and never changes
   Typora's insert behavior.
3. If your images are site-root-relative, set **Format → Image →
   Use Image Root Path** in Typora; it writes `typora-root-url` to YAML.
   Publy resolves this **local filesystem** root and the exact nested path,
   including Windows drive roots where applicable.
4. The currently available **developer-built** Publy CLI can check and preview
   your original file; the future user-facing publishing companion should
   provide a file picker / Open With UI without needing a terminal.

A typical source file stays in place:

```md
---
title: My WeChat draft
cover: images/封面 图片.png
typora-copy-images-to: images
---

# An article written in Typora

![photo](images/封面%20图片.png)
```

The optional `typora-copy-images-to` line is Typora's setting, **not** a
requirement or a Publy-specific instruction. Typora's official image guide
also documents `%uXXXX` escape sequences for Unicode filenames; Publy
recognizes them after decoding without guessing an unrelated image path.

## Developer CLI commands (not a public one-click installer)

```sh
publy check "/path/to/article.md"
publy preview "/path/to/article.md"
publy preview "/path/to/article.md" --no-open --out "review.html"
# An existing review.html is deliberately not overwritten:
publy preview "/path/to/article.md" --no-open --out "review.html" --force
```

**Check and preview do not submit drafts.** The check reports missing,
remote, or undeliverable images and refuses to treat those as publish-ready.
The preview embeds local image bytes; the HTML file therefore contains
private content. By default Publy creates an isolated temporary preview
folder and restricts its permissions. If you specify `--out`, the output
must be HTML, will not overwrite an existing file without `--force`, and
will never write back to your original Markdown document.

Only after you deliberately select a configured WeChat account can the
separate `publish` action submit a draft. **Public sending is not part of
this command.** Server onboarding and a clean user installation still need
real-machine validation.

## Known boundaries

- No Typora toolbar, plugin API, automatic Typora-to-Publy synchronization,
  or editor modification.
- Remote images / embedded data images are not silently uploaded: save them
  locally before draft delivery. Source files are never rewritten by Publy.
- The shared renderer supports ordinary local Markdown, but only Typora and
  Obsidian receive first-class editor-workflow acceptance.
- Real Typora GUI tests, clean Windows/macOS/Linux installation, and real
  WeChat draft verification are still pending. Successful CI is not a
  supported retail release.

References: [Typora: Images](https://support.typora.io/Images/),
[Typora: YAML front matter](https://support.typora.io/YAML/),
[Current scope](platform-strategy.md), [Release readiness](distribution.md).
