# Publy Roadmap

## M0 — 设计定稿与仓库骨架 ✅

- [x] 产品设计 / 商业模式 / 路线图文档
- [x] monorepo 骨架（pnpm workspace、packages/shared|core|server|cli）
- [x] 客户端形态定稿：Obsidian 插件 = 客户端 A，CLI = 客户端 B（2026-09-29 与用户对齐）

## M1 — 渲染与发布闭环（当前阶段）

- [x] `@publy/core` 渲染管线：markdown-it + hljs 高亮 + juice 内联 + Obsidian 语法（`![[img]]` / wikilink）+ SVG→PNG（resvg，白底）+ 链接转脚注 + footer 注入
- [x] claude 主题移植（用户 wenyan 自定义主题，CSS 变量编译为字面量）
- [x] `publy render` / `publy publish`（--json、退出码）
- [x] `@publy/core` 微信客户端：token 缓存（单飞 + 600s buffer）、add_material、draft/add（文章 + newspic 小绿书两种草稿）
- [x] `publy-server` 协议 v1（/health /verify /v1/publish，base64 附件 + attachment:// 引用替换）——本地冒烟通过
- [ ] 部署 server 到用户服务器（稳定 IP，与 wenyan server 并存于不同端口）
- [ ] `publy preview`（render + 打开浏览器；文章形态可见性）
- [ ] CLI `config` 命令（交互式写 ~/.publy/config.json）

**验收**：真实公众号全流程发布 1 篇文章（渲染 → 服务器 → 草稿箱）。

## M1b — 小绿书 card 引擎（差异化楔子）

- [ ] satori + resvg 卡片渲染：markdown 分节（cover/point/list/ending 四版式原型）→ 3:4 PNG
- [ ] `publy card` + `--preview` 拼版大图 + `--lint`（caption ≤1000 字、图片 3–9 张）
- [ ] 2 个内置卡片主题；CJK 字体子集化
- [ ] 发布链路：type=image_post 全流程实测

**验收**：一条命令从 markdown 出 9 张主题化卡片并发布到草稿箱；汉字像素级正确。

## M2 — 稳定性与自吞狗粮

- [ ] 幂等键（服务端去重）、发布历史/审计日志
- [ ] 封面 2.35:1 自动裁切（sharp）
- [ ] 素材上传 hash 缓存（同图免重传）
- [ ] 替换 tlai-wechat-publish 后端，自己的公众号连续 2 周仅经 publy 发布

## M3 — Obsidian 插件（客户端 A）

- [ ] 插件骨架：设置页（server/api_key/account）、命令面板发布
- [ ] 文章渲染预览（core 直接 import，编辑器侧边）
- [ ] 小绿书实时预览（卡片拼版）——插件是"看得到渲染形态"的完整答案
- [ ] 进 Obsidian 社区目录（开源免费）引流

## M4 — 公开商业版

- [ ] 云控制面：多账号、定时任务、webhook、计费（Free / Pro ¥39 / Team ¥129）
- [ ] 主题注册表仓库 + gallery 页 + `publy theme` 命令族
- [ ] jrtx.site 产品页 + 开源发布文

## Later（不承诺时间表）

MCP 薄封装 / 付费主题市场（70/30）/ Team 审批流 / API 按量计费
