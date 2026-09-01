# ADR-011：单词高亮改用 CSS Custom Highlight API + `caretPositionFromPoint`，并把「单词高亮」与「点击查词」拆成两个独立、可开关的功能

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-01。6 项范围/取舍决策已确认（见下方「已确认的决策」）。同日据 `docs/research/adr-010-phase2-*.md` 三份调研修订 Decision 5/6 的实现细节与 Revisit Trigger（就绪信号、路由检测机制与退路、`wordCache` 短路、`<br>` 切句仍 defer）；随后用临时探针在真实 X 页面实测确认 isolated world 收得到 Navigation API 的 `navigate` 事件，Decision 6.1 由「待验证」转「已确认」，`chrome.webNavigation` 兜路与新增权限均不需要。配套 TASK-SPEC 留到编码阶段再写。 |
| **日期** | 2026-09-01 |
| **关联 Spec** | 配套 TASK-SPEC 留到编码阶段再写（同 ADR-008 / ADR-010 的做法）；本 ADR 只定技术路径、功能边界与配置模型 |
| **关联 ADR** | [`adr-010-x-tweet-page-support.md`](adr-010-x-tweet-page-support.md)（Options D3 是本 ADR 的前身，见下方「与 ADR-010 的关系」）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（短语查询依赖「选区内能找到 `.enx-word` 锚点」，本 ADR **推翻**这一前提，`findPhraseAnchor` 与 `extractSentenceContext` 一并改为基于 `Range`）、[`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（划词整句翻译走 `window.getSelection()`，不依赖 `.enx-word`，本 ADR 不影响）、[`adr-002-word-popup-react-shadow-dom.md`](adr-002-word-popup-react-shadow-dom.md)（Shadow DOM + Popover 弹窗保留；只把弹窗**定位机制**从 CSS Anchor Positioning 换成 Floating UI 吃 `Range`）、[`adr-005-word-popup-vertical-positioning.md`](adr-005-word-popup-vertical-positioning.md)（垂直「让开一整行文字」的诉求不变，实现从「读锚点元素 `line-height` + `position-area`」改为 Floating UI 的 `offset()` middleware，本 ADR **取代**其实现部分） |
| **关联调研** | [`../research/adr-010-phase2-spa-navigation-detection.md`](../research/adr-010-phase2-spa-navigation-detection.md)（SPA 路由检测：Navigation API vs `chrome.webNavigation` vs `history` patch）、[`../research/adr-010-phase2-dom-readiness.md`](../research/adr-010-phase2-dom-readiness.md)（切推文时 `tweetText` 的 DOM 生命周期与就绪信号实测）、[`../research/adr-010-phase2-wordcache-growth.md`](../research/adr-010-phase2-wordcache-growth.md)（`wordCache` 跨推文体积增长与重跑成本） |

---

## 已确认的决策（2026-09-01）

1. **迁移范围**：9 个现有静态站点与 X 一次性全部切换到 Highlight API，不保留 `<u>` 兼容路径。
2. **依赖**：引入 `@floating-ui/dom` 做弹窗定位。
3. **点击范围**：点词查词对正文任意英文词生效，不再限于 ECDICT 认识 / 已高亮的词。
4. **悬停反馈**：不做。正文鼠标指针保持默认，删除 `.enx-word:hover` 规则。
5. **配色**：连续 hue 渐变归并为 5–6 个复习档位。
6. **X 自动重建**：页内切推文后主推文自动重新标注（`contentVolatility: 'spa'`）并入本 ADR，交付 ADR-010 Phase 2 的核心诉求。检测机制用 Navigation API，content script（isolated world）内闭环——2026-09-01 已用临时探针在真实 X 页面实测确认 isolated world 收得到 `navigate` 事件（`push` 与 `traverse` 两种类型均验证），不需要 `chrome.webNavigation` 兜底，也不新增权限。见 Decision 6.1。

---

## Context

### 现状

`enx-chrome` 的「点词查释义」目前的实现链路是：

1. `processArticleContent` 整篇取词 → 后端 `getWords` 批量查 → 填 `wordCache`（`content.tsx:443`）；
2. `applyHighlightsToNodes` 把 `wordCache` 里**每一个查过的词**在正文里用 `<u class="enx-word enx-<word>" data-word="..." style="display:inline !important; text-decoration:<hsl> underline; ...">` 包裹（`wordProcessor.ts:162`）——包裹的目的一半是「画下划线」，一半是「让这个词可点击」；
3. 默认站点走 `articleNode.innerHTML = renderWithHighlights(...)`：读出整块 innerHTML，在游离 `tempDiv` 里包裹，整体写回（`content.tsx:587`）；X 走 ADR-010 引入的 `inPlace` 策略，直接在真实文本节点上 `replaceChild`；
4. `addWordClickListeners` 给**每个** `.enx-word` 元素单独挂冒泡阶段 `click` 监听（`content.tsx:637`）。

### 这套实现的代价

| 代价 | 具体表现 |
| --- | --- |
| DOM 膨胀 | 一篇 2000–3000 词的文章多出同数量级的 `<u>` 元素，每个还带一长串 inline `style`。layout 计算、内存占用、序列化开销都随正文长度线性增长 |
| 监听器数量与词数耦合 | `addWordClickListeners` 挂几千个 `click` 监听，且没有对应解绑（`disableEnx` 靠 `replaceWith` 顺带丢弃元素） |
| `innerHTML` 回写破坏宿主页面 | 写回销毁重建正文容器下所有真实节点：宿主页面挂在正文里的事件监听失效、懒加载 `<img>` 状态丢失、React 持有的引用变野指针（ADR-010 §1.1）。ADR-010 的 `inPlace` 分支就是被这条路径逼出来的**第二套**高亮策略 |
| 分词脆弱 | 逐词 `new RegExp('\\b' + word + '\\b', 'gi')` 在每个文本节点上 `replace` + 占位符防嵌套（`wordProcessor.ts:204`）；复杂度 O(词数 × 文本节点数)；`'`、连字符、跨节点断词、Unicode 都是坑（ADR-010 §1.3） |
| 一堆副作用补丁 | flex 容器 `display:inline` 修复（`content.tsx:592`）、`<u>` 标签配对自检（`wordProcessor.ts:85`）、白色下划线哨兵（ADR-010 §1.4）——全都是「包元素 + 写 innerHTML」这条路径衍生出来的 |

### 两个被焊死的功能

现状把两件本应独立的事强绑在一个 `<u>` 元素上：

- **可点击**：点下去要知道点中了哪个词。这**不需要任何标记**——浏览器原生就能从坐标反查文本位置。
- **可见下划线**：需要一个视觉处理。这需要某种「标注」，但不一定是 DOM 元素。

因为焊在一起，导致：想要「点词查词」就必须给几乎每个词包元素，成本全压在第二件事上。

### 需求

1. 用一种**不改宿主 DOM** 的方式做下划线，消除上面整张表的代价，并让 ADR-010 的两套高亮策略收敛回一套。
2. 把「单词高亮」做成用户**可开关的功能**：默认开，用户能在扩展设置里关掉。关掉后正文不再有下划线，但**点词查词照常工作**——因为点击不依赖高亮。

---

## 与 ADR-010 的关系

ADR-010 的 Options D3 就是「CSS Custom Highlight API」，当时**明确评估过并搁置**，理由（ADR-010 Rationale）：

> 选 D2 而不是 D3：D2 的代码今天就已经存在……D3 要重写点击命中、颜色分桶，还会推翻 ADR-008 依赖的 `.enx-word` 锚点前提——为一个尚未证伪的风险付这个代价不划算。D3 作为实测失败后的明确退路记在 Revisit Trigger 里。

ADR-010 把 D3 的触发条件写成「前提 §2.4 实测失败（原地包裹让 React 报错）」。

**本 ADR 是主动触发 D3，触发理由不是 §2.4 失败，而是上面 Context 那张代价表**——即把 D3 从「X 上出事后的应急退路」提升为「所有站点的默认方案」。ADR-010 对 D3 成本的判断没有变（点击命中要重写、ADR-008 锚点要改），本 ADR 的立场是：**这些成本现在值得付了**，因为它一次性消掉 `innerHTML`/`inPlace` 两套策略、几千个监听器、逐词正则、以及一串副作用补丁。ADR-010 Decision 4（`inPlace`）与 Decision 3（取词/高亮共用一次遍历）在本 ADR 落地后**部分作废**，具体见 Consequences。

**范围决策已确认（2026-09-01）**：9 个现有静态站点与 X 一次性全部切换，不保留 `<u>` 兼容路径——「收敛回一套」是本 ADR 的主要收益，分两批迁移会多背一个 release 的双策略。

**本 ADR 吸收 ADR-010 Phase 2**：Decision 6（页内导航重建）就是 ADR-010 Roadmap 里 Phase 2 的核心诉求（页内切推文后主推文正文自动重新渲染）。ADR-010 Phase 2 的四项「启动前跑」调研已于 2026-09-01 完成（见上方「关联调研」三份文件），结论已并入 Decision 6：

- **调研项①**（patch `history` 是否可靠）：`history` 在 content script 的 isolated world 里拦不到页面自己的调用，本就不可行。改用 Navigation API——「isolated world 能否收到 `navigate` 事件」原是未验证项，2026-09-01 已用临时探针在真实 X 页面实测确认收得到（Decision 6.1），可直接采用。
- **调研项②③**（新推文 DOM 何时稳定、就绪信号）：实测已定——`article[tabindex="-1"]` 内非空 `tweetText`，取 DOM 顺序最后一个；`document.title` / `aria-live` 都不可用（前者 visibility-gated、后者全程为空）。
- **调研项④**（`wordCache` 体积）：非问题，维持现状；顺带发现重跑路径无「全命中跳过网络」的短路，本 ADR Decision 6 一并补上。

ADR-010 Phase 3/4（评论区、`streaming`）不在本 ADR 范围。

---

## 目标方案概览

```
点词查词（click-to-lookup，常开）
  ├─ 一个委托监听（正文容器 or document 捕获）
  ├─ 点击 → caretPositionFromPoint(x,y) → 拿到 Range
  ├─ Intl.Segmenter('en',{granularity:'word'}) 把 Range 扩到整词
  ├─ 命中 <a>/<button>/<code> 等祖先 → 放弃（沿用 collectTextNodes 的过滤集）
  └─ 扩词后的 Range 直接作为弹窗定位参照，不写入任何 DOM
       ├─ Floating UI: computePosition(range, popup, [offset, flip, shift, size]) + autoUpdate
       ├─ 同一个 Range 传给 extractSentenceContext（签名改为收 Range）
       └─ 弹窗关闭时无需清理正文——正文从头到尾没被动过

单词高亮（word-highlight，可开关，默认开）
  ├─ 读配置 enx-word-highlight-enabled（chrome.storage.local，默认 true）
  ├─ 开：collectTextNodes 一次遍历 → 对 wordCache 命中项建 Range
  │     → 按复习档位分桶注册 CSS.highlights.set('enx-hl-<bucket>', Highlight)
  │     → ::highlight(enx-hl-<bucket>) { text-decoration: underline <color> }
  ├─ 关：不建 Range、不注册 highlight，正文零变化
  └─ chrome.storage.onChanged 监听：开关翻转时实时加/清高亮，不刷新页面
```

零 `<u>` 包裹，零瞬态元素。正文 DOM 在「学习模式开 / 关」「高亮开 / 关」「弹窗开 / 关」所有组合下**逐字节不变**。

---

## Options Considered

### A. 下划线怎么画

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 维持 `<u class="enx-word">` 包裹 | 现状 | 零改动；`:hover` 换指针天然可用 | 见 Context 代价表全部 |
| A2.（采用）CSS Custom Highlight API：`Range` + `CSS.highlights.set(name, Highlight)` + `::highlight(name)` | 完全不改 DOM，用 Range 标注 + 伪元素上色 | 零 DOM 改动，天生免疫宿主页面 / React 重渲染；`disableEnx` 变成 `CSS.highlights.clear()`；ADR-010 两套策略收敛回一套；副作用补丁全部消失 | `::highlight()` 支持的属性有限（`color` / `background-color` / `text-decoration` / `text-shadow` / `-webkit-text-stroke`）——但正好覆盖需求；无 `:hover` 伪类；Range 在 DOM 变动后失效需重建；重叠 Range 要用多个 Highlight + `priority` 排序 |
| A3. `::spelling-error` / `::grammar-error` 伪元素 | 蹭浏览器内建的波浪线 | 完全免费 | 样式不可控（颜色、线型都是 UA 决定），30 档颜色无从表达。排除 |
| A4. 覆盖层（overlay）：绝对定位一层透明 div，在词位置画线 | 不碰正文 | 完全不干扰正文 | 要自己跟随滚动、resize、reflow 重算所有位置，几百个词的矩形跟踪，性能和复杂度都比 A2 差。排除 |

`::highlight()` 属性支持是 A2 的唯一实质约束。当前下划线需求（彩色 `text-decoration: underline` + 30 档 hue）完全落在支持范围内。未来若要「悬停高亮词时加背景色」也能做（`background-color` 支持）。

### B. 点中了哪个词，怎么定位

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. 维持每个 `.enx-word` 上的 `data-word` + 元素监听 | 现状 | 直接 `element.dataset.word` | 依赖 A1 的包裹，与 A2 互斥 |
| B2.（采用）`document.caretPositionFromPoint(x, y)` 拿 Range，再用 `Intl.Segmenter` 扩到整词 | 点击时按坐标反查文本节点 + 偏移，ICU 分词规则确定词边界 | 无需任何标记；ICU 规则比 `\b` 正则更准（缩写、连字符、Unicode）；正文不动 | `caretPositionFromPoint` 标准版 Chrome 128+ 才有；旧版是非标准的 `caretRangeFromPoint`——需 feature-detect + fallback（扩展只跑 Chrome，影响可控） |
| B3. `Selection` + `modify('extend', 'forward', 'word')` | 借 selection API 求词边界 | 原生词边界 | 会改动用户的选区状态，副作用大。排除 |

`caretPositionFromPoint` 命中 `<a>` / `<button>` / `<code>` / `<pre>` 内文本时（Range 的 `startContainer` 祖先链命中 `collectTextNodes` 那份排除集），直接放弃本次点击——与今天「这些子树里的词根本不包 `.enx-word`，点了没反应」行为一致。

### C. 弹窗（Popover）定位参照从哪来

现状 `createAnchoredPopup(anchor)` 需要一个真实 DOM **元素**设 `anchor-name`（`content.tsx:57`），弹窗用 CSS Anchor Positioning（`position-anchor` + `position-area: top` + `position-try-fallbacks`）贴上去，ADR-005 的垂直「让开一整行」还要读锚点元素的 `line-height`。A2 之后正文里没有 `.enx-word` 元素了，需要另找定位参照。

关键事实：`Range` 原生带 `getBoundingClientRect()` 和 `getClientRects()`，这正是所有主流定位方案（Floating UI 的 "virtual element"、CSS `anchor()`）需要的几何来源。所以定位**不需要**一个 DOM 元素，只需要一个矩形。

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 把扩词后的 Range `surroundContents` 一个临时 `<span>` 当锚点，关窗拆掉 | 正文里任一时刻最多一个 enx 元素 | `createAnchoredPopup` / `extractSentenceContext(wordElement,…)` 签名不用改 | **为「定位」去写宿主 DOM 是 code smell**：触发宿主 `MutationObserver`、打断宿主 `:nth-child` / 相邻兄弟选择器 / `contenteditable` 选区；`surroundContents` 在 Range 跨元素时抛错。与本 ADR「正文全程不变」的核心立场自相矛盾 |
| C2. 原生 CSS Anchor Positioning + proxy 锚点：在自己的 overlay 层（非宿主正文）放一个 0 尺寸元素，镜像 `range` 的**文档坐标**，`anchor-name` 给弹窗用 | 不碰宿主 DOM；命中常见文章页时浏览器原生跟踪滚动，零 JS | proxy 用文档坐标只在「range 不在嵌套滚动容器 / `transform` / `sticky` 祖先里」时才准——第三方页面里这些很常见（X 已是，评论区更甚），一旦不准又得加 JS 补，原生跟踪的好处就没了 |
| C3.（采用）不注入任何元素，把 `Range` 作为 **virtual reference** 交给 Floating UI：`computePosition(range, popupEl, { middleware: [offset(lineH), flip(), shift(), size()] })` + `autoUpdate()` | 零 DOM 写入（正文和 overlay 都不加元素）；`flip`/`shift`/`size` ≈ `position-try-fallbacks` + 视口收缩；`autoUpdate` 用 `ResizeObserver` + 祖先 scroll 监听，**嵌套滚动 / transform / sticky 都能正确跟踪**——正是接更多站点时最容易踩的坑 | 引入一个第三方依赖 `@floating-ui/dom`（~4kb min+gzip，项目当前没有）；滚动时有 rAF 节流的 JS 计算（实测无感）；`createAnchoredPopup` 与 ADR-005 的定位实现要重写；`extractSentenceContext` / `findPhraseAnchor` 签名改为收 `Range` |

选 C3。理由：C1 违反本 ADR 自己的核心立场（正文不变）；C2 的原生跟踪优势只在简单页面成立，而 ENX 的方向是接 SPA / 深层滚动容器的站点，proxy 锚点会变成「每接一个站点修一次漂移」。C3 把「弹窗定位」连同它的所有边界情况一次性外包给一个成熟库，`Range` 天然是它的输入。ADR-005 的诉求（弹窗上边缘让开一整行正文，不要压住相邻行）用 `offset()` middleware 表达：`lineH` 从 `range.getClientRects()[0].height` 取（行盒高度已含 `line-height`），取不到再退回 `getComputedStyle(range.startContainer.parentElement).lineHeight`。

**依赖成本单独说明**：`@floating-ui/dom` 是 Popper.js 的继任者，Radix / Headless UI / shadcn 底层都是它，MIT，无运行时副作用，随 Vite 打进扩展包（content script isolated world，无 CSP / CDN 问题）。项目已带 React / jotai / Sentry，加这一个不构成架构性改变。

### D.「单词高亮」开关放在哪、存在哪

**这套基础设施项目里已经有了，不是新建**：`manifest.json` 已声明 `"options_page": "options.html"`，对应 `src/options/Options.tsx`——一个整页标签的配置页（右键工具栏图标 →「选项」，或 `chrome://extensions` → 详情 → 扩展程序选项 打开）。它当前唯一的配置项 `apiBaseUrl` 就是「存 `chrome.storage.local`、`config/env.ts` 里一对 `get/set` helper、`Options.tsx` 里一个输入框」这个模式。本 ADR 的开关照抄这个模式，只是加一个布尔字段。

关于「配置页 vs 内嵌对话框」：Chrome 有两种——`options_page`（整页标签，ENX 用的这个）和 `options_ui` + `open_in_tab: false`（嵌在 `chrome://extensions` 里的小面板）。ENX 已选整页,本 ADR 不改这个选择。

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1.（采用）`chrome.storage.local` 存 `enx-word-highlight-enabled: boolean`（缺省视为 `true`），读写走 `config/env.ts` 里 `getApiBaseUrl`/`setApiBaseUrl` 同款 helper（`getWordHighlightEnabled` / `setWordHighlightEnabled`）；UI 放 options 页 + popup 快捷开关 | 逐项复用现有 `apiBaseUrl` 的实现模式，零新基础设施；`storage.local` 在 content script 里可读；`chrome.storage.onChanged` 能广播到所有已开启的标签页 | `storage.local` 不跨设备同步（可接受，阅读偏好本来就偏本机） |
| D2. `chrome.storage.sync` | 跨设备同步开关状态 | 换机器保留偏好 | `sync` 有配额和写频限制，且项目现有配置都用 `local`，引入 `sync` 是新模式。留作 Revisit |
| D3. 不做持久化，只在 popup 里做「本次会话」开关 | 每次重新开 | 实现最简 | 用户每次打开页面都要重新关，体验差。排除 |
| D4. 做成 per-site 开关（某些站点默认关） | 适配器里加 `wordHighlightDefault` 字段 | 更精细 | 当前没有「某站点就是不想要高亮」的实际诉求，YAGNI。字段留口子，本次不做 |

**options 页和 popup 两处都放**：options 页是 set-and-forget 的正式归属；popup 开关更重要——「读这篇文章时下划线太吵，先关掉」是个当下、就地的动作，用户已经在页面上了，不该为它跳去 options 页。两处读写同一个 key，`chrome.storage.onChanged` 保证互相同步、且立即作用到当前标签页。

### E. `::highlight` 的颜色分档

现状 `getColorCode` 按 `LoadCount` 算 0–300 的 hue，理论上 31 档（`Math.min(count, 30)`）。`::highlight()` 不能按元素传值，只能靠 highlight 名字区分。

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| E1.（采用）把 31 档 hue 归并成 **5–6 个复习档位**，每档一个具名 highlight（`enx-hl-1` … `enx-hl-6`），CSS 里写死每档颜色 | 建 Range 时按档位 `hl.add(range)` 分派 | highlight 对象数量固定且少；CSS 静态可读；档位对用户其实更易理解（「很生 / 较生 / 眼熟」）比连续渐变更有信息量 | 丢失连续渐变。实际观察：连续 hue 用户根本分辨不出相邻档，是伪精度 |
| E2. 每个不同 hue 一个 highlight | 忠实还原现状 | 视觉逐字节等价 | 最多 31 个 Highlight 对象 + 31 条 `::highlight` 规则，且大部分永远用不上。过度 |
| E3. 单一 highlight，不分色，只有「要复习 / 不要」 | 一个 `::highlight(enx-review)` | 最简 | 丢掉 `LoadCount` 承载的信息，是功能倒退 |

`getColorCode` / `getTextDecoration` 的「`#FFFFFF` / `none` 哨兵」逻辑（ADR-010 §1.4）在 A2 下天然消失：不该高亮的词**根本不进任何 Range**，不存在「画一条看不见的线」的问题。

### F. Range 何时失效、怎么重建

**心智前提**：`Highlight` 里的 `Range` 集合**不是持久状态**，是从「`wordCache`（哪些词要高亮）+ 当前活的 DOM」随时可重新推导的一次性投影。要信任和持久化的是 `wordCache`，不是 Range。

`Range` 本身是 live 的，浏览器会在周围 DOM 变动时自动修正 offset。真正会让 `::highlight` 消失 / 错位的只有一类：**Range 的容器节点被替换或移除**（框架 reconciliation、宿主 `innerHTML` 重置、虚拟列表回收、SPA 路由切换）。节点内改文本、加兄弟节点、"Show more" 展开——Range 自愈，不用管。而且**没有「Range 失效」事件**，只能靠观察 DOM 或直接重建来应对。

关键函数：`rebuildHighlights(root)` = 对 `root` 重跑 tokenize + match + 分桶 + `CSS.highlights.set` 覆盖，做到「随便什么时候调都对」。因为 Highlight API 不改 DOM，重建没有「过滤自己造成的 mutation」这种麻烦。

正确的应对**取决于站点内容的易变程度**，用一个新的 `SiteAdapter` 字段表达：

```ts
/** 正文内容在 enx 开启后的易变程度，决定挂哪些 observer。 */
contentVolatility: 'static' | 'spa' | 'streaming'
```

| 方案 | 适用 | 机制 |
| --- | --- | --- |
| F1.（本次落地）**`static`**：不挂任何 observer，`enxRun` 重复触发时 `CSS.highlights` 清空 + `rebuildHighlights` 整段重跑（ADR-010 Decision 7 的「重新武装」） | 现有白名单里的静态文章页 | 零新增机制。宿主页面 enx 开启后自行大改 DOM 会错位，但这类页面本来就不会 |
| F2.（本次落地，见 Decision 6）**`spa`**：F1 + Navigation API（`navigation.addEventListener('navigate', …)`，**不** monkey-patch `history`）在路由切换时拆掉全部 highlight + observer，等新 DOM 稳定后对新 DOM `rebuildHighlights` | X 主推文详情页（切推文） | 一个导航监听 + 一次防抖重建 |
| F3.（Phase 3/4，方向）**`streaming`**：F2 + 正文根上一个 `MutationObserver`（`childList`+`characterData`+`subtree`，rAF + trailing timeout 防抖 ~150ms，尽量只重建受影响子树）+ `IntersectionObserver` 按可视区惰性建 Range（段落进视口才 `hl.add`，回收即释放），把 live range 数量限制在「屏幕内 + margin」 | X 时间线 / 评论区、Reddit、HN 这类无限滚动 | live range 数量有上界（浏览器对每个 live range 在 layout 时有成本）；observer 生命周期需与 F2 的导航拆解协调 |

**本 ADR 落 F1 + F2**（决策已确认 2026-09-01）。`DEFAULT_ADAPTER` = `contentVolatility: 'static'`，`X_ADAPTER` = `'spa'`，两个分支都实现。F2 顺带交付 ADR-010 Phase 2 的核心诉求（页内切推文后主推文正文自动重新渲染），见「与 ADR-010 的关系」。`'streaming'` 全套按 ADR-010 Phase 3/4 走，届时可能另写 ADR。

---

## Decision

### 1. 下划线改用 CSS Custom Highlight API（采用 A2 + E1 + F1）

- 新增 `WordProcessor.buildHighlightRanges(textNodes: Text[], wordDict): Map<bucket, Range[]>`：复用 `collectTextNodes` 的一次遍历结果，对每个文本节点用 `Intl.Segmenter('en', { granularity: 'word' })` 切词，命中 `wordDict` 且 `getColorCode` 非哨兵的词，按复习档位建 `Range` 归桶。
- 新增 `applyHighlights(buckets)`：`CSS.highlights.set('enx-hl-<n>', new Highlight(...ranges))`，共 5–6 桶。
- content script 注入的 `<style>`（`content.tsx:1027`）：删掉现有的 `.enx-word` / `.enx-word:hover`（cursor + opacity）规则，加 `::highlight(enx-hl-1) { text-decoration: underline hsl(...); text-decoration-thickness: 1px; }` … 每桶一条。正文不再有 enx 的 cursor 覆盖。
- `disableEnx` 里删词元素解包裹的整段（`content.tsx:952`）替换为 `for (const n of [...CSS.highlights.keys()]) if (n.startsWith('enx-hl-')) CSS.highlights.delete(n)`。
- `updateWordHighlighting`（查词 / 标记掌握后改色，`content.tsx:359`）改为：从对应桶里移除该词的 Range，或加入新桶，然后 `CSS.highlights.set` 覆盖。不再 `querySelectorAll('.enx-<word>')`。

`renderWithHighlights` / `applyHighlightsToDom` / `applyHighlightsToNodes` / `inPlace` 分支 / flex 修复 / 标签配对自检 —— **全部删除**。`getArticleNodes` / `collectTextNodes` / `extractWords` / `cleanArticleText` 保留。

### 2. 点击查词改用 `caretPositionFromPoint` + `Range` 定位参照（采用 B2 + C3）

- `enableEnx` 里把 `addWordClickListeners`（遍历 `.enx-word` 挂 N 个监听）换成**一个**委托监听。默认站点挂在正文容器冒泡阶段；为将来 SPA 站点预留：`SiteAdapter` 加 `clickBinding?: 'bubble' | 'documentCapture'`（ADR-010 Options F3 早已写好细节，本次只落 `'bubble'`）。
- 监听回调：
  1. `const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY) ?? legacyCaretRange(e)`（fallback 为非标准的 `document.caretRangeFromPoint`）；
  2. 由 `pos` 构造 collapsed `Range`，用 `Intl.Segmenter('en', { granularity: 'word' })` 在 `pos.offsetNode` 的文本里找到包含该偏移的 word-like 段，把 `Range` 的 start/end 扩成整词——得到 `wordRange`；
  3. `wordRange.startContainer` 祖先链命中 `collectTextNodes` 排除集（`a/script/style/noscript/button/input/textarea/select/code/pre`）→ `return`；
  4. `showWordPopup(段文本, wordRange)` —— **不写入任何 DOM**。
- `createAnchoredPopup` 重写：签名从 `(anchor: HTMLElement)` 改为 `(reference: Range)`。内部：
  - 不再设 `anchor-name`、不再用 `position-anchor` / `position-area` / `position-try-fallbacks`；
  - 弹窗 `position: fixed`，用 `@floating-ui/dom` 的 `computePosition(reference, popup, { placement: 'top', middleware: [offset(lineH), flip(), shift({ padding: 8 }), size(...) ] })` 设 `top`/`left`；
  - `autoUpdate(reference, popup, update)` 在弹窗生命周期内跟踪滚动 / resize / 布局变化，`hideWordPopup` 时调用它返回的 cleanup。
  - `lineH`（ADR-005 的「让开一整行」）取自 `reference.getClientRects()[0]?.height`，退回 `parseFloat(getComputedStyle(reference.startContainer.parentElement).lineHeight)`。
- `Range` 对象在其文本节点仍挂在文档上时保持有效；`autoUpdate` 不依赖 Range 是元素。弹窗关闭后丢弃该 `Range` 即可，**无正文清理步骤**。
- `createAnchoredPopup` 的另外两个调用方一起改：`showSelectionHint`（ADR-007 划词提示）和短语面板提示——它们传的 `event.target` 改为 `document.caretRangeFromPoint(e.clientX, e.clientY)`（或选区 range 的 collapsed 副本）。
- `extractSentenceContext` 签名从 `(wordElement: HTMLElement, word)` 改为 `(wordRange: Range, word)`——见 Decision 5。

### 3.「单词高亮」独立开关（采用 D1）

- `config/env.ts`（或新 `config/preferences.ts`）加：
  ```ts
  export const getWordHighlightEnabled = async (): Promise<boolean> => {
    const { 'enx-word-highlight-enabled': v } = await chrome.storage.local.get('enx-word-highlight-enabled')
    return v ?? true            // 缺省即开启
  }
  export const setWordHighlightEnabled = (enabled: boolean) =>
    chrome.storage.local.set({ 'enx-word-highlight-enabled': enabled })
  ```
- `processArticleContent`：查词（`getWords` 填 `wordCache`）**始终执行**——它同时服务「点击查词的缓存」和「高亮」。只有 Decision 1 的 `buildHighlightRanges` + `applyHighlights` 用 `await getWordHighlightEnabled()` 门控。
- content script 顶层加 `chrome.storage.onChanged` 监听：`enx-word-highlight-enabled` 翻转且 `isEnxEnabled` 为真时，`true → applyHighlights(重新 build)`，`false → 删除所有 enx-hl-* highlight`。不刷新页面、不重新查词。
- UI 两处：
  - **options 页**：`Options.tsx` 加一个 checkbox 区块「阅读时高亮生词（Highlight vocabulary while reading）」，默认勾选。
  - **popup**：`Popup.tsx` 加一个 toggle，方便读文章时快速开关。两处读写同一个 storage key，`onChanged` 保证互相同步。
- **点击查词没有开关**：它是「学习模式」本身的核心，跟着 `enxRun` / `enxStop` 走。用户要的「关掉」指的是高亮，不是查词。

### 4. `SiteAdapter` 收敛

- 删除 `highlightStrategy: 'innerHTML' | 'inPlace'` 字段和 `HighlightStrategy` 类型 —— 只剩一种高亮方式，不需要这个维度。
- 删除 `DEFAULT_ADAPTER` 和 `X_ADAPTER` 的 `highlightStrategy`。
- `X_ADAPTER` 的 `showProcessingIndicator: false` 保留（提示条仍是结构性 `insertBefore`，与 React 冲突）；`minTextLength` / `contentSelector` / `focusedNodeResolver` / `pageSupport` 全部保留。
- `focusedNodeResolver`（`pickFocusedTweet`）保留但按实测（`adr-010-phase2-dom-readiness.md` §3）修正判据：判据①（focused `<article>` 的 `tabindex="-1"`）可靠，保留为主；判据③（focused article 内无 `/status/` 链接）**已证伪**——主推文 article 里就有 permalink / 引用推文的 `/status/` 链接，删除；判据②（字号）不稳（长推文正文实测 17px 而非预期 ~23px），降为弱兜底或一并删除。另外带引用推文时 `div[data-testid="tweetText"]` 会在**同一个** `article[tabindex="-1"]` 内匹配 2 个（正文 + 被引用正文），需在 focused article 内取 **DOM 顺序第一个** `tweetText`。Phase 2 的自动重建会让会话页 / 引用页常触发这条路径，随本 ADR 一并修。
- 加 `clickBinding?: 'bubble' | 'documentCapture'`，缺省 `'bubble'`（本次只落 `'bubble'`）。
- 加 `contentVolatility: 'static' | 'spa' | 'streaming'`（见 F 节），决定挂哪些 observer。`DEFAULT_ADAPTER` = `'static'`，`X_ADAPTER` = `'spa'`。本次实现 `'static'`（靠 `enxRun` 重新武装）和 `'spa'`（Navigation API 重建，见 Decision 6）两个分支；`'streaming'` 的 `MutationObserver` + `IntersectionObserver` 分支按 ADR-010 Phase 3/4 落地，字段先就位。

净结果：`SiteAdapter` 去掉 1 个字段（`highlightStrategy`）、加 2 个字段（`clickBinding`、`contentVolatility`），字段数持平，但每个都对应一个真实维度。

### 5. `extractSentenceContext` 与 ADR-008 短语锚点改为基于 `Range`（本 ADR 必须一并处理）

`.enx-word` 元素消失后，两处依赖它的下游代码要 Range 化。**都不再引入瞬态元素**。

**`extractSentenceContext(wordRange, word)`**（`wordProcessor.ts:381`）：

- `findSentenceContainer` 的入参从 `wordElement` 改为 `wordRange`，起点用 `wordRange.startContainer.parentElement`（文本节点的 `closest` 走父元素），其余「向上找 `p/li/blockquote/td/div` 且文本够长」的逻辑不变。
- `getTextOffsetWithin(container, target)` 现在用 `range.setEndBefore(target)` 求偏移；改为 `range.setEnd(wordRange.startContainer, wordRange.startOffset)` —— 直接用点击词 Range 的起点，比原来「setEndBefore 元素」更准（不受包裹元素前后空白影响）。
- 其余（`MAX_SEGMENT_LENGTH` 窗口截断、`Intl.Segmenter` 切句、找不到退回整段）完全不变。
- **仍 defer**：ADR-010 Decision 5「切句侧」提出的问题——X 推文里跨行、无句末标点的两句会被 `Intl.Segmenter` 合并成一句（因为 `container.textContent` 和 `Range.toString()` 都忽略 `<br>`）——本 ADR 不解决，与本 Decision 的 Range 化正交。它需要按 `<br>` / 块级边界往 `textToSegment` 插 `\n` 并同步调整点击词偏移，留到 ADR-010 前提 §2.3（`<br>` vs 块级）实测后另做。在此之前 X 上跨行无标点的两句仍会合并送 AI（质量降级，非功能损坏）。

**`findPhraseAnchor` → `resolvePhraseSentenceRange`**（`content.tsx:776`）：

- 现在靠 `container.querySelectorAll('.enx-word')` 找一个已包裹的词当锚点。改为：直接返回 `window.getSelection().getRangeAt(0)` 的一个 collapsed 副本（取 selection range 的起点），作为 `extractSentenceContext` 的 `wordRange` 入参。
- 选区本身已是精确边界，不需要「在选区里找某个词」——选区起点所在的句子就是要的上下文。

ADR-007 的划词整句翻译（`triggerSelectionTranslation`）走 `selection.toString()`，**完全不受影响**。

### 6. `contentVolatility: 'spa'` 的页内导航重建（本次落地，采用 F2）

`X_ADAPTER` 是 `'spa'`。X 是 SPA，页内点开另一条推文不重新注入 content script、DOM 被整片替换，现状要用户再点一次 Enable。本 Decision 让它自动重建，交付 ADR-010 Roadmap 的 Phase 2 核心诉求。

**6.1 路由切换的检测：Navigation API，content script 内闭环（已实测确认）**

机制是 content script 顶层的 `navigation.addEventListener('navigate', onRouteChange)`（Navigation API，Chrome 102+；**不** patch `history.pushState` / `replaceState`——调研 `adr-010-phase2-spa-navigation-detection.md` §2 已确认从 content script 的 isolated world patch `history` 拦不到页面自己的调用，isolated world 有独立的 `history` 包装对象）。

**isolated world 能否收到 `navigate` 事件，原是决定性未知项**（无一手文档确认，且存在与 `history` patch 同类的「每个 world 各一份对象」隐忧）——**2026-09-01 已实测确认收得到**：把 `navigation.addEventListener('navigate', ...)` 临时加进 content script（真实 isolated world，非 DevTools console 的 MAIN world），构建、在 `chrome://extensions` 重新加载，于真实 X 页面点开另一条推文（`push`）和浏览器后退（`traverse`），content script 都正确收到了 `navigate` 事件与目标路径（结果通过共享的 DOM 属性回读——isolated world 的 `console.log` 不会出现在部分外部 DevTools 读取工具里，这本身也是本次验证的一个副产物）。

**结论：不需要 `chrome.webNavigation` 兜底，`manifest.json` 不用新增任何权限。** `chrome.webNavigation` 仍记在 Revisit Trigger 里，作为「以后 X 改版导致 Navigation API 失效」时的退路，但不是本次要做的分支。

**6.2 content script 的重建流程**

`onRouteChange(newUrl)`（由 Navigation API 的 `navigate` 事件触发）：

1. **取消上一个未完成的重建**：模块级代际计数器 `rebuildGen`，每次进入 `++rebuildGen` 并捕获局部 `myGen`；就绪等待和 `processArticleContent` 的每个 `await` 之后检查 `myGen === rebuildGen`，不等则放弃。快速连续切推文时只有最后一次跑完。
2. 立即 `teardownHighlights()`（`CSS.highlights.delete` 全部 `enx-hl-*`）+ `hideWordPopup()`。
3. 用 `adapter.pageSupport?.(newUrl)` 判断新 URL 是否仍在范围内（X 的 `TWEET_DETAIL_PATH`）。**不在 → 停在「已拆除」状态，静默返回，不弹任何提示**（区别于手动 `enxRun` 路径——那条才展示 `pageSupport` 的错误串；content script 靠消息来源区分两条路径）。
4. 在 → 等新正文 DOM 稳定：`MutationObserver` 观察 `document.body` 子树，命中条件 = 存在 `article[tabindex="-1"] [data-testid="tweetText"]` 且其 `textContent` 非空；命中后防抖 ~100ms；超时 ~2s 兜底（按当前 DOM 尽力而为）。**不读 `document.title`、不读 `aria-live`**——实测（`adr-010-phase2-dom-readiness.md`）：`document.title` visibility-gated，切推文后长时间仍是上一条推文的标题（首次加载滞后 ~51 秒）；`aria-live` 区域全程为空。典型就绪延迟 <200ms，不需要长轮询。
5. 过渡期新旧 `article[tabindex="-1"]` 会并存约 750ms，取 **DOM 顺序最后一个**。
6. 跑一次完整 `processArticleContent`（含 §Decision-4 的 `focusedNodeResolver` 修正）+ `rebuildHighlights`。`processArticleContent` 目前会无条件把当前推文全部 unique 词发 `getWords`；本 Decision 一并加短路：`uniqueWords.every(w => wordCache[w.toLowerCase()])` 时跳过 `getWords`/`paragraph-init` 网络调用，直接进 `buildHighlightRanges`——否则 Phase 2 每切一条推文都会白发一个 `/api/paragraph-init` GET（该接口纯读、幂等、不计费，但无谓）。

**6.3 生命周期**

- `enableEnx` 注册 `navigate` 监听，`disableEnx` / `enxStop` 移除。
- `DEFAULT_ADAPTER`（`'static'`）不涉及任何导航监听——静态站点整页导航本来就重新加载、重新注入 content script。

ADR-010 Phase 2 前期调研四项均已完成（见上方「与 ADR-010 的关系」），结论已并入本节。

---

## Rationale

- **A2 现在值得做**：ADR-010 拒绝 D3 的理由是「为一个尚未证伪的风险付重写成本不划算」。本 ADR 的立场不同——重写成本照付，但换来的不只是「X 上能用」，而是删掉 `renderWithHighlights` 整条序列化链、`inPlace` 第二策略、几千监听器、逐词正则、flex 补丁、标签自检、白线哨兵。这是**净减代码**的改动，不是加功能。
- **C3（`Range` 作 virtual reference + Floating UI）而不是 C1/C2**：A2 的最大下游冲击是「弹窗和 ADR-008 都依赖锚点元素」。C1（瞬态 span）看似把冲击降到最低、下游签名不用改，但它为了「定位」去写宿主 DOM——与本 ADR「正文全程不变」的核心立场直接矛盾，且会触发宿主 `MutationObserver` / 打断宿主 CSS 选择器。C2（原生 CSS Anchor + proxy 锚点）不碰宿主 DOM，简单页面下还有浏览器原生滚动跟踪的优势，但 proxy 用文档坐标只在「无嵌套滚动 / transform / sticky 祖先」时准，而 ENX 明确要接 SPA 与深层滚动容器的站点（X 已是），那会退化成「每接一个站点修一次漂移」。C3 把定位连同 flip / shift / 嵌套滚动跟踪一次性外包给成熟库，`Range` 天然是它的输入；代价是一个 ~4kb 依赖和重写 `createAnchoredPopup`——一次性成本，换掉一类会反复出现的 bug。
- **查词不设开关，只有高亮设开关**：用户表述是「单词高亮做成可开关」。查词是学习模式的本体，`enxRun`/`enxStop` 已经是它的开关。把两者拆开的价值正在于：关掉视觉噪音（下划线）的同时，「想查哪个词点哪个」依然可用——这只有在「点击不依赖高亮标记」之后才可能，也正是 A2/B2 的直接收益。
- **E1（档位归并）而不是 E2（忠实还原）**：31 档连续 hue 是伪精度，相邻档人眼分不出。借这次重构把它归并成 5–6 个有语义的复习档位，对用户是信息增益，对实现是「6 个 Highlight 对象」而不是「31 个」。
- **`Intl.Segmenter` 而不是 `\b` 正则**：ADR-010 §1.3 已经点出正则分词在缩写 / 连字符 / Unicode 上的问题。既然点击命中无论如何要一套词边界算法，直接用 ICU 的，取词侧（`extractWords`）也可以后续统一过去（本 ADR 不强求，见 Out of Scope）。
- **F 节把「什么时候重建」做成 `contentVolatility` 三档，本次落 `static` + `spa`**：Range 集合是从 `wordCache` + 活 DOM 可重新推导的一次性投影，`rebuildHighlights(root)` 是唯一需要写对的函数。`static` 页只在 `enxRun` 时调它；`spa`（X）加一个 Navigation API 监听在路由切换时重建——这一条顺带交付 ADR-010 Phase 2。`streaming`（`MutationObserver` + `IntersectionObserver` 惰性建 Range）留给 ADR-010 Phase 3/4，字段先就位避免将来动 `SiteAdapter` 形状。用 Navigation API 而非 monkey-patch `history`：调研已确认从 content script 的 isolated world patch `history` 根本拦不到页面的调用，Navigation API 是 content script 内唯一干净的选项——isolated world 能否收到 `navigate` 事件原是唯一的不确定项，2026-09-01 已实测确认收得到（见 Decision 6.1），不需要 `chrome.webNavigation` 兜底。

---

## Consequences

### Positive

- 正文 DOM 在「学习模式开 / 关」「高亮开 / 关」「弹窗开 / 关」所有组合下**逐字节等于原始页面**——不再有任何 enx 注入的元素，连弹窗打开时也没有。宿主页面的事件监听、懒加载、React fiber、`MutationObserver`、CSS `:nth-child` / 相邻兄弟选择器全程不受影响——ADR-010 前提 §2.4（原地包裹与 React 共存）这个「最高风险」的未知数**直接消失**。
- ADR-010 的两套高亮策略（`innerHTML` / `inPlace`）收敛回一套。`wordProcessor.ts` 里 `renderWithHighlights` / `applyHighlightsToDom` / `applyHighlightsToNodes` / 占位符逻辑 / 标签配对自检约 150 行删除。`content.tsx` 里 flex 修复、`addWordClickListeners` 循环、`disableEnx` 的解包裹循环删除。
- `disableEnx` 从「遍历几千个 `.enx-word` 逐个 `replaceWith`」变成「`CSS.highlights.delete` 几个 key + 移除一个监听」。关闭学习模式不再引起一次大 reflow。
- 弹窗定位从手写 CSS Anchor Positioning（`position-area` + `position-try-fallbacks` + 手算 `line-height` margin）变成 Floating UI 的声明式 middleware 链，视口边缘翻转 / 收缩 / 嵌套滚动跟踪由库负责，`createAnchoredPopup` 净变短。
- 监听器数量与正文词数解耦：从 O(词数) 变成 O(1)。
- 新增「单词高亮」开关，用户可关掉下划线而保留点词查词。
- `getColorCode` 的 `#FFFFFF` 哨兵、`getTextDecoration` 的 `none` 分支（ADR-010 §1.4 的跨站点修正）不再需要——不该高亮的词根本不进 Range。
- 分词从 `\b` 正则升级到 `Intl.Segmenter`，缩写 / 连字符 / Unicode 边界更准。
- **点词查词对正文任意英文词生效**（不再限于 ECDICT 认识 / 已高亮的词，那些词才有 `.enx-word`）。`getOneWord` 走 `/api/translate` 的词典查询，不消耗 AI credit（ADR-009），代价只是词典请求量和误点弹窗略增——已确认接受。
- **X 页内切推文后主推文正文自动重新标注**（Decision 6），不再需要手动再点 Enable。交付了 ADR-010 Phase 2 的核心诉求。

### Negative

- **新增依赖 `@floating-ui/dom`**（~4kb min+gzip，项目当前无 Floating UI）。随 Vite 打进扩展包。这是本 ADR 唯一的新增运行时依赖；理由见 Rationale 的 C3 条。
- **`caretPositionFromPoint` 的浏览器兼容**：标准方法 Chrome 128+；更早只有非标准 `caretRangeFromPoint`。需 feature-detect + fallback 两条路径（`legacyCaretRange`）。扩展只跑 Chrome，且已因 CSS Anchor Positioning 要求 125+，实际影响很小，但代码里多一处兼容分支。
- **ADR-002 / ADR-005 的定位实现被取代**：`createAnchoredPopup` 从 CSS Anchor Positioning 改为 Floating UI。ADR-002 的 Shadow DOM + Popover（top-layer）保留；ADR-005 的「让开一整行」诉求保留，但其具体实现（读 `line-height` 算 margin + `position-area`）作废，改用 `offset()` middleware。两份 ADR 的状态行已加取代注记（2026-09-01）。
- **ADR-008 的 `findPhraseAnchor` 与 `extractSentenceContext` 都要改签名**（Decision 5，都改为收 `Range`）。ADR-010 当初拒绝 D3 时预判的成本，这里如数付出。范围可控（两个函数、无瞬态元素），但确实是 ADR-008 前提的推翻。
- **`::highlight()` 无 `:hover`（已确认接受）**：现状「悬停高亮词 → 指针变 pointer + opacity 0.8」（`content.tsx:1030` 的 `.enx-word:hover` 规则）随包裹元素一起删除。正文鼠标指针保持默认（`text`），不加可点性提示——因为点词查词现在对所有词生效，「哪些能点」不需要靠下划线暗示。
- **连续 hue 渐变丢失（已确认接受）**（E1），换成 5–6 档。档位划分与配色在实现时定，不阻塞本 ADR。
- **ADR-010 Decision 3（取词/高亮共用一次遍历）部分失效**：取词侧的价值还在（`collectTextNodes` 仍被 `buildHighlightRanges` 复用），但「两个阶段的过滤规则天然不漂移」这个论证的另一半——高亮侧——现在走 Range 不走 `applyHighlightsToNodes` 了。过滤集仍是同一个 `collectTextNodes`，所以不漂移的结论不变，只是理由从「同一个替换函数」变成「同一个遍历函数」。
- **`streaming` 类站点仍会错位**：本次落地 `static` + `spa` 两个分支。宿主页面在 enx 开启后异步替换正文子树（非整页导航、非 SPA 路由）——目前白名单里没有这种站点，但接入后会让下划线消失/错位，需把该站点提到 `'streaming'` 并实现其 observer 分支（ADR-010 Phase 3/4）。A2 下「错位」表现为 highlight 画在错误位置，比 `<u>` 方案「元素被删掉」更难察觉。
- **页内切推文后的 DOM 就绪时序**（Decision 6.2）：靠 `MutationObserver` 等 `article[tabindex="-1"] [data-testid="tweetText"]` 非空 + ~100ms 防抖 + ~2s 超时兜底（`document.title` / `aria-live` 实测不可用，已排除）。实测典型延迟 <200ms，但探测仍可能过早（标注到过渡态）或过晚（用户看到一小段无标注窗口）。
- **滚动时的 JS 计算**：Floating UI 的 `autoUpdate` 在弹窗打开期间监听祖先滚动 + resize，每帧 rAF 节流重算位置。只在弹窗打开的短暂窗口内，实测无感，但严格说不是「零 JS」。弹窗关闭必须调 `autoUpdate` 的 cleanup，否则泄漏监听。
- content script 需要新增 `chrome.storage.onChanged` 监听 + 读 storage，content script 启动路径多一次异步。

### Mitigation

- 实施顺序建议：
  1. **弹窗定位先行**：`createAnchoredPopup` 改为收 `Range` + Floating UI，`extractSentenceContext` / `findPhraseAnchor` Range 化（Decision 5）。此步不动高亮，仍是 `.enx-word` 包裹，点击仍走元素——只是把「元素」换成「元素的 `Range`」喂给定位。可独立上线、独立回滚。
  2. **换高亮 + 换点击命中，不加开关**：A2 + B2 + Decision 1 + Decision 4（含 `contentVolatility` 字段 + `static` 分支），9 个默认站点和 X 一次性全切到 Highlight API + `caretPositionFromPoint`（现有测试 `wordHighlighting.test.ts` / `inPlaceHighlighting.test.ts` / `siteAdapters.test.ts` 需大改或替换）。此步之后功能等价于今天（高亮恒开、X 切推文仍需手动 re-arm）。
  3. **X 自动重建**：Decision 6，Navigation API + `spa` 分支。仅影响 `X_ADAPTER`。
  4. **加开关**：Decision 3，options + popup UI + `onChanged`。
  5. 每步独立可验证、可回滚。
- `caretPositionFromPoint` 的 fallback、`::highlight` 属性支持、`Intl.Segmenter` 词边界、Floating UI 对 `Range` virtual reference 的 `autoUpdate` 表现，四项在实现前用附录脚本在目标站点各验一遍。（X 切推文的 DOM 就绪信号已由 `adr-010-phase2-dom-readiness.md` 定：`article[tabindex="-1"]` 内非空 `tweetText`；isolated-world Navigation API 前提已于 2026-09-01 实测确认，均不用再测。）
- 档位划分（E1）在实现时于 2–3 篇真实文章上截图定色，不阻塞 ADR。
- ADR-005 的「让开一整行」在 Floating UI `offset()` 下要单独手测一次（`range.getClientRects()[0].height` 是否等于该行行盒高度，特别是 X 深色模式和大字号主推文）。

---

## Out of Scope（本次不做）

- **取词侧（`extractWords`）也换成 `Intl.Segmenter`**。本 ADR 只统一「点击命中」和「高亮」两处的词边界；取词侧照旧走 `WORD_PATTERNS.contractedWord` 正则，避免同一次改动波及查词请求的内容。留作后续。
- **`contentVolatility: 'streaming'` 分支实现**（`MutationObserver` + `IntersectionObserver` 按可视区惰性建 Range）。字段本次就位，实现按 ADR-010 Phase 3/4 落地，可能另写 ADR。（`'static'` 与 `'spa'` 本次落地。）
- **`chrome.storage.sync` 跨设备同步**开关状态（Options D2）。
- **per-site 高亮默认值**（Options D4）。`SiteAdapter` 不加 `wordHighlightDefault`。
- **X 之外的新 SPA 站点**（Reddit / HN / Substack）。本 ADR 让接入它们更容易（无 `inPlace` 风险），但不在本次落地。
- **划词整句翻译 / 短语查询的 UI 变化**。ADR-007 完全不动；ADR-008 只把 `findPhraseAnchor` / `extractSentenceContext` Range 化，交互不变。
- **X 推文跨行、无标点两句的切句合并**（ADR-010 Decision 5「切句侧」）。见 Decision 5 末尾，留到 ADR-010 前提 §2.3（`<br>` vs 块级）实测后另做。
- **弹窗动画 / 进出场过渡的重做**。换 Floating UI 只改「定位到哪」，不改「怎么出现」。
- **悬停预览释义**（不点就看）。`::highlight` 无 `:hover` 让这个更难做，但它本来也不在需求里。

---

## Revisit Trigger

- **`::highlight()` 渲染性能不达标**（超长文章、几千个 Range 分桶后滚动掉帧）：退回「只对视口内 + 附近的词建 Range」的惰性方案，或回到覆盖层（Options A4）。
- **无悬停反馈导致用户不知道能点词**：给正文容器加 `cursor` 提示，或在 highlight 词上用 `background-color` 做一个轻悬停态（需要自己在 `pointermove` 时动态调整一个「hover highlight」的 Range）。
- **Floating UI 的 `autoUpdate` 在某站点跟踪不住**（复杂 transform / 多层 sticky / 虚拟滚动回收导致 Range rect 抖动）：先试 `autoUpdate` 的 `animationFrame: true` 选项；仍不行则该站点的 `SiteAdapter` 标记「弹窗跟随滚动关闭」（滚动即 `hidePopover`），避免错位停留。
- **`caretPositionFromPoint` 在某些站点的 Shadow DOM / iframe 正文里返回 null**：对这类站点回退到「正文容器上仍然只包高亮词、点击走元素」的混合模式——但这会把 A1 的一部分代价带回来，应作为最后手段。
- **Floating UI 体积 / 维护性变成负担**：`@floating-ui/dom` 的 `computePosition` + `offset`/`flip`/`shift` 其实可以用 ~100 行原生 `getBoundingClientRect` 重写（放弃 `autoUpdate` 的细致跟踪）。若依赖出问题，这是明确的退路。
- **静态站点上下划线错位成为实际投诉**（某个白名单站点其实会异步替换正文节点）：把该站点的 `contentVolatility` 从 `'static'` 提到 `'spa'` 甚至 `'streaming'`，实现对应 observer 分支。
- **Navigation API 的 `navigate` 事件在 X 上（未来某次改版后）不再触发 / 触发时机不对**（2026-09-01 的实测确认它在 isolated world 里收得到，此条只覆盖以后 X 改动路由实现导致的回归）：退回 `chrome.webNavigation.onHistoryStateUpdated`（background 监听 → `chrome.tabs.sendMessage` 通知 content script），新增 `"webNavigation"` 权限。给 `SiteAdapter` 加一个 `navigationDetection?: 'navigationApi' | 'webNavigation'` 开关。**不要退回 monkey-patch `history`**——调研 `adr-010-phase2-spa-navigation-detection.md` §2 已确认 isolated world patch `history` 拦不到页面自己的调用；真要走 patch 路线只能注入 MAIN world 脚本 + `postMessage`，成本比 `webNavigation` 更高，不作为默认退路。
- **X 切推文后重建时机不稳**（就绪信号探测不准，标注闪烁或滞后）：调整 Decision 6 的稳定探测策略；最差退回「切推文后不自动重建，显示一个『点击刷新标注』的小按钮」。
- **接入第 3 个 SPA 站点时**：确认单一 Highlight API 策略在 3 个站点稳定后，可以删掉 `SiteAdapter` 里为过渡保留的任何兼容字段。

---

## 附录：实现前的验证脚本

在**默认站点**（如一篇 InfoQ 文章）和 **X 推文详情页**各跑一遍。

```js
// 1. caretPositionFromPoint 是否可用 + 命中精度
console.log('caretPositionFromPoint:', typeof document.caretPositionFromPoint)
console.log('caretRangeFromPoint (legacy):', typeof document.caretRangeFromPoint)
document.addEventListener('click', e => {
  const pos = document.caretPositionFromPoint?.(e.clientX, e.clientY)
  if (!pos) return console.log('null pos')
  const t = pos.offsetNode.textContent || ''
  console.log('node:', pos.offsetNode.nodeName, 'offset:', pos.offset,
    'around:', JSON.stringify(t.slice(Math.max(0, pos.offset - 10), pos.offset + 10)))
}, true)
// 点几个词，确认 offsetNode 是文本节点、offset 落在词内

// 2. Intl.Segmenter 词边界
const seg = new Intl.Segmenter('en', { granularity: 'word' })
for (const s of seg.segment("it's a well-known KARDASHEV-2 problem, isn't it?"))
  if (s.isWordLike) console.log(JSON.stringify(s.segment), s.index)
// 确认 "it's" / "well-known" / "isn't" 的切法符合预期

// 3. CSS Custom Highlight API + ::highlight 属性支持
const style = document.createElement('style')
style.textContent = `::highlight(enx-test){text-decoration: underline hsl(300 100% 40%); text-decoration-thickness: 2px; background-color: rgba(255,235,59,.3);}`
document.head.appendChild(style)
const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
const h = new Highlight()
let n, c = 0
while ((n = walker.nextNode()) && c < 40) {
  const i = (n.textContent || '').toLowerCase().indexOf('the')
  if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + 3); h.add(r); c++ }
}
CSS.highlights.set('enx-test', h)
console.log('highlighted "the" x', c, '— 确认 text-decoration 生效、线型/粗细/颜色符合预期')

// 4. Range 作为定位参照：rect / 行盒高度 / 滚动跟踪（不写任何 DOM）
const tw = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
let tn; while ((tn = tw.nextNode())) if ((tn.textContent || '').trim().length > 20) break
const rr = document.createRange(); rr.setStart(tn, 0); rr.setEnd(tn, 4)
const rect = rr.getBoundingClientRect()
const lineH = rr.getClientRects()[0]?.height
console.log('range rect:', rect, 'line box height:', lineH,
  'vs computed line-height:', getComputedStyle(tn.parentElement).lineHeight)
// 放一个 fixed 方块贴到 rect 上，滚动页面，肉眼看它是否跟随 —— 验证「弹窗打开时要不要 autoUpdate」
const probe = document.createElement('div')
probe.style.cssText = `position:fixed;left:${rect.left}px;top:${rect.top}px;width:${rect.width}px;height:${rect.height}px;outline:2px solid red;pointer-events:none;z-index:99999`
document.body.appendChild(probe)
const track = () => { const r = rr.getBoundingClientRect(); probe.style.left = r.left+'px'; probe.style.top = r.top+'px' }
addEventListener('scroll', track, true); addEventListener('resize', track)
setTimeout(() => { probe.remove(); removeEventListener('scroll', track, true); removeEventListener('resize', track)
  console.log('probe 已移除 —— 全程没有改动正文 DOM') }, 8000)
// 若项目已装 @floating-ui/dom，可直接：
//   const { computePosition, offset, flip, shift } = FloatingUIDOM
//   computePosition(rr, probe, { placement:'top', middleware:[offset(lineH||20), flip(), shift({padding:8})] })
//     .then(({x,y}) => Object.assign(probe.style, { left:x+'px', top:y+'px' }))

// 5. （仅 X）Navigation API 是否在页内切推文时触发 + 新 tweetText 何时稳定
console.log('Navigation API:', typeof navigation)
navigation?.addEventListener('navigate', e => {
  console.log('navigate →', e.destination.url, 'canIntercept:', e.canIntercept)
  const t0 = performance.now()
  const poll = setInterval(() => {
    const art = document.querySelector('article[tabindex="-1"]')
    const tt = art?.querySelector('div[data-testid="tweetText"]')
    if (tt && tt.textContent.trim()) {
      console.log(`tweetText 稳定，用时 ${Math.round(performance.now() - t0)}ms:`,
        JSON.stringify(tt.textContent.slice(0, 40)))
      clearInterval(poll)
    }
  }, 50)
  setTimeout(() => clearInterval(poll), 5000)
})
// 在 X 上点开评论里的另一条推文 / 点作者头像再点回，观察 navigate 是否触发、
// article[tabindex="-1"] 是否是可靠的就绪信号、典型延迟多少
```

**关于 script 5 与 Decision 6.1 的关系**：上面这段在 DevTools Console 里跑的是 **MAIN world**（`article[tabindex="-1"]` 就绪信号的实测已经用这种方式确认过，见 `adr-010-phase2-dom-readiness.md`），只能证明 X 用了 Navigation API 可观察的导航方式，**不能**证明 content script 收得到同样的事件。Decision 6.1 真正要验证的是 **isolated world**，2026-09-01 已经做过：把同样的 `navigation.addEventListener('navigate', ...)` 临时加进 content script（结果写进一个共享 DOM 属性回读，因为 isolated world 的 `console.log` 不会出现在部分外部 DevTools 读取工具里），构建、`chrome://extensions` 重新加载、在真实 X 页面点开另一条推文 / 浏览器后退，content script 都收到了 `navigate` 事件（`push` 与 `traverse` 均触发，目标路径正确）。**结论已定，无需再测**；探针代码已从仓库中撤回。
