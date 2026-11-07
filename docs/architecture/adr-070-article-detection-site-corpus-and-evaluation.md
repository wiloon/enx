---
status: accepted
date: 2026-11-07
related: adr-034（正文识别；本 ADR 不改它的规则，只定怎样衡量和改进它）、adr-010（站点 adapter）、adr-028（阅读统计）
---

# ADR-070：正文识别以主流英文站点清单为支持范围，用评估工具量化后再改

ADR-034 修订（2026-11-07）定了：**正文只认 selector**，没匹配上的页面是整页，只能划词查词。这样不会再误拦截页面自己的点击（InfoQ 首页 Trending 标签），代价是 selector 没覆盖到的站点丢了单击查词、下划线和阅读统计。

所有者决定：**要解决的问题是「主流英文站点的文章页，单击查词落在正确的正文节点上」。** 做法是先定一份站点清单作为支持范围，用一个评估工具量出每个页面选中的节点对不对，再按通用性从高到低补 selector 和 adapter。

## 背景：「匹配上」不等于「选对了」

2026-11-07 用 curl 取服务端 HTML，抽了 18 个页面（Guardian、BBC、NPR、CNN、The Verge、Wired、TechCrunch、Ars Technica、dev.to、Cloudflare blog、Stratechery、Joel on Software、Simon Willison、Paul Graham、Wikipedia 等）：

- 内置 selector 匹配上 11 个，但没核对选得对不对。例如 Ars Technica 选中的 `.post-content` 只有 2294 字符，整页有 22926 字符，很可能是一段导语或卡片，不是正文。
- 有 `itemprop="articleBody"` 的只有 1 个（CNN，本来就被 `article` 匹配）。新闻站改用 JSON-LD 声明 `@type: NewsArticle`，它只说明「这页是文章」，指不出正文节点。所以不加这条 selector。
- 匹配不上的多是没有语义标记的手写个人站（Paul Graham、Simon Willison）。
- Standard Ebooks 只差一条站点规则（#700，用 `epub:type="bodymatter"`）。

单凭人工抽查，看不出每个站选得对不对，也发现不了站点改版后的退化。

## 决定

1. **支持范围是一份站点清单。** 清单列出主流英文阅读站点，每个站取 2–3 篇文章页，按类别分：新闻、科技媒体、博客平台（Medium、Substack、WordPress、Ghost）、技术文档（MDN、GitHub README 等）、个人站。清单在仓库里，只存网址；它就是「主流英文站点」的定义，加站点改清单。
2. **用评估工具衡量，Readability 当参照答案。** 工具在真实浏览器里打开清单上的每个页面，用扩展的识别逻辑（`resolveSiteAdapter` + `findLookupArea`）选出正文节点，再拿 Mozilla Readability 抽出的正文作参照，算两个分数：
   - **覆盖率**：参照正文有多少落在选中节点里（选少了，单击在正文的一部分不生效）。
   - **精度**：选中节点里有多少是参照正文（选多了，导航、推荐列表里的点击会被拦截）。

   Readability 只装成 enx-chrome 的 devDependency，只在评估工具里跑，**不进扩展**。理由同 ADR-034 修订：猜出来的节点不配拥有拦截单击的权限。Readability 自己也会抽错，两者分歧大的页面由人看一眼，判断是哪边错。
3. **按通用性从高到低修。** 先补能覆盖一类站点的通用 selector（例如博客平台模板的类名，一条救几十个站），剩下的单个站点再写 adapter。每次修改附上评估工具改前、改后的分数。
4. **结果存成基线，用来发现退化。** 每个页面的分数存进仓库，下次运行时和基线比。评估跑在线上真实网站，会受改版、付费墙、反爬影响，所以**不进 CI**，按需手动跑（或以后定期跑）。网页快照有版权问题，不进 public 仓库；需要快照时放 catglish-private。

## 不做的事

- **不把启发式识别（Readability 或最大文本块）放回扩展。** 如果评估显示 selector 方案的覆盖率始终上不去，另一条路是让单击处理本身更安全（例如 `cursor: pointer` 的元素放行，只拦截确实打在单词上的点击），之后再考虑放回启发式。那会改 ADR-034 修订，要另写 ADR，等数据出来再说。
- **不做非英文站点。** 学习模式只面向英文文章。

## 后果

- 「支持哪些站点」从口头印象变成一份清单和一组分数，能回答「主流站点里多少能单击查词」。
- 每加一条 selector，都能看出它在别的站点上有没有选多了。
- 清单和基线要有人维护：站点改版、网址失效时要更新。
- 评估工具依赖线上网站，结果会有波动；它是改进工具，不是验收门槛。
