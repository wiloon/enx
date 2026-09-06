# ADR-014：从查词弹窗打开 Side Panel 时，默认高亮点击的词 + 把「整句翻译」与「该词本句含义」合并成**一次** AI 调用（新增结构化 `sentence-with-word` 端点）；同时把 `aitranslate` 的三个翻译功能全部迁到**按 token 精确计费**

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-03。已实现（enx-api + enx-chrome）：新叶子包 `aitranslate/sentenceword` + `aitranslate/aiusage`，`Translator` 三方法改返回 `Usage`，三 provider（kimi / minimax / bedrock）补 `TranslateSentenceWithWord`，`Handler` 从 `Consume/Refund` 改为 `Balance/Settle`（复用 ADR-012 的 `TokenLedger`），新增 `POST /api/translate/sentence-with-word`；Side Panel 高亮点击词 + 打开即自动查词。`go test ./aitranslate/...`、`tsc`、`jest`（chrome 151 项）、`vite build` 均通过。 |
| **日期** | 2026-09-03 |
| **关联 Spec** | [`../tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](../tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md) §3.10（本 ADR 的实现依据写在那里的新小节） |
| **关联 ADR** | [`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（`Translator` 接口起点）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)（Side Panel 生词卡运行列表）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（**本 ADR 推翻其 Decision 4 中「翻译按固定成本计费」的部分**——翻译改按 token）、[`adr-012-enx-ui-idiomatic-rephrasing.md`](adr-012-enx-ui-idiomatic-rephrasing.md)（**本 ADR 推翻其 Decision 1「不改动现有 `Translator` 接口 / `/translate/*` 计费键 / `Consume` 语义」**——把 rephrase 当试点铺的 token 计费基础设施，现在推广到整个 `aitranslate`；复用其 `credit.Balance/Settle` 原语与 `TokenPricing` 公式） |
| **关联配置** | `config.toml` `[stripe.costs.translate]`（新增一组 token 权重，取代 `[stripe.costs]` 的固定 `translate-sentence` / `translate-word-in-context`）；部署侧环境变量 `STRIPE_COSTS_TRANSLATE_SENTENCE` / `_TRANSLATE_WORD_IN_CONTEXT` **作废**，换成 `STRIPE_COSTS_TRANSLATE_WEIGHT_IN` / `_WEIGHT_OUT` / `_DIVISOR`。`w10n-config` 里 homelab / k8s 的部署清单需同步（不在本仓库改）。 |

---

## Context

### 现状（触发路径③：正文查词弹窗 →「整句翻译」按钮 → Side Panel）

- 用户在正文点一个高亮词 → 弹窗 → 点「整句翻译」→ `content.tsx` 发 `openSentencePanel {word, sentence, sourceUrl}` → `background.ts` 落盘 `PendingSentenceContext`（**`word` 字段一直在写，但 `SidePanel.tsx` 从不读**）+ 尽力打开 Side Panel。
- Side Panel 挂载 → 对 `pendingContext.sentence` 发 **一次** `translateSentence` AI 调用，顶部显示整句中译。
- 用户想知道刚点的那个词「在这句里」是什么意思，得**在侧边栏原文里再点一次那个词** → 触发**第二次** AI 调用（`translateWordInContext`）+ 一次 `getOneWord` 词典查询，结果进生词卡。

痛点：① 点过的词在侧边栏没有任何视觉标记，用户要重新找；② 「查这个词在这句里的意思」这个几乎必然会做的动作要手动再点一次；③ 为此付两次 AI 调用的钱（整句 + 单词各一次）。

### 现状（计费）

- `aitranslate.Translator` 三个方法（`TranslateSentence` / `TranslateWordInContext`，本 ADR 再加第三个）此前只返回 `(string, error)`。
- `Handler` 走 ADR-009 Decision 4 的**固定成本**：`credit.Consume` 先扣 1 积分 → 调 provider → 失败 `Refund`。功能键 `translate_sentence` / `translate_word_in_context`。
- ADR-012 给 rephrase 铺了**按 token 计费**：`credit.Balance` 预检（≥1 放行）→ 调 provider → 成功按实际 `prompt`/`completion` token `Settle`（允许扣成负数，下次请求挡）→ 失败不扣。公式 `cost = ceil((prompt*weight-in + completion*weight-out) / divisor)`，floor 1。provider 的 `chat` helper 已经在返回 `usage`（kimi / minimax），bedrock 的 `converse` 也已在内部提取 token 数（只打日志）。

---

## 已确认的决策（2026-09-03，用户确认）

1. **默认高亮点击词**：Side Panel 英文原文里，`pendingContext.word` 的**每一个同形词**都加持久高亮（`bg-yellow-200 font-medium`，区别于 hover 态）。拖选整句（ADR-007，`word` 为空）和短语查询（ADR-008，`phrase` 非空）不高亮。content 层不传具体位置，所以按「所有同形词」处理。
2. **打开即自动查词**：从查词弹窗打开面板时（`word` 非空、无 `phrase`），不等用户再点，直接为该词 seed 一张生词卡 + 补词典半边（`getOneWord`）。
3. **两次 AI 调用合并成一次**：新增结构化端点 `POST /api/translate/sentence-with-word`，一个 prompt 让模型同时返回整句译文和目标词**在本句上下文中**的含义，JSON `{"sentence": "...", "word": "..."}`。取代打开面板时的 `translateSentence`。
4. **优雅降级**：模型只返回整句、漏了 `word` 字段 → **不报错**，整句译文照常展示，Side Panel 再单独发一次 `translateWordInContext` 兜底。缺 `sentence` 才算失败（502）。
5. **面板已打开时在侧边栏里点「另一个」词**：**维持现状**——继续 `translateWordInContext` + `getOneWord` 并行，不重译整句（整句译文已在上方）。合并端点只用于「打开面板」这一下。
6. **三个翻译功能全部改按 token 精确计费**：`translate_sentence` / `translate_word_in_context` / 新的 `translate_sentence_with_word` 统一走 ADR-012 那套 `Balance` 预检 + `Settle` 实扣。三者同一模型、token 画像相近，**共用一组** `[stripe.costs.translate]` 权重（不像 rephrase 那样单独一块，因为 rephrase 可能指向更大上下文的模型）。这是 ADR-012「全站 token 计费」试点的第一次正式推广。

