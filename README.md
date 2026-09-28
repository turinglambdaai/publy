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

Status: M0 — design finalized, implementation starting. Read the design:

- [docs/design.md](docs/design.md) — product design: positioning, form factor, CLI contract, xiaolvshu pipeline, theme store, architecture
- [docs/business.md](docs/business.md) — open-core boundary, pricing, GTM
- [docs/roadmap.md](docs/roadmap.md) — M0 → M3

## License

AGPL-3.0
