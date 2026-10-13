# Operations: backup, restore, moving servers

## What lives where

| Thing | Location | In git? |
| --- | --- | --- |
| Code (server, CLI, plugin, gateway) | this repo → `github.com/turinglambdaai/publy` | ✅ |
| Operator config (apiKey, accounts, secretKey) | `~/.publy/server.json` on the server | ❌ back it up |
| **Users, API keys, orders** | `~/.publy/server-data/users.db` (SQLite) | ❌ back it up |
| Audit trail (the event gateway reads this) | `~/.publy/server-data/history.jsonl` | ❌ back it up |
| Scheduled publish jobs | `~/.publy/server-data/jobs.json` | ❌ back it up |
| WeChat tokens / material cache | `~/.publy/server-data/` (rest) | regenerable |

**Code can never be lost** (local clone + GitHub). What only exists on the
server is `~/.publy/` — that is the customer list, the keys and the order
book. Back it up before touching the server.

## Backup (on the server)

```bash
tar -czf publy-backup-$(date +%F).tar.gz -C ~ .publy
```

Contains config + database + audit trail in one file. Copy it off the box
(scp/oss/网盘). Automation: run it from cron daily and keep 7.

## Restore (new server)

```bash
# 1. node 22+ and the code
git clone https://github.com/turinglambdaai/publy && cd publy && pnpm -r build
# 2. drop in the data
tar -xzf publy-backup-YYYY-MM-DD.tar.gz -C ~
# 3. start server + event gateway (ports default 8081 / 8082)
node packages/server/dist/index.js &
node racket/publy-ws.rkt &
```

`secretKey` inside `server.json` decrypts the stored AppSecrets — restoring
without it keeps users and orders but breaks bound accounts until secrets
are re-entered. Never lose `server.json`.

## Updating a running deployment

```bash
cd publy && git pull && pnpm -r build
# restart the server / gateway processes however you run them
```

`users.db` is SQLite; the event gateway only ever opens it read-only, so a
rolling restart of the gateway is safe while the server keeps serving.
