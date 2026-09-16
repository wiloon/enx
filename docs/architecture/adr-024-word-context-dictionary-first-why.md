# ADR-024：单词上下文释义改为「词典先行、AI 依据词典释义生成含义与差异说明」两阶段流程——为此撤销 ADR-014「整句翻译 + 单词上下文合并成一次 AI 调用」中「单词上下文」的那一半

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-15。已实现（enx-api + enx-chrome）：新叶子包 `aitranslate/wordcontext`，`Translator.TranslateWordInContext` 加 `dictionaryChinese` 入参并改返回 `wordcontext.Result{WordChinese, Why}`，四个 provider（bedrock/kimi/minimax/deepseek）跟进；`aitranslate/sentenceword` 与 `TranslateSentenceWithWord` 撤回本次早先加的、无词典依据的 `why` 字段，恢复 ADR-014 原始形态；`SidePanel.tsx` 的 `fetchDictionary` 改为返回 `Promise<string \| undefined>`，新增 `fetchWordContext`（词典 resolve 后才发起 AI 调用）取代 `seedAnchorWord`/`handleWordClick` 里原本各自独立的词典+AI 并行调用；打开面板时的整句翻译改回始终用纯 `translateSentence`，不再等待、也不再依赖单词上下文的结果。`go test ./aitranslate/...`、`tsc --noEmit`、`jest sidepanel`（35 项）、`vite build` 均通过（`enx-api/utils` 的 `TestViperInitSetsDefaults` 失败与本次改动无关，是本机 `~/.enx/config.toml` 覆盖了测试期望的默认值，改动前即如此）。 |
| **日期** | 2026-09-15 |
| **关联 Spec** | 无独立 TASK-SPEC——决策过程即本 ADR 的 Context/Decisions 两节，未另写 spec（同 ADR-017/ADR-023 的做法：先落地再补 ADR）。 |
| **关联 ADR** | [`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（**本 ADR 推翻其决策 3「两次 AI 调用合并成一次」中「单词上下文释义」的部分**——合并端点 `POST /api/translate/sentence-with-word` 本身未删除、仍可用、仍有测试覆盖，只是 Side Panel 不再在「打开面板」这一步调用它；决策 3 之外的部分——默认高亮点击词、打开即自动查词、三个翻译功能按 token 计费——不受影响，继续有效）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（复用其 `getOneWord` 词典查询——本 ADR 把它从「与 AI 调用并行」改成「AI 调用的前置依赖」）、[`adr-023-sidepanel-unified-history-list-nested-sentence-words.md`](adr-023-sidepanel-unified-history-list-nested-sentence-words.md)（本 ADR 改动的 `fetchContextTranslation`/`fetchDictionary`/`seedAnchorWord`/`handleWordClick`/`handleRetryContextTranslation` 都定义在该 ADR 建立的 `SidePanelContent` 里；`WordCardData` 新增 `contextWhy` 字段） |

---

## Context

用户在用 ENX 阅读时，偶尔会看到一个词的「词典释义」（灰色小字）和 AI 给出的「上下文释义」（蓝色 `in context` 标签那行）明显对不上——比如 `tips` 在某句里 AI 判断是「倾向于」，但词典释义是「秘诀、技巧；小贴士」，二者没有交集。用户看不出这是 AI 判断错了、还是这个词本来就有词典没收录的引申/习语用法，想要一个「为什么」的解释。

最初的想法是把「上下文释义」那段蓝字做成一个可点击链接，点击时再发一次请求追问「为什么」。评估后发现更省成本的做法是：在生成上下文释义的**同一次** AI 调用里，让模型顺带判断是否需要解释、需要就给一句短解释，不点也不额外计费/延迟。

但这个「顺带生成 why」最初是接在 ADR-014 的合并端点（`sentence-with-word`）上实现的——那个端点为了「一次 AI 调用拿到整句翻译 + 单词上下文含义」，从设计上就**不查词典**，模型只能凭自己对这个词常见用法的认知去猜「这算不算跟词典义不一样」，猜测本身没有词典原文可比对，容易文不对题。要让 `why` 真正站得住，模型必须先看到词典释义原文，再判断上下文义是否在词典义范围内、如果不在则说明原因——这就要求：**先查词典，把词典释义嵌进给 AI 的提示词，AI 才发起调用**，而不是像 ADR-014 那样「词典查询」与「AI 调用」二者并行、互不知道对方结果。

这与 ADR-014 决策 3「查一个词的上下文含义时，把整句翻译和单词含义合并成一次 AI 调用，零延迟」直接冲突：合并调用是跟句子翻译一起立刻发起的，不可能等词典查完再发；而且合并调用本来的职责是「整句翻译」+「单词含义」两件事，跟「单词含义是否需要向词典解释」是两个不同的问题，硬塞进同一个 prompt 只会让两者互相牵制。用户确认后的方案是：**把「整句翻译」和「单词上下文释义」彻底拆成两条独立的线，互不等待；单词上下文释义这条线内部再拆成两阶段：词典先返回并渲染，再用词典释义拼提示词调用 AI**。

## 已确认的决策（2026-09-15，用户确认）

1. **整句翻译与单词上下文完全解耦**：打开 Side Panel 时的整句翻译永远只发 `translateSentence`，不等词典、不等任何单词相关的结果，也不再用 ADR-014 的合并端点。
2. **单词上下文释义统一两阶段**：不管是正文点词打开面板（锚点词）、还是在侧边栏原文里点某个词、还是重试，一律先查词典（`getOneWord`）、词典结果一出来就渲染到 UI，然后把词典释义拼进提示词再调用 AI 拿上下文释义；AI 返回的内容作为第二次更新展示。
3. **词典失败/无词条不阻塞 AI 调用**：词典查询失败或这个词不在 ECDICT/Word 表里，AI 调用仍然发起，只是提示词里没有词典释义可比对（`why` 自然倾向于留空）。
4. **`why` 只在有依据、有实质差异时才出现**：没有词典释义可比对，或模型判断上下文义就是词典义的普通义项，`why` 留空，UI 不渲染这一行。
5. **不删除 ADR-014 的合并端点**：`sentence-with-word` 是否要正式废弃/删除是另一个决定，本次不做——保留它继续可用、继续有测试覆盖，只是新流程不再调用它。
6. **代价接受**：以前锚点词点击时上下文释义有机会零延迟（合并调用命中快路径），现在变成固定「词典网络请求 + AI 网络请求」两跳，且这次 AI 调用不再是偶尔才发生的兜底，而是每次都发生（多一次计费的 `translate_word_in_context` 调用）。用户认可这个代价，换取 `why` 有词典依据。

## Decisions（实现形状）

### 后端（enx-api）

- **`aitranslate/wordcontext`**（新叶子包，结构照搬 `aitranslate/sentenceword`）：`SystemPrompt`（给模型句子、目标词、可选的词典释义，要求只返回 JSON `{"word": "...", "why": "..."}`；`why` 的规则写在 prompt 里——没给词典释义或上下文义就是普通义项时留空）、`Temperature=0.3`、`Result{WordChinese, Why string}`、`ParseResult`（宽松 JSON 提取 + 正则字段兜底，同 sentenceword 的两层解析）、`BuildUserContent(sentence, word, dictionaryChinese)`（`dictionaryChinese` 为空时整行「Dictionary definition: ...」都不出现在提示词里，而不是传一个空字符串占位，避免误导模型「查过词典但没查到」和「压根没查」两种情况）。
- **`Translator` 接口**：`TranslateWordInContext(ctx, sentence, word string)` 改为 `TranslateWordInContext(ctx, sentence, word, dictionaryChinese string) (wordcontext.Result, Usage, error)`。四个 provider（bedrock/kimi/minimax/deepseek）各自的 `wordContextSystemPrompt`（纯文本、单值回复）替换成引用 `wordcontext.SystemPrompt` + `wordcontext.BuildUserContent` + `wordcontext.ParseResult`，改法与它们各自已有的 `TranslateSentenceWithWord`（引用 `sentenceword.*`）完全对齐。
- **`Handler.TranslateWordInContext`**：`wordInContextRequest` 加 `DictionaryChinese string`（无 `binding:"required"`，允许空——空表示「没有词典释义可比对」）；成功响应从 `{success, chinese}` 扩展成 `{success, chinese, why}`（`chinese` 这个 key 名不变，保持前端既有契约；`why` 可能是空串）。
- **撤销** 早先在本次会话中临时加到 `aitranslate/sentenceword`（`SystemPrompt` 的第三个 `why` 字段、`Result.Why`、`whyFieldPattern`）和 `Handler.TranslateSentenceWithWord`（响应里的 `"why": res.Why`）上的改动——这条 `why` 没有词典依据，跟本 ADR 的设计目标（`why` 必须有词典原文可比对）矛盾，且合并端点本身已经不参与单词上下文这条线，留着这个字段只是死代码。恢复到 ADR-014 原始的 `{sentence, word}` 两字段形态。

### 前端（enx-chrome）

- **`types/index.ts`**：`ContentMessage` 的 `translateWordInContext` 变体加 `dictionaryChinese?: string`（调用方在发消息前已经查过词典，这里带上结果）；`BackgroundResponse.why` 的归属文档更正为「由 `translateWordInContext` 产生」（不是 `translateSentenceWithWord`——那个端点的响应不再有这个字段）。
- **`background.ts`**：`handleTranslateWordInContext` 加 `dictionaryChinese` 形参，透传进 POST body；成功响应加 `why: response.data.why || ''`。`handleTranslateSentenceWithWord` 撤回同一批早先加的 `why` 透传（该端点响应已不含这个字段）。
- **`SidePanel.tsx`**：
  - `fetchDictionary(word, sentenceId)`：保持原有的即时 UI 渲染行为不变，但现在把 `Promise` 链的 resolve 值改成词典查到的中文释义（或 `undefined`），供调用方 `await`。
  - 新增 `fetchWordContext(word, sentence, sentenceId)`：`await fetchDictionary(...)` 拿到词典释义后，再调用 `fetchContextTranslation(word, sentence, sentenceId, dictionaryChinese)`——这是现在所有「查一个词的上下文释义」场景的唯一入口。
  - `fetchContextTranslation` 加第四个可选参数 `dictionaryChinese`，透传进 `translateWordInContext` 消息；成功时额外把响应的 `why` 写进卡片的 `contextWhy` 字段。
  - `seedAnchorWord`（正文点词打开面板时给锚点词 seed 一张卡）：去掉原本信任合并调用 `wordChinese`/`why` 的快路径分支，改成跟 `handleWordClick` 一样调用 `fetchWordContext`；且这次调用挪到打开面板 effect 里、跟发起 `translateSentence` 并列的位置（不再嵌在 `translateSentence` 的 `.then()` 里），保证两条线互不等待。
  - `handleWordClick`（侧边栏原文里点某个词）：原本各自独立的 `fetchDictionary` + `fetchContextTranslation` 两次调用，合并成一次 `fetchWordContext`。
  - `handleRetryContextTranslation`：按卡片当前的 `dictionaryStatus` 分三种情况重试——短语卡（`'none'`，没有词典半边）直接重试 AI 调用；词典已经查到过（`'loaded'`）复用已有的 `dictionaryChinese`，只重试 AI 调用（避免词典查询重复计入 Query Count）；词典本身也失败了，走完整的 `fetchWordContext` 重新来一遍。
  - `WordCardData` 新增 `contextWhy?: string`；渲染上在蓝色 `in context` 那一行下面加一行小号斜体灰字（`data-testid="sidepanel-context-why-${word}"`），只在非空时出现。

## 与既有 ADR 的关系

- **推翻 ADR-014 决策 3 的一部分**：「打开面板时把整句翻译和单词上下文合并成一次 AI 调用」这个具体机制被撤销——但仅限于「单词上下文释义」这一半；决策 3 新增的合并端点 `sentence-with-word` 本身没有删除，代码、测试、路由都还在，只是 Side Panel 的新流程不再调用它。决策 1（默认高亮点击词）、决策 2（打开即自动查词）、决策 6（三个翻译功能按 token 计费，含新增的 `wordcontext` 调用）都不受影响，继续生效。
- **复用并改造 ADR-006 的 `getOneWord`**：查询本身没变，但地位从「跟 AI 调用并行的独立一路」变成「AI 调用发起前必须先 resolve 的前置依赖」。
- **落在 ADR-023 建立的结构上**：改动的所有函数（`fetchDictionary`/`fetchContextTranslation`/`fetchWordContext`/`seedAnchorWord`/`handleWordClick`/`handleRetryContextTranslation`）和 `WordCardData` 都是 ADR-023 引入的 `SidePanelContent`/统一历史列表的一部分，本 ADR 未改变该数据结构本身，只改了几个字段怎么被填充。

## Revisit Triggers

- 是否要正式废弃/删除 `sentence-with-word` 端点（后端 Go 实现 + `background.ts` 的 `handleTranslateSentenceWithWord`/`'translateSentenceWithWord'` case）：目前只是不用，不是删除，需要单独决定。
- 延迟代价：单词上下文释义从「有时零延迟」变成「固定两跳（词典请求 + AI 请求）」，且 AI 调用次数比之前（合并调用命中快路径时）更多。如果用户实际使用中觉得单词卡片出现变慢是负面体验，需要重新评估是否要恢复某种「先出一个无依据的即时结果，词典+AI 结果出来后再补充/替换」的渐进式方案。
- `why` 的生成质量目前没有做人工评测；如果发现解释经常文不对题、啰嗦，或者该出现时没出现/不该出现时乱出现，需要迭代 `wordcontext.SystemPrompt` 或加 few-shot 例子。
