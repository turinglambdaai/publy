# Publy 使用指南

> 面向使用者（人和 agent 皆可）的完整操作手册。设计理念见 [design.md](design.md)，部署架构见仓库 roadmap。

## 它是什么

一条命令把 Markdown 变成排版好的微信公众号草稿：

```
markdown 文件 → publy CLI → publy-server（你的服务器）→ 微信官方 API → 公众号草稿箱
```

排版在本地完成（主题渲染），服务器只负责可靠地把内容送进微信。支持两类内容：

- **文章**：标准图文消息，主题化排版
- **图片消息**：图片消息，图文分离（text）或卡片渲染（cards）两种模式

## 准备工作

### 1. 一台有稳定 IP 的服务器

微信公众号 API 要求 IP 白名单，家用/办公网络的出口 IP 会变，所以发布动作必须由一台固定 IP 的机器完成。publy-server 就部署在这台机器上（见文末「自托管服务器」）。

### 2. 本机安装 CLI

```bash
npm i -g @turinglambdaai/publy        # 推荐（包发布后）
```

或从源码（开发期）：

```bash
git clone https://github.com/turinglambdaai/publy.git && cd publy
pnpm install --frozen-lockfile && pnpm -r build
# 把 publy 命令指向 packages/cli/dist/index.js（全局 bin 或 alias）
```

字体、主题与样例随包分发，装完即用，无需联网下载。

### 3. 配置客户端

```bash
publy config set server http://your-server:8081     # 服务器地址
publy config set api_key <你的APIkey>                # 与服务器端一致
publy account add TuringLambdaAI --app-id wx... --author 吉人 --theme claude
```

配置落盘在 `~/.publy/config.json`，多账号直接改文件：

```json
{
  "server": "http://your-server:8081",
  "api_key": "...",
  "default_account": "TuringLambdaAI",
  "media_dirs": ["D:/Notes/0.asset/media"],
  "accounts": [
    { "name": "TuringLambdaAI", "app_id": "wx...", "author": "吉人", "theme": "claude" },
    { "name": "另一个号", "theme": "medium" }
  ]
}
```

`media_dirs` 是 Obsidian 附件目录：正文里的 `![[img.png]]` 会按这些目录递归解析，**源文件永不修改**。

### 4. 服务器端注册账号

在服务器上编辑 `/root/.publy/server.json`（权限 600）：

```json
{
  "port": 8081,
  "apiKey": "与客户端一致",
  "accounts": [{ "name": "TuringLambdaAI", "appId": "wx...", "appSecret": "..." }]
}
```

AppSecret 只存服务器，客户端永远接触不到。改完 `systemctl restart publy-server`。

## 发布文章

```bash
publy publish article.md
```

就这一条。渲染（主题 + 代码高亮 + 链接转脚注 + Obsidian 语法）全部自动完成，产物进公众号草稿箱，**群发仍是你在后台手动点**（这是官方 API 的边界，也是安全边界）。

### frontmatter 字段

| 字段 | 作用 | 默认 |
|------|------|------|
| `title` | 文章标题 | 文件名 |
| `cover` | 封面图片路径 | 正文首图（都没有则报错） |
| `theme` | 排版主题 | 账号配置的 theme |
| `author` | 作者署名 | 账号配置的 author |
| `digest` | 摘要 | 空 |
| `type: image` | 图片消息（见下节） | 文章 |

命令行可覆盖：`--title`、`--cover`、`--account`、`--theme`、`--custom-theme <css路径>`（任意 CSS 即主题）、`--footer "文末文案"`、`--no-footnote`、`--at "2026-10-01 09:00"`（定时发布）。摘要（digest）不填时自动取正文首段前 120 字。

### 封面

服务端自动把封面中心裁切为公众号要求的 2.35:1。封面三种来源：frontmatter `cover` 字段、`--cover` 参数、正文首图。

### 写作前先看效果

```bash
publy preview article.md     # 浏览器打开渲染结果，所见即发布
publy render article.md -o out.html   # 只要 HTML
```

### 发布图片消息

**text 模式（图文分离）**——图片即帖子图片，剩余文字即配文：

```markdown
---
title: 帖子标题
type: image
---

![[图1.png]]

![[图2.png]]

配文正文，第一行是钩子……
```

**cards 模式（卡片渲染）**——按节写，引擎确定性渲染 3:4 卡片，汉字像素级正确：

```markdown
---
title: 居家咖啡指南
mode: cards
theme: naive
caption: 配文（≤1000 字）
tags: [咖啡, 手冲]
---

## cover        # 封面卡：第一行大标题，其余行副标题
居家咖啡指南
入门手冲，从这四个参数开始

## point        # 内容卡：第一行是小标题，其余行是段落
水粉比 1:15
15 克粉配 225 克水……

## list         # 清单卡：每行一个要点，自动编号
- 研磨度：中细
- 水温：92°C

## ending       # 结尾互动卡
关注我
下期讲注水手法
```

