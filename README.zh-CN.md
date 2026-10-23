# Publy

agent 时代的微信公众号发布管线：一个 CLI 负责排版与图片消息渲染，一个自托管服务负责草稿投递，一个主题商店负责排版资产分发。

[![License](https://img.shields.io/badge/license-AGPL--3.0-blue)](LICENSE) ![status](https://img.shields.io/badge/status-pipeline%20implemented-blue)

[English](README.md) · **中文**

- **写作留在 Obsidian，发布交给 agent。** `publy publish a.md` ——没有 GUI，没有「复制粘贴进公众号后台」。
- **图片消息是一等公民。** `publy card post.md` 确定性渲染主题化 3:4 卡片——像素级正确的汉字，秒级出图，不靠 AI 生图。
- **主题商店告别 gist。** 主题即 npm 包，带渲染预览；`publy theme add` 一条命令安装，装前可预览。
- **开源核心，不做锁定。** CLI 与自托管 server 开源（AGPL-3.0），与云服务同一协议。未来托管服务的价值是：IP 白名单稳定出口、AppSecret 托管、token 生命周期、定时、多账号。

合规：只走微信公众号官方 API，不做账号模拟，不做浏览器自动化。

状态：本地渲染与投递组件已存在；公开托管开通与商业运营尚未开放。

## 开始使用

CLI、默认主题、Obsidian 和自托管按现行许可证保持免费。公开托管订阅尚未开放，不销售无限量套餐。 提供 CLI 与 Obsidian 工作流；不是 Rivet/Glaze 桌面应用。当前发布附件包含 Obsidian 插件。服务端需要稳定出口 IP，以及公众号实际具备的官方 API 权限。

[安装、首次使用、隐私与备份恢复](docs/USER-GUIDE.zh-CN.md) · [English](docs/USER-GUIDE.md)

## 三分钟上手

```bash
publy config set server https://your-server.example
publy config set api_key <key>
publy account add me --app-id wx... --theme claude
publy preview article.md     # 先看效果
publy publish article.md     # 排版稿进公众号草稿箱
```

图片消息：frontmatter 写 `mode: cards`，正文按 `## cover` / `## point` / `## list` / `## ending` 分节，`publy card post.md --preview` 出拼版预览，`publy publish post.md` 发布。

完整手册：[English manual](docs/guide.md) · [中文手册](docs/guide.zh-CN.md) · 主题画廊：[themes.publy.jrtx.site](https://themes.publy.jrtx.site/)

设计文档：

- [docs/design.md](docs/design.md) — 产品设计：定位、形态、CLI 契约、图片消息管线、主题商店、架构
- [docs/business.md](docs/business.md) — 开源边界、定价、GTM
- [docs/roadmap.md](docs/roadmap.md) — 当前交付与商业门禁

## License

AGPL-3.0
