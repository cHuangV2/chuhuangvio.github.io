# cHuangV3.github.io

个人博客，网址：https://chuangv3.github.io

基于 Jekyll（GitHub Pages 原生支持），版式参考 lixiaolai.com 的 Articles 页面。

## 写文章

在 `_posts/` 下新建 `YYYY-MM-DD-slug.md`：

```yaml
---
layout: post
title: 文章标题
subtitle: 副标题（可选）
description: 给搜索引擎看的一句话摘要（可选，利于 SEO）
tags: [关键词一, 关键词二]
image: /assets/img/xxx.png  # 分享卡片图（可选，建议 1200×630）
cover: /assets/img/xxx.jpg  # 首页封面图（可选）
---
```

首页介绍区的文字在 `_config.yml` 的 `home:` 下修改。

## 网文编辑器

访问 `/editor/`。纯前端，稿子只保存在当前浏览器的 localStorage 里，换浏览器或清理数据会丢失，请定期「更多 → 备份」。该页面已设置不被搜索引擎收录。

## SEO

`jekyll-seo-tag`、`jekyll-sitemap`、`robots.txt` 已配置。在 Google Search Console / 必应 / 百度站长平台拿到验证码后，填进 `_config.yml` 的 `webmaster_verifications`，并提交 `https://chuangv3.github.io/sitemap.xml`。

## 目录

- `_config.yml` 站点配置（标题、作者等）
- `_layouts/` 页面模板
- `_includes/article-list.html` 按年份分组的文章列表
- `assets/css/style.css` 样式
- `articles/index.html` 文章列表页
- `editor/`、`assets/editor/` 网文编辑器
