# Publy

Agent-era publishing pipeline for WeChat Official Accounts: one CLI for Markdown typesetting & xiaolvshu (image-post) card rendering, one hosted service for reliable publishing, one theme store.

![license](https://img.shields.io/badge/license-AGPL--3.0-blue)
![status](https://img.shields.io/badge/status-M0%20design-orange)

**English** · [中文](README.zh-CN.md)

- **Write in Obsidian or any Markdown editor. Your agent ships it.** `publy publish a.md` — no GUI, no copy-paste into the WeChat web editor.
- **Xiaolvshu as a first-class citizen.** `publy card post.md` renders themed 3:4 card PNGs deterministically — pixel-perfect Chinese text, seconds per deck, no AI image generation.
- **Theme store without the friction.** Themes are npm packages with rendered previews; `publy theme add` installs, `publy theme preview` shows before you commit.
- **Open core, no lock-in.** The CLI and a self-hostable server are open source (AGPL-3.0) and speak the same protocol as the hosted cloud. The cloud sells reliability: stable egress IP for the WeChat API whitelist, AppSecret custody, token lifecycle, scheduling, multi-account.

Compliance: Publy only uses official WeChat MP APIs. No account simulation, no browser automation.

Status: pipeline implemented and dogfooding — articles and xiaolvshu cards publish through it daily.

## Quick start

```bash
publy config set server http://your-server:8081
publy config set api_key <key>
publy account add me --app-id wx... --theme claude
publy preview article.md     # see it before you ship it
publy publish article.md     # typeset draft lands in the WeChat backend
```

Xiaolvshu: write sections (`## cover` / `## point` / `## list` / `## ending`) with `mode: cards` in frontmatter, run `publy card post.md --preview`, then `publy publish post.md`.

Full manual: [docs/guide.md](docs/guide.md) · Theme gallery: [jrtx.site/publy-themes](http://jrtx.site/publy-themes/)

## License

AGPL-3.0
