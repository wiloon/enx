---
status: proposed
date: 2026-11-09
related: adr-034（正文识别）、adr-070（第二阶段的方向）、adr-072（识别分层第 6 层）、adr-073（用户手动指定正文）、adr-074（Readability 进扩展）、adr-075（人工标注评测集）
amends: 以下三处均待所有者接受后才生效：adr-034 修订（2026-11-07）「正文只来自 selector」；adr-072 决定 1 第 6 层的「待做」状态；adr-074 决定 2「Readability 只用于『用阅读器打开』，不参与原页面上的正文识别」
---

# ADR-077：正文识别第二阶段：页面用 JSON-LD 声明自己是文章时，用 Readability 选出的节点兜底

ADR-072 的识别分层里，第 6 层「更严格的启发式兜底」一直是待做。#744（PR #768）第一次用 WCXB 全量量了一遍：1,099 个文章页和文档页里，31%（341 页）找不到正文节点，学习模式只能整页开启，单击查词、单词高亮和阅读统计都没有。selector 命中时我们的分数和 Readability 接近，差距几乎全在这 341 页上。

本 ADR 记下 #770 的测量：这 341 页有哪些信号，几种候选启发式各能救回多少页、又会把多少页弄错，在非文章页上会误选多少；再据此提出第 6 层的规则。ADR-070 的原则不变：**精度优先，拿不准就整页。**

## 测量方法

- **数据：** WCXB 固定提交 `c039d5ee`，`metadata.json` 列出的 1,869 页全部量（dev 和 test 两个 split）。文章集是 `article` 和 `documentation` 两类；负样本是 `listing`、`collection`、`product`、`service`、`forum` 五类。另量 Zyte（固定提交 `4a3bc979`，181 篇新闻）和在线站点清单（`article-eval/corpus.json`，172 页）。快照只放本地缓存，不进仓库（ADR-075）。
- **基线：** 扩展现在的 `findLookupArea`（第 3–5 层 + 整页）。WCXB 上复现了 #744 的数字：ok 580、misses text 120、too broad 54、whole page 341（文章 287、文档 54）。
- **候选只在基线整页时才跑**，也就是第 1–5 层都没命中之后。所以候选只可能把「整页」变成「ok」或变成错的节点。错的节点（too broad、misses text）比整页更糟：选少了，正文的一部分单击无效；选多了，导航和推荐里的点击会被拦截。
- **打分：** 沿用 `score.ts` 的 5 词 shingle 和结论门槛（覆盖率 ≥ 0.8、精度 ≥ 0.7），参照答案是数据集的人工标注；在线清单没有标注，参照答案是 Readability 的正文。
- **链接密度：** 节点去掉 `script`、`style`、`noscript` 后，链接文字长度除以全部文字长度，空白先合并。ADR-034 修订里 InfoQ 的 0.28 是按原始 `textContent` 算的，与这里的口径不同。
- **测量代码是一次性的**，没有留在仓库里。

## 341 个整页页面有哪些信号（WCXB）

| 信号 | 页数（共 341） |
|---|---|
| JSON-LD 有文章类 `@type`（规则见决定 1；出现的是 `Article`、`NewsArticle`、`BlogPosting`、`TechArticle`） | 70 |
| `og:type` = `article` | 159 |
| 有发布时间元数据（`article:published_time`、`itemprop="datePublished"` 或 JSON-LD `datePublished`） | 135 |
| 以上三者任一 | 194 |
| 有 `<article>` 元素 | 1 |
| 有 `<main>` | 161 |
| 有 `role="main"` | 44 |
| 有 `<main>` 或 `role="main"` | 185 |
| Readability `isProbablyReaderable` 为真 | 336 |
| Readability 选出节点（映射回原页面，见决定 1） | 340 |
| 　其中链接密度 ≤ 0.1 / ≤ 0.2 / ≤ 0.3 / ≤ 0.5 / > 0.5 | 289 / 29 / 7 / 9 / 6 |
| 　其中文字 > 5,000 / 2,000–5,000 / 1,000–2,000 / < 1,000 字符 | 283 / 44 / 9 / 4 |
| Readability 的正文与人工标注比，结论为 ok | 280 |

