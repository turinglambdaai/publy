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
- [x] 审计日志（server-data/history.jsonl，逐条发布/去重/失败记录）
- [x] 封面 2.35:1 中心裁切（server 端 resvg 视口裁切，零图像库依赖）
- [x] 素材 hash 缓存（同 appId 同字节内容免重传，material-cache.json）
- [x] `AccountStore` 接口抽象（文件实现，M4 换数据库）
- [x] 公司网络大 POST 拦截解法：SSH 隧道（22 端口加密流，启动文件夹开机静默自启）——2026-09-29 实测：直连大 POST 均被中间设备掐断（几十 KB 阈值），隧道 200KB+ 全通
- [x] **wenyan 全面退役**（2026-09-29）：服务器 tmux 会话停止 + npm 卸载 + 数据目录改名 `.retired-20260929` 观察；本机 npm 卸载 + 数据目录删除；`tlai-wechat-publish` 技能 v1.0.0 重写为纯 publy 流程（预处理/临时文件全删，publy 原生零修改原文）
- [x] CLI 全局命令 `publy`（npm 全局 bin 直指 workspace dist，改码即生效）；修复 ESM 主模块判断在 Windows 路径/junction 下静默失效（改用 `pathToFileURL`）
- [ ] CLI `publy tunnel` 自动隧道（直连失败自动建）——产品 insight：目标客户大量在企业网络内，这是刚需特性
- [ ] **自吞狗粮进行中**：连续 2 周仅经 publy 发布（自 2026-09-29 起算，wenyan 已不可回退）

## M3 — Obsidian 插件（客户端 A）✅ 骨架

- [x] 插件骨架：设置页（server/api_key/account/mediaDir）、ribbon 按钮、命令「Publish current note」「Preview rendered HTML」
- [x] esbuild 构建 + resvg 原生模块随插件分发（dist/ 即装即用）
- [ ] 小绿书实时预览（编辑器侧边拼版）——下一步
- [ ] 发布到 Obsidian 社区目录

## M4 — 公开商业版（进行中）

- [x] 主题注册表仓库 `publy-themes`（index schema + 内置主题登记 + 提交指南）
- [x] **主题商店 gallery 上线**（2026-09-29）：themes.publy.jrtx.site/——四主题真实渲染预览（Edge headless 截样例文章 + card 引擎出图），数据内联同步渲染；`publy theme preview <name>` 本地即看；主页已挂入口
- [ ] 云控制面：多账号、定时任务、webhook、计费（Free / Pro ¥39 / Team ¥129）
- [ ] 外部主题提交流程开放（npm 包规范 + CI 预览自动生成）
- [ ] jrtx.site 产品页（已上线 publy.jrtx.site）+ 开源发布文

## Later（不承诺时间表）

MCP 薄封装 / 付费主题市场（70/30）/ Team 审批流 / API 按量计费
