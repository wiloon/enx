# ADR-008：划词选中句子中间的短语（2–5 个词）时，复用单词反查句子的锚点逻辑，调用 AI 显示短语在整句中的释义

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-08-10 |
| **日期** | 2026-08-10 |
| **关联 Spec** | [`TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](../tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md)（本决策新增一条"短语在句中释义"的展示路径，是该 spec 的姊妹功能；配套的 TASK-SPEC 更新留到编码阶段） |
| **关联 ADR** | [`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（本决策收窄并延续其 B3 选区分级：`SELECTION_DICTIONARY_MAX_WORDS`/`SELECTION_TRANSLATE_MAX_WORDS`/标点判断结构不变，只是把原来"1–5 词→词典查询"这一档拆成"1 词→词典"和"2–5 词→AI 短语"两档）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（`chrome.storage.session` + `onChanged` 传输模式、`FetchStatus \| 'none'` 状态惯例，本决策直接复用） |

---

## Context

用户划词选中 "hunt down emails"（3 个词，无句末标点，句子中间的一段）时，按 ADR-007 的 B3 分级，`wordCount(3) <= SELECTION_DICTIONARY_MAX_WORDS(5)` 且不含标点，会走现有的词典查询路径：`content.tsx:790` 的 `showWordPopup(selectedText, event)` → `getOneWord` → 后端 `translate/service.go` 的 `isSentence(raw)`（`translate/helpers.go:13-15`，"包含空格即判定为句子"）命中 → `respondSentenceUnavailable`（`helpers.go:17-23`）直接返回罐头文案 `SentenceTranslationNotice`="句子翻译功能暂未开放，将在未来版本中提供。"（`translate/messages.go:5`），不查 `words` 表也不查 ECDICT。这是一条死路——短语类查询永远拿不到真正的释义。

需求：选中的如果不是单个词、也不是完整句子，而是句子中间的几个词（短语），侧边栏应该显示**这个短语在它所在的完整句子里的含义**——单独看 "hunt"/"down"/"emails" 三个词用户可能都认识，但组合在一起、放进这句话的语境里是什么意思，需要调用 AI。

设计讨论中已确认的前提（不在本 ADR 重新展开）：

1. **短语暂不落库**：`words` 表只存单词，短语查询不写入 `words`/`user_dicts`，也不新建短语表——留作 Revisit Trigger，等真实需要出现（省成本的缓存 or 短语生词本）再决定表怎么设计。
2. **后端已经有通用接口可以直接复用**：`TranslateWordInContext`（`aitranslate/handler.go:64-84`，对应 `POST /api/translate/word-in-context`）当前完全无状态——不碰任何数据库，也没有对 `word` 参数做单词长度限制，`word` 传入短语文本应该可以直接工作（AI prompt 措辞是否需要从"这个单词"调整为"这段文字"留给实现阶段验证）。
3. **单个词的现有逻辑不受影响**：点击单个词仍然是 `getOneWord`（词典）+ `translateWordInContext`（AI 反查句中释义）合并显示在同一张单词卡片里，`SidePanel.tsx` 的 `handleWordClick`/`fetchContextTranslation` 不变。
4. **短语结果的展示位置**：不占用侧边栏顶部现有的"整句翻译"单槽位区域（`SidePanel.tsx:376-393` 的 `status`/`chinese`/`errorMessage`），而是借用单词卡片的视觉形态，混进同一个 `definitions` 堆叠列表——短语卡片没有音标/词典释义/Query Count 这些字段，只有短语原文 + AI 给出的语境释义 + loading/error/重试状态。

本 ADR 要解决的是**技术实现路径**：短语选区怎么找到它所在的完整句子（AI 需要这个上下文才能给出准确释义），以及这条新路径怎么接进现有的选区分级、消息传递、侧边栏渲染这三层现有基础设施。

---

## Options Considered

**A. 短语选区怎么找到它所在的完整句子**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 新写一个基于 `Range`/`Selection` 的句子边界提取算法 | 独立于 `extractSentenceContext`，直接对选区的起止节点做块级容器定位 + `Intl.Segmenter` 切句 | 不依赖"选区内必须有已包裹的单词元素"这个假设 | 重新实现一遍 `extractSentenceContext`（`wordProcessor.ts:306-362`）已经在做的事，双份逻辑要保持同步；而且这个假设在实践中基本总是成立（见下） |
| A2.（采用）复用 `extractSentenceContext`：从选区里挑一个已包裹的 `<u class="enx-word">` 元素当锚点，直接调用现有函数，函数本身不改 | 排查确认：`renderWithHighlights`（`wordProcessor.ts:140-154`）在文章正文范围内给几乎每一个词都套了 `<u class="enx-word">`（唯一排除的是 `a/script/style/noscript/button/input/textarea/select/code/pre` 内的文本，`wordProcessor.ts:88-104`），且 `showWordPopup` 内已有的 `handleOpenSentencePanel`（`content.tsx:163-167`）已经在用同样的模式——拿 `event.target` 当锚点传给 `extractSentenceContext(anchor, word)`。短语选区的 `mouseup` 事件的 `event.target` 大概率就是选区内某个词的 `<u>` 元素，直接复用零新增算法 | 释放点偶尔可能落在词间空白/标点上，`event.target` 不是 `.enx-word` 元素，需要一个兜底（见 Decision）；理论上选区跨句边界时，锚点只能定位到其中一句，另一部分会被忽略——接受这个边界情况（见 Rationale） |

**B. 选区分级怎么改**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1.（采用）沿用 ADR-007 B3 结构，只把"1–5 词"拆成"1 词→词典"“2–5 词→AI 短语”两档，`SELECTION_DICTIONARY_MAX_WORDS`（=5）、`SELECTION_TRANSLATE_MAX_WORDS`（=80）、标点优先判断都不变 | 改动面最小，`content.tsx:772-790` 的分支结构基本不用重新设计，只是把 `wordCount <= 5` 的分支内部再切一刀（`wordCount === 1` 走 `showWordPopup`，`wordCount` 在 2–5 走新的短语路径） | 无 |
| B2. 重新设计分级（比如按"是否能找到锚点"决定，而不是词数） | 更贴合 A2 的实现方式 | 引入新的分级心智模型，且 ADR-007 的词数分级本来就有独立的作用（区分短语查词 vs 整句翻译），没必要为了这次改动重新论证一遍 |

**C. 短语文本 + 完整句子怎么传给侧边栏**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 复用 `PendingSentenceContext.word` 字段（当前存在但完全未被读取，见下） | 不用加新字段 | `word` 字段今天已经在两个不同调用点被填入不同语义的值：单词"🔤 整句翻译"按钮（`content.tsx:170-175`）填的是被点击的**单个词**；`triggerSelectionTranslation`（ADR-007，`content.tsx:723`）填的是空字符串。如果 `SidePanel.tsx` 开始读这个字段来判断"是否显示短语卡片"，会让单词按钮那条**既有**调用点的行为被意外改变（因为它的 `word` 也非空）——这不是本 ADR 的范围，不应该顺手改掉 |
| C2.（采用）给 `PendingSentenceContext` 新增一个可选字段 `phrase?: string`，只由本 ADR 新增的短语选区路径写入 | 单词按钮和整句翻译两条既有路径完全不受影响（它们不写这个字段，`SidePanel.tsx` 判断 `pendingContext.phrase` 是否存在来决定走短语卡片还是维持现状）；复用现成的 `openSentencePanel` 消息类型和 `PENDING_SENTENCE_STORAGE_KEY` 存储链路（ADR-006/007 已验证的模式），只是多带一个字段，`handleOpenSentencePanel`（`background.ts:693-705`）加一个参数透传即可 | 多一个字段，`PendingSentenceContext` 里 `word`/`phrase` 两个字段语义上有点重叠（`word` 字段目前处于"存在但没人读"的死数据状态）——这是历史遗留，本 ADR 不顺手清理，留给以后单独收拾（见 Revisit Trigger） |

**D. 短语卡片状态怎么建模**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1.（采用）扩展现有 `WordCardData`：`dictionaryStatus` 的类型从 `FetchStatus` 放宽成 `FetchStatus \| 'none'`，短语卡片固定用 `'none'`（跳过词典查询和音标/释义/Query Count 渲染），`contextStatus`/`contextChinese`/`contextError` 三个字段和现有的 loading/error/重试渲染逻辑原样复用 | `'none'` 这个语义已经在 `contextStatus` 上用过（ADR-006，表示"不适用"），`dictionaryStatus` 照搬同一个惯例，渲染代码只需要多判断一次 `dictionaryStatus === 'none'` 来跳过词典区块；短语卡片天然复用我此前刚加的 `contextError`/重试机制，不用重新写一套 | 短语卡片和单词卡片共用一个类型，字段并不都有意义（比如 `pronunciation`/`loadCount` 对短语卡片永远是 `undefined`），类型上不是最干净的表达 |
| D2. 新建一个独立的 `PhraseCardData` 类型，渲染时按 `'word' in card` 之类的判别式区分 | 类型更精确 | `definitions` 列表要变成联合类型数组，渲染分支、`prev.map`/`prev.find` 之类的更新逻辑都要重新过一遍类型收窄，改动面明显更大，对于目前的字段差异（就 3、4 个字段用不上）不值得 |

---

## Decision

1. **句子边界提取**（采用 A2）：短语选区（2–5 词、无句末标点，见 Decision 第 2 点）在 `handleTextSelection`（`content.tsx:763`）里新增分支时，按以下优先级找锚点元素：
   - 优先用 `event.target as HTMLElement`（`mouseup` 落点），如果它本身是 `.enx-word` 元素，直接用。
   - 否则退化为扫描 `window.getSelection()` 的 Range，取选区范围内**任意一个** `.enx-word` 元素（比如 `Range.cloneContents()` 后 `querySelector('.enx-word')`，具体 DOM API 留给实现阶段选定）。
   - 如果选区内一个 `.enx-word` 元素都找不到（比如整段选区都落在被排除的区域，如 `<a>` 标签内部），放弃 AI 短语查询，走 Decision 第 5 点同一个提示通道，文案类似"暂时无法识别所在句子"。
   拿到锚点元素后，直接调用现有的 `WordProcessor.extractSentenceContext(anchorElement, anchorElement.textContent)`（**函数本身不改**——注意传入的 `word` 参数必须是锚点元素自己的单词文本，不是整个短语，这是这个函数消歧重复出现单词的必要输入）得到锚点所在的完整句子。**注意**：`showWordPopup` 里已有的 `handleOpenSentencePanel`（`content.tsx:166`）目前对多词选区调用 `extractSentenceContext(anchor, word)` 时，`word` 传的是整个短语文本而不是锚点自己的单词——这是一个既有的潜在错配，但因为 2–5 词选区在本 ADR 之后不会再进入 `showWordPopup` 这条分支（见下），这个错配对短语场景自然失效，不需要专门修它。

2. **选区分级**（采用 B1）：`content.tsx:781` 的判断条件从
   ```
   if (looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS) { …整句翻译… }
   // 否则 (<=5 词，无标点): showWordPopup(selectedText, event)
   ```
   改为三路分支：
   - `looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS`：不变，走整句翻译（含防抖）。
   - `wordCount === 1`（无标点）：不变，`showWordPopup(selectedText, event)`，走词典查询。
   - `wordCount` 在 2–5 之间（无标点）：新分支，走 Decision 第 1 点的句子边界提取 + Decision 第 3 点的消息发送。
   `SELECTION_DICTIONARY_MAX_WORDS`（=5）、`SELECTION_TRANSLATE_MAX_WORDS`（=80）、`SELECTION_TRANSLATE_DEBOUNCE_MS`（=500）、标点优先判断，数值和逻辑都不变。

3. **消息与存储**（采用 C2）：`PendingSentenceContext`（`types/index.ts:96-101`）新增可选字段 `phrase?: string`。新分支发送：
   ```ts
   sendToBackground({
     type: 'openSentencePanel',
     word: '',
     phrase: selectedText,          // 短语原文，如 "hunt down emails"
     sentence: extractedSentence,   // Decision 第 1 点提取出的完整句子
     sourceUrl: window.location.href,
   })
   ```
   复用现成的 `openSentencePanel` 消息类型，`handleOpenSentencePanel`（`background.ts:693-705`）加一个 `phrase` 参数透传进 `PendingSentenceContext`，其余不变（`chrome.storage.session` 写入、`sidePanel.open()` 尝试、失败兜底提示，全部复用 ADR-007 已有实现）。**不复用 `word` 字段**（原因见 Options C）。

4. **侧边栏渲染**：`SidePanel.tsx` 新增一段逻辑，`pendingContext.phrase` 存在时：
   - 现有的"整句翻译"顶部单槽位（`translateSentence` 的 `useEffect`，`SidePanel.tsx` 约 168-205 行）**跳过**，不对这次 `pendingContext` 触发整句翻译。
   - 触发一次 `translateWordInContext(pendingContext.phrase, pendingContext.sentence)`，用返回结果新建一张短语卡片，`unshift` 进 `definitions` 列表最前面（和现有单词卡片 `newest on top` 的堆叠行为一致）。卡片用 Decision（D1）里扩展的 `WordCardData` 表达：`word: phrase`、`dictionaryStatus: 'none'`、`contextStatus`/`contextChinese`/`contextError` 走和单词卡片完全相同的 loading/loaded/error+重试渲染路径（复用已经写好的 `sidepanel-context-error-*`/`sidepanel-retry-context-*` 那一套）。
   - 渲染层对 `dictionaryStatus === 'none'` 的卡片跳过音标行、词典释义区块、Query Count（这三处目前的条件判断都要加一个 `!== 'none'`/等价判断）。

5. **找不到锚点的兜底提示**：复用 ADR-007 Decision 第 4 点已有的 `sentencePanelHintAtom` + `WordPopup` 轻量提示模式（`content.tsx` 里 `showSelectionHint`），文案待定（如"暂时无法识别所在句子，请尝试重新选择"）。

---

## Rationale

- 选 A2 而不是 A1：花了时间确认"选区内几乎总能找到一个已包裹的单词元素"这个前提成立（`wordProcessor.ts` 的包裹逻辑覆盖文章正文里除少数结构性排除元素之外的所有单词），既然前提成立，重新发明一遍 `extractSentenceContext` 已经做过的"锚点 + 块级容器 + `Intl.Segmenter`"逻辑没有必要，复用能省下一整块新代码和潜在的行为不一致（两套切句逻辑难免会在边界情况上产生分歧）。
- 选 B1 而不是 B2：ADR-007 的词数分级本身要解决的是"这个选区看起来更像短语还是更像句子"，跟"锚点好不好找"是两个不同维度的问题，没必要为了实现细节去动一个已经经过一轮真实数据验证（`40→80` 那次调整）的分级结构。
- 选 C2 而不是 C1：`word` 字段今天处于"两个调用点各自赋值、没人读"的状态，贸然复用会让 `SidePanel.tsx` 一读它就同时影响到单词按钮那条完全不相关的既有路径——这种"改一个字段语义，波及另一个不相关功能"的耦合是应该避免的，多一个字段的代价比这个风险小。
- 选 D1 而不是 D2：字段差异只有 3、4 个（`pronunciation`/`loadCount`/`dictionaryChinese` 对短语卡片不适用），远不到需要联合类型的复杂度；`'none'` 这个"不适用"语义在 `contextStatus` 上已经用过一次（ADR-006），`dictionaryStatus` 照搬保持惯例一致，比引入新类型再教一遍"怎么判别式收窄"要便宜。

---

## Consequences

### Positive

- 短语查询不再是死路——2–5 词的短语选区能拿到真正有意义的、带上下文的 AI 释义。
- 复用面很大：句子边界提取（`extractSentenceContext`）、消息传递（`openSentencePanel`/`PENDING_SENTENCE_STORAGE_KEY`）、AI 调用（`translateWordInContext`）、卡片渲染和 error/重试逻辑（`WordCardData`/`contextError`）全部是已经存在且验证过的代码，新增代码量集中在"选区内找锚点"这一小段逻辑和分支路由上。
- 短语不落库这个决定不需要额外代码去"防止"——`translateWordInContext` 本来就无状态，短语场景不调用 `getOneWord`，自然不会碰 `words`/`user_dicts`。

### Negative

- 选区如果跨越两个句子的边界（比如故意选中"...上一句结尾，下一句开头..."这种片段），锚点只能定位到其中一句，`extractSentenceContext` 返回的"完整句子"可能不完整覆盖选中的短语——接受这个边界情况，不做额外校验（比如"提取出的句子是否完整包含选中文本"），出现时 AI 拿到的上下文只是部分正确，不算严重故障。
- `PendingSentenceContext.word` 字段的"死数据"状态没有被清理，反而多了一个 `phrase` 字段，两者语义上容易让后来者困惑——记在 Revisit Trigger 里。
- `showWordPopup` 里 `handleOpenSentencePanel` 对多词输入错配 `extractSentenceContext` 参数这个既有问题，本 ADR 没有主动修，只是让它自然失效（2–5 词选区不再进入这条分支）——如果以后单词按钮的行为发生变化（比如反向复用短语卡片逻辑，见 Revisit Trigger），需要重新检查这里。

### Mitigation

- 找不到锚点的兜底提示复用 ADR-007 已有的提示通道，不需要新造一套 UI 反馈机制。

---

## Revisit Trigger

- 真实使用中如果发现用户经常需要"短语在别的句子里的释义对比"（比如同一个短语出现在不同句子里，用户想同时看多个），需要重新评估短语卡片要不要允许同一短语文本出现多张卡片（当前实现按短语文本 `d.word === word` 去重复用现有卡片列表逻辑，行为等同于单词卡片：同一短语再次选中会命中已有卡片并前移，不会重新调用 AI——如果这不是期望行为，需要另外决策）。
- 如果需要给短语查询加缓存或"常用短语"频次统计，回到设计讨论里搁置的"短语要不要落库"这个问题，注意释义是句子相关的，不能简单按短语文本做 key（讨论已记录在本 ADR 之前的对话中，未来写新 ADR 时可以引用）。
- `PendingSentenceContext.word` 字段长期"写了没人读"，如果以后有机会一起重构（比如统一单词按钮和短语选区的处理路径），应该把 `word`/`phrase` 两个字段的语义合并或至少理清，不要让死数据长期留在类型定义里。
- 如果单词"🔤 整句翻译"按钮的行为后续也要改成"显示该词在句中的释义卡片"而不是现在的"整句翻译"，可以复用本 ADR 建立的短语卡片渲染路径（D1 的 `WordCardData` 扩展对单词场景同样适用），但这是一次独立的、会改变现有单词按钮行为的决策，需要单独的 ADR，不应该顺着本次改动顺手做掉。
