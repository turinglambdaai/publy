# Publy CLI and self-hosting manual

**English** · [简体中文](guide.zh-CN.md)

Publy renders Markdown locally and delivers article drafts or image-post cards through a server to official WeChat APIs. A successful draft delivery is not a public post or mass-send. Available APIs depend on your actual account permissions.

Public hosted registration and payment are **not open**. Start with local rendering and your own server; do not send credentials to an old hosted URL. The server disables the historical `/purchase`, `/order/:id`, `/lookup` and `/pay/xunhupay/notify` routes by default (`CHECKOUT_NOT_AVAILABLE`). An explicit `payments.enableLegacyCheckout: true` with `payments.provider: "manual"` is reserved for isolated owner-controlled tests and is **not** permission to operate public billing. Missing Alipay/XunhuPay configuration never silently falls back to manual selling. Hosted checkout must move to Commerce/Permit and pass the merchant admission and authorization gates in [#17](https://github.com/turlamai/publy/issues/17). See the [user guide](USER-GUIDE.md) for availability, privacy and recovery limits.

## Install from source

Use Node.js 22+ and pnpm, as declared by the repository:

```sh
git clone https://github.com/turlamai/publy.git
cd publy
pnpm install --frozen-lockfile
pnpm -r build
node packages/cli/dist/index.js --help
```

The commands below use `publy` for that CLI entry. If a published package is available for the version you selected, `npm i -g @turinglambdaai/publy` provides the command; inspect its version rather than assuming a website badge identifies the installed release.

## Preview before delivery

```sh
publy preview article.md
publy render article.md -o out.html
publy theme ls
publy theme preview claude
```

Keep source Markdown and media. `preview` opens the local result; `render` writes HTML. Themes may be installed packages, so review their provenance before using them with private material.

Article frontmatter supports `title`, `cover`, `theme`, `author` and `digest`. A cover can come from frontmatter, `--cover` or the first image; missing required media is an error. Account defaults can be overridden with the documented command flags; `publy --help` and subcommand help remain the exact flag reference.

## Image cards

Use `mode: cards`, a caption, and 3–9 sections containing a cover, content and ending. Preview the resulting deck before delivery:

```markdown
---
title: A test deck
mode: cards
theme: naive
caption: A non-sensitive test
---
## cover
A test deck
## point
One useful idea
Check the rendered result before sending.
## ending
Thanks for reading
```

```sh
publy card post.md --preview
```

Card validation can refuse an invalid count or caption length. Standard image posts use `type: image`; review the Chinese manual and command help for the full input contract. Rendering does not imply the account can publish every WeChat message type.

## Configure your server

The delivery server needs a stable outbound IP whitelisted for the intended account. First prove a single-account private pilot; follow [operations](operations.md) for its actual state and backup layout. Do not expose an unauthenticated listener to the public internet.

A legacy static configuration has this shape, referenced by `PUBLY_SERVER_CONFIG`:

```json
{
  "port": 8081,
  "apiKey": "<random-server-api-key>",
  "accounts": [{"name": "test", "appId": "wx...", "appSecret": "<server-only-secret>"}]
}
```

This example stores a secret in a restricted file; it does not provide encryption at rest. Never commit a real file. Managed binding/database paths may handle secrets differently and must be checked against the selected implementation. Reload the server using your process manager after a configuration change.

For a source build the server entry is `packages/server/dist/index.js`. Use a service manager and authenticated HTTPS or a private tunnel for remote access. A localhost-only test can use HTTP without transmitting secrets over a public network.

## Configure the client and deliver one draft

```sh
publy config set server https://your-server.example
publy config set api_key <random-server-api-key>
publy account add test --app-id wx... --theme claude
publy account list
publy publish article.md --account test
publy history
```

Client configuration is stored under `~/.publy/config.json`; it contains the server API key. `media_dirs` configures local attachment lookup. Keep credentials out of screenshots and logs. Never send AppSecret through an issue or place it in a URL.

Confirm the returned outcome in WeChat’s draft backend. On a network failure the outcome is unknown, not failed: query the original request identity with `publy publish-result <key>` (the failed command prints it), then retry the same request — the server reconciles against its idempotency record instead of duplicating. Interrupted scheduled jobs never auto-rerun after a restart; re-admit them with `publy jobs retry <id>`. The source has token caching, media deduplication, bounded duplicate handling and queued jobs, but their existence is not a qualified guarantee of exactly-once delivery or crash recovery. Scheduling via `--at` needs a running, recovered server and its actual timezone/queue semantics checked first.

## Obsidian

Install the plugin assets from the release you selected, configure the same authenticated server and preview one disposable note. The plugin supports article/card preview, rich-text copying and delivery. Source notes remain in your vault; server-side copies, metadata and retry state follow the selected deployment’s storage behavior.

## Troubleshooting

- Authentication failure: verify server address and key without posting either publicly.
- WeChat IP error: confirm the server’s actual outbound IP and the account whitelist, not its browser-facing domain alone.
- WeChat credential error: check AppID/AppSecret on the server and rotate exposed secrets at WeChat.
- Unknown delivery outcome: inspect remote drafts and history before retrying; preserve redacted error codes.
- Missing images/fonts: preview locally, check media paths and build dependencies before contacting a server.

## Recovery and support

Back up source/media separately from server configuration, SQLite state, history, jobs and decryption material. Do not copy an active SQLite file unsafely; use a consistent snapshot or stop the writer. Restore to an isolated server and verify old credentials/jobs before reconnecting external delivery. See [operations](operations.md), [privacy status](privacy.md), [service status](terms.md), and [support](USER-GUIDE.md#get-help).
