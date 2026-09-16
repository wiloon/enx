# ADR-023：侧边栏单词卡列表与句子翻译合并成一个统一有序历史列表，句子内点词/划词嵌套进该句子自己的子列表——不重排顶层顺序，修「回主窗口查词后历史句子消失」的问题

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-15。已按方案实现（TDD）：`SidePanel.tsx` 的 `definitions`/`pendingContext`/`chinese`/`status` 收敛为单一 `entries: PanelEntry[]`（`PanelEntry = WordEntry \| SentenceEntry`），拆出 `SentenceBlock`/`WordCard` 组件，四个纯函数 `findCard`/`reorderOrInsertCard`/`patchCard`/`removeCard` 承载所有按 scope（top-level vs 某条 `SentenceEntry.words`）的读写。`mergePageWordLookup` 不再清空句子。`SidePanel.test.tsx` 全量迁移 + 新增「多句历史共存」「句子内查词不重排顶层」两个用例；code-review 后修：`seedAnchorWord`（ADR-014 锚点词自动查询）补回「已存在卡片则只回填、不重查」的守卫——它是在 `translateSentenceWithWord` 的 `.then()` 里跑的，若这期间用户手动点了同一个高亮锚点词，原实现会对同一个词重复触发 `getOneWord`（重复计入 Query Count）与 `translateWordInContext`（重复计费）；用 `entriesRef`（在 effect 里同步镜像 `entries`）替代该函数原本闭包住的、可能过期的 `entries`，修掉这个过期闭包读到旧值的问题。`pnpm jest`（184 passed）/ `tsc` / `pnpm build` 通过。 |
| **日期** | 2026-09-15 |
| **关联 Spec** | 配套 TASK-SPEC 留到编码阶段再写（同 ADR-008 / ADR-017 的做法） |
| **关联 ADR** | [`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（本 ADR 改动的 `definitions` 累积列表、newest-on-top 惯例的出处）、[`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md) / [`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（`pendingContext` 单槽位句子翻译、`PendingSentenceContext` 的出处；本 ADR 把这个单槽位改成历史列表里的一种 entry）、[`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（`LATEST_PAGE_WORD_STORAGE_KEY` 正文点词回传侧边栏的机制，本 ADR 不改这条链路的传输方式，只改它落地时对句子状态的副作用）、[`adr-017-sidepanel-sentence-drag-select-phrase-lookup.md`](adr-017-sidepanel-sentence-drag-select-phrase-lookup.md)（`handleSentenceSelection` 单词/短语分派、`upsertPhraseCard`，本 ADR 改这两者的落点） |

---

## Context

### 现状（`SidePanel.tsx`）

侧边栏today有两块**互相独立**的 state：

- `definitions: WordCardData[]`（`SidePanel.tsx:196`）：单词卡/短语卡的扁平列表，newest-on-top（ADR-006），append-only，只有点「Clear」才整体清空。
- `pendingContext` + `chinese`/`status`（`SidePanel.tsx` 多处）：当前句子翻译的**单槽位**，来自 ADR-007（划词整句）/ ADR-008（短语）经 `PendingSentenceContext` 传入，渲染在面板顶部，独立于 `definitions`。

`mergePageWordLookup`（`SidePanel.tsx:253-276`）在正文点词（`LATEST_PAGE_WORD_STORAGE_KEY` 变化，走 ADR-014 那条链路）时被调用，其中 `setPendingContext(null)` 等三行（`:256-259`）**会把当前显示的句子原文+译文清空**——原意是「新词不一定属于当前句子」，但代价是：用户翻译完一句话，回到正文随手点一个词查词，这句话和它的译文就从侧边栏消失，且不进入任何历史。

### 需求

用户希望：

1. 句子翻译（原文+译文）不再是易失的单槽位，而是并入 `definitions` 那样的历史列表，**newest-on-top**，和单词卡混排。
2. 在正文里点新词，正常置顶显示在列表最前——**不需要**判断这个词是否属于列表里某条历史句子。
3. 在侧边栏里对着某条**历史句子的原文**点词/划词查询时，查询结果挂在**这条句子自己下面**的一个子列表里，且**这条句子在顶层列表里的位置不变**（不因为句子内部查词而被重新置顶或跳动）。

### 为什么值得写 ADR

- **状态模型的形状会长期影响交互**：`definitions: WordCardData[]` 这个扁平列表已经被 ADR-006/008/017 三次复用/扩展；本次要把句子也塞进同一个列表并允许嵌套子项，是对这个核心数据结构的一次结构性改动，后续任何面板新交互都会长在这个形状上。
- **两条路径的判定逻辑容易混，需要白纸黑字定下来**：「正文点词」和「句子内点词」看起来都是「点一个词查词典」，但本 ADR 决定让它们走完全不同的落点（一个置顶顶层列表，一个不置顶只塞进句子子列表），且刻意不做「这个词属不属于某条历史句子」的语义判断——这个决定的理由值得记录，避免以后有人「优化」成统一逻辑又引入指代歧义。

---

## Options Considered

### A. 句子翻译要不要并入 `definitions` 同一个列表

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 止血版：保留 `pendingContext` 单槽位，只删掉 `mergePageWordLookup` 里清空它的那三行 | 正文点词不再清空句子 | 改动极小，一行文件 diff | 句子依旧只有「当前」一条，翻译第二句会覆盖第一句，进不了历史；不满足需求 1 |
| **A2.（采用）合并成统一的 `entries: PanelEntry[]`**，`PanelEntry = WordEntry \| SentenceEntry`，`SentenceEntry` 自带 `words: WordCardData[]` | 句子和单词共享同一个顶层有序列表和 newest-on-top 规则 | 满足「句子进历史、和单词混排」的需求；`definitions`/`pendingContext` 两套并行状态收敛成一套，`mergePageWordLookup` 不再需要对句子做任何特殊处理 | 是一次真实的重构：渲染层从「单例句子块 + `definitions.map`」改成「`entries.map`，按 `kind` 分支渲染」；触及面比 A1 大 |

**采用 A2。** A1 只是把 bug 修掉，不满足「句子进历史」「跨句子分别嵌套查词结果」两个核心需求；这两个需求本质上要求句子和单词活在同一个有序结构里，A2 是唯一能同时满足三条需求的形状。

### B. 判定「点的词该归到哪条历史句子」的机制

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. 显式 `sentenceId` 跨上下文传递：正文点词也尝试匹配「这个词是否落在某条历史句子文本里」，匹配上就嵌套 | 理论上更「智能」 | 需要把 sentenceId/匹配逻辑打通 `content.tsx → background → chrome.storage.session → SidePanel`；正文页面本身并不知道侧边栏历史里有哪些句子，「一个词是否属于某条历史句子」在语义上就模糊（同一个词可能出现在好几条历史句子里，也可能哪条都不属于）；用户明确表示不需要 |
| **B2.（采用）只有侧边栏内、对着某条句子自己渲染出来的文本发起选择，才归入该句子**；正文点词永远走顶层置顶，不做归属判断 | 无需任何新的 id/匹配逻辑——句子内选词的处理函数本来就是绑定在那条句子自己的 `<p>` 上的闭包，天然知道自己是哪条 entry；正文点词路径（`mergePageWordLookup`）完全不用动匹配逻辑 | 两条路径行为不对称（正文点词永远不嵌套，哪怕这个词恰好在某条历史句子里），但这正是用户要的简化 |

**采用 B2。** 用户明确「正文点词不需要关心属于哪个句子」；B2 把「归属判定」这个最难的部分直接消掉，两条路径各自独立、互不感知，实现和心智都更简单。

### C. 句子内划短语（ADR-017 的确认浮标短语）要不要也嵌套

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 短语仍进顶层 `entries`，与单词区别对待 | 维持 ADR-017 现有落点 | 改动更小 | 「从这条句子里选的东西」一部分嵌套（单词）一部分不嵌套（短语），行为不一致，用户在句子下面找短语卡会找不到 |
| **C2.（采用）短语按与单词相同的规则处理**：只要选择动作发生在某条句子自己渲染出来的文本容器里（`handleSentenceSelection` 命中的单词分支或短语确认浮标），结果都进这条句子的 `words` 子列表 | 「这条句子文本上选出来的东西都留在它下面」规则统一、好记；`upsertPhraseCard` 只需按调用方所在的 entry id 决定落点，逻辑复用 | 短语卡不再和单词卡共享同一份顶层去重（同一短语先后在两条不同历史句子里被选中，会分别出现在各自句子下面，而不是全局合一）——判为合理：短语的语境释义本来就依赖当时那句话，分属地正确 |

**采用 C2。** 延续 B2 的分界原则——判定标准是「选择动作发生的位置」（正文 vs 某条侧边栏历史句子），而不是「查的是单词还是短语」，避免规则打架。

---

## Decision

### 1. 统一数据模型（采用 A2）

```ts
type SentenceEntry = {
  kind: 'sentence'
  id: string                 // 例如 `${sourceUrl}#${createdAt}`
  sourceUrl?: string
  sentence: string
  clickedWord?: string       // 对齐现有 ADR-007 的高亮
  chinese: string
  status: FetchStatus
  errorMessage?: string
  errorHttpStatus?: number
  words: WordCardData[]      // 本条句子自己的嵌套查词结果（单词 + 短语，见 Decision C2）
}
type PanelEntry = ({ kind: 'word' } & WordCardData) | SentenceEntry
```

`definitions: WordCardData[]` 与 `pendingContext`/`chinese`/`status`/`errorMessage`/`errorHttpStatus` 全部废弃，替换为单一 `entries: PanelEntry[]`。

### 2. 新句子翻译 = 新顶层 entry

`PendingSentenceContext` 触发的 effect（原 `SidePanel.tsx:323-373`）不再写单例状态，而是 prepend 一条新的 `SentenceEntry` 到 `entries` 最前面。

### 3. 渲染从单例槽位改成按 `entries` 遍历（采用 A2）

原顶部单独渲染的句子块（原 `SidePanel.tsx:699-757`）下沉为 `entries.map` 里 `kind === 'sentence'` 分支的渲染逻辑，每条句子各自持有自己的 `sentenceRef`/`onMouseUp`，互不干扰。`kind === 'word'` 分支复用现有单词卡渲染（原 `:759` 起）。

### 4. 正文点词：不再清空句子，也不做归属判断（采用 B2）

`mergePageWordLookup` 删掉清空 `pendingContext` 的三行，只对 `entries` 做「已存在该词则前移，否则 prepend 新 `WordEntry`」——逻辑与今天对 `definitions` 的操作等价，只是操作对象换成 `entries`。

### 5. 句子内选词/选短语：落点改为所在句子的 `words`，顶层不重排（采用 B2 + C2）

`handleSentenceSelection`（ADR-017）的单词分支、以及短语确认浮标确认后的 `upsertPhraseCard`，都改为接收「当前所在的 `SentenceEntry.id`」，查询结果 upsert 进 `entries` 里该 id 对应条目的 `words` 数组（存在则前移/更新，不存在则 prepend），**不触碰 `entries` 顶层顺序**。

### 6. 不新增消息 / 存储链路

句子内选词全程仍是 `SidePanel.tsx` 组件内闭环（同 ADR-017 Decision 4），只是查询结果的落点从「prepend 到顶层 `definitions`」改成「upsert 进所在 `SentenceEntry.words`」。正文点词路径（ADR-014 的 `LATEST_PAGE_WORD_STORAGE_KEY`）的传输机制不变，只改 `mergePageWordLookup` 消费它之后的落点与副作用（Decision 4）。

---

## Rationale

- **A2 而非 A1**：需求本质要求「多条句子历史」+「每条句子有自己的查词子历史」，这两点单槽位状态无法表达，必须有一个能装多条、且允许嵌套的结构。
- **B2 而非 B1**：把「一个词属于哪条历史句子」的判定丢给正文点词路径，在语义上没有唯一答案（同一个词可能出现在好几条历史句子里），且用户明确不需要这个判断。B2 利用了一个既有事实——句子内选词的处理函数本来就是绑定在那条句子自己 DOM 上的闭包，「它属于哪条句子」这个信息在调用点上是免费的，不需要额外传递任何 id 跨 content.tsx/background/storage。
- **C2 而非 C1**：判定标准统一成「选择动作发生的位置」而不是「查的是词还是短语」，两条规则打架的空间最小，用户心智上「这条句子里选出来的东西都在它下面」是一句话能说清的规则。

---

## Consequences

### Positive

- 句子翻译不再因为回主窗口点词而消失，成为可回溯的历史（需求核心诉求）。
- 正文点词路径的实现反而更简单：不再需要清空句子、不需要任何归属判断。
- 句子内查词结果不重排顶层列表，视觉上不跳动（需求诉求 3）。
- `definitions` + `pendingContext` 两套并行状态收敛成一套，减少了以后新交互要同时考虑两套状态的心智负担。

### Negative

- 是一次真实重构，触及渲染层（单例句子块 → per-entry 渲染）、两条既有点击路径（`mergePageWordLookup`、`handleSentenceSelection`/`upsertPhraseCard`）和 ADR-006/007/008/017 定下的部分实现细节；不是一行 diff。
- 短语卡不再跨句子全局去重（Decision C2 的取舍）：同一短语在两条不同历史句子里分别选中，会在各自句子下面各出现一次，而不是全局合一成一张卡。
- 正文点词与句子内选词现在是两条完全不对称的路径（一个永远置顶顶层，一个永远只进所在句子），需要在代码里用清晰命名/注释体现这是刻意分界，避免以后被误「统一」。

### Mitigation

- 建议实现顺序（每步可独立验证）：
  1. 定义 `PanelEntry`/`SentenceEntry` 类型 + 把 `entries` 迁移进来替换 `definitions`（先不改 `pendingContext`，行为等价于今天）。
  2. 把 `pendingContext`/`chinese`/`status` 收进 `entries` 里的 `SentenceEntry`，渲染改 per-entry；此步交付「句子进历史列表」。
  3. `mergePageWordLookup` 删清空逻辑；此步修掉「句子消失」的 bug。
  4. `handleSentenceSelection`/`upsertPhraseCard` 改成接收 entry id、落点改成对应句子的 `words`；此步交付「句子内查词不跳动」。
- 测试沿用 ADR-017 的 seam 划分（`SidePanel.tsx` 组件 RTL 测试），新增：多条句子历史共存、正文点词不清空任何句子、句子内点词只改该句子的 `words` 且顶层顺序不变。

---

## Out of Scope（本次不做）

- 正文点词与历史句子的归属匹配（Decision B1 的方向），如用户以后反馈需要，见 Revisit。
- 句子历史的持久化（跨会话保留）：`entries` 沿用现有惯例（同 ADR-006 注释）purely local，不写 `chrome.storage`；如需持久化是另一个 ADR。
- 历史列表的容量上限/清理策略（目前沿用「Clear 按钮整体清空」，不做单条删除或自动裁剪）。

---

## Revisit Trigger

- **用户反馈想知道正文点的词是否出现在某条历史句子里**：重新评估 Decision B（B1 方向），届时需要设计「一个词匹配多条候选句子」时的消歧 UI。
- **短语卡不跨句子去重让用户困惑**（同一短语在不同句子下面反复出现）：重新评估 Decision C2，可能需要引入「全局短语卡 + 句子内引用」两层结构。
- **历史列表长到需要清理/持久化**：另立 ADR 讨论容量策略与是否持久化。
