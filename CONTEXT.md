# ENX

AI 辅助英语阅读工具。用户在网页上阅读英文时，ENX 标注生词、点词查释义、划词翻译整句，并把查过的词沉淀到生词本与复习系统。仓库含 `enx-api`（后端）、`enx-ui`（Web 前端）、`enx-chrome`（浏览器扩展）、`enx-sync`（同步）。

本文件只是术语表。实现决策见 `docs/architecture/adr-*.md`。

## Language

### 阅读辅助功能（enx-chrome）

**学习模式（learning mode）**：
用户在某个页面上启用 ENX 后的状态。由工具栏图标 / popup 的「Enable Learning Mode」开启（发 `enxRun`），`enxStop` 关闭。启用后整篇取词、查词、并激活下面的交互。
_Avoid_: 阅读模式、reading mode

**点击查词（click-to-lookup）**：
点正文里任意一个英文词，弹窗显示该词释义。学习模式的核心交互，不单独设开关——跟随学习模式开关。不依赖任何注入到正文的标记元素。
_Avoid_: 点词翻译、tap-to-translate

**单词高亮（word highlight）**：
给「值得复习」的生词在正文里加彩色下划线，颜色按复习档位分级。是一个**独立的、用户可开关**的功能（默认开，设置项 `enx-word-highlight-enabled`）。关掉后正文无下划线，但点击查词照常。
_Avoid_: 生词标注、划线、underline（作动词时）

**复习档位（review bucket）**：
一个生词按 `LoadCount`（被查过多少次 / 复习进度）落入的等级，决定单词高亮的颜色。少数几档（5–6），不是连续渐变。
_Avoid_: 熟练度、mastery level（`mastery` 在 IELTS 词表语境另有含义，见 adr-003）

**划词整句翻译（drag-select sentence translation）**：
选中一句话（或带句末标点、或超过短语长度的选区），把整句发到 Side Panel 翻译。见 adr-007。
_Avoid_: 选择翻译、划句翻译

**短语查询（phrase lookup）**：
选中 2–5 个词、无句末标点的选区，走 AI 的「在上下文中解释这个短语」，而非词典查询（词典无短语条目）。见 adr-008。
_Avoid_: 词组翻译、idiom lookup

**站点适配器（SiteAdapter）**：
把「某个网站与默认行为的差异」（正文选择器、最小文本长度阈值、哪个匹配节点才是正文、页面是否在支持范围内、点击监听绑定方式、内容易变程度等）收在一处的对象。默认适配器逐字段等于历史行为。见 adr-010、adr-011。
_Avoid_: site config、网站配置

**内容易变程度（contentVolatility）**：
站点适配器的一个字段，取 `static` / `spa` / `streaming`，描述正文在学习模式开启后会不会被替换，决定单词高亮要挂哪些 observer 来在 DOM 变化后重建。见 adr-011 F 节。

### 界面功能（enx-ui）

**地道表达（idiomatic rephrasing）**：
输入一段中文 / 中英混杂 / 不地道的英文，返回地道的职场美式英语说法（面向跟美国同事发消息、邮件、协作沟通时的措辞优化），附 1–2 个不同语域的备选和中文学习注解。后端是 `aitranslate` 包内与英译中方向相反、按实际 token 计费的 `Rephraser` 能力。见 adr-012。
_Avoid_: 翻译、直译、提示词生成、prompt generation
