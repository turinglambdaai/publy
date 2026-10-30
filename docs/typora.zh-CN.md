# Typora 写作，Publy 投递微信公众号草稿

English：[typora.md](typora.md) · **简体中文**

**保持在 Typora 写作，用 Publy 读取原始 Markdown。** 不要求安装 Typora
插件，不必换编辑器、导入整个文件夹或复制笔记库。本产品唯一发布目标是
**微信公众号草稿箱**。

## Typora 用户的操作方式

1. **保存原文：** 在 Typora 写完并保存 `.md` / `.markdown` 文件，
   图片继续留在文章旁边或自己选定的素材子目录。
2. **建议图片使用相对路径：** Typora 的「偏好设置 → 编辑器 → 图像插入」
   可选择尽可能使用相对路径。若启用了「复制图片到指定文件夹」，
   Typora 可能在 YAML 中写入 `typora-copy-images-to`；
   **它只决定 Typora 以后将粘贴图片保存在哪里**，不是 Publy 的图片根目录。
   Publy 只按文章里实际写出的图片链接定位文件。
3. **使用网站根路径时：** Typora「格式 → 图像 → 使用图像根路径」
   会写入 `typora-root-url`。Publy 支持这个**本地文件路径**、
   子目录、中文文件名和适用的 Windows 盘符；不自动从云端下载素材。
4. **打开 Publy 预览：** 当前已实现的是源码构建后的开发版 CLI。
   普通用户需要的文件选择、系统「打开方式」和不接触命令行的体验，
   仍属于后续独立发布入口的交付验收。

示例 `article.md`：

```md
---
title: 我的公众号草稿
cover: images/封面 图片.png
typora-copy-images-to: images
---

# 用 Typora 写作

![正文图](images/封面%20图片.png)
```

`typora-copy-images-to` 不是 Publy 必填字段。Typora 在部分图像 URL
转义模式下会产生 `%uXXXX` 形式的中文文件名，Publy 会在原路径查找，
不会拿其他文件夹里的同名图片替换。

## 当前开发版可用方式

```sh
publy check "D:/Writing/article.md"                  # 离线检查图片和封面
publy preview "D:/Writing/article.md"                # 本地浏览器预览
publy preview "D:/Writing/article.md" --no-open --out review.html
publy preview "D:/Writing/article.md" --no-open --out review.html --force
```

**检查和预览不会投递草稿。** 缺图、外链图片、无法上传的素材会清楚提示，
不把失败当成功。预览会内嵌图片字节，因此临时 HTML 含有私密内容；
默认在隔离的临时目录中生成，并限制文件权限。使用 `--out` 时，
必须保存为 HTML，已存在的文件默认拒绝覆盖；只有显式 `--force`
才覆盖已有 HTML。**原始 Markdown 永远不会被预览写回。**

连接经过配置的 Publy 服务并明确选定目标公众号后，另一个
`publish` 操作才会尝试投递**草稿箱**，不是公开群发。

## 现阶段不能对外承诺的事情

- 目前没有 Typora 原生工具栏插件、自动同步或完整发布伴侣安装包。
- 外链/内嵌 data 图片必须先保存为本地图片，不能静默丢图投递。
- 真实 Typora GUI、Windows/macOS/Linux 干净安装、公众号实机投递
  尚未全部验收通过；CI 成功不等于已达到商业公开版本。
- 产品不会扩展到知乎、头条、WordPress、Ghost、小红书等发布目的地。

参考：[Typora 图片官方文档](https://support.typora.io/Images/)、
[Typora YAML 官方文档](https://support.typora.io/YAML/)、
[产品范围](platform-strategy.zh-CN.md)、[安装发行状态](distribution.md)。