## Decisions（实现形状）

### 后端（enx-api）

- **`aitranslate/aiusage`**（新叶子包）：`Usage{PromptTokens, CompletionTokens, TotalTokens int}`。单独成包是为了打破 `aitranslate` ↔ provider 的 import 环（`aitranslate` import 各 provider 包，见 `factory.go`）。`aitranslate` 内 `type Usage = aiusage.Usage`。
- **`aitranslate/sentenceword`**（新叶子包，照搬 `aitranslate/rephrase` 结构）：`SystemPrompt` / `Temperature=0.3` / `Result{SentenceChinese, WordChinese string}` / `ParseResult(raw)`。`ParseResult` 复用 rephrase 的「首个 `{` 到最后一个 `}`」宽松提取；`sentence` 空 → error，`word` 空 → 容忍（`WordChinese=""`）。
- **`Translator` 接口**：三方法都改返回 `(..., Usage, error)`；新增 `TranslateSentenceWithWord(ctx, sentence, word) (sentenceword.Result, Usage, error)`。三 provider（kimi / minimax / bedrock）各补实现（新文件 `sentenceword.go`，对齐现有 `rephrase.go` 拆分）；bedrock 的 `converse` 从 `(string, error)` 改为带出 `Usage`。
- **`Handler`**：删 `CreditLedger`（Consume/Refund）、`credit_ledger.go`、`costTranslate*` 字段。改持有 `ledger TokenLedger`（= ADR-012 的 `RephraseLedger` 重命名，Balance/Settle，rephrase handler 一并改用）+ 一个共享 `credit.TokenPricing`。三个 handler 方法统一走私有 `billedCall(c, feature, fn)`：translator 配置检查 → `pricing.Priced()` → `Balance < 1` 则 402 → 调 `fn` 拿 `Usage` → `Settle`（失败仅日志）。`translate_sentence_with_word` 成功响应 `{success, chinese, wordChinese}`（`wordChinese` 可能是空串）。
- **路由**：`authGroup` + `apiGroup` 各加 `POST /translate/sentence-with-word`。
- **配置**：`config.toml` 用 `[stripe.costs.translate]` weight-in/out/divisor（占位 `1/3/3000`）取代固定 `translate-sentence=1` / `translate-word-in-context=1`；`viper.go` 同步 `SetDefault(0)` + `BindEnv`。

### 前端（enx-chrome）

- `types`：`ContentMessage` 加 `'translateSentenceWithWord'`；`BackgroundResponse` 加 `wordChinese?: string`。
- `background.ts`：新 `case` → `handleTranslateSentenceWithWord(sentence, word)` → `POST /api/translate/sentence-with-word`，`wordChinese` 缺失归一化为 `''`。
- `SidePanel.tsx`：
  - 提取 `fetchDictionary(word)`（从 `handleWordClick` 里抽 `getOneWord` 那半，注释点明 getOneWord 会自增服务端 Query Count，只能调一次）。
  - 打开面板的 effect 按 `pendingContext.word` 分支：非空且无 `phrase` → 发 `translateSentenceWithWord`，成功后 `autoLookupClickedWord(word, sentence, wordChinese)`：已存在的卡只置顶（不重查，避免 Query Count 重复计数）；不存在则插入 + `fetchDictionary` + （`wordChinese` 空则）`fetchContextTranslation` 兜底。`word` 为空 → 维持 `translateSentence`。
  - 渲染时给等于 `clickedWord`（小写比较）的 clickable token 加高亮类 + `data-clicked-word="true"`。

---

## 与既有 ADR 的关系

- **推翻 ADR-009 Decision 4（翻译部分）**：翻译不再是「固定成本 1 积分/次」，改按 token。dictionary 查词（免费额度 + 固定逻辑）不受影响。
- **推翻 ADR-012 Decision 1**：ADR-012 当时刻意「不碰」现有 `Translator` / `/translate/*` 计费 / `Consume`，把 token 计费限定在新建的 rephrase 上作试点。试点已稳定运行，本 ADR 把它推广到整个 `aitranslate`——`Translator` 接口签名变了、计费键的成本模型变了、`Consume/Refund` 在 `aitranslate` 内不再使用（`billing/credit` 里保留，别处仍用）。
- **复用 ADR-006**：自动 seed 的生词卡进的是同一个「面板会话运行列表」，去重 / 置顶规则跟 `handleWordClick` 一致。

## Revisit Triggers

- `sentence-with-word` 的结构化输出可靠性：如果线上 `wordChinese` 空串（降级）比例偏高，考虑给 prompt 加 few-shot，或对小模型回退到两次调用。
- `[stripe.costs.translate]` 权重是占位值，待整体定价复核（同 rephrase）——从 usage 日志的 `cost=` 字段校准。
- 若将来 content 层能传「点击的是第几个同形词」，高亮可收窄到那一个。
