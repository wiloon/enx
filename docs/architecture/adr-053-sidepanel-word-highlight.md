---
status: proposed
date: 2026-10-11
related: adr-011（主窗口 CSS Custom Highlight API 下划线，本 ADR 把同一机制搬进侧边栏）、adr-014（锚点词 `<mark>`，本 ADR 修订为 Highlight API）、adr-017（侧边栏原句纯文本，本 ADR 让它真正只剩一个文本节点）、adr-006（页面查词镜像进侧边栏）、adr-050（标签页级侧边栏，面板知道自己的 `tabId`）
---

# ADR-053：侧边栏原句的生词下划线与锚点词统一用 CSS Custom Highlight API，并与主窗口双向同步

主窗口里查过的词会画下划线（ADR-011）。下划线按**词**计，不按出现位置计：content script 的 `wordCache` 里 `LoadCount > 0`、未标「已认识」的词，页面上每一处都画，颜色按 LoadCount 分档。

侧边栏原句（ADR-017 纯文本）里没有这层下划线，唯一的标记是 ADR-014 的 `<mark>`：包住在主窗口点了「整句翻译」的那个词（锚点词）。于是：

- 同一个句子，主窗口有下划线，侧边栏没有；
- 在侧边栏原句里点词查询，服务端 LoadCount +1，但主窗口的 `wordCache` 不知道，刷新页面前不会画线。

我们决定：**侧边栏原句和主窗口用同一套下划线规则；任一处查词，两处都立即更新；侧边栏里所有词级标记（下划线和锚点）都用 CSS Custom Highlight API，不再用 `<mark>`。**

## Considered Options

- **锚点继续用 `<mark>`，只有下划线用 Highlight API**：`<mark>` 能加粗、圆角、留内边距（`::highlight()` 只接受 `color` / `background-color` / `text-decoration` / `text-shadow` 等不影响排版的属性）。但侧边栏会同时有两套标记机制；`<mark>` 还把原句切成多个文本节点，ADR-017 的 `getSelectionCharRange` 得一直顾着元素边界（ADR-017 Revisit 已点名这个风险）。锚点和下划线视觉上一个是背景、一个是线，不会混淆，少了加粗和圆角可以接受。否决。
- **逐词 `<span>` 画下划线**：违反 ADR-017「原句不拆逐词元素」；词状态一变就要重渲染文本。否决。
- **侧边栏打开时按句子里的词调一次 `getWords` 取状态**：多一次请求；主窗口 `wordCache` 里已经有这些词的状态（页面启用时 `getWords` 取过）。否决，改为随句子带过去（Decision 3）。

## Decision

1. **侧边栏原句只渲染纯文本，一个文本节点。** 删掉 `renderSentence` 的 `<mark>` 包裹。所有词级标记都是注册到侧边栏 document 的 `CSS.highlights` 里的 Range：
   - `enx-hl-1` … `enx-hl-N`：生词下划线，分档、颜色、`::highlight()` 规则与主窗口完全一致（侧边栏是独立 document，同名不冲突）；
   - `enx-sp-anchor`：锚点词，背景色 `brand/15`，与今天 `<mark>` 的底色相同，不加粗、无圆角。

   两者叠在同一个词上时，背景和下划线是不同属性，同时显示。

2. **分档逻辑抽成小模块共用。** `isReviewable` / `reviewBucket` / `HIGHLIGHT_BUCKET_COLORS` / `HIGHLIGHT_NAME_PREFIX` 从 `WordProcessor` 抽到 `src/lib/reviewBucket.ts`，`WordProcessor` 和侧边栏都从这里取。不把 `WordProcessor` 整个拖进 side panel bundle（ADR-017 C3 的同一考虑）。

3. **侧边栏的词状态表。** 面板维护一张 `word → WordData`（小写）表，来源有三个：
   - `openSentencePanel` 时 content script 从 `wordCache` 里取出该句所有词的条目，随 `word` / `sentence` 一起写进 pending context（字段 `wordStates`）；
   - 面板在原句里点单词时 `getOneWord` 返回的 `ecp`（短语查询不算，见 Decision 6）；
   - ADR-006 的页面查词镜像（`latestPageWordKey`）带来的 `ecp`。

   表一变，或原句重新渲染，就在 `useLayoutEffect` 里重建所有 Range：按 `Intl.Segmenter`（`wordSegment.ts` 已用）切出词的字符区间，对单一文本节点建 Range，再按档位注册。React 重渲染会换掉文本节点、让旧 Range 失效，所以必须每次重建，不做增量。

4. **侧边栏查词 → 主窗口刷新。** 面板 `getOneWord` 成功后，直接 `chrome.tabs.sendMessage(tabId, { action: 'panelWordLookup', word, ecp })`（面板 URL 里有 `tabId`，ADR-050）。content script 收到后写入 `wordCache`、调用 `refreshHighlights()`，与主窗口自己查词的后半段相同。

   content script 不在（页面没启用 ENX、已关闭或导航走）时 `sendMessage` 报 "Receiving end does not exist"，捕获后忽略。下划线状态跟着**词**走、存在服务端：之后在任何页面启用 ENX，`getWords` 取到 LoadCount 就会画线，与这个词是从哪篇文章、哪个句子查的无关，不需要特殊处理。

5. **高亮开关同时管两边。** `WORD_HIGHLIGHT_KEY`（「阅读时高亮生词」）关闭时，侧边栏不注册 `enx-hl-*`（锚点 `enx-sp-anchor` 不受影响，它不是生词标记）。面板监听 `chrome.storage.onChanged` 上的这个 key，与主窗口一样即时生效。

6. **只给单词画线，不给短语。** 侧边栏划选短语、主窗口划词翻译都不产生下划线；短语卡片的查询不写进状态表，也不发 `panelWordLookup`。两处划选逻辑的统一另议，不在本 ADR 范围内。

## Consequences

- 侧边栏查了某个词，主窗口里所有这个词都画线（整页范围，与主窗口点词一致）。
- 锚点词外观从「浅底 + 加粗 + 圆角」变成「浅底」，与下划线视觉上仍分得清。
- `getSelectionCharRange` 面对的原句永远只有一个文本节点，ADR-017 Revisit 里「加了逐词标记后偏移算错」的风险消失。
- `SidePanel.test.tsx` 里断言 `data-clicked-word` 的用例改为断言 `CSS.highlights.get('enx-sp-anchor')` 的 Range。jsdom 没有 Highlight API，`src/test/setup.ts` 已有 shim（ADR-011），单元测试能断言「注册了哪些 Range、各在哪一档」；真实绘制靠 Playwright e2e（`word-highlight-toggle.spec.ts` 已是这种写法）。
- 主窗口「标为已认识」不经过 ADR-006 镜像，已打开的侧边栏不会立即去掉该词的下划线，下次该词在面板里更新状态时才同步。v1 接受。

## 测试

- `reviewBucket.ts`：从 `WordProcessor` 现有用例迁过来，行为不变（characterization）。
- 侧边栏 Range 构建：给定句子 + 状态表 + 锚点词，断言每个档位、`enx-sp-anchor` 的 Range 文本；开关关闭时没有 `enx-hl-*`；短语查询不改状态表。
- content script：收到 `panelWordLookup` 后 `wordCache` 更新并重建高亮；没有 `articleRoots` 时什么都不做。
- e2e：主窗口整句翻译 → 侧边栏原句有与主窗口一致的下划线；侧边栏点一个新词 → 主窗口 `CSS.highlights` 里多出该词的 Range。