规则：3–9 张卡（一节一张），cover 和 ending 必备，caption ≤1000 字——lint 不过拒绝发布（退出码 4）。`mode: cards` 本身即隐含 `type: image`，不必重复写。

先出图检查再发：

```bash
publy card post.md --preview    # 浏览器打开拼版预览（全部卡片 + 配文）
publy publish post.md           # lint 通过后发布
```

## 主题

```bash
publy theme ls                  # 列出全部主题
publy theme preview claude      # 本地渲染样例文章，浏览器即看
```

| 主题 | 类型 | 风格 |
|------|------|------|
| claude | 文章 + 卡片 | 暖燕麦底、陶土色强调 |
| medium | 文章 | 近白底、绿色强调、1.85 行高 |
| naive | 卡片 | 纯白底、黑墨文字 |

在线画廊（真实渲染预览）：[themes.publy.jrtx.site](https://themes.publy.jrtx.site/)。

## 托管服务：购买与开通

不想自己运维服务器？直接用托管版：**https://publy-api.jrtx.site**

1. 打开购买页，选套餐（Pro ¥39/月 或 ¥390/年），填联系方式，扫码支付
2. 支付完成页面**当场发放 API key**（也可用「找回」按联系方式查）
3. 本机接入：

```bash
publy config set server https://publy-api.jrtx.site
publy config set api_key publy_你的key
```

4. 公众号账号由管理员绑定（把 AppID/AppSecret 通过安全渠道提供给运营者），之后 `publy publish` 即可

查看用量与额度：`publy quota`。免费档（1 账号、30 次发布/月）联系管理员开通。

> 当前托管版收款通道为手工开通模式；自动支付在接入虎皮椒后开放（购买页会自动变为扫码直付）。

## 自托管服务器

```bash
git clone https://github.com/turinglambdaai/publy.git /opt/publy && cd /opt/publy
pnpm install --frozen-lockfile && pnpm -r build
# 写 /root/.publy/server.json（见上），然后 systemd 托管：
# ExecStart=node /opt/publy/packages/server/dist/index.js
# Environment=PUBLY_SERVER_CONFIG=/root/.publy/server.json
```

服务端自带：access_token 缓存（两小时过期自动刷新、并发单飞）、素材去重（同图免重传）、幂等（同内容 10 分钟内重试不重复发布）、审计日志（`~/.publy/server-data/history.jsonl`，客户端 `publy history` 直读）、定时任务（`--at`，jobs.json 持久化 + 失败重试 3 次）、webhook（账号配置 `"webhook": "https://..."` 即推送 publish/failed 事件）。

安全建议：API key 用 24+ 字节随机值（`node -e "console.log(require('crypto').randomBytes(24).toString('hex'))"`）；生产环境建议服务器前挂 Caddy 上 HTTPS（Caddyfile 两行：域名 + `reverse_proxy localhost:8081`）。

更新版本：

```bash
cd /opt/publy && git pull && pnpm install --frozen-lockfile && pnpm -r build && systemctl restart publy-server
```

## 查发布记录与定时任务

```bash
publy history            # 服务器审计日志（谁、何时、发了什么、mediaId）
publy jobs list          # 定时任务
publy jobs cancel <id>   # 取消未执行的定时任务
```

## 故障排查

| 现象 | 原因与处理 |
|------|-----------|
| 退出码 2 | 文件或封面路径不存在 |
| 退出码 3 | 渲染失败，看输出的 warn（多半是图片找不到：检查 media_dirs） |
| 退出码 4 | 图片消息 lint 未过：按提示补 cover/ending 节、压 caption |
| 退出码 5 + `WECHAT_40001` | AppSecret 不对或被重置，改服务器端 server.json |
| 退出码 5 + `WECHAT_45166` | 图片消息内容超微信长度限制，精简 |
| 连接拒绝 | 服务端 `systemctl status publy-server`，检查安全组/防火墙端口放行 |
| 卡片出现乱码方块 | 生僻字/emoji 超出内置 GB2312 子集：`--font-file` 指定全量字体（首次自动下载） |

## 设计边界（为什么没有这些）

- **不自动群发**：官方 API 到草稿为止，群发按钮留给人——这是合规红线，也不做账号模拟
- **没有 GUI**：预览即 HTML/卡片拼版；编辑器内预览由 Obsidian 插件承担（开发中）
- **不做图床**：图片随文章仓库走，发布时经微信素材接口上传
