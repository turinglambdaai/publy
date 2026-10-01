# Publy 产品设计

> 状态：M0 设计定稿。本文档是产品的唯一权威设计，实现与文档冲突时以本文档为准；要改实现先改文档。

## 0. 一句话

**Publy 是面向 agent 时代的微信公众号发布管线：一个 CLI 负责排版与图片消息渲染，一个托管服务负责稳定的微信发布，一个主题商店负责排版资产分发。**

写作留在 Obsidian / 任意 Markdown 编辑器，其余一切（排版、卡片渲染、上传、群发、定时、多账号）收进一条 `publy` 命令。

## 1. 判断：为什么是「CLI + 服务」，而不是又一个编辑器

### 1.1 现有竞品全是给人用的 GUI

| 竞品 | 形态 | 共同假设 |
|---|---|---|
| [doocs/md](https://github.com/doocs/md)（md.doocs.org） | 浏览器编辑 → 复制 → 手动粘贴进公众号后台 | 操作者是坐在浏览器前的人 |
| [Raphael](https://github.com/liuxiaopai-ai/raphael-publish)（publish.raphael.app） | 30 套主题、Notion/飞书粘贴清洗，仍是网页复制流 | 同上 |
| mdnice / 壹伴 | 商业化成熟（付费主题/浏览器插件），形态不变 | 同上 |

agent 时代这个假设失效：创作发生在 Obsidian，执行发生在 CLI/agent，人只做审阅。GUI 排版器没有服务端，也就没有护城河和收入——doocs/md 30k+ star 依然收不了钱。

### 1.2 wenyan 的教训

wenyan（文颜）验证了 CLI + server 路线可行（tlai-wechat-publish 技能即构建其上），但产品摊得太开：macOS App、跨平台桌面版、CLI、MCP、Docker 多端并进；主题靠本地 CSS / gist 注册，没有主题广场。多端并进的结果是每一端都是半成品。

Publy 只做两个工件：**CLI（唯一客户端）+ 云服务（唯一服务端）**。自托管 server 与云服务同协议——既是用户的逃生门，也是信任背书。

### 1.3 为什么「发布服务」能收钱

公众号 API 的脏活恰好全是运维活：

- IP 白名单要求出口 IP 稳定——家用/办公网络天然不可行
- AppSecret 托管与轮换
- access_token 两小时过期，多进程集中刷新需要分布式锁
- 素材上传、群发配额（订阅号 1 次/天）、失败重试与幂等

这些对个人是负担，对服务是产品。GUI 工具收钱靠去广告和主题数量；Publy 收钱靠**发布可靠性**——这是硬成本，用户愿意为省掉的运维付费（mdnice/壹伴已验证过这个人群的付费意愿）。

### 1.4 图片消息是空白区

所有排版工具都在做「文章」，没有工具认真做「图片消息」：

- 现有图片消息工作流（tlai-wechat-card）靠 AI 生图烘焙文字：慢、贵、汉字经常出错
- 确定性渲染（HTML/CSS 模板 → PNG）可以做到：像素级正确的汉字、主题化、秒级、零边际成本

图片消息是 Publy 的差异化楔子：先建立「最好用的图片消息管线」心智，再带动文章发布服务。

## 2. 产品形态：一个引擎，两个客户端，一个服务，一个商店

| 工件 | 形态 | 开源性 | 角色 |
|---|---|---|---|
| **@publy/core** | npm 包（渲染引擎 + 卡片引擎） | 开源（AGPL） | 产品本体：排版、图片消息渲染、校验、微信客户端 |
| **publy CLI** | npm 包，`npx publy` | 开源（AGPL） | 客户端 B：agent 的操作面，非 Obsidian 用户的入口 |
| **Obsidian 插件** | Obsidian 社区插件 | 开源 | 客户端 A：写作现场——图片消息实时预览、文章预览、一键直推服务器 |
| **Publy Cloud / 自托管 server** | REST 服务（协议 v1） | server 开源 / cloud 闭源 | 发布可靠性：IP 白名单、密钥托管、定时、多账号；**收费物** |
| **主题商店** | npm 包 + 注册表索引 | 主题与索引均开源 | 文章主题与卡片主题的分发、预览、提交 |

客户端不设上限：core 是 npm 包，任何客户端壳都可以包它；CLI 和 Obsidian 插件是两个一等公民。插件进 Obsidian 社区目录（开源免费）引流，服务器服务收费——插件免费 + 云服务收费是 Obsidian 生态成熟惯例。

**渲染可见性设计**（写作的人必须看得到最终形态）：

- 文章：`publy render -o out.html` 产出自包含 HTML（内联样式与微信一致），浏览器打开即所见即所得；`publy preview` = render + 自动打开
- 图片消息：card 引擎的原生输出就是 PNG 卡片——渲染形态即文件本身；`publy card --preview` 额外产出拼版大图（9 张 + caption 模拟排版）
- Obsidian 插件：编辑器侧边实时预览文章渲染效果与卡片拼版，写作现场直接看，这是完整答案

### 2.1 明确不做（范围纪律）

- ❌ 独立 Web 排版编辑器（doocs/md / Raphael 类通用 GUI，正面竞争无护城河）；写作场内入口（Obsidian 插件）不在禁列——它不承担排版编辑职责（排版是主题 + core 的确定性渲染），只做预览与触发
- ❌ 桌面 App
- ❌ 图床——图片随文章仓库/Obsidian 存放，发布时经素材接口上传
- ❌ 知乎/头条等多平台适配——wenyan 式「都支持一点」是杂的根源；只做微信，做穿
- ❌ MCP server（首版）——REST + CLI 已可被任何 agent 驱动，后续可加薄封装
- ❌ 账号密码模拟 / 扫码爬虫——**合规红线**：只走官方 MP API

## 3. CLI 契约（agent-first）

设计原则：一切命令非交互可完成；`--json` 输出机器可读结果；退出码稳定；破坏性操作显式确认。

```bash
publy render a.md --theme claude -o out.html   # Markdown → 公众号 HTML（免费路径，可贴入后台）
publy preview a.md --theme claude              # 本地预览（HTML + 截图，供 agent 自检）
publy card post.md --theme naive -o cards/     # 图片消息：Markdown → N 张卡片 PNG + caption
publy card post.md --lint                      # 校验：caption ≤1000 字、图片 3–9 张、比例 3:4
publy publish a.md                             # 发布文章（经云端或自托管服务）
publy publish post.md                          # 发布图片消息（图片消息）
publy publish a.md --at "2026-10-01 09:00"     # 定时（服务端 job）
publy theme add @scope/theme-x | theme ls | theme preview <name>
publy account add --app-id wx... --secret-env WX_SECRET   # 密钥走环境变量引用，不明文落盘
publy quota                                    # 群发配额余量
```

- 所有命令支持 `--json`。退出码：`0` 成功 / `1` 用法错误 / `2` 输入文件错误 / `3` 渲染失败 / `4` 校验失败 / `5` 服务端错误 / `6` 配额不足
- 输入兼容 Obsidian：`![[img.png|650]]`、`[[wikilink|别名]]` 原生解析（`--media-dir` 指定资源目录）；frontmatter 的 `title` / `cover` / `type` / `theme` 直接消费
- 密钥管理：配置文件只存环境变量名引用（`--secret-env`），与 tlai 技能的 `${VAR}` 约定一致

### 3.1 从 tlai 技能继承的实战经验（内置为默认行为）

这些是现有公众号推送技能踩坑沉淀，全部固化为 CLI 默认行为：

- **零修改原文**：所有变换发生在内存/输出物，绝不回写源文件
- SVG 自动补白底（公众号把透明背景渲染成黑色的坑）
- 链接转文末脚注（默认开，`--no-footnote` 关闭）
- `--footer` 文末引流文案注入
- 封面比例 2.35:1 裁切
- 账号 ↔ 主题绑定（`accounts[]` 配置，`--account` 选择）
- 图片消息预检清单（错别字/风格一致性提醒）保留为 `preview` 流程的人工/agent 环节

## 4. 图片消息管线（楔子功能）

### 4.1 创作格式：一个 Markdown 文件即一篇图片消息

```markdown
---
title: 居家咖啡指南
mode: cards            # cards 图文卡片 | text 图文分离
theme: naive           # 卡片主题
tags: [咖啡, 生活]
caption: ...           # 帖子配文（≤1000 字；# 标签写在 caption 末尾）
---

## cover               # 第一节 = 封面卡（版式原型 Sparse）
居家咖啡，从磨豆开始

## point               # 中间节 = 内容卡
水粉比 1:15
水温 92°C

## list                # 版式原型 Dense：清单/步骤
...

## ending              # 最后一节 = 结尾互动卡（Sparse）
关注我，下期讲手冲参数
```

节名对应四种版式原型（对齐 tlai-wechat-card 的成熟经验）：`cover`（Sparse）/ `point`（Balanced）/ `list`（Dense）/ `ending`（Sparse）。主题控制每种原型的排版实现。

`text` 模式沿用现状：正文列图（`![[...]]`）+ 一段配文，发布为图片消息，图片不做渲染。

### 4.2 确定性渲染（双引擎）

- **默认引擎 satori**：HTML/CSS 模板 → SVG → PNG（resvg），无浏览器依赖、秒级出图。约束：CSS 子集；CJK 字体使用预分包字体
- **兜底引擎 browser**：`--engine browser` 走无头 Chromium 截图，支持完整 CSS；主题在 `manifest.json` 中声明所需引擎
- 输出 1080×1440（3:4）；文字自适应缩放（放不下逐级降字号）；页码/水印由主题控制

### 4.3 预览与校验：人/agent 各司其职

- `publy card --preview` 生成拼版预览页；agent 截图自检，并提醒人工核对错别字（AI 生图时代的教训保留为流程）
- `--lint` 硬校验：caption 字数、图片数量、比例、标签格式；发布前不通过即拒绝（退出码 4）

### 4.4 发布

素材接口上传 N 张图 → 图片消息群发（首图为封面）→ 返回发布链接。**幂等**：同 idempotency-key 重试不会重复群发——群发配额（订阅号 1 次/天）极其宝贵。

## 5. 主题商店

### 5.1 主题包

- 文章主题 = npm 包 `publy-theme-*`：`theme.css`（`#publy` scope）+ `manifest.json`（适用范围 article|card）+ `sample.md` + `preview.png`（CI 渲染）
- 卡片主题：`CardTheme` 风格配置模块（colors、fonts、watermark），引擎按四种版式原型消费配置；内置参考实现 naive / claude。卡片主题不做 HTML 模板——satori 的 flex 语义下配置化比模板更可靠
- 语义化版本；本地 CSS 文件可用 `--custom-theme` 直接兜底，不强绑 npm

### 5.2 注册表

- GitHub 仓库 `publy-themes`：`index.json` 精选清单（名称、npm 包、截图、作者）
- 提交 = PR；CI 自动渲染 sample 生成预览图进 gallery 页
- `publy theme search / add / preview` 读注册表；`add` 实际安装走 npm
- 解决 gist 注册的痛点：版本化、一条命令安装、装前可预览、贡献有常规入口

### 5.3 商业化（二期）

付费主题上架，70/30 分成；先用免费主题养生态。

## 6. 服务协议与架构

### 6.1 协议 v1（已实现于 packages/server 与 packages/cli）

```
GET  /health              # 无鉴权
GET  /verify              # 鉴权探针，返回账号名列表
POST /v1/publish          # 发布（JSON，≤30MB）
```

- 鉴权：`x-api-key` 请求头
- `POST /v1/publish` 请求体：

```json
{
  "account": "TuringLambdaAI",
  "type": "article | image_post",
  "title": "...",
  "html": "<div id=\"publy\" style=\"...\">...</div>",
  "images": [{ "name": "a.png", "data": "<base64>", "contentType": "image/png" }],
  "cover": "a.png",
  "author": "...", "digest": "...", "contentSourceUrl": "...",
  "needOpenComment": true
}
```

- 正文 HTML 中图片引用 `attachment://<name>`，server 上传素材后替换为微信 CDN URL（复用 media_id 语义：正文图用 `add_material` 的 url，封面用 media_id 作 thumb）
- 响应：`{ "mediaId": "..." }`；错误 `{ "code": "...", "message": "..." }`（400 客户端错 / 401 鉴权 / 502 `WECHAT_<errcode>`）
- server 配置 `~/.publy/server.json`：`{ port, apiKey, accounts: [{ name, appId, appSecret }], cacheDir }`；token 缓存 600s buffer + 并发单飞
- 幂等键（`idempotencyKey`）字段已预留，v1.1 实现

### 6.2 服务端职责

IP 白名单管理、AppSecret 加密托管（KMS，永不下发）、access_token 集中刷新（分布式锁）、群发队列（重试/退避/幂等）、审计日志（谁在何时发了什么）。

### 6.3 Monorepo（pnpm + TypeScript）

```
packages/
  core/     # 渲染器（md → 公众号 HTML）、卡片引擎、主题加载、校验 —— 纯函数库
  cli/      # commander 薄壳，npm 包名 publy
  server/   # 自托管参考实现（Fastify，Docker）
  shared/   # 协议类型、配置 schema（zod）
  cloud/    # 托管控制面（闭源，后期：计费、多租户、调度器）
```

### 6.4 技术风险

| 风险 | 应对 |
|---|---|
| Satori CJK 字体体积与加载 | cn-font-split 预分包；主题声明字体栈；browser 引擎兜底 |
| 微信 API 变动/收紧 | 只走官方接口；协议层隔离微信细节，服务端灰度升级 |
| 群发配额稀缺（订阅号 1 次/天） | 幂等键 + `publy quota` 预检 + 定时错峰 |
| 用户不信任托管 AppSecret | 加密托管 + 审计透明 + 自托管逃生门；文档明示数据流 |

## 7. 渲染位置与多租户（2026-09-29 定稿）

### 7.1 渲染永远在客户端，server 永不渲染

| 流量 | 位置 | 说明 |
|---|---|---|
| 预览（高频） | 客户端 | `render -o out.html` 浏览器打开 / 插件侧边预览；毫秒级反馈，零网络往返，零服务器成本 |
| 发布（低频） | 客户端渲染 → server 转发微信 | server 只做素材上传 + 草稿提交等 API 编排 |
| 定时发布 | 客户端预渲染，server 存 job | 到期时 server 只做"上传素材 + 提交草稿"，依然不渲染 |

理由：

1. **成本结构**：渲染是 CPU 密集活（juice DOM 内联、resvg 光栅化、将来的 satori 卡片渲染）。放 server 则服务器成本随用户数线性上涨且不产生付费点；放客户端由用户自己的机器出算力，一台小服务器可以服务大量用户。server 端**禁止引入渲染依赖**（juice / resvg / satori 都不进 `packages/server` 的依赖树）。
2. **交互性**：预览要边写边看、换主题即时重渲，任何网络往返都不可接受。
3. **隐私**：正文只在发布那一刻离开本机；自托管用户内容全程不经他人之手。
4. **职责分层**：server 的价值全在有状态运维（IP 白名单、密钥托管、token 生命周期、配额、审计），渲染是无状态 CPU 活，不属于它。

### 7.2 多租户演进路径（现在不实现，架构不埋死路）

自托管 server 定位为单租户（一人或一个团队）。真正的多用户只发生在云控制面（M4）：

**现在就对的（不用改）：**

- 协议 v1 的 `account` 字段按名寻址；多租户下语义自然变为"该用户的账号"，协议不变
- `TokenManager` 按 appId 缓存，天然支持多账号并存
- `publishToWechat(req, cred, tokenManager)` 是纯函数，控制面直接复用
- 渲染在每用户的客户端各自发生，天然水平扩展

**M4 才做的：**

- `AccountStore` 抽象：文件实现 → 数据库实现；API key → user → accounts 归属关系（M2 先把 server 的账号读取抽成接口，成本几乎为零）
- 配额记账（Free 30 次/月）按 user 统计
- 审计日志按 user 记录（谁在何时发了什么）
- AppSecret 加密托管（KMS），永不明文下发、永不出 server
