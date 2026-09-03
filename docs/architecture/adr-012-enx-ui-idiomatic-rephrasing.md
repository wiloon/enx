# ADR-012：enx-ui 新增「地道表达」页面——把中文 / 中英混杂 / 不地道的英文改写成地道的职场美式英语（面向跟美国同事沟通的措辞优化），在 `aitranslate` 包内**新建**反向 `Rephraser` 能力，并以此作为**全站按 token 计费**基础设施的第一块试点

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-02。经 grilling 收敛全部取舍，已按 TDD 实现（enx-api + enx-ui）并过一轮双轴 code review，review 提出的 Spec / Standards 问题已修（`Settle` 改单条原子 UPDATE 保证 subscription 池不为负、`TokenPricing` 值类型下沉到 `billing/credit`、`TypeSettle` 并入 `ledger.go`、日志行去重、enx-ui 补测试）。 |
| **日期** | 2026-09-02 |
| **关联 Spec** | 配套 TASK-SPEC 留到编码阶段再写（同 ADR-008 / ADR-010 / ADR-011 的做法）；本 ADR 只定后端能力形状、输出结构、路由、计费机制、前端页面形态与功能边界 |
| **关联 ADR** | [`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（`aitranslate.Translator` 接口的起点，本 ADR 在**同一个包**里新建方向相反的姊妹能力，**不改动** `Translator`）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（复用「无状态 AI 调用、结果不落库、把落库留作 Revisit Trigger」的先例，以及「不为实现细节增加分级心智」的取舍思路）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（复用两池积分 ledger 与 402 约定；本 ADR 是其 Decision 4「固定成本」之外**按 token 计量**的第一个功能，新增 `credit.Settle` 原语作为将来全站推广的基础——见下方「与 ADR-009 的关系」） |
| **关联配置** | `w10n-config/enx/monetization.md` / `monetization-tasks.md`（定价讨论；本 ADR 新增一组 token 计费常数，初值待整体定价复核） |

---

## 修订记录

- **2026-09-02（部署前）**：新增 **MiniMax** 的 `Rephrase` 实现。原计划「至少实现 kimi 一个 provider」，但 homelab 部署跑的是 `sentence-translate.provider = minimax`（只有 MiniMax 的 key），而 Decision 1 定的「provider 显式配了但 `NewRephraser` 失败 → `os.Exit(1)`」会让 enx-api 在 homelab 直接崩溃。为让 homelab 能用上 rephrase，给 MiniMax 也实现了 `Rephraser`：
  - 共享 system prompt / temperature 提到 `aitranslate/rephrase` 包（`rephrase.SystemPrompt` / `rephrase.Temperature`），kimi 与 minimax 共用，不再各写一份。
  - MiniMax 的 `chat` helper 改为返回 `usage` 并接受 `temperature` 参数（对齐 kimi）。
  - `utils/viper.go` 补上 `stripe.costs.rephrase.weight-in / weight-out / divisor` 的 `SetDefault(0)` + `BindEnv`（`STRIPE_COSTS_REPHRASE_WEIGHT_IN` 等）和 `sentence-translate.kimi.rephrase-model` 的 `BindEnv`——k8s 不带 config.toml，这些之前没有 env 绑定，rephrase 会因「未定价」502。
  - homelab `deployment.yaml` 加 `STRIPE_COSTS_REPHRASE_WEIGHT_IN/OUT/DIVISOR = 1/3/3000`（与 config.toml 占位一致，待定价复核）。
  - `bedrock` 仍未实现 `Rephrase`——配 `bedrock` 时 rephrase 端点按 Decision 1 仍会 `os.Exit(1)`（fail fast 行为不变）。

---

## 已确认的决策（2026-09-02，用户确认；含 grilling 轮次结论）

1. **不改动现有 API**：现有 `Translator` 接口、`/translate/*` 路由、`translate_sentence` / `translate_word_in_context` 计费键、`credit.Consume` 语义全部不动。本功能是**新建**接口 + 新建路由 + 新建计费键 + 新增一个 ledger 原语。
2. **场景**：面向英语不够自信的中文母语职场人——典型场景是入职外企后，要给美国同事发消息 / 邮件、请对方帮忙做一件事、或日常沟通协作；发出去之前想让 AI 把措辞优化成地道的说法。
3. **输入范围**：输入可以是中文、中英混杂、或用户自己写的不地道英文；一律理解其意思并输出地道的职场美式英语。
4. **输出形态**：地道版 + **1–2** 个不同语域的备选说法（至少 1 条）+ **0–4** 条**中文**学习注解（每条 ≤ ~60 字，解释「改了什么、为什么」）。
5. **不替用户加戏**：只优化措辞——不新增用户没表达的信息 / 背景 / 需求细节，不扩写，不改变原意，长度贴近输入。**不是提示词生成器**。
6. **输入上限**：**200 中文字符**（前端拦 + 后端 400）。**这是暂时的**——未来可能上调，届时需复查 provider 上下文窗口（见 Revisit Trigger）。
7. **计费：按 provider 返回的实际 prompt / completion token 用量计费**。这不是「为 rephrase 特事特办」，而是**有意为之的全站按 token 计费基础设施试点**：rephrase 是第一个吃螃蟹的功能，`credit.Settle` 原语和 in/out 加权公式都按「将来别的功能能直接复用」来设计。
8. **计费流程**：调用前 `balance >= 1` 才放行（否则 402）→ 调 provider → 成功则按实际 token `Settle` 扣费（**允许把余额扣成负数**）→ 下次请求余额 ≤ 0 就被 402 挡住。provider 调用失败 / JSON 解析失败 → **不扣费**、502。
9. **免费额度**：不加。纯积分扣费，跟句子翻译一致。
10. **交付方式**：不写单独的 TASK-SPEC（同 ADR-008 / 010 / 011）——本 ADR 的 Decision + Decision 8 测试清单直接作为实现依据，走 TDD。

---

## Context

### 用户场景

目标用户是中文母语、英语说得不太好的职场人（入职外企 / 跨国团队）。日常要用英文跟美国同事文字沟通——Slack / Teams 消息、邮件、请人帮忙、协调进度。痛点：发消息之前对自己的英文没信心，机器直译出来的英文又生硬、不像同事之间平时说话的样子（过度正式、过度铺垫、语气拿捏不准）。

需求：给一段中文（或中英混杂、或自己写的蹩脚英文），返回**地道的职场美式英语说法**，并附带能帮助学习的对比信息（不同语域的备选说法 + 中文注解，讲清楚为什么这么说）。

### 现状：`aitranslate` 只有 EN→CN；积分 ledger 只有固定成本、不能扣负

`aitranslate` 包（ADR-007 / ADR-008）目前提供**英译中**：

- `Translator` 接口两个方法 `TranslateSentence` / `TranslateWordInContext`，都返回单条中文字符串。
- provider 工厂 `aitranslate.New(ctx)` 按 `sentence-translate.provider`（`kimi` / `bedrock` / `minimax`）选实现，provider 未配置时返回 error、调用方降级（端点 502）。当前配置模板里 `provider = ""`（各部署自己设）。`kimi` 默认模型 `moonshot-v1-8k`（8k 上下文）。
- `Handler` 走 `credit.Consume` 先扣 → 调 provider → 失败 `Refund` 的流程。计费是 **ADR-009 Decision 4 的固定成本模型**：功能键 `translate_sentence` / `translate_word_in_context`，成本在 `config.toml [stripe.costs]` 各为 `1` 积分/次。
- `billing/credit.Consume`（`billing/credit/ledger.go:50`）是**带条件的原子 UPDATE**：`WHERE subscription_balance >= cost`（不够再试 `topup_balance >= cost`），两个池都不够 → `ErrInsufficientCredit`（调用方映射 402）。**它按设计不可能把余额扣成负数**，且拒绝 `cost <= 0`。`Refund` 需要 `Consume` 返回的 `pool` 才能退到同一个池。
- `billing/credit` **没有对外的余额读取函数**——`billing/handler.go` 的 `Me` 直接查 `sqlitex.CreditAccount` 行。
- `kimi.go` 已经有一个 `usage` 结构体，把每次调用的 `prompt_tokens` / `completion_tokens` / `total_tokens` **记进日志但还没用于计费**——注释里写明「先量真实 token 数，再决定 token→credit 的换算比例」。本 ADR 正是那条注释在等的决策。
- 路由 `POST /translate/sentence` 等挂在 `cognitoAuth` 组里。
- enx-ui 侧 `ApiService`（`enx-ui/src/services/api.ts`）用 `makeRequest` 封装 `fetch` + 401 静默刷新，页面用 `@tanstack/react-query` + shadcn 卡片（`enx-ui/src/app/lookup/` 是现成范例）。
- 现有 handler 测试（`aitranslate/handler_test.go`）用 `fakeTranslator` + `fakeCreditLedger` 纯单元测试，无 DB。

本功能是**方向相反**（CN→EN）、**输出形态不同**（结构化：地道版 + 备选 + 注解）、**计费模型不同**（按实际 token、允许负余额）的新能力。

### 为什么值得写 ADR

- **难以反悔**：后端接口形状、结构化响应字段、路由、计费机制一旦定下来，enx-ui（及未来可能复用的 enx-chrome）就会依赖它，改动要动多端；计费机制还牵涉真实的积分扣减，而且**引入了系统里此前不存在的「负余额」状态**。
- **反直觉**：(a)「帮我跟同事沟通 / 帮我在 AI 工具里表达」这个背景极易被理解成「生成 / 优化提示词」，要显式把边界钉在「优化措辞，不是写提示词」；(b) 计费**不走 ADR-009 的固定成本模型**，未来读代码的人会疑惑为什么这个功能按 token 计量、为什么余额能是负的。
- **真实取舍**：后端能力放哪、输出怎么建模、按 token 计费时扣负数能力怎么加进 ledger（改现有函数 vs 新原语）、失败路径扣不扣费，都有多个合理选项、各有代价。

---

## Options Considered

### A. 后端能力放在哪

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 扩展 `aitranslate.Translator` 接口，加一个 `RephraseToEnglish` 方法 | 现有接口多一个方法 | 不新增接口 | **改动现有接口**（用户已明确否掉）；逼 `kimi` / `bedrock` / `minimax` 三个 provider 立刻都实现一个方向、输出形态、计费模型都不同的方法 |
| A2.（采用）`aitranslate` 包内**新建**姊妹接口 `Rephraser` + 独立工厂 `NewRephraser(ctx)` + 独立 `RephraseHandler` | 复用 provider 的 HTTP client / 鉴权 / `sentence-translate.*` 配置命名空间 / `chat` helper；接口契约独立；现有代码零改动（只在 `enx-api.go` 加装配和路由行） | 多一个接口和一个 handler；`sentence-translate.*` 配置名字开始同时服务两种能力，语义变宽 |
| A3. 全新包 `airephrase` | 彻底隔离 | provider client 构造、config 读取、用量日志要再抄一遍；无法直接调现有 provider 的私有 `chat` helper |

### B. 输出结构怎么建模

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. 三条平铺字符串 | response 三个 string 字段 | 后端简单 | 表达不了「备选几条、每条什么语域、注解几条」，而这正是学习价值；前端无法给单条备选加「复制」按钮 |
| B2.（采用）结构化：`idiomatic` + `alternatives: [{text, register}]` + `notes: [string]`（中文）；要求 LLM 返回严格 JSON，服务端解析，解析失败按「不静默返回半成品」惯例回 502 | 前端能稳定渲染三块、给地道版和每条备选单独加「复制」按钮（复制走某条说法就是核心动作） | 依赖 LLM 稳定返回合法 JSON；小模型偶尔带 markdown 围栏或多余解释，需要容错解析 |
| B3. 把 LLM 的 markdown 原样透传给前端 | 后端零解析 | 「输出长什么样」完全交给 prompt 微调；前端无法稳定分块、无法给单块加操作按钮 |

### C. 路由挂在哪

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. `POST /translate/rephrase` | 跟现有 `/translate/*` 并列 | 路径分组一致 | 语义误导——这不是「翻译成中文」，`/translate/` 前缀让人以为输出是中文 |
| C2.（采用）`POST /rephrase` + `POST /api/rephrase` | 独立能力独立路径 | 语义清楚 | 多一个顶层路径段 |

### D. 计费机制

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1. 固定 N 积分/次（照 ADR-009 Decision 4） | `stripe.costs.rephrase-to-english = 1` | 最简单、无竞态、不碰 ledger | 用户明确要按实际用量；且这次要顺带铺「全站按 token 计费」的地基，固定成本铺不了 |
| D2. 保守预扣估算 → 调用 → 按实际用量对账（退差额 / 补差额） | `Consume(估算)` 先扣，事后 `Refund` 或补 `Consume` | 预扣能堵并发竞态 | **补扣走不通**——`Consume` 按设计不能扣负、且拒绝 `cost<=0`；要么加负数能力（那就是 D3 的原语），要么接受「实际 > 预估」时白少收。且预估逻辑本身是一层会错的复杂度，而 200 字上限让输入 token 又小又有界，预估收益很低 |
| D3.（采用）**调用前 `balance >= 1` 预检 → 调 provider → 成功后按实际 token `Settle` 扣费（允许 topup 池扣负）**。失败路径不扣费。 | 扣费精确；无预估、无对账；一次请求最多把 topup 池冲进小额负数，下次预检即挡住；`Settle` / `TokenPricing` 是可复用的全站基础设施 | 系统多出「负余额」状态，`/billing` 展示和充值加法要能正确处理负数；并发下多个请求可能同时过预检、把 topup 池冲得更负（有界，接受；subscription 池由 `Settle` 的原子 UPDATE 保证不为负） |

**D 的子决策：扣负数能力怎么加进 `billing/credit`**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| 直接改 `Consume` | 去掉 `WHERE balance >= cost` 条件 / 加 `allowNegative` 开关 | 不新增函数 | 立刻改变 `translate_sentence` / `translate_word_in_context` 的行为（余额不足从硬 402 变成放行扣负），要全套回归；ADR-009 的反超支设计被动 |
| （采用）新增 `credit.Settle(ctx, userID, feature, cost)` | **一条原子 UPDATE**：`subscription_balance -> MAX(0, sub - cost)`、`topup_balance -> topup - (cost - 从 sub 实扣量)`；SQL 用更新前的值求值，并发下 subscription 池也不会为负；拒绝 `cost < 0`；写一条 `SETTLE` 类型 ledger row（`TypeSettle`，与 `TypeConsume` 并列在 `ledger.go`） | 现有 `Consume` 语义完全不变，风险隔离；`Settle` 明确就是「事后按量结算」的语义，将来别的 token 计费功能直接用 | `billing/credit` 多一个函数 + 一套并发测试；`Consume` 和 `Settle` 两个扣费入口并存，直到将来 ADR 统一 |

### E. 输入语言是否要先判断中英再分派 prompt

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| E1. 判断输入语言，中文 / 英文各一套 prompt | prompt 更针对 | 语言判断是会出错的一层逻辑（中英混杂、专有名词、单术语）；两套 prompt 要同步维护 |
| E2.（采用）不判断，一个 prompt 同时覆盖中文 / 混杂 / 蹩脚英文 | 少一层易错逻辑；同 ADR-008「不为实现细节增加分级心智」 | 单个 prompt 要写得够周全 |

### F. 改写结果要不要落库 / 收藏

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| F1. v1 就做历史 / 收藏 | 用户能回看 | 现在就要设计一张表，key 怎么定没想清楚 |
| F2.（采用）v1 不持久化 | 同 ADR-008「短语暂不落库」的克制，等真实需求出现再单独决策 | 刷新即丢——接受 |

---

## Decision

### 1. 后端 `Rephraser` 接口（采用 A2，**不改动 `Translator`**）

`aitranslate` 包内**新增**：

```go
// Rephraser 把一段中文 / 中英混杂 / 不地道的英文，改写成地道的职场美式
// 英语。方向与 Translator 相反（CN→EN），输出是结构化结果，且带回本次
// 调用的 token 用量供上层按量计费。
type Rephraser interface {
    Rephrase(ctx context.Context, input string) (RephraseResult, error)
}

type RephraseResult struct {
    Idiomatic    string        // 最自然的地道表达，必填；为空视为失败
    Alternatives []Alternative // 1–2 条不同语域的备选
    Notes        []string      // 0–4 条中文注解，每条 ≤ ~60 字
    Usage        TokenUsage    // 本次调用的 token 用量，来自 provider 响应的 usage 对象
}

type Alternative struct {
    Text     string // 备选说法
    Register string // 语域标签自由文本，如 "formal (email)" / "casual (Slack DM)"
}

type TokenUsage struct {
    PromptTokens     int
    CompletionTokens int
    TotalTokens      int
}
```

- 新工厂 `NewRephraser(ctx)` 读**同一个** `sentence-translate.provider`（复用 provider 与凭据，不新增 provider 配置）。
- **per-provider 可选实现**：`NewRephraser` 构造出配置指定的 provider client 后，用接口断言判断它是否也实现了 `Rephraser`：
  - 实现了 → 返回它。
  - 没实现（如 `provider = minimax` 但只有 `kimi` 写了改写）→ 返回明确 error `"aitranslate: provider %q does not support rephrase"`。
  - provider 未配置 → 返回 error（同 `New` 的「可选未配置」语义）。
- `enx-api.go` 照 sentence translation 的 pattern 接线：provider **显式配了但 `NewRephraser` 失败** → `os.Exit(1)`（fail fast）；**没配** → `logger.Warn` 降级，`rephraser = nil`。
- `RephraseHandler` 持有 `rephraser`（可为 nil）、一个 `RephraseLedger` 和一个 `credit.TokenPricing`（都见 Decision 5）。`rephraser == nil` → 端点 502 `{"success": false, "message": "Rephrase is not configured."}`。
- **模型**：新增 `sentence-translate.kimi.rephrase-model` 配置项，默认空 → 回落到现有 `sentence-translate.kimi.model`（`moonshot-v1-8k`）。200 字上限下 8k 够用；上限上调时该项用来单独换更大上下文的模型。

至少实现 `kimi` 一个 provider：复用现有私有 `chat(ctx, feature, systemPrompt, userContent)` helper（`feature` 传 `"rephrase_to_english"`），system prompt 要求返回 JSON（Decision 2），在 `kimi.go` 里把 JSON 解析成 `RephraseResult`，并把已有 `usage` 结构体的值填进 `RephraseResult.Usage`（这个结构体现在只记日志，本 ADR 让它真正参与计费）。

### 2. 结构化输出 + 严格 JSON + 容错解析（采用 B2）

- system prompt 要求**只**返回一个 JSON 对象：`{"idiomatic": "...", "alternatives": [{"text": "...", "register": "..."}], "notes": ["...", "..."]}`，`notes` 用中文。
- 服务端解析：先直接 `json.Unmarshal`；失败则剥掉 markdown 代码围栏（```json … ```）取第一个 `{ … }` 子串再试；仍失败、或 `Idiomatic` 为空、或 `alternatives` 为 0 条 → 视为一次失败的调用，走 Decision 5 的「失败路径」：**不扣费**、502 `{"success": false, "message": "Rephrase service unavailable."}`，**不返回半成品**（同 `aitranslate/handler.go` 的「no silent empty result」惯例）。**不重试**（重试翻倍成本和延迟，收益不值；让用户重新提交即可）。
- temperature **0.5**（比翻译的 0.3 高、比创意写作低）。

### 3. Prompt / 语域（显式功能边界 + 输出规模硬约束）

system prompt 的核心要点（措辞实现阶段定稿）：

- **角色**：你在帮一位中文母语、英语不太自信的职场人，把想表达的意思用**地道的职场美式英语**说出来。语域是「同事之间日常沟通」——Slack / Teams 消息、邮件、请人帮忙、协调进度、开会发言。既不要过度正式 / 生硬，也不要用俚语；美式职场那种**礼貌但直接**、不过度铺垫的语气。
- **输入**：可能是中文、中英混杂、或不地道的英文。一律理解其含义并输出地道表达。
- **产出**（硬约束，写死在 prompt 里）：
  - `idiomatic`：1 条最自然的地道表达，长度贴近输入。
  - `alternatives`：**1–2 条**（至少 1 条），每条不同语域，带 `register` 标签（如「更正式，适合邮件」「更随意，适合即时消息」）。
  - `notes`：**0–4 条**中文注解，**每条 ≤ ~60 字**，解释不明显的用词 / 语气选择（例如「这里用 *Could you…* 比 *Please help me…* 更自然，因为……」）。
- **禁止**（写进 ADR 是因为「帮我沟通 / 帮我在 AI 工具里表达」极易被误解成「生成提示词」）：
  - 不要写提示词，不要把用户的话扩写成给 AI / 给同事的一整套指令。
  - 不要新增用户没表达的信息、背景、需求细节。
  - 长度贴近输入；用户给一句就还一句，不要展开成一段。

### 4. 路由（采用 C2）

```
authGroup.POST("/rephrase", rephraseHandler.Rephrase)     // cognitoAuth
apiGroup.POST("/api/rephrase", rephraseHandler.Rephrase)  // cognitoAuth + Kong 前缀
```

- 请求体：`{"input": "..."}`，`input` 必填。
- **输入上限：200 中文字符**（暂定，会涨）。超出 → 400 `{"success": false, "message": "Input is too long (max 200 characters)."}`，不进 provider。前端也做同样的字符计数拦截。
- 响应：`{"success": true, "idiomatic": "...", "alternatives": [{"text": "...", "register": "..."}], "notes": ["..."]}`。token 用量不回给前端（内部计费用）。

### 5. 计费：按实际 token 计量，事后 `Settle`，允许负余额（采用 D3）

这是**全站按 token 计费基础设施的第一块**，按「可复用」设计。

**新增 ledger 原语** `billing/credit`：

```go
// Balance 返回 userID 两个池的余额之和（可能为负）。给按量计费功能在
// 调 provider 前做「有没有积分」的预检用。
func Balance(ctx context.Context, userID string) (int64, error)

// Settle 是「事后按实际用量结算」原语。写成**一条原子 UPDATE**：
//   subscription_balance -> MAX(0, subscription_balance - cost)
//   topup_balance        -> topup_balance - (cost - 从 subscription 实扣的量)
// SQL 用「更新前的行值」求值所有右边，所以并发下两个 Settle 也不会都
// 从 subscription 扣同一笔、把它扣成负数。subscription 池永不为负，
// 负数只落在 topup 池。拒绝 cost < 0。写一条 SETTLE 类型 ledger row
// （`TypeSettle`，与 `TypeConsume` 等并列在 `ledger.go`）。
func Settle(ctx context.Context, userID, feature string, cost int64) error

// TokenPricing 是 token→credit 的换算策略，放在 billing/credit（挨着
// Settle），不放在 handler 里——它是计费策略，不是 HTTP 关注点。
type TokenPricing struct{ WeightIn, WeightOut, Divisor int64 }

// Priced: Divisor > 0 且至少一个权重非 0，否则「未定价」。
func (p TokenPricing) Priced() bool

// Cost: ceil((prompt*WeightIn + completion*WeightOut) / Divisor)，至少 1。
func (p TokenPricing) Cost(promptTokens, completionTokens int) int64
```

`Consume` / `Refund` / `Grant*` 完全不动。

**计费公式**（credits 是整数，见 `TokenPricing.Cost`）：

```
cost = ceil((PromptTokens * WeightIn + CompletionTokens * WeightOut) / Divisor)   // 至少为 1
```

- `[stripe.costs.rephrase]` 新增一组：`weight-in`、`weight-out`、`divisor`。初值 `weight-in = 1` / `weight-out = 3` / `divisor = 3000`（标注「待定价复核」，跟现有 `translate-sentence = 1` 一样是占位）；环境变量可覆盖。`enx-api.go` 把这三项读进一个 `credit.TokenPricing` 传给 handler。in/out 分开加权是因为每个 LLM 供应商都按 input / output 分别计价（bedrock claude-haiku 是 input \$0.8 / output \$4 per 1M，5 倍差），全站基础设施从一开始就带这个维度。
- **配置校验**：`!pricing.Priced()`（`divisor <= 0` 或两个权重都为 0）→ 视为「未定价」，端点 502（沿用 ADR-009「不让 AI 调用免费漏过去」的约定）。

**请求流程**：

1. **预检**：`bal, err := credit.Balance(ctx, userID)`。`err` → 502。`bal < 1` → 402 `{"success": false, "message": "Insufficient credits. Top up or subscribe to continue."}`（英文 UI 文案，见 `.ai/instructions.md`；**不**沿用 `aitranslate/handler.go` 现有的中文文案）。
   > 不按输入长度预估门槛——设计意图就是「让一次请求可以冲进负数，之后挡住」。并发下多个请求可能同时过预检、把 **topup 池** 扣得更负，接受（破坏范围有界：每个请求就一次 AI 调用，且 200 字上限封了单次成本）。subscription 池不受影响——`Settle` 的原子 UPDATE 保证它永不为负。
2. **调用 provider**：`result, err := rephraser.Rephrase(ctx, input)`。
3. **失败路径**（`err != nil`，或 JSON 解析失败 / `Idiomatic` 空 / `alternatives` 空）→ **不调 `Settle`**（用户没拿到结果就不付费；provider 侧那点 token 成本我们自己吃）→ 502。
4. **成功路径** → `cost = h.pricing.Cost(result.Usage.PromptTokens, result.Usage.CompletionTokens)`（至少 1）→ `credit.Settle(ctx, userID, "rephrase_to_english", cost)`（可能把 `topup_balance` 扣成负数）。`Settle` 返回真正的 DB error → 记 `logger.Error`，**仍返回 200 结果**（调用已发生、结果已产出，扣费失败不该反噬用户体验；靠日志 + 对账补）。
5. 返回 200 结构化响应。

- **handler 的 ledger 依赖**用一个新接口表达（不复用现有 `CreditLedger`）：

  ```go
  type RephraseLedger interface {
      Balance(ctx context.Context, userID string) (int64, error)
      Settle(ctx context.Context, userID, feature string, cost int64) error
  }
  ```

  生产实现 `DefaultRephraseLedger` 是 `credit.Balance` / `credit.Settle` 的适配器（照 `aitranslate/credit_ledger.go` 现有 `creditLedgerFuncs` 的写法）；测试用 `fakeRephraseLedger`。`RephraseHandler` 持有 `rephraser` / `RephraseLedger` / `credit.TokenPricing` 三个字段，`NewRephraseHandler(rephraser, ledger, pricing)`。
- **日志**：token 数和 provider 名 provider 自己已经打了（`kimi.chat` 的 `aitranslate: usage provider=kimi feature=... prompt_tokens=...`）。handler 只补一行 provider 不知道的计费结果：`logger.Infof("aitranslate: rephrase billed feature=%s user=%s cost=%d", ...)`。不重复打 token 数、不硬编码 provider 名。

### 6. enx-ui 页面

**UI 文案一律用英文**（见 `.ai/instructions.md` Language Requirements）；唯一的例外是 `notes` 的内容——那是给中文用户看的学习注解，本来就是中文（见已确认决策 #4 与 Decision 3）。

- **路由**：`enx-ui/src/app/rephrase/page.tsx`（`'use client'`）。
- **交互**：多行 `textarea` + 字符计数（按 Unicode 码点 `[...input].length` 计，与后端 rune 一致；**超过** 200 时禁用提交并提示——正好 200 字可提交，跟后端 `> 200 → 400` 对齐）+ 提交按钮 `Rephrase`（`@tanstack/react-query` 的 `useMutation`——有成本的动作，不是 `useQuery`；进行中禁用按钮并显示 loading 文案）。
- **结果区**：
  - 地道版 `idiomatic`：突出显示（大字 / 卡片顶部），带 `Copy` 按钮。
  - 备选 `alternatives`：列表，每条显示 `register` 标签 + `text` + `Copy` 按钮。
  - 注解 `notes`：分区标题 `Notes`（英文），条目内容为中文，直接列出。
- **错误**：积分不足 / 服务不可用等，直接透传后端 `message`（后端已是英文，见 Decision 5）。
- **`ApiService` 新增方法**（`enx-ui/src/services/api.ts`，不改现有方法）：

  ```ts
  async rephrase(input: string): Promise<ApiResponse<RephraseData>> {
    return this.makeRequest<RephraseData>('/api/rephrase', {
      method: 'POST',
      body: JSON.stringify({ input }),
    })
  }
  ```

- **`types/index.ts` 新增**：

  ```ts
  export interface RephraseAlternative {
    text: string
    register: string
  }
  export interface RephraseData {
    idiomatic: string
    alternatives: RephraseAlternative[]
    notes: string[]
  }
  ```

- **`AuthWrapper.tsx`**：`grid` 里加一张卡片，标题 `Idiomatic Phrasing`（英文 UI 文案），一句英文描述，`<Link href="/rephrase">`。（「地道表达」是这个功能在 `CONTEXT.md` / ADR 里的中文术语名，不是界面上显示的文字。）
- **v1 不持久化**输入 / 输出历史（Decision F2）。

### 7. 术语（CONTEXT.md）

`CONTEXT.md` 已新增「### 界面功能（enx-ui）」小节，收录术语「**地道表达（idiomatic rephrasing）**」，`_Avoid_`：翻译 / 直译、提示词生成 / prompt generation。

### 8. 测试（`.ai/instructions.md` 的强制测试要求）

- **`credit.TokenPricing`**（`pricing_test.go`，纯单元）：`Priced()` 的 5 种配置；`Cost()` 的 ceil / 下限取 1 / in-out 权重 —— token→credit 的算术边界在这里钉死。
- **`RephraseHandler`**：`fakeRephraseLedger` + `fakeRephraser` 纯单元测试（照 `aitranslate/handler_test.go`），覆盖：
  - `rephraser == nil` → 502
  - `!pricing.Priced()`（divisor ≤ 0 / 权重全 0）→ 502
  - `Balance` 返回 `< 1` → 402（含负值）；`Balance` 报错 → 502
  - provider 返回 error → 502，**未调用 `Settle`**
  - provider 成功 → 200，`Settle` 收到 `h.pricing.Cost(...)` 的结果，且 `>= 1`
  - `Settle` 返回 DB error → 仍 200，记日志
  - 输入超 200 字 → 400，**未调用 provider、未调用 `Settle`**
  - `input` 缺失 → 400
- **`kimi.Rephrase`**：`httptest` 假 Moonshot——成功（请求体带 input、返回 `Result` + `Usage`）、非 200、解析失败向上传。
- **`rephrase.ParseResult`**（纯单元）：纯 JSON / 带 ```json 围栏 / JSON 前后有多余文字 / 非法 JSON / `idiomatic` 缺失 / `alternatives: []`。
- **`billing/credit.Settle` / `Balance`**：集成测试（对真实 DB schema，照 `billing/credit/ledger_test.go` 现有风格），覆盖 subscription 先扣、溢出到 topup、topup 扣成负数、`cost < 0` 拒绝、`cost == 0` no-op、`Balance` 负值、并发多次 `Settle` 不丢写、**并发下 subscription 池不为负**（`TestSettleConcurrentKeepsSubscriptionNonNegative`）。
- 不为 `RephraseHandler` 写 DB 集成测试（现有 `aitranslate` 也没有）。
- **enx-ui**：`api.rephrase.test.ts`（POST 到 `/api/rephrase` + 请求体、402/502 透传 message）+ `rephrase/__tests__/page.test.tsx`（RTL：空输入禁用、>200 禁用 + 计数变红、正好 200 可提交、提交 trim + 渲染 idiomatic/备选/register/注解、错误渲染、Copy 写剪贴板）。

---

## 与 ADR-009 的关系

ADR-009 Decision 4 定的是「每功能**固定成本**，不按 token 计量」。本 ADR **不是推翻它，而是给它铺下一步的地基**：

- rephrase 是**第一个**按实际 token 计费的功能。`credit.Settle` / `credit.Balance` 原语和 `[stripe.costs.rephrase]` 的 in/out 加权公式，都按「将来别的功能能直接复用」设计，不是 rephrase 私有。
- `translate_sentence` / `translate_word_in_context` **不受影响**，仍走 `credit.Consume` + 固定 1 积分/次。系统里从此**同时有两套扣费入口**（`Consume` 固定成本 / `Settle` 按量），这是过渡态。
- 当足够多的功能迁到 `Settle` 之后，需要**一份新 ADR** 来决定：要不要把 `translate_*` 也迁过去、要不要退役 `Consume` 的固定成本路径、负余额的产品策略（宽限额度？欠费阈值断服？）。那份 ADR 会引用本 ADR 作为机制的出处。
- `kimi.go` 里「先量 token 再定换算比例」的 TODO，本 ADR 为 rephrase 兑现；翻译功能的 token 计量仍未决。

---

## Rationale

- **A2 而非 A1**：用户已明确不改现有接口。且 `Translator` 一旦加方法，`bedrock` / `minimax` 必须立刻实现一个方向、输出、计费都不同的方法。A2 复用真正该共享的东西（HTTP client、鉴权、config 命名空间、`chat` helper），不共享不该共享的（接口契约）。
- **A2 而非 A3**：新包要把 provider client 构造、config 读取、用量日志再抄一遍；同包姊妹接口能直接调现有 provider 的私有 `chat` helper。
- **B2 而非 B3 / B1**：透传 markdown 把「输出长什么样」交给 prompt 微调，前端无法稳定渲染三块、无法给单块加「复制」按钮——而复制走某条说法正是核心动作。三条平铺字符串则表达不了「备选几条、每条什么语域」。
- **D3 而非 D2**：D2 的「预扣 → 对账补扣」在现有 ledger 上根本走不通（`Consume` 不能扣负、拒绝 `cost<=0`）。就算给它加负数能力，预估也是一层会错的复杂度——而 200 字输入上限让 prompt token 又小又有界，预估几乎没有收益。D3 直接「事后按实际扣」，精确、无预估、无对账。
- **D3 而非 D1**：用户要按实际用量计费，且这次要顺带把「全站按 token 计费」的地基铺下去，固定成本铺不了。
- **新增 `Settle` 而非改 `Consume`**：改 `Consume` 会立刻改变翻译功能「余额不足硬 402」的行为，要全套回归，还动了 ADR-009 的反超支设计。`Settle` 是干净的新语义（事后按量结算），风险隔离，且明确是给将来复用的。
- **预检只查 `balance >= 1`、允许一次冲进负数**：这正是用户的心智模型——「有积分就能发，发完这次扣穿了，下次就发不了」。按输入长度做精确门槛反而引入预估逻辑，得不偿失。
- **失败路径不扣费**：沿用现有 handler「service failure shouldn't cost the user」的惯例。provider 侧的 token 成本我们自己吃，是可接受的小额损耗。
- **`Settle` 失败仍返回 200**：调用已经发生、结果已经产出，扣费的 DB 写失败不该反噬用户拿到的结果；靠 `logger.Error` + 事后对账兜。
- **E2 而非 E1**：语言判断是会出错的一层逻辑；同 ADR-008「不为实现细节增加分级心智」。
- **F2 而非 F1**：同 ADR-008「短语暂不落库」。
- **显式记录「不是提示词生成器」**：用户的背景（跟同事沟通、在 AI 工具里表达）让这个功能极易被后来者往「提示词优化」方向做。把边界钉进 ADR 和 prompt。

---

## Consequences

### Positive

- **现有代码零改动**：不动 `Translator`、`/translate/*`、现有计费键、`credit.Consume`。新增点集中在 `Rephraser` 接口 + `kimi` 的一个实现 + 一个 handler + `credit.Settle`/`Balance` + 一个前端页面；对既有文件只有「`enx-api.go` 加装配 / 路由行」「`config.toml` 加一组常数 + 一个 `rephrase-model` 项」「enx-ui 加一个方法 / 一个类型 / 一张卡片」这些纯增量改动。
- 复用面大：provider client + 鉴权 + `sentence-translate.*` 配置 + `chat` helper + 两池 ledger + enx-ui 的 `ApiService`/React Query/shadcn 卡片。
- 计费流程比「预估 + 对账」简单：无预估、无差额、无退款；一条 `Settle`。
- **`Settle` / `Balance` 是可复用的全站按 token 计费地基**，不是一次性代码。
- 结构化输出让前端能给地道版和每条备选单独加「复制」按钮。
- 「不是提示词生成器」的边界被显式记录在 ADR 和 prompt 里。

### Negative

- **系统首次出现「负余额」状态**：`/billing` 页面（`enx-ui/src/app/billing/`）和 `billing/handler.go` 的 `Me` 要能正确显示负数；`GrantTopup`（`topup_balance += amount`）对负起点是对的（充值自然回填）。`GrantSubscription` 是**替换** `subscription_balance`，一个负的 subscription 会在续费时被静默抹掉——所以 `Settle` 用单条原子 UPDATE 把负数**严格限制在 topup 池**，subscription 池即使并发下也不为负（`TestSettleConcurrentKeepsSubscriptionNonNegative` 钉死这条）。
- **并发可以把 topup 池冲得更负**：多个请求同时过 `balance >= 1` 预检、各自 `Settle`。有界（每个就一次 AI 调用 + 200 字成本上限），但一个用户拿 1 积分并发几发能白嫖有限几次。
- **两套扣费入口并存**：`Consume`（固定）和 `Settle`（按量）。读账要知道看哪个，直到将来 ADR 统一。
- 结构化 JSON 依赖 LLM 稳定返回合法 JSON；`moonshot-v1-8k` 偶尔带 markdown 围栏 → 容错解析，仍失败则 502 且不扣费（provider token 成本我们吃）。
- `sentence-translate.*` 配置命名空间现在同时服务「翻译」和「改写」，名字偏窄——接受，留 Revisit Trigger。
- 每个 provider 要单独实现 `Rephrase`；配 `minimax` 但只有 `kimi` 实现时，改写端点 502 而翻译正常——启动日志要能看出来。
- 语域固定为「职场同事沟通」，非职场场景不适用——刻意的产品聚焦。
- 200 字上限对「一整段需求描述」偏紧——已知，暂定，会涨。
- v1 无历史记录，刷新即丢——接受（F2）。

### Mitigation

- 容错解析 + 502 复用现有「不静默返回半成品」通道，enx-ui 的错误渲染路径已存在（`lookup/page.tsx` 的 `error` 分支是范例）。
- `cost` 进日志，上线后用真实数据校准 `weight-in` / `weight-out` / `divisor`。
- `billing/credit.Settle` / `Balance` 配套并发 + 负值集成测试（Decision 8），把负余额相关的行为钉死。
- 启动时若配置的 provider 未实现 `Rephraser`，`NewRephraser` 返回明确 error，`enx-api.go` 照 sentence translation 的 pattern fatal / warn。

---

## Revisit Trigger

- **上线后用真实 `cost` 日志复核 `weight-in` / `weight-out` / `divisor`**，把单次典型调用校到目标积分数。
- **输入上限上调时**：复查所配 provider / 模型的上下文窗口，必要时给部署配 `sentence-translate.kimi.rephrase-model`（更大上下文的模型）；同时重新评估 200 字上限撑起 token 计费复杂度的性价比是否变化。
- **负余额的产品策略**：如果用户欠费额度变大成问题，需要决定宽限阈值 / 欠费断服规则——单独小决策。观察 `/billing` 页面负数展示是否需要专门 UI。
- **当 ≥ N 个功能迁到 `Settle` 按量计费**：发新 ADR 决定要不要把 `translate_*` 也迁过去、退役 `Consume` 固定成本路径、统一两套扣费入口（修订 ADR-009）。
- 用户反馈「想回看 / 收藏之前优化过的说法」→ 回到「结果要不要落库」（F2），想清楚 key 怎么设计。
- 如果 EN→CN 和 CN→EN 的 provider / 定价需求分叉，把 `sentence-translate.*` 拆成 `translate.*` + `rephrase.*` 两个配置命名空间。
- 如果「把中文需求变成能直接粘给 AI 工具的东西」这个诉求变强，那是另一个功能（提示词 / 需求结构化），需要单独 ADR——**不要**把本功能的 prompt 往那个方向漂（见 Decision 3 的禁止项）。
- 如果前端想给不同 `register` 上不同颜色 / 图标，把 `Alternative.Register` 从自由文本改成固定枚举，需要一次小决策（后端 prompt 也要约束枚举值）。
- 如果 LLM 返回 JSON 的失败率实测过高，考虑改用 provider 的 JSON mode / function calling。
- 如果本功能对 enx-chrome 也有价值（在网页上选中中文注释 / 中文文档就地要地道英文说法），复用 `POST /api/rephrase` 即可，但侧边栏展示形态需另评估。