**常见结构：**

- 几乎都没有 `<article>`（340 页）。内置的 `article` selector 救不了它们，这也是它们落到整页的原因。
- 按「有没有 JSON-LD 或 `og:type` 文章声明」和「有没有 `main`」分：有声明、无 `main` 的 99 页；无声明、有 `main` 的 94 页；两者都有的 86 页；两者都没有的 57 页；另有 5 页 Readability 判为不可读。
- **平台**（取页面第一个 `meta[name="generator"]`）：218 页没有。有的里面 WordPress 系最多，共 65 页（`WordPress` 27、`All in One SEO` 9、`WP Rocket` 7、Elementor 7、Divi 7、`Site Kit by Google` 4、WPBakery 2、WPML 2，后几种是 WordPress 的插件或主题）；其次是 Gatsby 7、Webflow 7、HubSpot 6、MediaWiki 6、Drupal 4，Hugo、Joomla、NitroPack、SEOmatic 各 3。WordPress 系页面仍落到整页，说明 `.entry-content` 这条平台级 selector（ADR-072 决定 2）在 Divi、Elementor 这类页面构建器上够不着，或者站点没有输出 `WordPress` 的 generator。具体是哪一种，本次没有逐页区分。

Zyte 的 181 篇里有 33 篇整页：14 篇有 JSON-LD 文章声明，25 篇有 `og:type=article`，30 篇 `isProbablyReaderable`，8 篇有 `main` 或 `role="main"`。

## 候选启发式

每个候选由一个**节点**和一道**门槛**组成：门槛不过就保持整页。节点：

- **Readability 节点：** 在文档克隆上跑 Readability，把它抽出的正文映射回原页面（克隆上每个元素先打上序号，抽出的 HTML 里带序号的元素在原页面上的最近公共祖先）。节点不能是 `body`。
- **`main`：** 页面上只有一个最外层的 `main` 或 `role="main"` 时取它。
- **段落聚类：** 不用 Readability 的轻量写法。找出段落文字（`p`，≥ 25 字符，不在 `nav`、`header`、`footer`、`aside`、`form` 里）最多的父元素，再往上扩，直到上一层增加的段落文字不足三分之一。

门槛：`isProbablyReaderable`；JSON-LD 文章类型；`og:type=article`；发布时间元数据；以及它们的组合。每个候选另有节点条件：文字 ≥ 500 字符、链接密度 ≤ 0.1 / 0.2 / 0.3。

### 文章集：341 个整页页面会变成什么（WCXB）

都是文字 ≥ 500 字符，链接密度 ≤ 0.2。「变差」= 变成 too broad 或 misses text。

| 节点 | 门槛 | 变 ok | 变差（misses / broad） | 仍整页 |
|---|---|---|---|---|
| Readability | 无 | 276 | 39（21 / 18） | 26 |
| Readability | `isProbablyReaderable` | 274 | 37（20 / 17） | 30 |
| Readability | `og:type=article` | 133 | 16（10 / 6） | 192 |
| Readability | JSON-LD 或 `og:type` | 157 | 18（10 / 8） | 166 |
| Readability | JSON-LD、`og:type` 或发布时间 | 162 | 20（11 / 9） | 159 |
| **Readability** | **JSON-LD 文章类型** | **64** | **4（0 / 4）** | **273** |
| `main` | `isProbablyReaderable` | 139 | 26（4 / 22） | 176 |
| `main` | JSON-LD 文章类型 | 25 | 4（0 / 4） | 312 |
| 段落聚类 | 无 | 232 | 83（74 / 9） | 26 |
| 段落聚类 | JSON-LD 文章类型 | 54 | 12（9 / 3） | 275 |

链接密度门槛从 0.2 收到 0.1，「Readability + JSON-LD」变 ok 的从 64 降到 60，变差的不变；放到 0.3 与 0.2 相同。文字下限 500 和 1,000 结果相同。

