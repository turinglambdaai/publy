# Publy

- `docs/design.md` 是产品唯一权威设计；实现与文档冲突时先改文档再改代码
- 当前阶段：M0（设计定稿），进度见 `docs/roadmap.md`
- 动代码前必读 design.md 第 3 节（CLI 契约）与第 4 节（图片消息管线）
- 文档用中文；代码注释用英文
- 退出码与 `--json` 输出是对外契约，变更需同步 design.md 第 3 节

## racket/ — Racket components (2026-10-13)

`racket/publy-ws.rkt` is the live-events WebSocket gateway. It sits NEXT TO
the fastify server and never inside it: it tails `dataDir/history.jsonl`
and pushes each event to subscribers of `ws://host:port/events?key=<same
key as X-API-Key>`. The publishing server itself must stay untouched by
gateway work. Replay ends with a `{"control":"replay-done"}` marker —
clients synchronize on it. Tests: `raco test racket` (CI job `racket-ws`;
the websocket library installs from GitHub until it reaches the catalog).
