# ADR-045：有资格的用户（订阅有效或有充值余额）点击查词在 `words` 与 ECDICT 都未命中时，把**单个词**（不带句子）发给 AI 兜底——AI 同时打质量分，高分结果直接写入 `words`（`source='ai'`），按 token 扣积分，AI 释义只对有资格的用户可见（管理员编辑过的除外）；仅充值用户的自动 AI 默认关、可手动「用 AI 查询」；免费用户点这个入口会被引导去订阅或充值；浮层显示 AI 状态、不提供取消

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-10-01（维护者审阅全文通过；维护者在讨论中逐条确认了下列决定；本文据此起草，待维护者审阅。**它部分取代 ADR-030 的 Decision 5、Decision 6 与 Options D2**，见 Decision 0） |
| **日期** | 2026-09-30 |
| **关联** | [`adr-030-dictionary-provider-chain-and-fallback-sources.md`](adr-030-dictionary-provider-chain-and-fallback-sources.md)（provider 链；本文取代其中 AI 兜底的存储与计费部分）、[`adr-044-server-side-user-preferences.md`](adr-044-server-side-user-preferences.md)（开关）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（`Resolve` 是唯一查词入口）、[`adr-024-word-context-dictionary-first-why.md`](adr-024-word-context-dictionary-first-why.md)（句内释义，不变）、[`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（按 token 计费）、[`adr-021-enx-ui-admin-dictionary-maintenance.md`](adr-021-enx-ui-admin-dictionary-maintenance.md)、[`adr-026-user-reported-definition-issues.md`](adr-026-user-reported-definition-issues.md)、[`adr-043-words-english-case-insensitive-unique.md`](adr-043-words-english-case-insensitive-unique.md) |

---

## Context

点击查词时，`words` 与 ECDICT 都没有这个词，今天用户得到的是「未找到」。`dictionary.Service.Resolve`（`enx-api/dictionary/resolve.go`）把这种情况返回为 `SourceMiss`，链上没有下一级。

ADR-030 早就把「AI 兜底」设计成链尾，但它的存储与计费方案（独立的 `ai_definitions` 候选表、永不回写 `words`、走积分的 D2）是在**没有打分机制**、**积分系统尚未落地**时定的。现在两点都变了：

- 维护者决定让 AI **自己判断词的质量**，高分直接进缓存，让其他用户也能用。
- 积分系统（ADR-009/012/014）已合并，`aitranslate` 里有成熟的「先查余额 → 调用 → 按真实 token 结算」流程（`billedCall`）。

### 已确认的范围与取舍

- **只做点击查词**，**只发一个词**，**不发句子**。句内含义仍然只在侧栏里看（ADR-024，不变）。
- 讨论中曾考虑「连句子一起发」，结论是**不发**：见 Decision 2。
- **有资格**的用户才能用：订阅有效，**或**充值余额 > 0（与现有 AI 功能按余额放行的做法一致，详见 Decision 14）。自动 AI 的默认值：订阅用户开，仅充值用户关。**AI 生成的释义也只对有资格的用户可见**，不共享给没资格的免费用户：共享会稀释付费的价值（Decision 6）。
- 免费用户在词典未命中处会看到一个「用 AI 查询」的入口，点击引导去订阅或充值（Decision 10）。
- AI 释义要进生词本，和普通点击查词一样。

## Options Considered

### A. 发什么给 AI

| 方案 | 结论 |
| --- | --- |
| A1. 词 + 句子，返回句内含义，只展示不缓存 | 能给到最贴切的含义，但**每次都花钱、没有任何复用**；且句子来自任意网页，是不可信输入 |
| **（采用）A2. 只发词，返回无语境的词典式释义，可缓存** | 同一个词全站只付一次；输入只有一个过了正则的词，注入面几乎为零；句内含义由侧栏接力 |
| A3. 一次调用同时返回词典义和句内义 | 缓存的那一份被句子「污染」；注入也能影响缓存。**否决** |

### B. 结果缓不缓存、缓存到哪

| 方案 | 结论 |
| --- | --- |
| B1. 永不进 `words`，进独立候选表等管理员处理（ADR-030 原方案） | 安全，但**每个新词的每个用户都要重新调 AI**，直到管理员处理——成本与延迟都高 |
| B2. 一律写入 `words` | 乱码、恶意输入会污染全站可见的缓存。**否决** |
| **（采用）B3. AI 同时返回「是不是词」和质量分，达标才写 `words`** | 缓存质量由一道闸门把关；不达标的仍然展示给当事用户，只是不入库。局限见 Decision 6 |

## Decisions

0. **与 ADR-030 的关系：本文取代它的这几处，其余不变。**

   | ADR-030 | 本文 |
   | --- | --- |
   | Decision 0 的 miss 率闸门（>5% 才启动 AI 兜底） | **豁免**：维护者决定这是付费用户的体验功能，不以 miss 率为前提。采样埋点（`ECDICT_SAMPLING`）仍可开着，用来**预估成本**，不再当闸门 |
   | Decision 5：`words` 不接纳非 ECDICT 来源的行 | **改为**：`words` 接纳 `source ∈ {ecdict, ai}`，另加 `admin_edited_at` 记录是否被管理员改过（见 Decision 6） |
   | Decision 6：`ai_definitions` 候选表、永不自动回写 `words` | **取代**：无独立候选表；达标即写入 `words`，管理员事后按 `source='ai'` 筛查纠错 |
   | Options D2：AI 兜底走 ADR-009 积分、缓存命中不扣 | **采用并细化**：按 token 结算（Decision 7） |
   | Wiktionary（G2：独立表）、WordNet 只喂 AI、Decision 8（短语） | **不变**；Wiktionary 日后插在 ECDICT 与 AI 之间，无需改动本文 |

   ADR-043 里「`words` 只缓存 ECDICT」的表述同样以本文为准。

1. **范围（v1）：仅 enx-chrome 查词浮层里点击单个词，且 `Resolve` 返回 `SourceMiss`。**
   - **`SourceTimeout` / `SourceError` 不触发 AI。** 那是 ECDICT 慢或坏了，不是词不存在，用 AI 顶上既掩盖故障又花钱。
   - 不含：短语、拖选、整句、侧栏、paste reader、iOS（它们以后可复用同一接口，各自再决定）。

2. **只发词，不发句子。** 因此服务端**不需要知道用户在读的那句话**，也就没有「核对句子里确实包含这个词」的步骤（讨论中提过，v1 不需要）。这同时是防注入的核心：见 Decision 9。

3. **链上位置与两段式请求。**

   ```
   words → ECDICT →（Wiktionary，预留）→ AI
   ```

   - **第一个请求**：现有查词接口，行为不变。未命中时响应里加 `aiFallback: { canUse: bool, auto: bool }`。`canUse = 有资格（Decision 14）&& 已配置 AI`；`auto = canUse && effective(aiWordFallback)（ADR-044）`。**由服务端算，客户端只看这两个字段。**
   - **第二个请求**：`POST /api/dictionary/ai-word`，body `{ "word": "..." }`。`auto: true` 时扩展自动发；`canUse: true` 而 `auto: false` 时，用户点浮层里的「用 AI 查询」才发。**没有取消**（Decision 7）。
   - 实现落在 `dictionary` 包里，**与 `Resolve` 同属 `dictionary.Service`**（ADR-018：用户查词只经这一个入口）。AI 通过构造函数注入的接口 `WordDefiner` 提供，单元测试用 fake，不碰真实模型。
   - **配额**：第一个请求已按 ADR-018 B2 计过一次，**第二个请求不再调用 `Meter`**。（维护者说多记一次也无所谓；代码上分得开，就只记一次。）

4. **输入门槛（调 AI 之前）。** 经 ADR-043 的规范化（直撇号）后，必须匹配：

   ```
   ^[A-Za-z]+(?:['-][A-Za-z]+)*$      且长度 ≤ 40
   ```

   即：**只允许字母，撇号与连字符只能出现在字母之间**，不含空格、数字、换行与其他控制字符。**v1 只支持 ASCII 字母**（带重音的词如 `Bézier` 暂不支持，列入 Revisit）。不符合则不调 AI，直接按未命中处理，也不扣费。

5. **强制结构化输出，解析失败等同未命中。** 模型被要求只返回：

   ```json
   { "is_word": true, "quality": 0-10, "senses": [ { "pos": "n.", "zh": "…" } ] }
   ```

   - 服务端解析并校验：能解析、`senses` 至多 6 条、每条 `zh` 不超过 80 字符且含中文、不含 `<`、URL 与 markdown 标记。任何一项不满足 → 当作未命中，不缓存。
   - `chinese` 字段由服务端按 ECDICT 同样的「词性 + 释义，每行一条」格式拼出，**模型不能直接决定入库文本的格式**。
   - **音标 v1 不要。** 模型编的 IPA 不可靠（ADR-030 同样的立场），`pronunciation` 留空。词性与中文释义则可以放心要。

6. **打分与缓存。**

   - **`is_word = true` 且 `quality ≥ 阈值`**（配置 `ai_word_cache_min_quality`，初值 8，**是猜测值，上线后按数据调**）：写入 `words`，`source='ai'`，同时按普通查词流程记入 `user_dicts`（生词本）。因为有了 `words.id`，这条路径与 ECDICT 命中完全一样。
   - **`is_word = true` 但分数不够**：展示给当事用户，**不入库**，没有 `words.id`，所以不进生词本（`Resolve` 对「无法缓存」本来就有这条分支：`ID` 为空则跳过复习记账）。
   - **`is_word = false`**：按未命中处理，浮层显示「AI 也没有这个词」。
   - **库表变更**（GORM AutoMigrate：改 `sqlitex.Word` 与 `repo.Word` 两个 model，不写 SQL 迁移文件；下面的 SQL 只说明列的含义。`source` 与 `admin_edited_at` 已随第一步实现，`ai_quality` 与 `ai_prompt_version` 随 AI 兜底后端加）：

     ```sql
     ALTER TABLE words ADD COLUMN source            TEXT    NOT NULL DEFAULT 'ecdict';  -- 'ecdict' | 'ai'：词最初从哪来，之后不变
     ALTER TABLE words ADD COLUMN admin_edited_at   INTEGER;  -- NULL = 管理员从未改过；否则是最近一次编辑的 Unix 毫秒
     ALTER TABLE words ADD COLUMN ai_quality        INTEGER;   -- 仅 source='ai'
     ALTER TABLE words ADD COLUMN ai_prompt_version TEXT;      -- 仅 source='ai'，改提示词后据此批量作废
     ```

   - **⚠️ 诚实说明这道闸门的能力边界。** 让模型给自己的输出打分，**能挡住乱码和明显的非词，挡不住「一个像样但不存在的词，模型自信地编了释义」**。所以不能只靠分数，叠加四道缓解：
     1. 输入门槛（Decision 4）把可入库的输入限制在「词形」。
     2. `source='ai'` 的行**永久带 AI 标记**展示（Decision 10），用户知道它不是词典权威内容。
     3. 管理员在 ADR-021 的词典维护页按 `source='ai'` 且 `admin_edited_at IS NULL` 筛选、按 `load_count` 排序，修订或删除；用户可经 ADR-026 的入口报告。**⚠️ ADR-021 现在只有查看、删除、从 ECDICT 重新同步，没有「编辑词条文本」的接口**，所以要新增 `PUT /api/admin/words/:word`，它写 `chinese` / `pronunciation` 并设 `admin_edited_at`。`sync-from-ecdict` 把行重置回 ECDICT 内容时，同时把 `admin_edited_at` 清空。
     4. **按用户限制每日「写入 `words`」的次数**（Decision 8），一个账号无法批量灌入。
   - **`source` 与 `admin_edited_at` 是两个正交的字段**（维护者的设计）：`source` 记录词**最初**从哪来（ECDICT 或 AI），`admin_edited_at` 记录管理员**是否改过**。一行 AI 释义被管理员改过，仍然是 `source='ai'`、`admin_edited_at` 非空；ECDICT 词条被管理员订正，是 `source='ecdict'`、`admin_edited_at` 非空。这比把「管理员」当成第三种来源更好：来源信息不丢，审阅状态单独可查。
   - **打分要对模型说清楚含义：`quality` 是「你对这条释义**正确**有多大把握」，不是「值不值得缓存」。** 并明确允许它回答「不是词」或「我不认识这个词」。模型对「这是乱码 / 拼写错误」通常判断得很可靠；真正容易出错的是**真实但生僻的词被给了一条自信的错误释义**，这是任何用 LLM 做词典都有的风险，分数只能部分缓解，主要靠 AI 标记、用户报告与管理员筛查。
   - **可见性：AI 生成的释义只对有资格的用户可见。** 规则（维护者确认）：
       - **不具备资格的用户**查 `words` 时，**排除** `source='ai' AND admin_edited_at IS NULL` 的行；**有资格的用户不排除任何行**。
       - 排除不是在 `Resolve` 里命中后再丢弃，而是**放进 `WordStore.Find` 的查询条件**（参数 `includeAI bool`，由 `Resolve` 根据资格传入），免得被隐藏的行在代码里被读出来、再被别处误用。
       - 被排除的行等于 `words` 未命中，继续查 ECDICT；**不会触发 AI**，因为这类用户本来就没有 AI 功能。所以隐藏不会导致重复生成或覆盖已有的行。
       - 对**所有用户**，`words`（可见的行）或 ECDICT 命中，就**不会走 AI 兜底**；AI 只在两者都未命中、且用户有资格并开启时才发生。
       - 资格判断用构造函数注入的 `Entitlements` 接口，和 `Meter` 一样便于在单元测试里替换。
     - 理由：AI 兜底是付费的价值点；释义一旦入库就等于「已付过一次成本」，若再免费共享，付费用户的专属体验就没有了。**调用资格与可见资格必须是同一个判断**：否则能调 AI 的人会为一个已存在却被隐藏的词反复付费（行已存在，无法再次入库）。
     - 这条规则**同时缩小了污染的范围**：一条错误的 AI 释义在被管理员处理之前，只有有资格的用户看得到。
     - **管理员编辑过的行对所有用户可见**（维护者确认）：管理员既可能订正 ECDICT 的内容，也可能订正 AI 的内容。编辑过的 AI 行已经经过人工审阅，是词典内容而不是 AI 内容，开放给免费用户不稀释订阅价值，也让管理员的维护工作惠及所有人。因此隐藏条件只有「`source='ai'` 且未被编辑」这一种。
     - 资格失效的用户（订阅过期且充值余额为 0）：该规则在**查词时**实时判断；他们已在生词本里的词不受影响。
   - **本地命中优先，所以 AI 行不会遮蔽 ECDICT。** `Resolve` 先查 `words`；只有 ECDICT 也没有的词才会被 AI 写入。若 ECDICT 将来收录了，管理员删掉 AI 行即可。

7. **计费：按 token 结算，沿用 ADR-014 的 `billedCall` 约定。**

   - 先查余额：`< 1` 返回 402，浮层显示「积分不足」并链接到账单页。
   - 调用失败**不扣费**；成功后按真实 token 数结算，feature 名 `lookup_word_ai`。定价项未配置按现有惯例返回 502。
   - **不提供取消，服务端也不因客户端断开而中止。** 请求一发出就视为已开始：服务端用脱离请求的 `ctx`（`context.WithoutCancel` 加服务端超时）去调 AI，客户端关掉浮层、点了别的词、关了标签页，调用照常完成、结算、入库。这样「扣不扣积分」没有中间状态：**调用成功就扣，失败就不扣**。用户没看到结果也不亏：词已经缓存，下次点它是即时命中。
   - **AI 回答「不是词」也扣**——模型确实调用了、token 确实用了，而且这正是对乱码输入的天然约束。词级提示词很短，单次成本很小。
   - **缓存命中不再扣 AI 积分**，只照常占查词配额。
   - **没有资格的用户看不到 AI 生成的释义**（Decision 6 的可见性规则）；有资格的用户之间共享。
   - 实现提示：`billedCall` 现在是 `aitranslate.Handler` 的方法。这个接口需要同样的流程，实现时把它抽成两处共用的小组件，不要复制一份。

8. **限流（单独于查词配额）。**

   | 限制 | 目的 |
   | --- | --- |
   | 每用户每分钟 AI 调用数 | 挡脚本；超限返回 429，浮层退回普通「未找到」 |
   | 每用户每日 AI 调用数 | 成本安全阀 |
   | 每用户每日**写入 `words`** 数 | 防止单账号批量污染缓存（Decision 6 的第 4 道缓解） |

   数值是**配置项，初值为猜测**，与 ADR-029 同一原则：安全阀要高到正常阅读碰不到，上线后收集数据再调。

9. **提示词注入防护：缩小爆炸半径，不依赖检测器。**

   这个场景里模型**没有工具、接触不到密钥与用户数据、输出只是一段要显示的文本**，所以防护的重点是限制它能说什么，而不是识别它被骗没有。

   1. **唯一的输入是过了 Decision 4 正则的单个词。** 没有句子、没有网页内容，所以「网页里藏指令」这条路在 v1 不存在。
   2. **缓存的内容只由一个受限词生成。** 防止「构造输入 → 污染全站可见的缓存」，这是 Decision 2 与 A2 的核心理由。
   3. 提示词里把词放在明确的数据分隔内，并说明那只是待查的词、不是指令。
   4. 输出强制 JSON、服务端校验长度与内容、入库文本由服务端拼装（Decision 5）。
   5. 前端与管理员页一律**当纯文本渲染**，不当 HTML。
   6. **不引入第三方检测库，也不用 Bedrock Guardrails。** 后者与具体供应商绑定，而后端 AI 可由管理员换。词形门槛 + 结构化输出 + 无工具，对「只返回一条词典释义」的功能比检测器更有效，且没有误杀和额外延迟。
   7. 「把它当成免费 LLM 代理」的担忧：接口只接受单个词，输出只能是上述 JSON，**问不出别的东西**；它还要付费、扣积分、有限流，所以不构成实际风险。
   8. 此条在**将来**给 AI 加工具、或开始发送句子时必须重新评估（见 Revisit）。

10. **浮层的状态与入口。** 不需要细分层级：`words` 与 ECDICT 对用户是内部词典，不展示「哪一级没命中」。**不提供取消**（Decision 7）。

    | 阶段 | 浮层显示 |
    | --- | --- |
    | 词典未命中，`auto: true` | 「词典中没有，正在用 AI 查询…」 |
    | 词典未命中，`canUse: true` 且 `auto: false`（订阅用户关了自动 AI，或仅充值用户） | 普通「未找到」+ 按钮 **「用 AI 查询」**：用户主动点击才发第二个请求，随后进入上一行的状态。这是用户的主动操作，所以不叫「自动」 |
    | 词典未命中，`canUse: false`（免费用户） | 普通「未找到」+ 带锁或 Pro 标记的按钮 **「用 AI 查询（订阅或充值后可用）」**：点击在**新标签页**打开账单页（复用 `SidePanel.tsx` 已有的打开账单页做法），链接带 `?src=lookup-miss` 供统计转化，**不带单词**；不发 AI 请求，不占查词配额 |
    | 成功 | 释义 + 明显的 **AI 标记**；这个标记**就是永久入口**，点开有「以后不再自动使用 AI」 |
    | 402 | 「积分不足」+ 账单页链接（订阅用户当期积分用完、仅充值用户余额不足都走这里） |
    | 429 / 502 / 解析失败 / `is_word=false` | 退回普通「未找到」（`is_word=false` 时文案为「AI 也没有这个词」） |

    - **免费用户的按钮要诚实**：标明「订阅或充值后可用」，不做成看起来会直接查、点了才发现跳走。点击后**不会自动续查**：用户订阅或充值后回到页面，再点一次即可。
    - **关闭入口：[不再自动使用 AI]**，就地 `PUT /api/me/preferences { aiWordFallback: false }`（ADR-044），不跳转。仅在 `auto` 当前为 true 时显示（对仅充值用户它本来就是关的）。用户随时可在 Options 页或 enx-ui 设置页重新打开。
    - **首次提示与永久入口是同一个开关，分两层：**
      - **首次**（每个账号一次，自动或手动的第一次 AI 查询都算）：因为会把用户点的词发给第三方，在浮层里显示一行较醒目的提示「该词由 AI 查询，只发送这个单词」；`auto` 为 true 时**同一行带「不再自动使用 AI」**。看过之后，`aiWordFallbackNoticeAck` 记为已读（ADR-044 的第二个偏好，存服务端，换设备不重复提示）。
      - **之后每一次**：不再展示提示，也**不在每次未命中时额外塞按钮**；入口收在 AI 标记里（见上表）。这样界面保持干净，同时关闭入口始终在结果旁边，不用去翻设置。
    - **AI 标记不只在首次生成时出现**：之后任何有资格的用户命中这行 `source='ai'` 的缓存，浮层同样显示它。因此查词响应带 `origin`（取自 `words.source`），`origin == 'ai'` 时显示标记。

11. **生词本。** 达标入库的词与普通点击查词一样进 `user_dicts`（Decision 6）；不达标的不进。复习功能本身尚未实现，不在本 ADR 范围。

12. **隐私与法务。** 发给 AI 服务商的只有这一个词：不含句子、URL、用户标识。隐私政策与服务条款（`enx-ui/src/app/privacy`、`terms` 及 `zh/` 对应页）用「AI 服务商」措辞，**不写具体供应商名**（后端可能更换），并列入 LAUNCH-CHECKLIST §6.2 同批。

13. **观测。** 沿用 ADR-040 的指标：按结果（命中缓存、AI 成功入库、AI 成功未入库、非词、解析失败、限流、402）计数，并给 `dictsample` 增加 `SourceAI`，使 miss 率口径里「AI 兜住了多少」可见。

14. **资格：谁能用 AI 兜底、谁能看到 AI 释义。** 一个判断管三件事（能不能调、能不能看缓存、设置里的开关能不能改）：

    ```
    有资格 = 订阅有效  或  充值余额（credit_accounts.topup_balance）> 0
    ```

    - **为什么包含充值用户**：现有的 AI 功能（`billedCall`）只要求余额 ≥ 1、不看订阅，充值用户本来就能用；用户也希望「订阅或一次性充值都能用」。
    - **为什么调用资格与可见资格要相同**：见 Decision 6。
    - **「能用」与「默认开」分开：**

      | 用户 | 能用 AI 兜底 | 自动 AI 默认 | 能看到 AI 行 | 未命中处的按钮 |
      | --- | --- | --- | --- | --- |
      | 订阅用户 | 是 | **开** | 是 | 自动关掉后：「用 AI 查询」 |
      | 仅充值用户 | 是 | **关**（可在设置里打开） | 是 | 「用 AI 查询」 |
      | 免费用户（无订阅、余额为 0） | 否 | 关且不可改 | 否 | 「用 AI 查询（订阅或充值后可用）」→ 账单页 |

      仅充值用户默认关，是因为他们买积分可能是为了翻译；不要在他们不知情时给每个未命中的词扣一点积分。他们要用就点按钮，或在设置里打开自动。
    - 订阅用户当期积分用完、充值也为 0 时，仍是「有资格」（订阅有效），调用时返回 402，浮层提示充值。
    - 实现：`Entitlements` 接口提供 `CanUseAI(ctx, userID)`；`Resolve`、AI 接口、偏好的 `editable` 都经过它，**不要在三处各写一遍判断**。

## Consequences

**正面**

- 有资格的用户在词典没有的词上不再碰壁；同一个词全站只付一次 AI 成本，随后所有有资格的用户零成本命中。
- 输入只有一个受限的词，注入面小；缓存内容由服务端拼装。
- 无独立候选表，少一套审核队列，复用 ADR-021 的词典维护页（需新增编辑接口）。
- 付费的价值点不被稀释：AI 释义只对有资格的用户可见；免费用户在未命中处有一个明确的订阅或充值入口，且出现频率低（ECDICT 有 340 万条），不会成为打扰。

**负面 / 风险**

- **模型自评分挡不住「自信的假词」**（Decision 6）。缓解靠 `source='ai'` 标记、管理员事后纠错与写入限额；若线上出现，调高阈值或改为人工确认再入库。
- **`words` 不再只放 ECDICT 与人工订正。** 凡假设「`words` 全是词典数据」的地方（统计、导出、ADR-003 的 mastery 假设）要核对。这是实现前的待核实项。
- 乱码输入被重复提交会重复调用 AI（不记「否定缓存」）。用户为此付费，且有限流；若实际出现滥用再加。
- 两个用户同时首查同一个新词，会各调一次、各扣一次，`words.english` 的唯一索引只留一行（与 ADR-030 记录的缺口同类，和 [#15](https://github.com/wiloon/enx/issues/15) 一并处理更划算）。
- 有资格与没资格的用户对同一个词可能看到不同结果，`Resolve` 因此多了一个资格依赖，要有对应的测试。
- 每个 AI provider（bedrock、deepseek、gemini、kimi、minimax、openrouter）都要支持「定义一个词」这个调用，或抽出共用的提示词与解析层。实现时先看 `sentenceword` / `wordcontext` 是怎么共用的。

## Test Plan

遵循仓库约定：功能改动带测试，单元测试为主，真实库或完整 HTTP 流程用 `//go:build integration`。

- **先量覆盖率**（`go test -cover ./dictionary`），对 `Resolve` 现有未覆盖行为补特征化测试，再改。
- 单元（fake `WordDefiner`，不碰真实模型）：输入门槛的表驱动用例；输出校验的畸形输出用例（非 JSON、超长、含 HTML/URL、`senses` 为空）；打分三分支（入库 / 仅展示 / 非词）；`SourceTimeout`、`SourceError` 不触发 AI；402、429；客户端中途断开后服务端仍完成、结算并入库；不具备资格的用户对「`source='ai'` 且未被管理员编辑」的行视为未命中，对管理员编辑过的行则命中；资格判断的四种情形（订阅、仅充值、两者都没有、订阅过期且余额为 0）；`canUse` / `auto` 的各种组合对应的响应。
- 偏好：未知 key、类型不符、不可编辑、资格失效后 `effective` 为 false、仅充值用户的默认值为 false（ADR-044）。
- 集成：未命中 → AI → 入库 → 第二个用户命中缓存且带 `origin: ai`；达标词进入 `user_dicts`。

## Out of Scope

- 短语、拖选、整句、侧栏、paste reader、iOS 的 AI 兜底。
- 句内含义（仍是 ADR-024 / 侧栏）。
- Wiktionary（预留位置，不在本 ADR 实现）。
- 否定缓存、复习功能、IPA、带重音的词。
- 给免费用户更具体的提示文案（「这个词已有 AI 释义，订阅后可见」）：要让 `Resolve` 多返回一个「被隐藏」状态，之后再说。
- **取消按钮**（不做，见 Decision 7：请求发出即视为已开始，扣费无中间状态）。

## Revisit Triggers

- 出现被入库的假词 → 提高 `ai_word_cache_min_quality`，或改为「先进队列、人工确认再入库」。
- 要把句子发给 AI，或给 AI 加工具 → **整个 Decision 9 重新评估**，并重读 ADR-026 的「不自动采集句子」。
- 需要支持带重音的词（`Bézier`、`café`）→ 放宽 Decision 4 的正则，同时核对 ADR-043 的规范化。
- 乱码被重复提交造成明显成本 → 加否定缓存。
- 要把 AI 兜底扩展到短语 → 先读 ADR-030 Decision 8 的三条护栏，并核实 `words` 里多词条目对高亮与复习的影响。