「Readability + JSON-LD」按页面类型：文章 287 页里 62 页变 ok、4 页变 too broad；文档 54 页里 2 页变 ok，其余没有 JSON-LD 文章声明，仍整页。变差的 4 页覆盖率都在 0.87–0.97，精度 0.42、0.66、0.67、0.70，是比正文多带了一圈（作者栏、相关文章），不是选到了别处。

在 Readability 节点上再加段落数（≥ 3 / 5 / 8 个 80 字符以上的段落）和占全页文字比例（≥ 0.3 / 0.5）这类结构门槛，最好的一组（「JSON-LD、`og:type` 或发布时间」，段落 ≥ 8，比例 ≥ 0.5）是 146 页变 ok、12 页变差、负样本误选 31 页，仍远不如只用 JSON-LD 干净。

### Zyte：33 个整页页面

| 节点 | 门槛 | 变 ok | 变差 | 仍整页 |
|---|---|---|---|---|
| Readability | 无 | 30 | 0 | 3 |
| Readability | `isProbablyReaderable` | 28 | 0 | 5 |
| Readability | `og:type=article` | 22 | 0 | 11 |
| **Readability** | **JSON-LD 文章类型** | **12** | **0** | **21** |
| `main` | JSON-LD 文章类型 | 4 | 0 | 29 |
| 段落聚类 | JSON-LD 文章类型 | 13 | 0 | 20 |

Zyte 全是新闻文章，没有负样本，所以这里看不出门槛宽松的代价。

### 负样本：非文章页会不会被误选（WCXB）

两个 split 的五类非文章页共 770 页，3 页数据集里没有网址，量不了（forum 2、service 1）。「基线已有节点」是第 3–5 层已经给了节点的页，不是本 ADR 引入的；「候选新给节点」只算基线整页、候选门槛通过并选出节点的页。

| 类型 | 总数 | 已量 | 没量（原因） | 基线已有节点 | 基线整页 | 候选新给节点：Readability + JSON-LD | 对照：Readability + `isProbablyReaderable` | 对照：Readability + `og:type` |
|---|---|---|---|---|---|---|---|---|
| collection | 125 | 125 | 0 | 47 | 78 | **0** | 11 | 2 |
| forum | 163 | 161 | 2（没有网址） | 88 | 73 | **0** | 41 | 10 |
| listing | 138 | 138 | 0 | 61 | 77 | **0** | 15 | 6 |
| product | 120 | 120 | 0 | 61 | 59 | **0** | 29 | 2 |
| service | 224 | 223 | 1（没有网址） | 86 | 137 | **1** | 83 | 19 |
| 合计 | 770 | 767 | 3 | 343 | 424 | **1** | 179 | 39 |

（对照列同样是链接密度 ≤ 0.2、文字 ≥ 500 字符。）

forum 单独看：论坛页可能是一篇长帖（接近文章），也可能是一串回复，不能当作全是非文章。这里 73 个整页论坛页，「Readability + JSON-LD」一页都没选；用 `isProbablyReaderable` 作门槛会选 41 页。

「Readability + JSON-LD」唯一的误选是 `https://www.terminix.com/coupons-and-discounts/`（service，dev split）：一页优惠券列表，但它在 JSON-LD 里把自己声明成 `BlogPosting`，选中节点链接密度 0.04。页面自己说是文章，规则照信。

### 在线站点清单

2026-11-10（UTC）跑 `article-eval/corpus.json` 的 172 页：167 页打开，4 页 HTTP 403（wordpress.com、joelonsoftware.com 各 2 页），1 页超时（ScienceDaily）。基线 ok 100、too broad 30、misses text 10、整页 27（科技媒体 10、个人站 7、文档 6、新闻 2、参考 2）。

这里的参照答案就是 Readability 的正文，所以 Readability 节点对它的分数偏高，只能看出「节点比 Readability 的正文宽多少」，不能证明选对了。

