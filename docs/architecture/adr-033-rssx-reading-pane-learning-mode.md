# ADR-033：RSSX 阅读区上的学习模式由扩展自己打开，不把 RSSX 放进「网页→扩展」通道

RSSX 只展示 Catglish 的安装态。扩展在 RSSX 阅读区里自己打开学习模式，点击查词沿用现有查词浮层。`externally_connectable` 仍然只有 enx-ui 的源。

## Status

accepted

## Context

RSSX 的首页就是 Reader：订阅列表、文章列表、阅读区。阅读区一开始是空的，Article 的 HTML 在用户选中一篇之后才出现，换一篇时会被换掉。

内容脚本已经注入 `https://rssx-lab.wiloon.com/*`（今天提供 Reader 的 host）。学习模式默认关着，要收到 `enxRun` 才开。默认站点适配器把页面当静态页：只处理启用那一刻 DOM 里的文本，之后正文被换掉不会重跑。

adr-019 的 `externally_connectable` 是唯一的「网页→扩展」通道，源白名单只有 enx-ui。白名单外的页面没有 `chrome.runtime.sendMessage`。内容脚本和页面共享 DOM，所以扩展仍然可以在页面上留下安装态。

用户在 RSSX 里读到英文词时，要点击就能出查词浮层。RSSX 侧的记录见 rssx `docs/adr/0003-catglish-on-the-open-article.md`。

## Decision

在 RSSX 这个 host 上：

- 内容脚本把安装态写到页面上，包括 Catglish 是否已登录。Reader 用它显示三种状态：未安装、已安装未登录、可用。不走 `enx:ping`。
- 阅读区里有一篇打开的 Article 时，扩展自己启用学习模式；这篇被换掉时再跑一次。
- 作用范围是这一篇的标题和 Feed 提供的正文。订阅列表和文章列表不处理。
- 未登录不启用学习模式。

不把 RSSX 的源加入 `externally_connectable`。adr-019 的通道保持只服务 enx-ui。

## Considered options

- **让 RSSX 发 `enx:enable-reader`，跟 enx-ui Reader 一样。** 那条通道故意排除了 enx-ui 以外的源。把 RSSX 加进去，等于让另一个应用驱动扩展。而且页面刚打开时阅读区是空的，这一发打在空正文上。
- **Reader 一挂载就 `enxRun`。** 此时还没有 Article。之后的选中会换掉正文，静态的一次处理看不到新 HTML。
- **在 RSSX 里做查词浮层。** 点击查词、词典和登录门禁已经在 Catglish 里。

## Consequences

- 内容脚本的 match 必须是真正提供 Reader 的源。今天是 `rssx-lab.wiloon.com`。host 变了，match 要在同一次改动里跟上。
- 换一篇 Article 必须重跑学习模式，否则新正文没有点击查词，或上一次包好的词被 Vue 重绘清掉。
- 查词仍走 Catglish 的登录态和查词配额。这里不新增词典，也不新增计费路径。
