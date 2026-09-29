# Publy Roadmap

## M0 — 设计定稿与仓库骨架 ✅

- [x] 产品设计 / 商业模式 / 路线图文档
- [x] monorepo 骨架（pnpm workspace、packages/shared|core|server|cli）
- [x] 客户端形态定稿：Obsidian 插件 = 客户端 A，CLI = 客户端 B（2026-09-29 与用户对齐）

## M1 — 渲染与发布闭环 ✅

- [x] `@publy/core` 渲染管线：markdown-it + hljs 高亮 + juice 内联 + Obsidian 语法（`![[img]]` / wikilink）+ SVG→PNG（resvg，白底）+ 链接转脚注 + footer 注入
- [x] claude / medium 主题移植（用户 wenyan 自定义主题，CSS 变量编译为字面量）
- [x] `publy render` / `publy preview`（浏览器打开）/ `publy publish`（--json、退出码）
- [x] `publy config set` / `publy account add|list` / `publy theme ls`
- [x] `@publy/core` 微信客户端：token 缓存（单飞 + 600s buffer）、add_material、draft/add（文章 + newspic 小绿书两种草稿）
- [x] `publy-server` 协议 v1（/health /verify /v1/publish，base64 附件 + attachment:// 引用替换）——本地冒烟通过（含微信 API 真实调用错误路径）
- [x] 部署 server 到用户服务器（47.101.152.163，systemd 托管，AppSecret 不出服务器）——✅ 2026-09-29；同日 wenyan 卸载，server 迁至 **8081**（外网可直连；公司网络内走 SSH 隧道 18081）
- [x] cards 模式发布实测：`mode: cards` 自动推断 image_post（tlai-wechat-card 产出无需 type 字段）——4 卡 newspic 草稿全链路通过

**验收**：✅ 真实公众号全流程发布 1 篇文章（渲染 → 服务器 → 草稿箱，6.5s，幂等命中与审计日志实测通过）+ 1 篇 cards 小绿书。

## M1b — 小绿书 card 引擎 ✅

- [x] satori + resvg 卡片渲染：markdown 分节（cover/point/list/ending 四版式原型）→ 3:4 PNG（1080×1440）
- [x] `publy card` + `--preview` 拼版预览页 + lint（caption ≤1000 字、3–9 张、cover/ending 必备）
- [x] 2 个内置卡片主题（naive 白底墨色 / claude 暖燕麦）；Noto Sans SC 按需下载缓存（jsDelivr + GitHub 双源）
- [x] 发布链路：`mode: cards` → 卡片即 images → image_post 草稿（lint 不过拒发）

**验收**：实测 4 张卡片 2.5s 出图，汉字像素级正确；两主题渲染通过。

## M2 — 稳定性 ✅（除自吞狗粮周期）

- [x] 幂等键（内容寻址，服务端 10 分钟窗口去重）
- [x] 审计日志（server-data/history.jsonl + `publy history` / GET /v1/history）
- [x] 封面 2.35:1 中心裁切（server 端 resvg 视口裁切，零图像库依赖）
- [x] 素材 hash 缓存（同 appId 同字节内容免重传，material-cache.json）
- [x] `AccountStore` 接口抽象（文件实现，M4 换数据库）
- [x] 公司网络大 POST 拦截解法：SSH 隧道（启动文件夹自启）→ **2026-09-30 产品化：`publy tunnel` 幂等命令 + publish 失败自动拉隧道重试**
- [x] **wenyan 全面退役**（2026-09-29）：服务器 tmux 停止 + npm 卸载 + 数据目录改名 `.retired-20260929` 观察；本机 npm 卸载 + 数据目录删除；`tlai-wechat-publish` 技能 v1.0.0 重写
- [x] CLI 全局命令 `publy`（dev 期为直指 dist 的 shim；npm 发包后为 `npm i -g publy`）
- [x] **强 API key 轮换**（2026-09-30：24 字节随机 hex 替换 wenyan 时代弱 key，双端同步）
- [x] **定时发布**（2026-09-30）：`publy publish --at "..."` → 服务端 jobs.json 持久化 + 失败重试 3 次 + `publy jobs list/cancel` + webhook 通知
- [x] **webhook**（2026-09-30）：server.json 账号级 webhook URL，publish/failed 事件推送
- [x] **测试与 CI**（2026-09-30）：33 个单测（core 26 含真实渲染、server 7 含 fastify inject 协议测试），GitHub Actions ubuntu+windows 矩阵
- [x] **npm 包就绪**（2026-09-30）：esbuild 捆绑 workspace 依赖，单包自包含（子集字体/主题/样例随包零网络），publy@1.0.0 pack 验证 6MB；待 npm 账号发布
- [x] **小绿书 text 模式 caption 走 markdown 渲染** + digest 自动生成（首段前 120 字）
- [x] **字体子集化**（2026-09-30）：pyftsubset GB2312+ASCII 共 7549 字符 → 3.4MB/字重（原 32MB），随包分发零网络，越界字符自动回退全量字体
- [x] `--custom-theme <path>`：任意 CSS 文件即主题（变量自动解析）
- [ ] HTTPS：Caddy 2.6.2 已装已配（publy-api.jrtx.site → 8081），等 DNS A 记录 + 安全组 443/80 开放
- [ ] **自吞狗粮进行中**：连续 2 周仅经 publy 发布（自 2026-09-29 起算，wenyan 已不可回退）

## M3 — Obsidian 插件（客户端 A）进行中

- [x] 插件骨架：设置页（server/api_key/account/mediaDir）、ribbon 按钮、命令「Publish current note」「Preview rendered HTML」
- [x] esbuild 构建 + resvg 原生模块随插件分发（dist/ 即装即用）
- [x] 命令「Preview xiaolvshu card deck」：当前笔记渲染卡片拼版并打开（2026-09-30）
- [ ] 编辑器内实时预览（侧边栏常驻拼版）
- [ ] 发布到 Obsidian 社区目录

## M4 — 公开商业版（进行中）

- [x] 主题注册表仓库 `publy-themes`（index schema + 内置主题登记 + 提交指南）
- [x] **主题商店 gallery 上线并重做**（2026-09-30 v2）：themes.publy.jrtx.site/——文章主题直接内嵌**发布级真实 HTML**（同篇切主题对比 + 手机宽/文档宽切换），卡片主题按真实翻阅方式横向滑动 + 全屏翻页灯箱；废弃截图方案；生成器 scripts/build-gallery.mjs（输出到 publy-themes 仓库 D:Codespubly-themes）
- [x] **云控制面上线**（2026-09-30）：多用户（node:sqlite 独立 API key）、配额强制（Free 30 次/月 / Pro 5000 次/月，按自然月滚动）、账号归属与计划限制（Free 1 账号 / Pro 3 账号）、购买页 + key 找回 + `publy quota`、admin 控制台（开通/延期/停用/绑定账号/用量）、支付适配器（虎皮椒已实现，凭据待运营者注册填入；当前手工开通模式）
- [ ] 自动收款开关：运营者注册虎皮椒 → server.json 填 payments 凭据 → 购买页变扫码直付
- [ ] 定价页上主站 + 服务条款/隐私政策
- [ ] 外部主题提交流程开放（npm 包规范 + CI 预览自动生成）
- [ ] jrtx.site 产品页（已上线 publy.jrtx.site）+ 开源发布文

## Later（不承诺时间表）

MCP 薄封装 / 付费主题市场（70/30）/ Team 审批流 / API 按量计费
