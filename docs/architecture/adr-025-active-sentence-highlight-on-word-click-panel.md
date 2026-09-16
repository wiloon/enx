# ADR-025：单词点击触发整句翻译时，临时高亮主窗口里的原句——划词/短语两条路径已有原生选区高亮，不需要

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-09-16 |
| **日期** | 2026-09-16 |
| **关联 Spec** | 无独立 TASK-SPEC，留到编码阶段再写（同 ADR-008/010/011/017 的做法） |
| **关联 ADR** | [`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（本 ADR 复用其建立的 CSS Custom Highlight API 机制与 `::highlight()` 样式注入模式，也复用其 Decision 5 把 `extractSentenceContext` Range 化的结果）、[`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（划词整句翻译，**明确排除在本 ADR 范围外**）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（正文划词短语查询，**明确排除**）、[`adr-017-sidepanel-sentence-drag-select-phrase-lookup.md`](adr-017-sidepanel-sentence-drag-select-phrase-lookup.md)（侧边栏原句划词短语查询，**明确排除**——发生在侧边栏内，本来就不是"回到主窗口找句子"这个问题） |

---

## Context

用户点单词触发整句翻译（`handleOpenSentencePanel`，`content.tsx:232-259`）后，会切到侧边栏看 AI 翻译结果。文章长、句子多的情况下，看完翻译再切回主窗口继续阅读时，找不回刚才点的是哪一句——`WordPopover` 弹窗关闭后正文和点击前逐字节一样，没有留下任何视觉痕迹。

划词整句翻译（ADR-007 的 `triggerSelectionTranslation`）和短语查询（ADR-008 的 `triggerPhraseContextLookup`、ADR-017 的侧边栏原句划词）都不存在这个问题：触发方式本身就是"选中一段文本"，`window.getSelection()` 留下的原生选区高亮会一直可见，直到用户下一次操作。只有单词点击这条路径没有选区可言——点击只是一个坐标，`WordProcessor.extractSentenceContext(reference, word)`（`wordProcessor.ts:412-475`）只返回 `{ sentence, sentenceIndex }` 纯文本用于发给 AI，从未在正文上留下任何标记。

## 已确认的决策（2026-09-16，用户确认）

1. **范围仅限单词点击这一条路径**：只在 `handleOpenSentencePanel` 里加高亮。`triggerSelectionTranslation`（ADR-007）与 `triggerPhraseContextLookup`（ADR-008/017）不动——原生选区已经覆盖同样的视觉需求，再加高亮是重复噪音。
2. **只高亮最近一次查询的句子**，不做累积列表。下一次单词点击触发整句翻译时，上一个高亮直接被替换。
3. **复用 ADR-011 的 CSS Custom Highlight API 机制**（`CSS.highlights` + `::highlight()`），不引入 DOM class 或包裹元素——延续 ADR-011「正文 DOM 全程不变」的立场。新开一个独立的 highlight 名（如 `enx-hl-active-sentence`），不复用 `enx-hl-<bucket>` 那几档复习进度色——语义不同（一个是"这个词该不该复习"，一个是"刚才查的是这句"），混在一起容易互相干扰。
4. **清除时机：用户在主窗口里真的操作了才清除，不设任何计时器**——`click` / `scroll` / `keydown` 三个事件任一触发即清。不用 `mousemove`：光标常常本来就停在正文上（或者只是划过），会在用户眼睛找到高亮之前就把它清掉。
5. **明确不做自动淡出**。起初的草案里有一个「几秒后自动消失」的兜底，担心的是「用户切回来但不点任何地方，高亮无限期留着」。实现后发现这个担心站不住：高亮本来就是一层浅底色，而「替用户留着位置」正是它的职责，用户一操作它就消失了，没有需要兜底的场景。反过来计时器会主动破坏功能——见下方 Decisions 第 2 条。

## Decisions（实现形状）

- **扩展 `extractSentenceContext` 的返回值**：现在只有 `{ sentence: string, sentenceIndex: number }`，没有句子在 `container` 内的起止字符偏移，无法据此重建 `Range`。需要加上句子的 start/end 偏移（函数内部本来就算过 `segment.index` / `segmentEnd`，只是没往外传），供调用方用同一个 `container` 构造出对应的 `Range`。这是纯增量扩展——`triggerPhraseContextLookup`（ADR-008/017 的短语路径）也调用这个函数，但只读 `sentence` 字段，新增字段对它透明，不改变其行为。
- **新增 `WordProcessor.setActiveSentenceHighlight(range: Range)`**：内部 `CSS.highlights.set('enx-hl-active-sentence', new Highlight(range))`，替换式写入（不是 add，同一时刻只有一句）。配套 `clearActiveSentenceHighlight()`：`CSS.highlights.delete('enx-hl-active-sentence')`。
- **样式**：一条 `::highlight(enx-hl-active-sentence) { background-color: ...; }` 规则，追加进 content.tsx:1331-1347 现有的那个 `<style data-enx-highlight-styles>` 里（按 bucket 生成规则的同一段逻辑里多加一条，不新开 `<style>` 标签）。
- **触发点**：`handleOpenSentencePanel`（content.tsx:232-259）在 `extractSentenceContext` 返回句子偏移后，构造 `Range` 并调用 `setActiveSentenceHighlight`。
- **清除**：`ACTIVE_SENTENCE_CLEAR_EVENTS = ['click', 'scroll', 'keydown']` 三个监听，任一触发就 `clear()`，`clear` 内部把三个监听和那个注册用的 `setTimeout` 一并撤掉。三条实现期踩出来的约束：
  1. **必须延后一个 tick 注册**（`setTimeout(..., 0)`）。`handleOpenSentencePanel` 是「整句翻译」按钮自己的 click handler，调用它的那个 click 事件此刻仍在向 `document` 冒泡（`WordPopover` 全程没有 `stopPropagation`），同步注册会让**这一次点击**立刻把自己刚设好的高亮清掉，用户根本看不到。这是本功能第一版上线后「完全看不到高亮」的原因。
  2. **不要加固定计时器**。第一版加过一个 8s 自动清除，结果是：用户点完切到侧边栏读译文，读译文几十秒很正常，计时器在人还在侧边栏时就到期，回到主窗口高亮已经没了——功能等于没做。曾考虑改成「`window` 的 `focus` 事件触发后再开始倒计时」（侧边栏与主窗口同属一个浏览器窗口，tab 始终 visible，`visibilitychange` 不触发，只有 `focus`/`blur` 可用），但既然「用户操作即清除」已经覆盖了全部真实场景，计时器整个删掉，不留这个维度。
  3. **监听用捕获阶段**（`addEventListener(type, clear, true)`）。`scroll` 不冒泡，嵌套滚动容器（X 的时间线、任何 `overflow` 容器）里的滚动不走捕获就永远到不了 `document`。
- **highlight 名字故意不带 `enx-hl-` 前缀**（最终定为 `enx-active-sentence`）。`applyHighlights` 每次重建都会先 `clearHighlights()` 把所有 `enx-hl-*` 全清一遍，而重建在「几乎任何一次查词」后都会发生（词的复习档位可能变），共用前缀会让这条高亮被一次无关的 `refreshHighlights()` 顺手抹掉。
- **`disableEnx` 清理**：`disableEnx`（content.tsx）里 `WordProcessor.clearHighlights()` 之后显式再调一次本功能的 cleanup——因为上一条的关系，前缀匹配那个循环扫不到它，而且还要顺带摘掉 click 监听和计时器。

## 与既有 ADR 的关系

- **复用 ADR-011 的机制，不推翻其任何决策**：CSS Custom Highlight API、`::highlight()` 样式注入模式原样沿用；新增的 highlight 名与复习分桶（`enx-hl-1` … `enx-hl-6`）语义独立。
- **明确排除 ADR-007、ADR-008、ADR-017 三条选区驱动的路径**：它们触发时用户手上已经有一份原生选区高亮，问题不存在，本 ADR 不覆盖、不修改这三者的任何行为。
- **在 ADR-011 Decision 5 的基础上做增量扩展**：`extractSentenceContext` 已经是 Range 驱动的（收 `wordRange`），本 ADR 只是让它多算、多返回一点已经在内部算过的偏移信息，不改变签名的"输入是 Range"这个前提，也不影响短语路径的现有调用方式。

## Revisit Triggers

- 若 `click`/`scroll`/`keydown` 这组信号实际用起来不对——最可能的是 `scroll` 太急（用户回来第一个动作往往就是滚动几行找位置，结果高亮在眼睛跟上之前就没了）——先把 `scroll` 从清除事件里摘掉，退回 `click` + `keydown`。反方向（高亮留得太久碍事）目前没有预期场景，真出现再考虑计时器，但要连带解决 Decisions 第 2 条的问题。
- 另一条互补的思路：触发那一刻直接 `scrollIntoView` 把句子滚进视口，减少"找"这个动作本身。当前没做，因为它会在用户还没离开主窗口时就动页面滚动位置，干扰性比高亮大得多。
- 高亮的具体配色（背景色/透明度）需要在实现时找几篇真实文章试一下，确认和复习进度的下划线颜色不会混淆、不会太扎眼。
- 如果以后发现划词/短语路径在长文章场景下原生选区也不够醒目（比如滚动后选区状态丢失），可以再评估要不要把同一套机制延伸过去——但目前没有这个诉求，YAGNI。