| 门槛（节点都是 Readability，链接密度 ≤ 0.2，文字 ≥ 500） | 通过门槛 | 给出节点 | 与 Readability 正文比：ok / too broad |
|---|---|---|---|
| **JSON-LD 文章类型** | **8** | **8** | **7 / 1** |
| `og:type=article` | 16 | 16 | 13 / 3 |
| `isProbablyReaderable` | 24 | 21 | 18 / 3 |
| 无 | 27 | 23 | 20 / 3 |

「Readability + JSON-LD」给出节点的 8 页是 Al Jazeera、mitchellh.com、MIT Technology Review、DigitalOcean 教程各 2 页。too broad 的 1 页是 MIT Technology Review 的「2026 年值得关注的气候科技公司」榜单（覆盖率 0.98，精度 0.66）。其余 19 页仍整页，它们都没有 JSON-LD 文章声明：Paul Graham、Simon Willison、Martin Fowler、Dan Luu 这类个人站，Project Gutenberg，LWN、Quanta、ScienceDaily、filfre，MDN 和 Node.js 博客。

### InfoQ 首页（在线）

ADR-070 第二阶段要求新规则拒绝 InfoQ 首页这类首页和索引页（ADR-034 修订记下了原来的最大文本块兜底在这里选中 `div#infoq`，按原始 `textContent` 算链接密度 0.28）。经检测路径（`resolveSiteAdapter` + `findLookupArea`，候选接在整页之后）实测：

| 时间（UTC） | 网址 | 基线 | JSON-LD `@type` | `isProbablyReaderable` | Readability 节点 | 节点链接密度 | 「Readability + JSON-LD」结论 |
|---|---|---|---|---|---|---|---|
| 2026-11-10 05:31 | `https://www.infoq.com/` | 整页 | `WebSite` | 否 | `div#infoq > header.header > div.header__container` | 0.39 | 整页 |
| 2026-11-10 05:52 | `https://www.infoq.com/` | 整页 | `WebSite` | 是 | 同上 | 0.40 | 整页 |
| 2026-11-10 06:36 | `https://www.infoq.com/` | 整页 | `WebSite` | 否 | 同上 | 0.39 | 整页 |
| 2026-11-10 06:37 | `https://www.infoq.com/` | 整页 | `WebSite` | 否 | 同上 | 0.40 | 整页 |

两道门槛各自都会拒绝它：JSON-LD 没有文章类型，Readability 节点的链接密度也超过 0.2。`isProbablyReaderable` 四次里只有一次为真，说明首页内容在变，它不适合当门槛。按本 ADR 的口径，四次测量里 `main` 的链接密度是 0.86–0.87，`body` 是 0.51–0.52。后两次另外记下：页面没有 `og:type`；段落聚类找到的合格段落（`p`，≥ 25 字符，不在 `nav`、`header`、`footer`、`aside`、`form` 里）全页只有 3 个。

各候选在 InfoQ 首页上的结论（只写观察到或能由观察到的数值直接得出的）：

| 候选 | 门槛在 InfoQ 上 | 节点与链接密度 | 结论 |
|---|---|---|---|
| Readability + JSON-LD | 不通过（`WebSite`） | `div#infoq > header…`，0.39–0.40 | 整页（四次实测） |
| Readability + `isProbablyReaderable` | 四次里一次通过 | 同上，0.39–0.40 | 整页：没通过时被门槛拒，通过的那次密度 > 0.2（由实测密度得出） |
| Readability + `og:type` | 不通过（没有 `og:type`，后两次实测） | 同上，0.39–0.40 | 整页 |
| Readability，无门槛 | — | 同上，0.39–0.40 | 整页：节点密度 > 0.2（由实测密度得出） |
| `main` + `isProbablyReaderable` | 四次里一次通过 | 0.86–0.87 | 整页：密度 > 0.2（由实测密度得出） |
| 段落聚类 + JSON-LD | 不通过（`WebSite`） | 同下 | 整页 |
| 段落聚类，无门槛 | — | `div#infoq > section.section.container > div.container__inner > div.actions > div.actions__left`，127–132 字符，0.09（后两次实测） | 整页：节点文字不足 500 字符。链接密度本身过了 0.2，拒绝靠的是文字下限 |

## 决定 1：第 6 层 = JSON-LD 文章声明 + Readability 节点

