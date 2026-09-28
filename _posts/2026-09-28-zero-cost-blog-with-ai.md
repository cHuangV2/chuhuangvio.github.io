---
title: 零服务器、零成本、零框架：我和 AI 结对，几轮对话搭出这个 4KB 的博客
subtitle: 不用 Next.js，不用 Hexo 主题，不买服务器。GitHub Pages + Jekyll + 几百行手写代码，顺手还做了一个网文编辑器。全部源码公开。
description: 用 GitHub Pages + Jekyll 从零搭建个人博客的完整实录：和 AI 编程助手结对开发，首页 HTML+CSS 压缩后约 4KB，零服务器零成本，附 SEO 清单、中文字数统计、自动目录与纯前端网文编辑器的实现细节和源码。
tags: [GitHub Pages, Jekyll, AI 编程, 静态博客, SEO, 前端性能, 独立开发]
image: /assets/img/og-zero-cost-blog.png
---

先报几个数字，都是在这个站上实测的：

| 指标 | 数值 |
| --- | --- |
| 服务器费用 | 0 元（GitHub Pages 托管） |
| 首页 HTML + CSS（gzip） | 约 4 KB |
| JavaScript 框架 | 0 个 |
| 模板 + 样式代码 | 约 520 行 |
| 网文编辑器（HTML + CSS + JS，gzip） | 约 10 KB |
| 本地完整构建耗时 | 不到 1 秒 |

