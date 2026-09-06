# TASK-SPEC: enx-chrome 划词短语在句中释义（Phrase-in-Context AI Lookup）

| 字段 | 值 |
| --- | --- |
| **状态** | Implemented — 2026-08-10（代码已实现；`tsc --noEmit`、`jest`（16 项测试套件、112 项全过，含本次新增的 `phraseAnchor.test.ts` 4 项 + `SidePanel.test.tsx` 2 项）、`vite build`（产出 `dist/sidepanel.html` 等）、`go build ./...`、`go test ./aitranslate/...` 均通过；真实 Chrome 手工验证——划词选中截图里的 "hunt down emails" 这类短语——尚待用户执行，见 §7 第 7 步） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 用户在网页正文里划词选中句子中间的 2–5 个词（短语，如 "hunt down emails"）时，不再走词典查询死路，而是调用 AI 得到"这个短语在它所在的完整句子里的含义"，以短语卡片的形式显示在 Side Panel 的单词卡片列表里 |
| **非目标** | 不改变单个词点击的现有逻辑（词典 + AI 反查句子合并显示在单词卡片，见 `TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md` §3.7/§3.9）；不改变 6–80 词/含句末标点选区的"整句翻译"路径（ADR-007，不变）；不把短语持久化到 `words`/`user_dicts` 表，也不新建短语表；不修复 `showWordPopup` 内 `handleOpenSentencePanel` 对多词输入的既有参数错配（见 ADR-008 Decision §1 附注，本次改动后该错配自然失效，不需要主动修） |
| **触发原因** | 用户反馈：划词选中句子中间的短语（如截图里的 "hunt down emails"）时，侧边栏只显示"句子翻译功能暂未开放，将在未来版本中提供。"这条罐头文案——ADR-007 的 B3 分级把 1–5 词无标点的选区一律送进词典查询，但 ECDICT/`words` 表里从来就没有短语条目，这是一条必然失败的死路 |
| **关联背景** | [`adr-008-phrase-selection-context-translation.md`](../architecture/adr-008-phrase-selection-context-translation.md)（本 Spec 的架构决策依据，所有 Rationale/Options Considered 见该文档，本文只落地 Decision）；[`adr-007-drag-select-sentence-translation.md`](../architecture/adr-007-drag-select-sentence-translation.md)（本次改动收窄的选区分级基线）；[`TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md)（单词卡片 `WordCardData`/`translateWordInContext` 端点的原始实现，本次改动直接复用） |

---

## 1. 背景与动机

见 ADR-008 Context。简述：划词选中 2–5 个无标点的词（句子中间的短语）时，`content.tsx:781` 的现有判断把它和"单个词"归为同一档，送进 `showWordPopup(selectedText, event)` → `getOneWord` → 后端 `translate/helpers.go:13-23` 的 `isSentence`/`respondSentenceUnavailable` 直接拒绝（任何带空格的查询都返回占位文案，不查词典）。短语类查询因此永远拿不到有意义的结果。

本 Spec 把这一档改为调用已存在的 `translateWordInContext` AI 端点（`sentence`+`word` → AI 按上下文给出的中文含义），结果以"短语卡片"形式混入 Side Panel 现有的单词卡片列表。

---

## 2. 现状调查

### 2.1 选区分级（`enx-chrome/src/content/content.tsx:738-791`）

```ts
const SELECTION_DICTIONARY_MAX_WORDS = 5   // content.tsx:740
const SELECTION_TRANSLATE_MAX_WORDS = 80   // content.tsx:741
const SELECTION_TRANSLATE_DEBOUNCE_MS = 500
const SENTENCE_END_PUNCTUATION = /[.?!]/

const handleTextSelection = (event: MouseEvent) => {
  // ...
  const looksLikeSentence = SENTENCE_END_PUNCTUATION.test(selectedText)
  if (looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS) {
    // 6-80 词 或 含标点 → 防抖后走 triggerSelectionTranslation（整句翻译，不变）
    return
  }
  // <=5 词，无标点 → 词典查询（本次要拆分的分支）
  showWordPopup(selectedText, event)
}
```

### 2.2 单词包裹范围（`enx-chrome/src/lib/wordProcessor.ts`）

`renderWithHighlights()`（`wordProcessor.ts:140-154`）在文章正文范围内给几乎每个词都包了 `<u class="enx-word">`；`TreeWalker` 排除 `a/script/style/noscript/button/input/textarea/select/code/pre` 内的文本（`wordProcessor.ts:88-104`）。这意味着 2–5 词的短语选区内，绝大多数情况下能找到至少一个已包裹的单词元素当锚点——除非整个选区恰好落在上述排除元素内部。

### 2.3 单个词已有的句子边界提取（不改）

`WordProcessor.extractSentenceContext(wordElement, word)`（`wordProcessor.ts:306-362`）：给定单一 DOM 锚点元素 + 该元素自身的单词文本，向上找最近的块级容器（`closest('p, li, blockquote, td, div')`），用 `Range` 计算锚点在容器内的字符偏移消歧重复出现的词，`Intl.Segmenter('en', {granularity:'sentence'})` 切句，返回锚点所在的完整句子。**函数签名和实现本次不改**，短语场景通过"挑一个短语内的单词元素当锚点"来复用它（见 §3.3）。

`showWordPopup` 内已有的 `handleOpenSentencePanel`（`content.tsx:163-167`）已经在用同样的"拿 `event.target` 当锚点传给 `extractSentenceContext`"模式，本次新分支直接效仿。

### 2.4 `translateWordInContext` 端点是通用的、无状态的（不改后端逻辑，只改 prompt 措辞）

`aitranslate/handler.go:64-84` 的 `TranslateWordInContext` 对 `word` 参数没有做单词数量限制，短语文本可以直接传入。但三个 provider 实现（`kimi.go:19-27`、`bedrock.go` 、`minimax.go`，均在各自文件类似行号处）里硬编码的 system prompt 措辞是针对"单个词"写的：

```go
// kimi.go:23-26（bedrock.go/minimax.go 内容逐字相同，各自独立定义同名常量）
wordContextSystemPrompt = "You are a professional English-to-Chinese translator. " +
	"Given an English sentence and a specific word from that sentence, reply with the " +
	"word's Chinese meaning as used in THIS sentence's context only, not a generic " +
	"dictionary definition. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
```

`"a specific word"`/`"word's Chinese meaning"` 措辞对短语输入语义上不够准确（虽然大概率仍能工作，AI 通常能正确理解），需要调整为同时兼容单词和短语（见 §3.6）。

### 2.5 `PendingSentenceContext.word` 字段现状（`types/index.ts:96-101`）

```ts
export interface PendingSentenceContext {
  sentence: string
  word: string        // 存在但 SidePanel.tsx 全文没有任何地方读取这个字段
  sourceUrl: string
  createdAt: number
}
```

两个既有调用点分别写入不同语义的值：`content.tsx:170-175`（单词"🔤 整句翻译"按钮）填被点击的单个词；`content.tsx:723`（ADR-007 整句翻译）填空字符串。按 ADR-008 Decision §3 的结论，本次**不复用** `word` 字段，新增独立的 `phrase` 字段，避免让 `SidePanel.tsx` 一读 `word` 就意外影响到这两个既有调用点。

### 2.6 `WordCardData`/单词卡片渲染现状（`SidePanel.tsx`）

见 `TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md` §3.9。当前类型：

```ts
interface WordCardData {
  word: string
  pronunciation?: string
  loadCount?: number
  dictionaryChinese?: string
  dictionaryStatus: FetchStatus          // 'loading' | 'loaded' | 'error'
  contextChinese?: string
  contextError?: string                  // 近期新增，见下方修复记录
  contextStatus: FetchStatus | 'none'
}
```

`contextError`/`contextStatus === 'error'` 时的独立错误行 + 重试按钮（`sidepanel-context-error-*`/`sidepanel-retry-context-*`）是近期修复"AI 释义卡死在错误状态"问题时新加的（见 §6 相关文件索引里 `handleRetryContextTranslation`），短语卡片直接复用这一套，不用重新实现。

---

## 3. 目标设计

### 3.1 总体流程

```
网页正文划词选中 2-5 个词（无句末标点）
  → content.tsx: handleTextSelection 判定为"短语"分支（不再进入 showWordPopup/getOneWord）
      1. 在选区内找一个已包裹的 <u class="enx-word"> 元素当锚点（§3.3）
      2. 调用现有 WordProcessor.extractSentenceContext(anchor, anchor.textContent) 取完整句子
      3. 找不到锚点 → 走既有的 showSelectionHint 提示通道，文案"暂时无法识别所在句子"，流程终止
      4. 找到句子 → sendToBackground({ type:'openSentencePanel', word:'', phrase: selectedText, sentence, sourceUrl })
  → background.ts: handleOpenSentencePanel 新增 phrase 参数，透传进 PendingSentenceContext，写入 chrome.storage.session（不变的存储链路）
  → SidePanel.tsx: 监听到 pendingContext.phrase 存在
      1. 跳过顶部"整句翻译"单槽位的 translateSentence 请求
      2. 调用 translateWordInContext(pendingContext.phrase, pendingContext.sentence)
      3. 结果 unshift 进 definitions 列表，渲染成短语卡片（dictionaryStatus:'none'，跳过音标/词典释义/Query Count）
      4. loading/error 状态与重试按钮复用现有 WordCardData 的 contextStatus/contextError 渲染路径
```

单个词点击（`wordCount === 1`）、6–80 词或含标点的整句翻译，两条既有路径**完全不变**。

### 3.2 `content.tsx` 选区分级拆分

`handleTextSelection`（`content.tsx:763-791`）现有判断：

```ts
if (looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS) {
  // 6-80 词 或 含标点 → 整句翻译（不变）
  return
}
showWordPopup(selectedText, event)   // <=5 词无标点，统一走词典
```

改为：

```ts
if (looksLikeSentence || wordCount > SELECTION_DICTIONARY_MAX_WORDS) {
  // 6-80 词 或 含标点 → 整句翻译（不变，逻辑原样保留）
  return
}

if (wordCount === 1) {
  showWordPopup(selectedText, event)   // 单个词 → 词典查询（不变）
  return
}

// 2-5 词，无标点 → 短语在句中释义（新分支）
triggerPhraseContextLookup(selectedText, event)
```

`SELECTION_DICTIONARY_MAX_WORDS`（=5）、`SELECTION_TRANSLATE_MAX_WORDS`（=80）数值不变；新分支**不复用**整句翻译的 500ms 防抖（`SELECTION_TRANSLATE_DEBOUNCE_MS`）——短语选区不像"反复拖拽微调整句边界"那样有防抖需求（选中的就是明确的几个词，`mouseup` 即触发），且防抖是 ADR-007 专门为整句翻译场景设计的，不属于本次改动范围。

### 3.3 新增 `triggerPhraseContextLookup`（`content.tsx`，`showSelectionHint`/`triggerSelectionTranslation` 附近）

**实现后更新（2026-08-10）**：`findPhraseAnchor` 最终没有用 `Range.cloneContents()`（草案版本担心的"克隆节点脱离文档树"问题）。改用 `range.commonAncestorContainer`（不是元素节点时取其 `parentElement`）作为起点，`querySelectorAll('.enx-word')` 枚举该容器内的候选元素，逐个用 `range.intersectsNode(candidate)` 判断是否与选区相交，返回第一个相交的**真实 DOM 节点**——全程操作真实文档树，不涉及克隆，草案里的顾虑不适用。`jsdom` 已验证支持 `Range.intersectsNode`（`phraseAnchor.test.ts` 4 项用例全过，覆盖"target 本身是 `.enx-word`"“target 落在选区内非词文本上，退化扫描"“选区完全落在排除元素`<a>`内，返回 null"“无选区，返回 null"四种情况）。

```ts
const findPhraseAnchor = (event: MouseEvent): HTMLElement | null => {
  const target = event.target as HTMLElement
  if (target?.classList?.contains('enx-word')) return target

  const selection = window.getSelection()
  if (!selection || selection.rangeCount === 0) return null
  const range = selection.getRangeAt(0)

  let container = range.commonAncestorContainer as Node
  if (container.nodeType !== Node.ELEMENT_NODE) {
    container = container.parentElement as Node
  }
  if (!container || !(container instanceof HTMLElement)) return null

  const candidates = container.querySelectorAll('.enx-word')
  for (const candidate of Array.from(candidates)) {
    if (range.intersectsNode(candidate)) {
      return candidate as HTMLElement
    }
  }
  return null
}

const triggerPhraseContextLookup = async (selectedText: string, event: MouseEvent) => {
  const anchor = findPhraseAnchor(event)
  if (!anchor) {
    showSelectionHint('暂时无法识别所在句子，请尝试重新选择', event)
    return
  }

  const sentenceContext = WordProcessor.extractSentenceContext(anchor, anchor.textContent || '')
  const sentence = sentenceContext?.sentence
  if (!sentence) {
    showSelectionHint('暂时无法识别所在句子，请尝试重新选择', event)
    return
  }

  try {
    const response = await sendToBackground({
      type: 'openSentencePanel',
      word: '',
      phrase: selectedText,
      sentence,
      sourceUrl: window.location.href,
    })
    if (response.success && !response.panelOpened) {
      showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看', event)
    }
  } catch (error) {
    console.error('Error opening phrase panel:', error)
    showSelectionHint('已保存，请点击或右键工具栏 ENX 图标查看', event)
  }
}
```

**实现要点**（已解决，见上方"实现后更新"）：找到锚点元素后传给 `extractSentenceContext(anchor, anchor.textContent || '')`，其余不变。

### 3.4 `background.ts` / `types/index.ts` 消息与存储契约变更

`types/index.ts:96-101`：

```ts
export interface PendingSentenceContext {
  sentence: string
  word: string
  phrase?: string   // 新增：非空时表示这是"短语在句中释义"场景，SidePanel 据此分流
  sourceUrl: string
  createdAt: number
}
```

`background.ts:693-705` `handleOpenSentencePanel` 新增一个可选参数并透传：

```ts
const handleOpenSentencePanel = async (
  word: string,
  sentence: string,
  sourceUrl: string,
  tabId?: number,
  phrase?: string   // 新增
) => {
  const context: PendingSentenceContext = { word, sentence, sourceUrl, createdAt: Date.now(), phrase }
  await chrome.storage.session.set({ [PENDING_SENTENCE_STORAGE_KEY]: context })
  // ... 其余不变
}
```

`background.ts:299-305` 消息 switch 里的 `case 'openSentencePanel'` 新增 `request.phrase` 透传：

```ts
case 'openSentencePanel':
  return await handleOpenSentencePanel(
    request.word || '',
    request.sentence || request.word || '',
    request.sourceUrl || '',
    sender.tab?.id,
    request.phrase || undefined   // 新增
  )
```

`ContentMessage` 联合类型（`types/index.ts`，`openSentencePanel` 对应的成员）新增可选 `phrase?: string` 字段。

### 3.5 `SidePanel.tsx` 渲染改动

**跳过顶部整句翻译槽位**：现有 `translateSentence` 的 `useEffect`（约 168-205 行，keyed on `pendingContext?.createdAt`）开头加一个 guard：

```ts
useEffect(() => {
  if (!pendingContext || pendingContext.phrase) return   // 短语场景不触发整句翻译
  // ... 其余不变
}, [pendingContext?.createdAt])
```

**新增短语卡片 effect**，与上面并列，同样 keyed on `pendingContext?.createdAt`：

```ts
useEffect(() => {
  if (!pendingContext?.phrase) return
  const phrase = pendingContext.phrase
  const sentence = pendingContext.sentence

  setDefinitions(prev => [
    { word: phrase, dictionaryStatus: 'none', contextStatus: 'loading' },
    ...prev,
  ])
  fetchContextTranslation(phrase, sentence)   // 复用已有函数，见 §2.6
}, [pendingContext?.createdAt])
```

`fetchContextTranslation`（已存在，处理 `contextChinese`/`contextError`/`contextStatus` 和重试逻辑）**不需要改**——它本来就是通用的 `(word, sentence)` 签名，`word` 传短语文本直接可用。

**类型调整**：`WordCardData.dictionaryStatus` 类型从 `FetchStatus` 放宽为 `FetchStatus | 'none'`（对齐 `contextStatus` 已有的 `'none'` 惯例）。

**渲染调整**（三处判断都要跳过 `dictionaryStatus === 'none'` 的卡片）：
- 音标行（现有 `def.dictionaryStatus === 'loading' ? ... : def.pronunciation && (...)`）：`'none'` 时两者都不渲染。
- 词典释义区块（`def.dictionaryStatus === 'loading' ? ... : def.dictionaryChinese && (...)`）：`'none'` 时不渲染。
- Query Count（`def.loadCount !== undefined && (...)`）：短语卡片 `loadCount` 始终是 `undefined`，天然不渲染，不需要额外改动。

### 3.6 `enx-api` prompt 措辞调整（三个 provider 文件）

`kimi.go:23-26`、`bedrock.go`、`minimax.go` 里各自的 `wordContextSystemPrompt` 常量，措辞从"a specific word"调整为同时覆盖单词和短语，例如：

```go
wordContextSystemPrompt = "You are a professional English-to-Chinese translator. " +
	"Given an English sentence and a specific word or phrase from that sentence, reply with its " +
	"Chinese meaning as used in THIS sentence's context only, not a generic " +
	"dictionary definition. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
```

三个文件需要**逐一修改**（历史遗留：三份 prompt 是各自独立的字符串常量，没有共享定义，本次不做提取公共常量的重构，只改文案，保持改动面最小）。`user` 侧的 `"Sentence: %s\nWord: %s"` 格式串不变（字段名 `Word:` 沿用，不改成 `Phrase:`，因为这只是 prompt 里的标签文字，AI 能从上下文理解，没必要为了措辞精确引入"这是单词还是短语"的额外分支逻辑）。

---

## 4. 验收标准

> **图例**：`[x]` = 已通过自动化验证（`go test`/`jest`/`tsc`/`vite build`/`go build`）；`[ ]` 前标 ⏳ = 代码已实现（走查确认逻辑正确），但 `content.tsx` 因 Vite-only 的 `?inline` CSS import 无法在 Jest 里直接导入（既有 ADR-007 选区逻辑同样如此，非本次改动引入的限制），`handleTextSelection` 的选区分级路由本身只能靠真实 Chrome 手工验证。

### 4.1 选区分级

- [ ] ⏳ 划词选中 1 个词（无标点）：行为与改动前完全一致，走 `showWordPopup`/`getOneWord`，不受本次改动影响——代码改动为纯路由拆分，逻辑走查确认不变，真机验证待用户执行
- [ ] ⏳ 划词选中 2–5 个词（无标点）：不再调用 `getOneWord`/触发词典弹窗，走新的 `triggerPhraseContextLookup`——同上
- [ ] ⏳ 划词选中 6–80 词或含句末标点：行为与改动前完全一致，走 `triggerSelectionTranslation`（含 500ms 防抖），不受本次改动影响——同上，这部分代码未改动
- [ ] ⏳ 超过 80 词：行为不变，提示"选中内容过长"——同上，这部分代码未改动

### 4.2 句子边界锚点

- [x] 单测覆盖 `findPhraseAnchor`：`event.target` 本身是 `.enx-word` 时直接返回；`event.target` 落在词间空白/标点时能在选区范围内找到至少一个 `.enx-word` 元素；选区完全落在 `<a>` 标签内（无 `.enx-word`）时返回 `null`；无选区时返回 `null`——`phraseAnchor.test.ts`，4 项全过（对 `content.tsx` 内逻辑的镜像实现，原因见测试文件头注释）
- [ ] ⏳ 找不到锚点时，触发 `showSelectionHint('暂时无法识别所在句子，请尝试重新选择', event)`，不发起任何后台请求——`triggerPhraseContextLookup` 走查确认逻辑正确，因 `content.tsx` 不可导入未做端到端单测，真机验证待用户执行
- [ ] ⏳ 找到锚点后，`extractSentenceContext` 返回的句子确实包含选中的短语文本（健全性检查）——未新增自动化断言，`extractSentenceContext` 本身的 6 项既有单测未受影响仍全过；选区跨句边界的情况按 ADR-008 Consequences 已知接受不完整覆盖

### 4.3 消息与存储

- [x] `PendingSentenceContext` 新增 `phrase?: string` 字段，`handleOpenSentencePanel` 正确透传进 `chrome.storage.session`——`background.test.ts`「threads request.phrase into the stored PendingSentenceContext」用例覆盖
- [x] 单词"🔤 整句翻译"按钮、ADR-007 整句翻译两条既有调用点不传 `phrase`，写入的 `PendingSentenceContext.phrase` 为 `undefined`，行为与改动前完全一致（回归测试）——`background.test.ts`「leaves phrase undefined for the existing whole-sentence/single-word callers」用例覆盖

### 4.4 Side Panel 渲染

- [x] `pendingContext.phrase` 存在时，顶部"整句翻译"单槽位（`sidepanel-chinese`/`sidepanel-loading`/`sidepanel-error`）不触发、不显示任何内容——`SidePanel.test.tsx`「renders a phrase card instead of the top sentence-translation slot ...」用例覆盖，并断言未调用 `translateSentence`
- [x] `pendingContext.phrase` 存在时，`definitions` 列表最前插入一张短语卡片：卡片标题是短语原文，不显示音标/词典释义/Query Count，AI 释义走 loading → loaded/error 状态机——同上用例覆盖
- [x] 短语卡片的 error 状态显示独立错误行 + 重试按钮，点击重试后重新发起 `translateWordInContext`——`SidePanel.test.tsx`「shows an error + retry on a phrase card, same as a word card」用例覆盖
- [x] 单个词点击产生的单词卡片与短语卡片混在同一个 `definitions` 列表里，各自按最近操作时间置顶，互不干扰——沿用既有「appends word cards on click」等用例未受影响（回归通过），短语卡片测试与单词卡片测试并行运行未见互相干扰

### 4.5 后端 prompt

- [x] `kimi`/`bedrock`/`minimax` 三个 provider 的 `wordContextSystemPrompt` 更新措辞（"a specific word" → "a specific word or phrase"）；各自新增 `TestTranslateWordInContextPhrase` 用例（传入 "hunt down emails" 短语，断言请求体/mock 调用正确、返回中文释义正常），既有单测未受影响——`go test ./aitranslate/...` 全绿
- [ ] ⏳ 手工验证（不要求自动化）：真实调用一次 `POST /api/translate/word-in-context`，`word` 传短语，确认三个 provider 返回结果语义合理（非报错、非明显跑题）——需要真实 API Key/IAM 权限，待用户执行

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| `Range.cloneContents()` 找到的 `.enx-word` 是克隆节点，不能直接传给依赖真实 DOM 位置的 `extractSentenceContext` | §3.3 已标注这是实现阶段需要验证的工程细节，要求先写单测锁定 `findPhraseAnchor` 的行为，再接入 `extractSentenceContext` |
| 选区跨越两个句子边界时，`extractSentenceContext` 只能定位到锚点所在的一句，AI 拿到的上下文可能不完整覆盖选中短语 | 按 ADR-008 Consequences 已知接受，不做运行时校验/拒绝，出现时只是釋义质量下降，不算故障 |
| `PendingSentenceContext` 新增 `phrase` 字段后，`word` 字段的"写了没人读"死数据状态依然存在，两个字段语义容易混淆 | 记录在 ADR-008 Revisit Trigger，本次不清理，注释里需明确写清楚两者的分工（`word` 历史遗留未使用；`phrase` 新增，非空即短语场景） |
| 短语卡片和单词卡片共用 `WordCardData` 类型，`pronunciation`/`loadCount`/`dictionaryChinese` 对短语卡片永远是 `undefined`，容易被后续开发者误用 | 渲染层统一按 `dictionaryStatus === 'none'` 判断跳过，不额外判断具体字段是否为空；类型注释里注明 `dictionaryStatus: 'none'` 的语义 |
| 三个 provider 的 prompt 常量各自独立定义，改措辞需要同步改三处，容易漏改 | §4.5 验收标准要求三个 provider 的单测都同步更新并跑通，`go test ./aitranslate/...` 作为兜底检查 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/src/content/content.tsx` | `handleTextSelection` 三路分支拆分（§3.2）；新增 `findPhraseAnchor`/`triggerPhraseContextLookup`（§3.3） |
| `enx-chrome/src/content/__tests__/phraseAnchor.test.ts` | 新增，`findPhraseAnchor` 的镜像实现单测（`content.tsx` 因 `?inline` CSS import 无法在 Jest 里直接导入，与 `codeBlockExclusion.test.ts`/`flexContainerFix.test.ts` 同一模式） |
| `enx-chrome/src/types/index.ts` | `PendingSentenceContext` 新增 `phrase?: string`；`ContentMessage` 的 `openSentencePanel` 成员新增 `phrase?: string` |
| `enx-chrome/src/background/background.ts` | `handleOpenSentencePanel` 新增 `phrase` 参数并透传；`case 'openSentencePanel'` 新增 `request.phrase` 传参 |
| `enx-chrome/src/background/__tests__/background.test.ts` | 新增 `openSentencePanel phrase passthrough` 描述块：`phrase` 正确透传进 `chrome.storage.session.set`；既有调用点（无 `phrase`）写入 `undefined`，行为不变 |
| `enx-chrome/src/sidepanel/SidePanel.tsx` | `WordCardData.dictionaryStatus` 类型放宽为 `FetchStatus \| 'none'`；`translateSentence` effect 加 `pendingContext.phrase` guard；新增短语卡片 effect |
| `enx-chrome/src/sidepanel/__tests__/SidePanel.test.tsx` | 新增：`pendingContext.phrase` 存在时不触发整句翻译且短语卡片正确渲染（跳过音标/词典释义区块）；短语卡片 error+重试 |
| `enx-api/aitranslate/kimi/kimi.go` | `wordContextSystemPrompt`（23-26 行）措辞调整："a specific word" → "a specific word or phrase" |
| `enx-api/aitranslate/bedrock/bedrock.go` | 同上，各自独立定义的同名常量（30-33 行） |
| `enx-api/aitranslate/minimax/minimax.go` | 同上（26-29 行） |
| `enx-api/aitranslate/kimi/kimi_test.go`、`bedrock/bedrock_test.go`、`minimax/minimax_test.go` | 各新增 `TestTranslateWordInContextPhrase`，传入短语文本验证请求/返回正常；既有测试未受影响（本来就不断言精确 prompt 文本，只断言 sentence/word 出现在请求体里） |
| `docs/architecture/adr-008-phrase-selection-context-translation.md` | 本 Spec 的架构决策依据 |

---

## 7. 实施顺序（建议）

```text
1. [x] enx-chrome: content.tsx 新增 findPhraseAnchor + 单测（phraseAnchor.test.ts，镜像实现，4 项全过）
2. [x] enx-chrome: content.tsx 新增 triggerPhraseContextLookup，接入 handleTextSelection 三路分支（§3.2/§3.3）
3. [x] enx-chrome: types/index.ts 新增 phrase 字段；background.ts 透传 phrase（§3.4）+ background.test.ts 新增 2 项用例
4. [x] enx-chrome: SidePanel.tsx 短语卡片 effect + 类型调整（§3.5）+ SidePanel.test.tsx 新增 2 项用例（渲染改动本身无需额外代码，既有的 `status && (...)` 短路渲染天然跳过 'none' 状态的字段，见走查记录）
5. [x] enx-api: 三个 provider 的 wordContextSystemPrompt 措辞调整 + 各新增一项 TestTranslateWordInContextPhrase（§3.6，与 1-4 并行完成）
6. [x] tsc --noEmit（enx-chrome）/ jest（16 套件 114 项全过）/ vite build / go build ./... / go test ./aitranslate/... 全部跑通
7. [ ] 本地 unpacked 加载 + 真实 Chrome 手工验证：划词选中截图里的 "hunt down emails" 这类短语，确认短语卡片正确显示、混排顺序正确、重试可用——待用户执行
8. [ ] 勾选 §4 剩余 ⏳ 项（均为真实 Chrome 交互，无法用 jest 模拟），全部通过后文首状态改为 `Done — YYYY-MM-DD`
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；架构层面的取舍已经在 ADR-008 里定案，不要在实现时重新讨论"要不要这样做"，只讨论"这样做具体怎么写"。
2. **实现中**：严格按 §7 分步提交，每步跑一次对应测试；`enx-chrome` 与 `enx-api` 改动可以分开提交（§5 与 §1-4 互不依赖）。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Implemented — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 短语查询的缓存/持久化（ADR-008 Revisit Trigger：注意释义是句子相关的，不能简单按短语文本做 key）
- 短语版"生词本"/复习功能（若做，需要新的表设计，参考 `adr-003-ielts-wordlist-mastery-model.md` 但不能照搬其"一个词条一个权威释义"的假设）
- `PendingSentenceContext.word`/`phrase` 字段语义合并清理
- 单词"🔤 整句翻译"按钮改为显示该词的短语卡片（复用本 Spec 建立的渲染路径），而非现在的"整句翻译"——需要单独的 ADR，属于改变现有单词按钮行为的决策
