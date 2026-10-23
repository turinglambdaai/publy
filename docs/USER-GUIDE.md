# Publy user guide

**English** · [简体中文](USER-GUIDE.zh-CN.md)

Turn Markdown into WeChat article drafts and image-post cards, with local preview and a self-hosted delivery server.

## Availability

CLI, default themes, Obsidian and self-hosting remain free under their existing licences. Public hosted subscriptions are not open; there is no unlimited plan for sale.

## Platforms and installation

CLI and Obsidian workflows; this is not a Rivet/Glaze desktop application. Published release assets currently include the Obsidian plugin. A server needs stable outbound IP and the account’s actual official API permissions.

See the [README](../README.md) for source installation and execution; release assets do not constitute a deployed service.

## Your first successful session

1. Install from the source instructions and preview a non-sensitive Markdown article locally before configuring delivery.
2. Configure your own server and account, whitelist its actual outbound IP, and keep AppSecret on that server. Use HTTPS or a private tunnel for access.
3. Publish one test draft and confirm its result in the WeChat backend. A delivered draft is not a publicly published or mass-sent article.

## Data, backup and recovery

Keep source Markdown and media locally. Back up server configuration, databases, job history and encryption material together using restricted, encrypted storage. Restore and test on an isolated server; do not replay an unknown-outcome job before checking remote draft/history state.

## Network, keys and privacy

Rendering can run locally. Delivery sends content/media and account credentials or derived tokens through your chosen server to official WeChat APIs. Server logs, retry history and storage must be reviewed; “nothing is stored” is not a valid blanket promise. Never share API keys in URLs or screenshots.

## Known limits

Public hosted registration, payment, tenant isolation, retention/deletion and reliable job recovery are not yet qualified (#7, #8). Do not send AppSecret to an unannounced hosted endpoint or an issue.

## Upgrading and stopping use

Back up configuration/data and identify the source and dependency versions. Validate in isolation before replacing the version in use. Stop the process before removing local data; content and credentials at external services must be managed or revoked there separately.

## Get help

Report problems in [GitHub Issues](https://github.com/turinglambdaai/publy/issues), in English or Chinese. Include the version, OS/architecture, installation channel, steps, expected result and actual result. Reproduce with synthetic input first; do not attach keys, credentials, databases, private source documents or complete logs. Public support has no guaranteed response time.

## Further reading

- [CLI and self-hosting manual](../docs/guide.md)
- [Operations](../docs/operations.md)
- [Project overview and development](../README.md)
- [Current licence](../LICENSE)
