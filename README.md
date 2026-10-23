# Publy

Agent-era publishing pipeline for WeChat Official Accounts: one CLI for Markdown typesetting & image-post card rendering, one self-hosted service for draft delivery, one theme store.

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE) ![status](https://img.shields.io/badge/status-pipeline%20implemented-blue)

**English** · [中文](README.zh-CN.md)

- **Write in Obsidian or any Markdown editor. Your agent ships it.** `publy publish a.md` — no GUI, no copy-paste into the WeChat web editor.
- **The Obsidian plugin (this repo's `manifest.json`) renders and publishes the current note in place**: in-app article preview, image-post card deck preview, rich-text copy, publish progress — no browser needed.
- **Image posts as a first-class citizen.** `publy card post.md` renders themed 3:4 card PNGs deterministically — pixel-perfect Chinese text, seconds per deck, no AI image generation.
- **Theme store without the friction.** Themes are npm packages with rendered previews; `publy theme add` installs, `publy theme preview` shows before you commit.
- **Open core, no lock-in.** The CLI and a self-hostable server are open source (AGPL-3.0) and speak the same protocol as the hosted cloud. The future hosted service would provide: stable egress IP for the WeChat API whitelist, AppSecret custody, token lifecycle, scheduling, multi-account.

Compliance: Publy only uses official WeChat MP APIs. No account simulation, no browser automation.

Status: local rendering and delivery components exist; public hosted onboarding and commercial operation are not open.

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
