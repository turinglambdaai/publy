# Publy for Obsidian

Client A of the [Publy](https://github.com/turinglambdaai/publy) publishing pipeline: write in Obsidian, publish to WeChat Official Accounts through your own Publy server — no GUI, no copy-pasting into the WeChat backend.

## Features

- **Publish current note** — Markdown in, a typeset draft in the WeChat backend out (official API only, no account simulation)
- **Preview rendered HTML** — the theme-rendered article, opened in the browser; what you see is what ships
- **Preview image-post card deck** — sectioned notes () render into themed 3:4 card PNGs deterministically (bundled font subsets, works offline)

## Setup

1. Install and run a [Publy server](https://github.com/turinglambdaai/publy) (or use your provider's instance)
2. Settings → Publy: Server URL, API key, Account name
3. Publish

## Notes

- Desktop only (uses Node fs for local assets)
- Rendering happens on your machine; only the final draft upload leaves it
- Source lives in  of the monorepo; this folder is the plugin
