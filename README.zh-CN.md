# Publy

agent 时代的微信公众号发布管线：一个 CLI 负责排版与小绿书渲染，一个托管服务负责稳定发布，一个主题商店负责排版资产分发。

![license](https://img.shields.io/badge/license-AGPL--3.0-blue)
![status](https://img.shields.io/badge/status-M0%20design-orange)

[English](README.md) · **中文**

- **写作留在 Obsidian，发布交给 agent。** `publy publish a.md` ——没有 GUI，没有「复制粘贴进公众号后台」。
- **小绿书是一等公民。** `publy card post.md` 确定性渲染主题化 3:4 卡片——像素级正确的汉字，秒级出图，不靠 AI 生图。
- **主题商店告别 gist。** 主题即 npm 包，带渲染预览；`publy theme add` 一条命令安装，装前可预览。
- **开源核心，不做锁定。** CLI 与自托管 server 开源（AGPL-3.0），与云服务同一协议。云服务卖的是可靠性：IP 白名单稳定出口、AppSecret 托管、token 生命周期、定时、多账号。

合规：只走微信公众号官方 API，不做账号模拟，不做浏览器自动化。

状态：管线已实现并自吞狗粮——文章与小绿书每天经它发布。

## 三分钟上手

```bash
publy config set server http://your-server:8081
publy config set api_key <key>
publy account add me --app-id wx... --theme claude
publy preview article.md     # 先看效果
publy publish article.md     # 排版稿进公众号草稿箱
```

小绿书：frontmatter 写 `mode: cards`，正文按 `## cover` / `## point` / `## list` / `## ending` 分节，`publy card post.md --preview` 出拼版预览，`publy publish post.md` 发布。

完整手册：[docs/guide.md](docs/guide.md) · 主题画廊：[themes.publy.jrtx.site](https://themes.publy.jrtx.site/)

设计文档：

- [docs/design.md](docs/design.md) — 产品设计：定位、形态、CLI 契约、小绿书管线、主题商店、架构
- [docs/business.md](docs/business.md) — 开源边界、定价、GTM
- [docs/roadmap.md](docs/roadmap.md) — M0 → M3

## License

AGPL-3.0
