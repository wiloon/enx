# ADR-017：侧边栏原句支持划词查「一组词在句中的释义」——去掉逐词 `<button>` 拆分，改用原生 `Selection` + ICU 词边界吸附，与主窗口 ADR-011（点）/ ADR-007·008（划）的选词范式对齐

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-06。选词范围判定（A2：原生 `Selection`，去掉逐词 `<button>`）、吸附器用**纯字符区间签名** `snapToWordBounds(text, start, end)`（C3，原 Revisit 的「更 robust 方向」提为主方案）、确认方式（D2：选区旁一枚**无文字图标按钮**，点了才发计费查询）、不建消息/存储链路（Decision 4）均已确认。**已按方案实现（TDD）**：`src/lib/wordSegment.ts`（`snapToWordBounds` + 单测）；`SidePanel.tsx` 原句改纯文本渲染（删 `tokenizeSentence` / 逐词 `<button>`，被点词高亮改 `<mark>`）+ `getSelectionCharRange` + `handleSentenceSelection`（单词→`handleWordClick`、多词→确认浮标）+ `upsertPhraseCard`（`pendingContext.phrase` effect 一并收敛，修去重 bug）+ `PhraseConfirmButton`（autofocus / Esc / pointerdown / scroll 消失）。`SidePanel.test.tsx` 的 ~15 处逐词 `<button>` 断言迁移到 `selectWord` 选区 helper。`pnpm jest`（157 passed）/ `tsc` / `pnpm build` 通过。code-review 后修：删掉挂在不可聚焦 `<p>` 上的死 `onKeyUp`（纯键盘不能在原句发起选区，见 Consequences + Revisit）；整句词数 `useMemo` 缓存，不再每次 `mouseup` 重跑一遍全句分词。确认浮标用 `position: fixed` + 选区 `getBoundingClientRect`（跨多行定位不准的退路见 Revisit）。 |
| **日期** | 2026-09-06 |
| **关联 Spec** | 配套 TASK-SPEC 留到编码阶段再写（同 ADR-008 / ADR-010 / ADR-011 的做法）；本 ADR 只定选词范围的判定机制、单词/短语的分派、以及短语卡的复用边界 |
| **关联 ADR** | [`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（主窗口点词查词已从「逐词包 `<u class="enx-word">` + 元素监听」改为「`caretPositionFromPoint` → `Range` → `Intl.Segmenter` 扩到整词」，Decision 2；本 ADR 把侧边栏原句里对等的「逐词 `<button>` 拆分」按同样理由移除，词边界算法复用同一套 ICU 分词）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（在网页正文里划词选中 2–5 个词 → 短语卡，走 `translate/word-in-context`；本 ADR 新增一条**在侧边栏渲染出来的原句上**触发同一种短语卡的路径，复用其卡片形态、去重、渲染与「短语不落库」结论）、[`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（主窗口划词走 `window.getSelection()`、不依赖任何标记元素；本 ADR 把「划词用 `getSelection`」这条既有范式引入侧边栏）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（Side Panel 的单词卡累积列表 `definitions`、`FetchStatus \| 'none'` 状态惯例；本 ADR 的短语卡直接混进同一个列表）、[`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（`word-in-context` 按 token 计费；本 ADR 每次划词短语查询是一次 `translate_word_in_context` 计费调用） |

---

## Context

### 侧边栏原句现状（`SidePanel.tsx`）

Side Panel 顶部把当前句子渲染成可点的原文：`tokenizeSentence`（`SidePanel.tsx:88-105`）用 `/[a-zA-Z][a-zA-Z'-]*/g` 把句子切成 token，每个**词** token 渲染成一个 `<button onClick={() => handleWordClick(token.text)}>`，空白/标点渲染成不可点的 `<span>`（`SidePanel.tsx:549-571`）。

- 点某个词 `<button>` → `handleWordClick` → 并发 `getOneWord`（词典 + 音标 + Query Count）+ `translateWordInContext`（该词在本句中的含义），合并成一张**单词卡** `unshift` 进 `definitions` 列表（`SidePanel.tsx:482-514`）。
- 2–5 词的**短语卡**今天只有一条来路：主窗口 ADR-008 在网页正文里划词，经 `openSentencePanel` 消息 + `chrome.storage.session` 把 `PendingSentenceContext.phrase` 传进来，`SidePanel.tsx:439-451` 的 effect 读到 `phrase` 就建一张 `dictionaryStatus: 'none'` 的短语卡并调 `fetchContextTranslation(phrase, sentence)`。

**侧边栏原句本身不支持划词**——`<button>` 元素的默认 `user-select` 在 UA 样式里是 `none`，跨多个 `<button>` 拖选在 Chrome 里基本选不出文本；即便能选，也没有任何代码读这个选区。

### 需求

用户在侧边栏原句上**划词选中连续的几个词**（比如 `hunt down emails`），在下方生词列表里加**一条**「这一组词在本句中的释义」——和 ADR-008 的短语卡是同一个产物，只是触发点从「网页正文」挪到「侧边栏里已经渲染好的那句英文」。单独看 `hunt` / `down` / `emails` 用户可能都认识，组合进这句话的语境里什么意思，要调 AI。

### 主窗口刚做过的事，侧边栏还没跟上

ADR-011 Decision 2 把主窗口的点词查词从「给几乎每个词包 `<u class="enx-word">` 元素 + 逐元素挂监听」改成**无标记**：点击坐标 → `document.caretPositionFromPoint` → `Range` → `Intl.Segmenter('en', { granularity: 'word' })` 扩到整词。ADR-011 Context 那张代价表（DOM 膨胀、监听器数量与词数耦合、分词脆弱、一堆副作用补丁）说的就是「逐词包元素」这条路。

侧边栏原句的 `tokenizeSentence` + 逐词 `<button>` 是**同一个思路的小号版本**：句子短，代价没那么夸张，但方向和 ADR-011 刚清理掉的东西一致，而且正是它挡住了「原句划词」。本 ADR 要回答的核心问题——**「侧边栏里判断用户选词范围的最佳实践是什么」**——答案应该和主窗口的范式对齐，而不是在侧边栏里再长出一套。

### 为什么值得写 ADR

- **难以反悔**：原句的渲染方式（逐词元素 vs 纯文本）一旦改，`handleWordClick` 的触发方式、以后原句上任何新交互（例如高亮选中短语、原句里标记生词）都挂在这个选择上。
- **反直觉**：主窗口「点用坐标、划用 `Selection`」是两条不同机制各司其职（ADR-011 / ADR-007），侧边栏要不要照搬这个二分、还是统一用一种，需要论证。
- **真实取舍**：原生 `Selection` + 词边界吸附 vs 保留逐词元素追踪跨选 vs 两次 `caretPositionFromPoint`；划词即查 vs 弹确认；去掉 `<button>` 的无障碍代价——都有多个合理选项。
- 是 ADR-008 的姊妹功能，ADR-008 结尾 Revisit Trigger 已经预留了「同一短语在侧边栏的多种查看方式」。

---

## Options Considered

### A. 怎么判断用户在原句上选了哪几个词（本 ADR 的核心）

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 保留逐词元素，追踪选区跨了哪些 | 词 token 继续渲染成元素（`<span data-word-index>`），`mouseup` 时遍历选区 `Range`，收集 `intersectsNode` 命中的词元素，拼它们的 `textContent` | 词边界 = 元素边界，不需要分词算法 | 与 ADR-011 刚移除的「逐词标记元素」方向相反；跨 `<span>` 的原生选区在 Chrome 里仍不稳（选区可能停在元素中间、`user-select` 要逐个强制打开）；无障碍上一句话变成 N 个 tab 停靠点 |
| **A2.（采用）原句渲染成纯文本，用原生 `window.getSelection()` + ICU 词边界吸附** | 去掉 `tokenizeSentence` 和逐词 `<button>`，整句渲染为普通可选文本。`mouseup` 时把选区映射成「在 `pendingContext.sentence` 里的字符区间」，交给 `snapToWordBounds` 用 `Intl.Segmenter('en', {granularity:'word'})` 把两端**吸附到整词**（签名见 C） | 与主窗口范式对齐：**点**（collapsed 选区）落到光标所在的那一个词，**划**（非 collapsed）吸附成整词序列，同一段代码两种情况；原生选区自带拖选视觉反馈、双击选词、Shift+方向键扩选、屏幕阅读器「已选中」语义 | 去掉 `<button>` 后逐词 Tab 停靠消失（见 E）；React 在 `pendingContext` 变化时会替换原句文本节点，但选区是每次手势即用即弃、不持久，无影响 |
| A3. `mousedown` + `mouseup` 各做一次 `caretPositionFromPoint`，不碰 `Selection` API | 记下起点词和终点词，取两者之间的 `Range` | 与主窗口点词查词完全对称（都走 `caretPositionFromPoint`）；不依赖 `Selection` | 拖动过程中没有原生选区高亮（要自己画）；Shift+方向键、双击选词等键盘/习惯操作全都表达不了；`caretPositionFromPoint` 标准版 Chrome 128+，仍要 feature-detect |

**选 A2。** 关键认知：**「范围」本就是 `Selection` 建模的东西**。主窗口点词查词用坐标（ADR-011），是因为一次点击没有「范围」可言；而 ADR-007 的主窗口划词整句翻译**已经**走 `window.getSelection()`——「划词用 `getSelection`」是仓库里的既定范式，本 ADR 只是把它引入侧边栏，并补上主窗口划词没做的一步：把选区吸附到整词（主窗口 ADR-008 目前直接 `selection.toString().trim()`，选区停在词中间时会把半个词发给 AI）。A3 用坐标对做范围，等于放弃原生选区的全部好处去手搓一套，不值得。

### B. collapsed 选区（点击）与非 collapsed 选区（划词）怎么分派

| 情况 | 分派 |
| --- | --- |
| 选区 collapsed，或吸附后 `wordCount ≤ 1` | 当作**点单词**：走现有 `handleWordClick(word)`（词典 + `word-in-context`，镜像成单词卡，`getOneWord` 计入 Query Count / 生词本） |
| 吸附后 `wordCount` 在 2 到「整句词数 − 1」之间 | 当作**划短语**：建短语卡 + `fetchContextTranslation(phrase, sentence)` |
| 吸附后 `wordCount ≥ 整句词数`（整句/三击选中整段） | 忽略——顶部单槽位已经有整句翻译 |

不设 `SELECTION_DICTIONARY_MAX_WORDS`（=5）那种上限：ADR-008 在网页正文里要用词数区分「短语查词 vs 整句翻译」，侧边栏这里整句翻译已经在顶部占好槽位，划词只有「1 词 vs 多词」这一刀。**不 debounce**（同 ADR-008：选区本身已是精确、刻意的查询，没有边界微调的拖拽要等）。

### C. 词边界吸附：函数签名与放哪

吸附器有两种签名：**收 `Range`**（读 DOM 节点结构）或**收字符区间**（`(text, start, end)`，纯字符串）。

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| C1. `SidePanel.tsx` 内联一个 `Intl.Segmenter` | 侧边栏自己写一份 | 与 `WordProcessor` 的 ICU 分词两份并存，迟早漂移。否决 |
| C2. 抽 `snapRangeToWords(range: Range)` 到 `src/lib/wordSegment.ts` | 吸附器读 `range.startContainer/offset` 等节点结构 | 侧边栏原句里我们会插 `<mark>`（被点词高亮），选区跨元素时按节点结构算词边界要处理跨节点游标，jsdom 里还得造 live `Range` 才能测。够用但脆 |
| **C3.（采用）纯字符区间签名 `snapToWordBounds(text, start, end)`，放 `src/lib/wordSegment.ts`** | 侧边栏 `onMouseUp` 先把 DOM 选区映射成「在 `pendingContext.sentence` 里的字符区间」（`getSelectionCharRange(sentenceEl, sentence)`），再交给纯函数按 `Intl.Segmenter` 吸附 | 吸附逻辑与 DOM 结构彻底解耦——`<mark>`、文本节点怎么分割都不影响；纯函数用字面量就能测，不碰 jsdom Range；`wordSegment.ts` 只有分词那一小块，不把 `WordProcessor` 的 ~460 行拖进 side panel bundle |

**采用 C3。** 这就是原本记在 Revisit 里的「更 robust 方向」——2026-09-06 直接定为主方案。`WordProcessor.expandToWordRange`（主窗口点词查词，需要 `Range` 输出给浮层定位）**保持不动**、继续用自己的 `Intl.Segmenter`；本 ADR 不强行合并两处分词（合并要动 `WordProcessor` 内部结构 + 它的测试，风险大于收益），改为记一条 Revisit：两处 ICU 分词若在缩写/连字符边界上行为漂移，再抽 `wordSegments(text)` 低层原语给两边共用。主窗口 `triggerPhraseContextLookup` 的选区规范化本次不动（它先 `extractSentenceContext` 才拿到句子，接入 `snapToWordBounds` 要额外算偏移，单独一条 Out of Scope）。

### D. 划词后立即查，还是弹一个确认

每次划词短语查询 = 一次 `translate/word-in-context`，按 token 计费（ADR-014）。单词点击不进这一档（走现有 `handleWordClick`，词典查询是免费额度，行为不变）。

| 方案 | Pros | Cons |
| --- | --- | --- |
| D1. `mouseup` 吸附后 `wordCount ≥ 2` 立即查 | 零额外 UI；与 ADR-008 主窗口划词一致 | 侧边栏窄，用户拖着读原文、误选两三个词就扣一次费；划词是「刻意」在整页上成立，在窄面板里没那么成立 |
| **D2.（采用）选区旁弹一个确认浮标（一枚图标按钮，无文字），点了才查** | 划词与「扣费查询」解耦，误选零成本；选区本身就是范围回显，按钮不重复；浮标一出现自动获焦，Enter 确认、Esc 取消 | 多一步点击；要一个小浮标组件（但侧边栏是自家纯文本单文档，`range.getBoundingClientRect()` + `position: fixed` 足够，**不需要** `@floating-ui/dom`——主窗口引它是为了对付第三方页面的嵌套滚动 / transform，侧边栏没有） |

**采用 D2。** 主窗口 ADR-008「划词即查」的前提是「在整页文章里拖选是一个刻意动作」；侧边栏原句就几行、又窄，边读边拖高亮很自然，把「选中」直接等同于「掏钱查」不合适。确认浮标是一枚**纯图标按钮**（放大镜 / 翻译图标，`aria-label` 给无障碍，无可见文字——选中的文本自己就是范围提示，按钮不重复），只负责「确认」这一个动作。浮标定位在自家 DOM 里就是一次 `getBoundingClientRect` + 视口内 clamp，不构成 anchored-overlay 基建负担。

### E. 去掉逐词 `<button>` 的无障碍代价

现状每个词是 `<button>`，键盘可 Tab 逐词、Enter 查词。改成纯文本后：

| 处理 | 说明 |
| --- | --- |
| **采用**：原句纯文本 + 容器上一个 `onMouseUp` 委托；双击原生选中一个词（仍触发 `mouseup`），拖选一段词触发浮标 | 一句话在屏幕阅读器里读成一段文字，比 20+ 个 `<button>` 更自然；鼠标用户「点词查词」经委托 handler 保留。**纯键盘用户无法在原句里发起选区**（普通 `<p>` 收不到键盘选区事件、Chrome caret browsing 默认关）——接受，见 Consequences |
| 不采用：每个词 `<span role="button" tabIndex={0}>` | 一句话 20+ 个 tab 停靠点，键盘穿行成本高；且 `tabIndex` 元素跨选仍有 A1 的选区问题 |

丢失的是「Tab 逐词跳」，换来「选一段词一起查」这个新能力 + 原句可被正常复制。判为可接受，记入 Consequences。

### F. 短语卡的去重与展示

复用 ADR-008 的短语卡：`dictionaryStatus: 'none'`，跳过音标/词典释义/Query Count，只有短语原文 + AI 语境释义 + loading/error/重试/移除（`SidePanel.tsx:433-451`、`:648` 起，**渲染层零改动**）。

- **去重**：ADR-008 的 effect（`SidePanel.tsx:445`）今天是无脑 `unshift`，同一段文字选两次会撞 React `key={def.word}`。本 ADR 抽一个 `upsertPhraseCard(phrase)`：命中已有卡 → 前移不重查不重扣费（对齐 `handleWordClick` 的「已存在 → reorder」）；主窗口来的 `pendingContext.phrase` effect 一并改用它。确认浮标在打开前也先查 `definitions`：已有该短语卡就不弹浮标，直接前移。
- **展示位置**：混进 `definitions` 堆叠列表最前，与单词卡一致（ADR-006 newest-on-top）。
- **落库**：沿用 ADR-008——短语不写 `words` / `user_dicts`，`fetchContextTranslation` 本就无状态。

---

## Decision

### 1. 原句改为纯文本渲染（采用 A2 + E）

- 删除 `tokenizeSentence`（`SidePanel.tsx:80-105`）和 `tokens.map(... <button>)` 渲染（`:549-571`）。原句渲染为单个可选文本容器（保留 `data-testid="sidepanel-sentence"`），`user-select: text`。
- 被点击词的黄色高亮（`clickedWord`，`:533-563`）改为：对渲染出的文本做一次 `<mark>` 包裹（按 `pendingContext.word` 匹配同形词），不影响选区。
- 容器上挂**一个** `onMouseUp` 委托（不用 `selectionchange`——拖动中逐像素触发，太吵）。不挂 `onKeyUp`：普通 `<p>` 不接收键盘选区事件，挂了也是死代码。
- 委托里点单个词（collapsed 选区）仍走现有 `handleWordClick`（词典查询免费额度，行为不变）。

### 2. `src/lib/wordSegment.ts`（采用 C3）

```ts
// 模块级唯一 Intl.Segmenter('en', { granularity: 'word' })
export function snapToWordBounds(
  text: string,
  start: number,
  end: number
): { text: string; start: number; end: number; wordCount: number }
```

- 输入 `[start, end)` 是 `text` 里的字符区间（`start === end` 表示 collapsed，即一次点击的游标位置）。
- 把 `start` 往前吸附到它所在（或紧邻）词的词首、`end` 往后吸附到它所在（或紧邻）词的词尾，按 `Intl.Segmenter` 的 `isWordLike` 段判定词边界。
- 返回吸附后的区间、`text.slice` 出来的子串（不再 `trim`，吸附已保证两端贴词）、以及区间内 `isWordLike` 段的数量 `wordCount`。
- collapsed 且不在任何词内（游标在纯空白/标点）→ `wordCount: 0`，`text: ''`。
- 纯字符串，无 DOM、无副作用。`WordProcessor` 的分词**不动**。

### 3. 侧边栏选词处理（采用 B + D2，`SidePanel.tsx` 新增）

`onMouseUp` 回调：

```
sel = window.getSelection()
若 rangeCount === 0 → clearPendingPhrase()，return
若 !sentenceEl.contains(sel.anchorNode) || !sentenceEl.contains(sel.focusNode) → clearPendingPhrase()，return
[start, end] = getSelectionCharRange(sentenceEl, sel)          // DOM 选区 → 在 sentence 字符串里的字符区间
{ text, wordCount } = snapToWordBounds(pendingContext.sentence, start, end)
若 wordCount === 0 → clearPendingPhrase()，return              // 游标落在空白/标点
若 wordCount === 1 → handleWordClick(text)                     // 点单词，走现有路径，不弹浮标
否则若 wordCount ≥ tokenCount(pendingContext.sentence) → clearPendingPhrase()，return   // 整句，顶部已翻译
否则若 definitions 已有 d.word === text → upsertPhraseCard(text)（只前移），return    // 已查过，不弹浮标
否则 → setPendingPhrase({ text, rect: sel.getRangeAt(0).getBoundingClientRect() })   // 弹确认浮标
```

`getSelectionCharRange(sentenceEl, sel)`：原句是单一容器、内部至多一个 `<mark>`（被点词高亮），用 `Range` 从 `sentenceEl` 起点到选区起/止点各做一次 `range.toString().length` 求字符偏移即可（同 ADR-011 Decision 5 `getTextOffsetWithin` 的思路，但目标是字符数不是节点）。`<mark>` 只是包了同一段文本，`toString()` 忽略元素边界，偏移不受影响。

**确认浮标**（新的小组件，`SidePanel.tsx` 内即可，非独立文件）：

- `pendingPhrase` 非空时渲染一个 `position: fixed` 的**图标按钮**（无可见文字，一枚放大镜/翻译图标 + `aria-label="查这段词的句中释义"`）；`top/left` 由 `rect` 算，贴在选区下方，视口内 clamp（侧边栏是自家单文档、几乎不滚，一次 `getBoundingClientRect` 够用，**不引** `@floating-ui/dom`）。
- 挂载即 `focus()`：浮标一出现焦点就落在它上面，Enter 确认 / Esc 取消，不用再摸鼠标。
- 消失条件：点击它（→ `upsertPhraseCard(text)` 后清空）、`Esc`、面板内下一次 `mousedown`、`scroll`、选区变空或变化。
- `data-testid="sidepanel-phrase-confirm"`。

`upsertPhraseCard(phrase)`：

```
若 definitions 已有 d.word === phrase → 前移该卡，return（不重查、不重扣费）
否则 unshift { word: phrase, dictionaryStatus: 'none', contextStatus: 'loading' }
     fetchContextTranslation(phrase, pendingContext.sentence)   // 一次 translate/word-in-context，计费
```

`SidePanel.tsx:439-451` 现有的 `pendingContext.phrase` effect（主窗口 ADR-008 来路，已在网页那侧确认过选区）**直接**调 `upsertPhraseCard`，不经浮标。

### 4. 不新增消息 / 存储链路

侧边栏划词全程在 Side Panel 组件内闭环：`window.getSelection()` → `getSelectionCharRange` → `snapToWordBounds` → `fetchContextTranslation`。**不**走 `openSentencePanel` 消息、**不**写 `PendingSentenceContext.phrase`、**不**碰 `chrome.storage.session`——那条链路是 ADR-006/007/008 为「从网页跨上下文把数据送进侧边栏」建的，侧边栏自己手里已经有 `pendingContext.sentence`，不需要。

### 5. 测试（seam 已与用户确认）

两个 seam：`wordSegment.ts` 的导出函数、`<SidePanel>` 组件（RTL + mock `sendMessageToBackground`）。不测 React 内部 state、不测私有 helper。

- `src/lib/__tests__/wordSegment.test.ts`：`snapToWordBounds` 用字面量 `text` + 区间——选区停在词中间 → 吸附整词；含前后空白 → 收进两端词；跨标点；collapsed 在词内 → 该词；collapsed 在空白 → `wordCount 0`；缩写 `don't`、连字符 `hunt-down` 的边界；多词区间 → `wordCount` 正确。
- `src/sidepanel/__tests__/SidePanel.test.tsx` 增：原句纯文本渲染（不再有逐词 `<button>`）；mock `window.getSelection` 返回落在原句内、跨 3 词的选区 → 触发 `onMouseUp` → **弹出确认浮标**、此时**未**发 `translateWordInContext`；点浮标 → 列表新增一张 `dictionaryStatus:'none'` 短语卡且只发一次 `translateWordInContext`；`Esc` / 面板内 `mousedown` / 选区清空 → 浮标消失且不发请求；collapsed 选区在某词 → 走 `handleWordClick`、不弹浮标；选中整句 → 无浮标；已有该短语卡时再选 → 不弹浮标、卡片前移；选区 `anchorNode` 在原句外 → 无浮标。
- 回归：`pendingContext.phrase`（主窗口 ADR-008 来路）经 `upsertPhraseCard` 直接建卡、不经浮标。

---

## Rationale

- **A2（原生 `Selection` + 词边界吸附）而不是 A1/A3**：主窗口的「点用 `caretPositionFromPoint`、划用 `window.getSelection()`」不是随意的，是「点没有范围、划才有范围」的自然结果（ADR-011 vs ADR-007）。侧边栏划词属于后者，照搬 `getSelection()` 就对了，还白得拖选高亮、双击选词、Shift 扩选、屏幕阅读器语义。A1（逐词元素追踪跨选）正是 ADR-011 Context 代价表里被清掉的方向，且跨 `<button>`/`<span>` 选区在 Chrome 里本就不稳。A3（坐标对做范围）等于把原生选区的好处全丢掉再手搓。
- **吸附到整词是必要的一步**：选区停在词中间不吸附就会把半个词发给 AI。吸附器用**纯字符区间签名**（C3）而非收 `Range`：吸附逻辑与「原句 DOM 长什么样、`<mark>` 怎么切文本节点」彻底解耦，纯函数用字面量即可测，不碰 jsdom 里残缺的 `Range`/`Selection` 几何。
- **统一用 `getSelection()` 处理点和划，不再需要 `caretPositionFromPoint`**：侧边栏原句是我们自己渲染的纯文本，一次点击 Chrome 就会在该处放一个 collapsed 选区，映射成字符区间后 `snapToWordBounds` 吸附它就得到被点的那个词——比主窗口还简单（主窗口当年需要 `caretPositionFromPoint` 是因为宿主 `<u>` 元素会拦截）。
- **不建消息/存储链路（Decision 4）**：ADR-006/007/008 的 `openSentencePanel` + `chrome.storage.session` 是为「content script → background → side panel」跨上下文传数据存在的。侧边栏内划词的两个输入（选区文本、当前句子）都已在组件里，走那条链路只是徒增一次序列化往返和一个 `PendingSentenceContext` 字段的语义重叠（ADR-008 已经吐槽过 `word`/`phrase` 字段的死数据问题）。
- **去掉逐词 `<button>` 的无障碍取舍（E）**：换来的是「选一段词一起查」和「原句可正常复制」；一句话在 AT 里读成文本比读成 20 个按钮更好；鼠标点词经委托 handler 保留。逐词 Tab 跳这个能力，实测价值低于成本。
- **确认浮标（D2）而不是划词即查（D1）**：ADR-008 主窗口「划词即查」立足于「在整页文章里拖选是刻意动作」；侧边栏原句就几行、面板又窄，边读边拖选很自然，把「选中」直接当「掏钱查」会误伤。浮标把「圈定范围」和「确认花钱」分成两步，误选零成本。浮标只是一枚图标按钮、不带文字——选中的文本自己就是范围提示，按钮再写一遍是噪音；代价只是自家 DOM 里一次 `getBoundingClientRect` + 一个 `position:fixed` 图标按钮——不引 `@floating-ui/dom`（那是给主窗口对付第三方页面嵌套滚动的，侧边栏没有这些）。单词点击不套浮标：词典查询是免费额度，且点一个词是明确意图。

---

## Consequences

### Positive

- 侧边栏原句获得划词查短语能力，产物与 ADR-008 短语卡一致，用户心智统一（「选一段词 → 列表加一条这段词在句中的意思」）。
- 侧边栏选词范式与主窗口对齐：点→collapsed 选区→单词，划→非 collapsed 选区→短语（同 ADR-011「点」与 ADR-007「划」的分工）。
- `tokenizeSentence` + 逐词 `<button>` 渲染删除；原句 DOM 从 `O(词数)` 个交互元素变成一个文本容器；原句可被用户正常选中复制。
- 词边界吸附是一个纯字符串函数（`src/lib/wordSegment.ts`），side panel bundle 不必拖入 `WordProcessor` 的 ~460 行；`WordProcessor` 的分词不动，零回归风险。
- 短语卡去重 bug（`SidePanel.tsx:445` 无脑 `unshift` 撞 React key）随 `upsertPhraseCard` 一并修，主窗口来路也受益。
- 划词与「扣费查询」解耦：误选、边读边拖高亮都零成本，只有点了浮标才发计费请求。
- 渲染层、计费、重试、移除逻辑零改动，全部复用。

### Negative

- **原句逐词 `<button>` 移除 → 纯键盘用户不能再在原句里查词/查短语**。普通 `<p>` 收不到键盘选区事件，Chrome caret browsing 默认关，所以 Shift+方向键选区这条路走不通；查词要靠鼠标（点词 / 双击 / 拖选）。屏幕阅读器把整句读成一段文字（比 20+ 个 `<button>` 好），且下方生词卡列表、浮标确认按钮都是可聚焦的。若以后要补键盘可达：给原句加 `tabIndex` + 方向键在 `Intl.Segmenter` 词序列上移动一个「当前词」高亮，是独立增强（见 Revisit）。
- **多一次点击**：划完词还要点浮标才出结果。相较主窗口 ADR-008 划词即出，是刻意的一步减速，换误计费防护。
- **新增一个浮标组件 + 一组消失时机**（`Esc` / `mousedown` / `scroll` / 选区变化）。虽在 `SidePanel.tsx` 内、无新依赖，但消失时机漏一个就会留一个「幽灵按钮」，测试要覆盖全。
- **`getSelectionCharRange` 的偏移计算**：DOM 选区 → `sentence` 字符串偏移这一步仍读一点 DOM（`Range` 求 `toString().length`）；原句内的 `<mark>` 不影响（`toString()` 忽略元素边界），但选区端点落在 `<mark>` 边界的临界情况要测。**吸附本身**（`snapToWordBounds`）是纯函数，不受影响。
- 多词选区在第 4 步上线前不产生任何效果（不是回归——本来没这功能）。

### Mitigation

- 实施顺序（TDD，每步红→绿→可独立回滚）：
  1. `src/lib/wordSegment.ts` + `snapToWordBounds` + `wordSegment.test.ts`。纯函数，零现有代码改动。
  2. `SidePanel.tsx`：原句改纯文本渲染（删 `tokenizeSentence` / 逐词 `<button>`）+ `<mark>` 高亮被点词 + 容器委托 `onMouseUp` + `getSelectionCharRange` + 单词分支走 `handleWordClick`。此步交付「原句纯文本 + 点词仍能查」，功能等价于今天。
  3. `upsertPhraseCard` + 把 `pendingContext.phrase` effect 收敛过去（修去重 bug）。此步主窗口来的短语卡走新路径。
  4. 确认浮标（`pendingPhrase` 状态 + 图标按钮组件 + `clearPendingPhrase` 统管消失时机）+ 多词选区分支。多词选区从「无反应」变成「弹浮标 → 点 → 短语卡」。
- 浮标幽灵按钮：消失时机统一走一个 `clearPendingPhrase()`，`onMouseUp` 开头、`Esc`、`scroll`（capture）、面板 `pointerdown` 全指向它；`SidePanel.test.tsx` 逐条覆盖。

---

## Out of Scope（本次不做）

- **逐词批量查**：选中一段词、给**每个词**各自的句中释义（N 条结果）。本 ADR 只做「这一组词作为一个整体的句中释义」（一张短语卡），与 ADR-008 一致。逐词批量是另一个交互 + 可能的批量端点，另议。
- **把确认浮标推广到主窗口 ADR-008 划词**（网页正文里划词也先确认再查）。本 ADR 只在侧边栏加浮标；主窗口维持即查。
- **短语落库 / 短语生词本**：沿用 ADR-008，短语不写库。
- **主窗口 ADR-008 的选区规范化 / 分级重构**：`SELECTION_DICTIONARY_MAX_WORDS` 等常量、三路分支、`triggerPhraseContextLookup` 的 `selection.toString().trim()` 都不动。主窗口接入 `snapToWordBounds`（需在 `extractSentenceContext` 之后额外算选区在句中的偏移）单独另议。
- **合并 `wordSegment.ts` 与 `WordProcessor` 的两处 `Intl.Segmenter`**：本 ADR 让它们并存（`WordProcessor` 的分词零改动、零回归风险）。若两处在缩写/连字符边界上行为漂移，再抽 `wordSegments(text)` 低层原语给两边共用（见 Revisit）。
- **原句里把划中的短语高亮**（类似被点词的黄底）。可做的小增强，不阻塞本 ADR。
- **整句卡 / 短语卡在 `enx-ui` 生词本的呈现**。

---

## Revisit Trigger

- **确认浮标被嫌多此一举**（用户反馈「选了还要再点一下很烦」）：回落到 D1——多词选区 `mouseup` 直接 `upsertPhraseCard`，去掉 `pendingPhrase` 状态与浮标组件。改动局限在 Decision 3。
- **浮标定位在某些情况下不准**（选区跨多行时 `getBoundingClientRect` 取的是整个包围盒；面板缩得很窄触发换行）：改用 `range.getClientRects()` 的最后一个矩形（选区结尾处）定位，或退成「原句下方固定位置的一条操作栏」而非贴着选区。
- **用户经常想「同一短语在不同句子里的释义对比」**（ADR-008 已记同款 Trigger）：重新评估短语卡是否允许同一短语文本出现多张卡（当前 `upsertPhraseCard` 按短语文本去重、行为等同单词卡）。
- **`getSelectionCharRange` 在某些 DOM 形态下算错偏移**（原句以后不再是单容器 + 至多一个 `<mark>`，比如加了逐词生词标记）：把「DOM 选区 → 字符区间」这步换成对渲染文本做一次全量 `textContent` 比对定位，或给原句加不可见的字符锚点。`snapToWordBounds` 本身不受影响。
- **`wordSegment.ts` 与 `WordProcessor` 两处 `Intl.Segmenter` 行为漂移**（同一缩写/连字符两边切分不一致）：抽 `wordSegments(text): { segment, index, isWordLike }[]` 低层原语，`snapToWordBounds` 和 `WordProcessor.tokenizeWords`/`expandToWordRange` 都基于它重写。
- **纯键盘用户要能在原句里查词/查短语**：给原句 `<p>` 加 `tabIndex={0}`，用方向键在 `Intl.Segmenter` 词序列上移动一个「当前词」ring highlight，Enter 查该词、Shift+方向键扩成短语再 Enter 走浮标那条确认路径。是一次独立的无障碍增强，不阻塞本 ADR。
- **需要在原句上做更多交互**（标记生词、点短语再拆词、hover 预览）：纯文本 + 委托 handler 的结构比逐词元素更容易承载，届时在此基础上加。

---