第 1–5 层都没命中、要退回整页之前（只走没有 `contentSelector` 的默认 adapter 路径；有 `contentSelector` 的 adapter 照旧，ADR-010、ADR-071），按顺序检查：

1. **门槛：** 页面的 `script[type="application/ld+json"]` 里（包括 `@graph`、`mainEntity`、`mainEntityOfPage` 里嵌套的对象）有一个 `@type` 以 `Article` 结尾（`Article`、`NewsArticle`、`TechArticle`、`ScholarlyArticle` 等），或是 `BlogPosting`、`LiveBlogPosting`、`APIReference`。这就是测量用的规则；本次数据里实际出现的只有 `Article`、`NewsArticle`、`BlogPosting`、`TechArticle`。没有就整页，不加载 Readability。
2. **节点：** 在文档克隆上跑 Readability，把它抽出的正文映射回原页面，取这些元素的最近公共祖先。没有结果，或结果是 `body`、`html`，就整页。
3. **节点条件：** 去掉 `script`、`style`、`noscript` 后文字 ≥ 500 字符，链接密度 ≤ 0.2。不满足就整页。

通过的节点就是正文，和 selector 找到的正文一样：单击查词、单词高亮、阅读统计都生效，正文里的查词排除（链接、表单控件、ARIA 交互角色、可编辑区域）不变。用户手动指定正文（ADR-073）仍排在最前面，可以覆盖它。

**量出来的效果：** WCXB 341 个整页页面里 64 页变 ok（文章 62、文档 2），4 页变 too broad，0 页变 misses text；Zyte 33 页里 12 页变 ok，0 页变差；在线清单 27 个整页页面里 8 页给出节点（与 Readability 正文比 7 页 ok、1 页 too broad）；负样本 424 个整页页面里误选 1 页；InfoQ 首页保持整页。

**接受的误差（请所有者确认）：**

- 负样本误选：**1 页**（770 页中，基线整页的 424 页里 1 页；即上文 terminix 优惠券页）。实现后在同一提交上复测，超过 1 页要回到本 ADR 重新定门槛。
- 文章集变差：WCXB **4 页** too broad，Zyte 0 页。

**为什么用 Readability，而不是自己写：** 同样过 JSON-LD 门槛，Readability 节点变 ok 64 页、变差 4 页；`main` 只有 25 页；段落聚类 54 页，变差却有 12 页（9 页 misses text）。Readability 的打分处理了被拆成多块的正文、页内推荐和评论，这些自己写一遍代价不小，也难做到同样准。

**为什么不用更宽的门槛：** 加上 `og:type=article`，WCXB 变 ok 的从 64 页增到 157 页，但变差的从 4 页增到 18 页，负样本误选从 1 页增到 40 页，service 类就有 20 页。`og:type=article` 是 Open Graph 分享卡片的默认值之一，很多 CMS 给每个页面都写上，说明不了「这页是文章」。`isProbablyReaderable` 更宽：负样本误选 179 页，InfoQ 首页也会被判为可读。

## 决定 2：Readability 怎样进内容脚本（修订 ADR-074 决定 2）

ADR-074 决定 2 让 Readability 进扩展，但只用于「用阅读器打开」，不参与原页面的正文识别。本 ADR 提议改为：**Readability 也用于第 6 层，但只在 JSON-LD 门槛通过后才加载。**

