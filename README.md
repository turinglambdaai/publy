# Publy

Agent-era publishing pipeline for WeChat Official Accounts: one CLI for Markdown typesetting & image-post card rendering, one hosted service for reliable publishing, one theme store.

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE) ![status](https://img.shields.io/badge/status-pipeline%20implemented-blue)

**English** · [中文](README.zh-CN.md)

- **Write in Obsidian or any Markdown editor. Your agent ships it.** `publy publish a.md` — no GUI, no copy-paste into the WeChat web editor.
- **The Obsidian plugin (this repo's `manifest.json`) renders and publishes the current note in place**: in-app article preview, image-post card deck preview, rich-text copy, publish progress — no browser needed.
- **Image posts as a first-class citizen.** `publy card post.md` renders themed 3:4 card PNGs deterministically — pixel-perfect Chinese text, seconds per deck, no AI image generation.
- **Theme store without the friction.** Themes are npm packages with rendered previews; `publy theme add` installs, `publy theme preview` shows before you commit.
- **Open core, no lock-in.** The CLI and a self-hostable server are open source (AGPL-3.0) and speak the same protocol as the hosted cloud. The cloud sells reliability: stable egress IP for the WeChat API whitelist, AppSecret custody, token lifecycle, scheduling, multi-account.

Compliance: Publy only uses official WeChat MP APIs. No account simulation, no browser automation.

Status: pipeline implemented and dogfooding — articles and image-post cards publish through it daily.

## Quick start

```bash
publy config set server http://your-server:8081
publy config set api_key <key>
publy account add me --app-id wx... --theme claude
publy preview article.md     # see it before you ship it
publy publish article.md     # typeset draft lands in the WeChat backend
```

Image-post: write sections (`## cover` / `## point` / `## list` / `## ending`) with `mode: cards` in frontmatter, run `publy card post.md --preview`, then `publy publish post.md`.

Full manual: [docs/guide.md](docs/guide.md) · Theme gallery: [themes.publy.jrtx.site](https://themes.publy.jrtx.site/)

## License

AGPL-3.0

## Feedback and diagnostics

Report reproducible bugs and feature requests through [GitHub Issues](https://github.com/turinglambdaai/publy/issues). Include the release, OS/architecture and steps; inspect and redact diagnostics before sharing. Do not post API keys, license files, vault contents or private documents. For sensitive security reports, follow SECURITY.md when present; otherwise request a private contact route without disclosing sensitive details. Nothing is uploaded automatically.

## Product & pricing

免费 CLI/自托管 + 发布托管订阅. Launch design, not a live offer: see [PRICING.md](PRICING.md) for prices, boundaries and release gates. Current development builds do not gain payment restrictions from this documentation change.