这些代码大部分是我和 AI 编程助手（Claude Code）在几轮对话里写出来的。我负责提需求、看效果、拍板，它负责查资料、写代码、截图自测。下面把整个过程和关键实现摊开讲，源码在 [GitHub](https://github.com/cHuangV3/cHuangV3.github.io)，可以直接抄。

## 为什么不用 Next.js / Hexo / WordPress

一个个人博客，真正的需求其实就三条：

1. **写起来顺手**：用 Markdown，推送即发布；
2. **打开要快**：读者点进来就能看，不等加载；
3. **不用维护**：不交服务器费，不升级依赖，不怕被黑。

对照一下：

- **WordPress** 要服务器、要数据库、要打补丁，第三条直接出局；
- **Next.js / Astro** 很强，但一个纯文字博客用不上 SSR，还得维护 `node_modules` 和 CI；
- **Hexo / Hugo 主题**省事，可主题往往塞满了用不上的功能，改起来要先读懂别人的代码。

最后选了最“土”的方案：**GitHub Pages 原生支持的 Jekyll**。推送到 `master`，GitHub 自动构建和部署，不用配 Actions，不用装任何东西。

## 整个站只有这些文件

```text
.
├── _config.yml              # 站点配置、SEO、插件
├── _layouts/
│   ├── default.html         # 页头、页脚、<head>
│   └── post.html            # 文章页
├── _includes/
│   └── article-list.html    # 按年份分组的文章列表
├── _posts/                  # 文章，一篇一个 Markdown
├── articles/index.html      # /articles/ 列表页
├── editor/index.html        # 网文编辑器
├── assets/css/style.css     # 全站样式
├── index.html               # 首页
└── robots.txt
```

没有 `package.json`，没有构建脚本，没有依赖锁文件。版式参考的是李笑来老师网站的 Articles 页面：年份分组、日期加标题、一个向右的箭头，干净利落。

## 几个值得一抄的实现

### 1. 按年份分组，一行 Liquid 搞定

```liquid
{% raw %}{% assign years = site.posts | group_by_exp: "post", "post.date | date: '%Y'" %}
{% for year in years %}
  <h2>{{ year.name }} <small>{{ year.items.size }} 篇</small></h2>
  {% for post in year.items %} ... {% endfor %}
{% endfor %}{% endraw %}
```

`group_by_exp` 是 Jekyll 自带的过滤器，不需要任何插件。

### 2. 中文字数和阅读时间

Jekyll 自带的 `number_of_words` 按空格分词，对中文基本无效。GitHub Pages 用的 Jekyll 3.x 也没有 CJK 模式。解决办法很朴素：去掉 HTML、换行和空格，剩下的字符数就是字数，再按每分钟 400 字估算阅读时间。

```liquid
{% raw %}{% assign chars = content | strip_html | strip_newlines | remove: ' ' | size %}
{% assign minutes = chars | divided_by: 400 | plus: 1 %}{% endraw %}
```

### 3. 二十行 JS 的自动目录

文章里有两个以上二级标题时，自动在正文前生成“本文目录”：

```js
var heads = document.querySelectorAll('#post-body h2');
if (heads.length < 2) return;
heads.forEach(function (h, i) {
  if (!h.id) h.id = 'section-' + (i + 1);
  // 生成 <li><a href="#id">标题</a></li> 并插入目录
});
```

不装插件，不改 Markdown，写文章时完全不用管它。

### 4. 深色模式：只换 CSS 变量

全站颜色都定义成 CSS 变量，深色模式只需要在媒体查询里重新赋值，跟随系统自动切换：

```css
:root { --bg: #fbfaf7; --fg: #1a1a1a; --accent: #9a3412; }
@media (prefers-color-scheme: dark) {
  :root { --bg: #141414; --fg: #e8e6e1; --accent: #f59e6b; }
}
```

## SEO：静态站也能做满分功课

静态博客最容易被忽视的就是搜索引擎优化。下面这份清单全部用 GitHub Pages 白名单里的官方插件实现，零成本：

- **`jekyll-seo-tag`**：一行 `{% raw %}{% seo %}{% endraw %}` 自动生成 `<title>`、`description`、`canonical`、Open Graph、Twitter Card，以及给文章用的 JSON-LD `BlogPosting` 结构化数据；
- **`jekyll-sitemap`**：自动生成 `sitemap.xml`，新文章不用手动登记；
- **`robots.txt`**：声明站点地图位置，同时屏蔽不需要收录的页面（比如编辑器）；
- **`jekyll-feed`**：RSS 订阅，老派但依然是技术读者最爱的订阅方式；
- **分享卡片图**：每篇文章可以在 front matter 里指定 `image`，发到社交平台时显示大图预览；
- **`keywords`**：从文章 `tags` 自动生成，照顾百度这类还会参考关键词的搜索引擎；
- **语义化 URL**：`/articles/2026-09-28/zero-cost-blog-with-ai/`，日期加英文短标题，稳定、可读、利于分享。

写文章时只需要在开头多写两行：

```yaml
---
title: 文章标题
description: 给搜索引擎看的一句话摘要
tags: [关键词一, 关键词二]
image: /assets/img/cover.png
---
```

## 顺手做了一个网文编辑器

我自己还在写网文，市面上的码字软件要么收费，要么要注册，要么把稿子传到别人的服务器。于是在博客里加了一个 [写作](/editor/) 页面，纯前端、零后端：

- **作品 / 章节管理**：多部作品，章节新建、改名、排序、删除，侧栏实时显示每章字数；
- **回车自动缩进**：回车自动补两个全角空格，符合网文排版习惯；
- **一键排版**：去掉多余空行和首尾空白，统一首行缩进，还能 `Ctrl+Z` 撤销；
- **日更目标**：顶栏显示今日净增字数和进度条，默认 4000 字；
- **全书查找替换**：给角色改名是网文作者的刚需；
- **设定面板**：人物、金手指、大纲、伏笔清单，边写边查；
- **专注模式**、字号调节、跟随系统的深色模式；
- **导出 TXT**（单章 / 全书）和 **JSON 备份恢复**。

稿子只存在你自己浏览器的 `localStorage` 里，不经过任何服务器。所以请记得定期点「更多 → 备份」。

实现上有个小技巧：排版、替换这类整段改写，不直接给 `textarea.value` 赋值（那样会清掉撤销记录），而是先选中范围，再用 `document.execCommand('insertText')` 写入，浏览器原生的撤销栈就保留下来了。

## 和 AI 结对编程的真实体感

说几点实话：

1. **需求说清楚比什么都重要**。“参考某某网站的文章模块，不要书籍模块”这种一句话需求，它能直接拆成布局、列表、文章页、RSS。
2. **它会自己验证**。每次改完都会本地构建，用无头浏览器截桌面和手机两种尺寸的图，还会塞几篇临时文章测多篇时的排版，测完再删掉。
3. **它也会踩坑，但会追到底**。测试编辑器导出时，中文文件名变成了 `download`。它没有糊弄过去，而是写了最小复现，定位到是测试环境没设 UTF-8 语言环境，真实浏览器不受影响。
4. **拍板的还是人**。标语、配色、要不要某个功能，这些它会给默认值，但会明确告诉你“这是我暂拟的，你来改”。

## 你也可以十分钟拥有一个

1. Fork [这个仓库](https://github.com/cHuangV3/cHuangV3.github.io)，改名为 `你的用户名.github.io`；
2. 改 `_config.yml` 里的标题、简介、`url`；
3. 删掉 `_posts/` 里的文章，写你自己的；
4. 在仓库 Settings → Pages 里确认从 `master` 分支发布。

就这些。没有服务器账单，没有依赖升级，没有“主题作者不维护了”。

如果这篇对你有用，欢迎用 [RSS](/feed.xml) 订阅，或者去 GitHub 点个 Star。下一篇打算写：**怎么让这个静态博客被 Google 和百度更快收录**。
