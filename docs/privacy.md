# Publy data and privacy status

**English** · [简体中文](privacy.zh-CN.md)

Public hosting is not open. The old privacy page must not be treated as a promise from a running customer service. This page describes source/self-hosting boundaries, not a guarantee about a third-party deployment.

| Data | Actual boundary |
|---|---|
| Source Markdown/media | Kept locally; delivery sends rendered content/media through the selected server to WeChat |
| Client API key | Can be stored in ~/.publy/config.json; protect it as a secret |
| AppID / AppSecret | The static server.json example contains plaintext secrets; other binding paths need encryption/master-key review |
| Jobs, history and caches | Queues, history.jsonl, databases and caches can persist data; do not claim that no content is ever stored |
| External communication | Package/theme registries, the selected server, official WeChat APIs and configured webhooks have distinct data recipients |

Self-hosting operators own file permissions, HTTPS/private tunnels, authentication, log redaction, encrypted backups and verified restore. Never publish a WebSocket URL containing a key. Unbinding inside an app does not necessarily revoke a WeChat credential or delete old backup copies; rotate exposed credentials at their issuer.

Before public hosting launches, identify the actual operator, collected fields/purposes, third-party recipients, separate content/media/log/backup retention, export/deletion paths, support and incident response. Do not claim immediate deletion, a seven-day response or fully encrypted handling has already been delivered. Use [Issues](https://github.com/turlamai/publy/issues) for non-sensitive problems only; never post personal data or credentials there.
