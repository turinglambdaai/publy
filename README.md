# Publy

Editor-independent Markdown-to-WeChat draft publishing: local rendering and preflight, an Obsidian integration, and a self-hosted delivery service. Hosted subscriptions and a universal installer are not yet available.

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE) ![status](https://img.shields.io/badge/status-pipeline%20implemented-blue)

**English** · [中文](README.zh-CN.md)

- **Keep writing in Typora, Obsidian, VS Code, Zettlr, MarkText or any file-based Markdown editor.** Use the same source file; `publy check a.md` reports missing images before any draft is sent. The current CLI remains a developer source build.
- **The Obsidian plugin renders and delivers the current note to WeChat drafts in place**: in-app article preview, image-post card deck preview, rich-text copy, publish progress — no browser needed.
- **Image posts as a first-class citizen.** `publy card post.md` renders themed 3:4 card PNGs deterministically — pixel-perfect Chinese text, seconds per deck, no AI image generation.
- **Preview themes without installing registry packages.** Built-in themes and `publy theme preview` work in development; a signed/versioned standalone theme bundle flow is tracked separately in #21 and is not available yet.
- **Open core, no lock-in.** The CLI and a self-hostable server are open source (AGPL-3.0) and speak the same protocol as the hosted cloud. The future hosted service would provide: stable egress IP for the WeChat API whitelist, AppSecret custody, token lifecycle, scheduling, multi-account.

Compliance: Publy only uses official WeChat MP APIs. No account simulation, no browser automation.

Status: local rendering and delivery components exist; public hosted onboarding and commercial operation are not open. **Obsidian community-directory publication has not been verified**; the source plugin version and latest published GitHub Release differ. See [directory release readiness](docs/obsidian-submission.md) and [official-install blocker](https://github.com/turlamai/publy/issues/12).

**One document, many writing tools:** [English workflow and acceptance criteria](docs/editor-workflows.md) · [中文](docs/editor-workflows.zh-CN.md). No proprietary editor plugin is needed to consume a saved Markdown file; independent editor integrations still need clean-machine acceptance.

## Start here

CLI, default themes, Obsidian and self-hosting remain free under their existing licences. Public hosted subscriptions are not open; there is no unlimited plan for sale. CLI and Obsidian workflows; this is not a Rivet/Glaze desktop application. Published release assets currently include the Obsidian plugin. A server needs stable outbound IP and the account’s actual official API permissions.

[Installation, first use, privacy, backup and recovery](docs/USER-GUIDE.md) · [简体中文](docs/USER-GUIDE.zh-CN.md)

## Quick start

```bash
publy config set server https://your-server.example
publy config set api_key <key>
publy account add me --app-id wx... --theme claude
publy preview article.md     # see it before you ship it
publy publish article.md     # typeset draft lands in the WeChat backend
```

Image-post: write sections (`## cover` / `## point` / `## list` / `## ending`) with `mode: cards` in frontmatter, run `publy card post.md --preview`, then `publy publish post.md`.

Full manual: [English manual](docs/guide.md) · [中文手册](docs/guide.zh-CN.md) · Theme gallery: [themes.publy.jrtx.site](https://themes.publy.jrtx.site/)

## License

AGPL-3.0
