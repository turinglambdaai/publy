# Publy Roadmap

## M0 — 设计定稿与仓库骨架（当前阶段）

- [x] 产品设计 / 商业模式 / 路线图文档
- [ ] monorepo 骨架（pnpm workspace、packages/* 占位）
- [ ] CLI `--help` 可运行 + `publy init` 配置骨架

**验收**：`npx publy --help` 三平台可跑；设计文档评审通过。

## M1 — CLI 本地闭环（免费路径可用）

- [ ] `render`：md → 公众号 HTML，内置 1 个文章主题（移植现用主题）
- [ ] Obsidian 语法兼容（wikilink、`--media-dir`）、SVG 白底、脚注、`--footer`
- [ ] `card` 引擎 alpha（satori + 2 个卡片主题）+ `preview` + `lint`
- [ ] `--json` 契约 + 退出码全集

**验收**：现有公众号文章与小绿书各 1 篇全流程走通（不发布），render/card 产物人工验收达标。

## M2 — 服务闭环（自托管 + 云 dogfood）

- [ ] server（Fastify + Docker）：publish / media / accounts / quota / jobs
- [ ] 云 MVP：自己的账号先上，替换 tlai-wechat-publish 后端
- [ ] 文章 + 小绿书双发布链路、幂等键、审计日志

**验收**：自己的公众号连续 2 周仅经 publy 发布，零手工介入。

## M3 — 公开商业版

- [ ] 多账号控制面、定时任务、webhook
- [ ] 计费（Free / Pro / Team）
- [ ] 主题注册表仓库 + gallery 页
- [ ] jrtx.site 产品页 + 开源发布文

**验收**：Free 档开放注册；首位外部用户独立走通发布。

## Later（不承诺时间表）

MCP 薄封装 / 付费主题市场（70/30）/ Team 审批流 / API 按量计费 / 知乎等平台适配（存疑，倾向不做）