- **不进常驻的内容脚本包**（ADR-070 决定 2、ADR-074 的约束不变）：Readability 打成单独的块，内容脚本在第 1–5 层都没命中、且 JSON-LD 门槛通过时才按需加载（由 background 用 `chrome.scripting.executeScript` 注入，或内容脚本动态 `import()` 扩展内的 `web_accessible_resources`，实现时二选一）。JSON-LD 检查只是读几个 `<script>` 元素的文字再 `JSON.parse`，放在常驻包里。
- **与「用阅读器打开」共用同一个块**，扩展体积只多一份。ADR-074 还没实现，两者谁先落地，谁先引入这个块。
- **成本：** Readability 的源码约 90 KB（未压缩）。在 Zyte 的 181 个快照上，克隆、Readability 解析和映射回原页面合计 p50 7 ms、p90 16 ms、最长 43 ms；在线的 InfoQ 首页 233 ms。快照不跑页面脚本，比真实页面的 DOM 小，所以这是下限；实现时要在在线清单上再量一次。它只在学习模式开启时跑一次，而且只在页面声明自己是文章、前几层又都没命中时才跑。
- 「猜出来的节点不能拥有拦截单击的权限」（ADR-070 决定 2、ADR-034 修订的理由）不再一概适用：本层的节点不是按文本长度猜的，要页面自己声明是文章、Readability 认出正文、链接密度够低，三条同时成立。量出来的误选率见决定 1。

**没选的方案：** 把 Readability 的打分规则移植进 `src/lib/`、只保留选节点需要的部分。这能省掉 90 KB 的按需块，但要自己维护一份 Readability 的打分逻辑，而且上面的数字是在原版 Readability 上量的，移植版要重新量。等第 6 层上线、有了真实页面上的性能数据，再决定值不值得。

## 决定 3：「更安全的单击」放到第 6 层之后，单独做

ADR-070 第二阶段把「启发式兜底」和「更安全的单击」放在一起考虑：单击越安全，启发式猜错的代价越小，门槛就可以放宽。

本 ADR 决定**先做第 6 层，「更安全的单击」以后另写 ADR**，不阻塞本层：

- 只用 JSON-LD 门槛时，误选和变差都很少（负样本 1 页、文章集 4 页 too broad），不需要靠更安全的单击来兜。
- 更安全的单击对 selector 找到的正文同样有用（正文里也会有标签页、折叠块），它的价值不依赖第 6 层，应该按自己的需要排期。
- 它落地以后，可以拿本 ADR 的数据重新考虑放宽门槛：加上 `og:type=article` 能多救 93 页，代价是 14 页变差、39 页负样本误选。到时候另写 ADR，在同一套数据上重量。

## 提议修订的已接受决定（待所有者接受）

所有者接受本 ADR 之前，下面这些都**不生效**，相关 ADR 不改：

1. **ADR-034 修订（2026-11-07）第 1 条**「正文只来自 selector」：改为正文来自 selector，或第 6 层（本 ADR 决定 1）。没有 selector 命中且第 6 层也拒绝时，照旧整页、只能划词查词。ADR-034 写明不再追加修订，所以接受后只在它的状态行和页首说明里加一句指向本 ADR，不在文末加修订节。
2. **ADR-072 决定 1 第 6 层**：状态由「待做，另写 ADR」改为「已定（ADR-077），待实现」；实现合并后改为「已有」。
3. **ADR-074 决定 2**：Readability 不再只用于「用阅读器打开」，也用于第 6 层，按决定 2 的方式按需加载。接受后在 ADR-074 的状态行注明。

接受后，还要同步更新 `docs/agents/article-detection.md`，在实现合并时写进第 6 层的当前行为。

## 后果

- 声明了文章类型、但没被任何 selector 认出的页面（WCXB 上 70 页里的 64 页，在线清单上 8 页），单击查词、高亮和阅读统计回来了。WCXB 341 页里剩下的 273 页仍整页：多数没有 JSON-LD 文章声明（`og:type` 有，但单独靠它太宽）。在线清单上没有语义标记的个人站、MDN 这类文档仍要靠站点 selector、adapter 或用户手动指定正文（ADR-073）。
- 第 6 层的结果取决于站点自己写的 JSON-LD：把列表页声明成 `BlogPosting` 的站点会被误选（terminix），站点删掉 JSON-LD 会让页面退回整页。评估工具能看到这两种变化。
- 内容脚本多了一个按需加载的块；学习模式在这类页面上开启时多一次 Readability 解析。
- 评估工具要能报告第 6 层：实现时 `article-eval` 的 `SOURCE` 一列要能区分 selector 和第 6 层，WCXB 的负样本要能一起量（现在 `WCXB_PAGE_TYPES` 只有文章和文档）。
