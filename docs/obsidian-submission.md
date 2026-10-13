# Obsidian 社区目录提审材料

目标：把 Publy 插件提交到 [obsidianmd/obsidian-releases](https://github.com/obsidianmd/obsidian-releases) 的社区插件目录。本文档是提交所需材料的唯一权威草稿。

## 1. community-plugins.json 条目

在 `community-plugins.json`（按字母序）中添加：

```json
"publy": "turinglambdaai/publy"
```

## 2. PR 描述草稿

**标题**：Add Publy: agent-era publishing pipeline for WeChat Official Accounts

**Link to plugin**：https://github.com/turinglambdaai/publy（plugin source 在 `packages/obsidian-plugin/`，release 资产由 CI 校验后的 dist 打包）

**功能概述（给审核者）**：

Publy 把 Obsidian 笔记发布为微信公众号内容。插件提供：

- **应用内预览面板**：当前笔记的公众号排版实时渲染（约 0.9s 防抖），带手机宽（390px）/桌面宽切换与 10 套主题快切；图片消息（卡片组）以真实尺寸拼版预览
- **一键发布**：通过自托管或托管的 Publy 服务把排版 HTML 与图片经微信公众号**官方 API** 送入草稿箱（无模拟登录、无第三方中间商）；幂等键防重复、审计可查
- **零配置路径**：不配置服务也能用——本地渲染预览 + 复制带样式富文本，粘贴进公众号编辑器
- **封面选择器**：正文图 / 本机图片（HTML 文件选择器）/ 自动标题卡（真实渲染预览），按笔记记忆
- **定时发布 / 发布历史时间线 / 多账号切换 / webhook 通知**

**全新安装测试**：

1. BRAT 安装 `turinglambdaai/publy`，或手动复制 release 中的 `main.js`、`manifest.json`、`styles.css` 到 `.obsidian/plugins/publy/`
2. 启用插件——预览、富文本复制、卡片渲染全部离线可用（无需任何配置）
3. 配置 server + API key 后（设置页有「测试连接」），`发布当前笔记` 送入草稿箱

**审核规则自查**：

- ❌ `electron.remote`：未使用（本机图片选择用 `<input type="file">`，内容寻址存储，不保留文件路径）——0.8.1 起生效
- ❌ `eval` / 动态代码注入：未使用
- ✅ 网络：仅 `requestUrl` 到用户在设置中明确配置的服务器；字体与渲染引擎随包分发，**无任何 CDN 依赖**
- ✅ DOM：渲染产物写入预览面板（内容来自用户笔记经 markdown-it 渲染），无第三方注入面；样式全部 `publy-` 前缀
- ✅ 遥测：无任何数据收集
- ✅ `isDesktopOnly: true`（wasm PNG 渲染 + 本地字体子集）

**License**：AGPL-3.0（仓库根 LICENSE）。

## 3. 提交流程

1. Fork `obsidianmd/obsidian-releases`，在 `community-plugins.json` 按字母序插入上面的条目
2. 开 PR，标题 `Add Publy: agent-era publishing pipeline for WeChat Official Accounts`，描述用第 2 节内容（附预览面板与封面选择器截图/短视频，发布前补录）
3. 用 GitHub 账号在 PR 里回复审核机器人 checklist 确认
4. 等待人工审核（通常 2-8 周）；常见追问是 innerHTML 的内容来源（见上，答复「渲染用户自己的笔记，无第三方内容」）

## 4. 已知非阻塞项

- `data.json` 明文保存 API key（password 输入框采集）——社区同类插件（GitHub/Notion 发布类）惯例，审核不阻塞；后续可选 device 加密
- `body.innerHTML = html`——自产渲染内容，PR 描述已预答
