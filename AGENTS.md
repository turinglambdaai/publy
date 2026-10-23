# Publy

- `docs/design.md` 是产品唯一权威设计；实现与文档冲突时先改文档再改代码
- 当前阶段：渲染/发布管线已实现并自用，公开托管商业交付仍有门禁，进度见 `docs/roadmap.md`
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

`racket/publy-stats.rkt` is the read-only operational stats companion —
same posture (next to the server, `users.db` opened read-only,
`app_secret`/`api_key` never selected) and zero dependency on `@publy/core`.
It aggregates publish outcomes, top errors, monthly-quota pressure and
paid revenue from `history.jsonl` + `users.db`, bucketed in Asia/Shanghai
wall time. Human report by default, `--json` for agents. New Racket-side
components must follow this pattern: sidecar next to the server, read-only
over the data plane, no engine dependency.

## 组合定位（Portfolio placement）

- 当前决策（2026-10-v2）：免费 CLI/自托管 + 发布托管订阅。具体价格、免费/付费边界和开卖门禁以本仓 [PRICING.md](PRICING.md) 为唯一权威；旧版收费候选与早鸟方案已被替代。
- 组合归属：[PORTFOLIO](https://github.com/turinglambdaai/turinglambdaai.github.io/blob/master/PORTFOLIO.md)。当前全部产品开发中、没有实际用户；目标定价不表示已经开卖，不因此立即给开发版加收费墙。
- 免费产品不接商业激活；付费层先实现可验证价值，再接 Commerce/Permit。优先完成本仓既有产品审查 issue；不修改现行源码 LICENSE。

## 产品交付与下一步（2026-10-23）

- 家族[交付标准](https://github.com/turinglambdaai/turinglambdaai.github.io/blob/master/docs/PRODUCT-STANDARD.md)与[组合策略](https://github.com/turinglambdaai/turinglambdaai.github.io/blob/master/PORTFOLIO.md)是共用政策；本仓具体行为以 `docs/roadmap.md` 为准，不复制五库依赖图。
- 当前执行入口：[产品审查 issue](https://github.com/turinglambdaai/publy/issues/7)。先验证发布幂等/超时恢复与凭据边界；审计 WebSocket URL 的长期 key。托管套餐按账号与有界发布配额设计，CLI/自托管路径保留。
- 开工先检查干净工作树与远端，以 fast-forward-only 更新并记录 SHA；共享文件一次一个写入者，保留其他 checkout 的未提交工作。
- 每次只完成一个可验收切片，记录 owned files、依赖 pin、命令/平台/产物证据和回滚。已实现、已发布、实机验收分别陈述；不修改 requirements 或复用旧证据来制造通过。
