# ADR-030：查词从「单源 ECDICT」改为「有序 provider 链」——先测 miss 率再决定加不加源；Open English WordNet **只进 AI 提示词、不直接展示**（不依赖测量，直接做）；Wiktionary 若采纳则**自建一张与 `words` 同层的独立缓存表**，靠表的物理隔离解决 CC BY-SA 的边界问题；AI 兜底的结果**落管理员候选队列、永不自动回写 `words`**，`enx.Dictionary` 与 `words` 加 `source` 字段；**短语查词从「直接进 AI」改为「词典优先 + 两阶段」**（落点在前端 `upsertPhraseCard`，不是 `isSentence`）

| 字段 | 值 |
| --- | --- |
| **状态** | **Proposed — 2026-09-17。本次未写任何代码。** 2026-09-17 第一轮讨论后修订：Decision 0（先测量）、Decision 3（WordNet 喂 AI）、Decision 6（AI 结果落候选队列、不回写 `words`）、Options G（独立缓存表）**已获用户确认**；2026-09-17 补充确认：**AI 释义当场展示给用户**（审核因此降级为事后纠错），存储形态见 Decision 6 的 `ai_definitions` 表设计。**2026-09-17 第二轮：用户接受 CC BY-SA 的署名标注，并确认采纳 Wiktionary 作为备用源（因此来源展示锁定为 E2）——文末三个待确认问题全部关闭。** **2026-09-17 第四轮：实测了 homelab 的 ECDICT（340 万条，其中 204 万是多词条目、60.1%）**——Decision 0 的 ①③ 两个闸门已通过且结果大幅好于预期（无需换 build；短语的 ECDICT 基础远超预期，推翻了前端注释里「ECDICT 只有单词」的前提）；同时发现多词条目含大量噪声，Decision 8 因此新增一条过滤护栏。剩余待测：② 有效 miss 率、④ 拖选短语命中率。**第三轮**：短语查词从 Out of Scope 收进来成为 Decision 8（词典优先 + 两阶段 + 三条护栏），并修正了初稿对其落点的错误描述。本 ADR 的**设计问题已无悬念，剩下的闸门是 Decision 0 的四个测量数**（线上 ECDICT build → 有效 miss 率 → 多词条目数 → 拖选短语命中率），**阈值已预先登记在 Decision 0，测之前定死**。其中 build 要最先测——它可能让后面三个全部作废。**P2P 同步（`enx-sync`）已于 2026-09-17 标记为暂停维护，本 ADR 不再把它当作设计约束**（初稿曾以它为否决 G1 的理由之一，该理由已撤销）。 |
| **日期** | 2026-09-17 |
| **关联 Spec** | 无独立 TASK-SPEC，留到编码阶段再写（同 ADR-008/010/011/017/025/026 的做法） |
| **关联 ADR** | [`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（**主要依赖**：本 ADR 把它留下的 `dictionary.Lookup` 单一 seam 从「ECDICT-only 薄包装」扩成有序 provider 链；计量口径在 Options D 里被**扩充而非推翻**——查词配额仍按 018 B2 每次调用计一次，AI 兜底另立计量器）、[`docs/adr/0001-integrate-ecdict-dictionary.md`](../adr/0001-integrate-ecdict-dictionary.md)（ECDICT 集成的原始决策，本 ADR **不撤销它**，ECDICT 继续是主源）、[`adr-024-word-context-dictionary-first-why.md`](adr-024-word-context-dictionary-first-why.md)（**最大受益方**：其「词典释义进提示词、AI 据此判断上下文义并解释 `why`」现在喂的是 ECDICT `translation` 那一整坨文本；本 ADR 的 WordNet 义项清单把它从「自由发挥」变成「选择题 + 解释」，见 Options B）、[`adr-021-enx-ui-admin-dictionary-maintenance.md`](adr-021-enx-ui-admin-dictionary-maintenance.md)（其 `ecdict.LookupRaw` 是 ECDICT provider 的现成形状，新 provider 照抄；其确立的「`words` 表只能由人订正」边界**被本 ADR 完整继承**，AI 结果因此只落候选队列，见 Decision 6）、[`adr-026-user-reported-definition-issues.md`](adr-026-user-reported-definition-issues.md)（**两处咬合**：① 没有 `source` 字段，用户报告的释义问题就无法归因到源——本 ADR Decision 5 是它的前置；② 它建立的 `(app)/admin/` 审核队列与本 ADR 的 AI 候选队列是同一类东西，应当共用一套管理页形态）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md) + [`adr-017-sidepanel-sentence-drag-select-phrase-lookup.md`](adr-017-sidepanel-sentence-drag-select-phrase-lookup.md)（**本 ADR Decision 8 修改其行为**：它们建立的「短语选中 → 直接调 AI、无词典半边」被改成「先探词典、命中则走 ADR-024 的两阶段」；两份 ADR 的端点与消息形状不变，变的是 `upsertPhraseCard` 里那个写死的 `dictionaryStatus: 'none'`）、[`adr-028-reading-stats-what-to-measure.md`](adr-028-reading-stats-what-to-measure.md)（其 L1/L2 理解阻力阶梯是 Decision 8 计量例外的理由——短语探测混进 L1 会糊掉「每千词查词数」）、[`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（分档配额；AI 兜底的成本量级与查词差三个数量级，不能共用一个计数器，见 Options D）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（AI 动作走积分系统——AI 兜底如果做，归它管而不是归查词配额管） |
| **关联 Issue** | 待建。预期至少 3 个：miss 率采样脚本、`source` 字段迁移、WordNet 义项表构建 + 接入 `wordcontext`。 |
| **关联清单** | **已确认采纳 Wiktionary（2026-09-17），因此 `docs/tasks/LAUNCH-CHECKLIST.md` 必须增一条第三方数据署名**——词卡上的 `Wiktionary` 标记 + 回链原词条 + 「关于/数据来源」页的 CC BY-SA 3.0 声明（含「有修改」说明），与 6.2 隐私政策 / 服务条款同批做。**这是硬前置：署名没落地就不能把 Wiktionary 的释义放给用户看。**新增 1–2 个数据文件依赖（homelab PVC）+ 每个 provider 一组 viper 配置项（启用开关 + DB 路径）。 |

---

## Context

### 现状：seam 已经在了，但里面只有一个实现

ADR-018 把所有查词路径的计量收敛到了 `dictionary.MeterLookup`，`dictionary.Lookup`（`enx-api/dictionary/lookup.go:31`）是唯一的查词入口。但它的函数体是：

```go
if !ecdict.IsAvailable() { return nil, ErrEcdictUnavailable }
if err := MeterLookup(ctx, userID); err != nil { return nil, err }
return ecdict.Query(ctx, english), nil
```

「查不到」和「ECDICT 没配」是仅有的两种失败。`ecdict.Query` 内部（`enx-api/ecdict/ecdict.go`）已经有一条四级回退链——exact → lower → sw（strip-word）→ exchange（屈折形式）——**这条链解决的是同一本词典内的形态匹配问题，不是数据源问题**。

**好消息**：加 provider 链不需要动 seam 的位置，只需要把 `ecdict.Query` 那一行换成一条有序链。ADR-018 的深 seam（本地 `words` 查询搬进 `Lookup`）仍然推迟，与本 ADR 正交。

### 缺口不是「词条数不够」

真实 miss 分四类，每类需要的东西不一样：

| 缺口 | 例子 | ECDICT | 需要什么 |
| --- | --- | --- | --- |
| 多词短语 / 习语 | `kick the bucket`、`in spite of` | **取决于 build，且有限**（见下） | 收多词条目的源 **+ 放开 `isSentence` 门槛** |
| 新词 / 俚语 | `rizz`、`enshittification`、`doomscrolling` | 基本没有 | 持续更新的源 |
| 专名 / 品牌 / 缩写 | `Kubernetes`、`FOMO`、`Bézier` | 稀疏 | 百科类源或 AI |
| **义项级结构** | 「这个词有几个 sense、哪个 sense 对应哪个中文」 | **没有**，`translation` 是一坨文本 | sense inventory |

第四类对 ADR-024 最要命：现在是把 ECDICT 那坨中文整个塞进提示词，让模型判断「上下文义是否在词典义范围内」。给模型**离散的义项清单**而不是一坨文本，`why` 的质量是另一个量级。这一类**不需要新的展示数据，只需要给 AI 换一份输入**——成本最低、收益最直接，因此是本 ADR 里唯一不等测量就做的事（Decision 3）。

### 短语：两边各自的实际情况，以及一个更硬的拦路石

**ECDICT**：作者在项目 wiki 里明确写过「各大词典对短语词组收录其实做的并不好，不方便无法直接索引不说，收录还相当有限」，同时说《简明英汉增强版》是**带词组短语**的。版本上：基础版 `ecdict.csv` 约 **76 万**词条，《简明英汉增强版（欧陆）》约 **316 万**。所以「ECDICT 有没有短语」的答案是**取决于线上装的是哪个 build**。

> **✅ 已实测（2026-09-17，homelab `enx` 命名空间，临时只读 pod 挂 `enx-ecdict-data` PVC 查 `/ecdict/stardict.db`，851 MB）：**
>
> | 指标 | 值 |
> | --- | --- |
> | 总词条 | **3,402,564**（已是最全的 build，**不是** 76 万基础版——Decision 0 的 ① 闸门通过，无需换 build） |
> | 多词条目 `word LIKE '% %'` | **2,044,859（占 60.1%）** |
> | 其中 `[网络]` 标记（劣质众包） | 272,851 |
> | 其中 `[地名]` / `[人名]` | 55,625 / 217 |
> | **≤5 词且剔除上述噪声** | **1,686,234** |
>
> 词数分布（多词条目）：2 词 1,283,132｜3 词 509,420｜4 词 168,149｜5 词 55,325｜6 词 18,401｜7 词 6,357｜8+ 词 ~4,000。
> **累计覆盖：≤3 词 87.7%，≤4 词 95.9%，≤5 词 98.6%。**
>
> 习语抽查 8 个全部命中且释义可用：`kick the bucket >>> 死掉`、`put up with >>> 忍受, 容忍`、`take on >>> 呈现, 具有, 雇用, 接纳, 承担…`、`let the cat out of the bag >>> 真相大白, 秘密泄露; 露马脚`、`a piece of cake >>> 轻松的事`、`in spite of`、`take it for granted`、`make out`。
> 新词抽查 `doomscrolling`、`rizz` 均**未命中**——印证「新词/俚语」确实是真实缺口。
>
> **⚠️ 但随机抽样显示多词条目混着大量噪声**：伊朗地名、化学品名（`2-quinolinecarboxylic acid`）、标准号（`1394 ieee standard`）、畸形条目（`'d better`、`- philous`）、以及劣质众包译法（`a blinding flash >>> [网络] 一闪一闪`）。**60% 这个数字不能直接当成「短语覆盖率」读**，见 Decision 8 的过滤规则。

**Wiktionary**：多词条目是一等公民，`kick the bucket` 有独立词条，带 idiom 标注、分义项、例句。这一格上它明显强于 ECDICT。

**但拦路石不在数据侧**——`translate/service.go:24`：

```go
if isSentence(raw) { respondSentenceUnavailable(c, raw); return }
```

`isSentence` 就是 `strings.Contains(raw, " ")`。**任何带空格的输入在到达词典之前就被当成句子挡掉了。** 所以无论哪本词典收了多少短语，查词路径都够不着——短语现在走的是 ADR-008 / ADR-017 的 AI 上下文翻译，那是另一条线。

把 `isSentence` 换成「先查词典、查不到再当句子」会改变查词配额口径（选中一段文字会变成一次词典查询），是独立决策，见 Out of Scope。**在它之前，「短语/习语」这一格加任何数据源都无效。**

### 授权问题：这次不是纯技术选型

ENX 要收订阅（ADR-009，Stripe 已接）。ECDICT 自身的数据来源是整合网络词典，法律状态本来就偏灰——**这不是加新源的理由，但是「新源不要让情况更糟」的理由**：

| 源 | 许可 | 对收费产品的含义 |
| --- | --- | --- |
| Open English WordNet 2025 | CC BY 4.0（派生自 WordNet License） | **完全无忧**，署名即可，无 copyleft |
| Wiktextract / kaikki.org | CC BY-SA 3.0 + GFDL（随 Wiktionary） | 署名容易；**SA 有传染性**——派生数据若与自有数据混成不可区分的一张表，义务边界会说不清 |
| ECDICT | 代码 MIT，数据来源混杂 | 现状，不因本 ADR 改变 |

用户提出的解法（**给 Wiktionary 单独建一张与 `words` 同层的缓存表**）正是对这条的正面回应，见 Options G。

### 我们不知道 miss 率

没有任何埋点记录「`dictionary.Lookup` 返回了 nil」。**在拿到这个数之前，「加哪个源」是纯猜测**——如果 miss 率是 0.3%，整个 provider 链的工程量都不值得。Decision 0 因此是一次测量而不是一次实现。

### P2P 同步不再是约束

初稿把「`words` 表经 `enx-sync` P2P 同步出去」列为否决「多源混写 `words`」的理由之一。**2026-09-17 用户决定 enx-sync 暂停维护、未来不确定，所有需求一律不考虑 P2P 同步**（已在 `enx-sync/README.md` 与 `docs/agents/domain.md` 标注）。该理由撤销——但 G2 的结论不变，因为剩下两条理由（CC BY-SA 传染、ADR-021「`words` 只能由人订正」）各自都足够。

---

## Options Considered

### A. 备用展示源选哪个

| 方案 | 形态 / 体积 | 结论 |
| --- | --- | --- |
| **（采用，2026-09-17 确认）A1. Wiktionary**（离线 Wiktextract 子集或在线 API，见 Options F） | 全语言 raw dump 23.1GB / 2.7GB gz；英文子集剔掉 etymology/例句/category 后估计几百 MB | **恰好补上前三类缺口**，按 sense 分结构（pos + 多 senses + IPA + 屈折 + `translations` 段含中文译词），多词条目是一等公民。kaikki.org 每几天更新（当前 2026-09-09 抽自 09-02）。**英→中的开源数据里没有更好的**。代价：CC BY-SA（署名义务已接受，见 Decision 4）+ 构建管线。**「采纳」是方向上的确认，「什么时候做、做哪种形态」仍由 Decision 0 的数据决定**——若 miss 率极低，采纳了也可以不做 |
| A1'. 换一个更大的 ECDICT build（《简明增强》316 万） | 同现有形态，只换文件 | **可能是最便宜的一步**，零代码改动、零授权变化、零新依赖。优先于 A1 验证，见上文待实测 SQL |
| A2. CC-CEDICT | 中→英，~120k 条 | **方向反了**。反向索引英文 gloss 能榨出一点，噪声大，不值当 |
| A3. GCIDE / Webster 1913 | 公版，英英 | 无授权顾虑，但释义是 1913 年的英语，现代义项缺失严重。AI 兜底严格优于它 |
| A4. FreeDict | TEI XML，双语对 | `eng→zho` 那一对基本不可用 |
| A5. 商业 API（Merriam-Webster / Oxford） | 在线，需 key | 质量高但英英为主；免费额度带非商业限制，与收费产品定位冲突 |

### B. WordNet 的定位

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| B1. 当展示源，ECDICT miss 时给用户看英英释义 | 直接渲染 gloss | 对一个中文母语的阅读工具，英英释义是降级体验而不是补充 |
| **（采用，已确认）B2. 只进 AI 提示词，不直接展示** | 在 ADR-024 的两阶段流程里，把目标词的 synset / sense 列表连同 ECDICT 中文一起拼进 `wordcontext.BuildUserContent` | 体积十几 MB、CC BY 4.0 零风险、改动面只有一个 prompt builder。**把 `why` 从「自由发挥」变成「在给定义项里选一个 + 解释为什么上下文义不在其中」。** 2025 版把专名剥到了 Open English Namenet，有 `2025+` 合并版可选 |

### C. 链的形状

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| **（推荐）C1. 串行短路** | ECDICT → Wiktionary → （AI）逐级尝试，命中即返回 | 与现有 `lookupEntry` 的四级回退同构，最好理解。ECDICT 命中路径**一步都不变**（p99 不退化） |
| C2. 并行查全部、按优先级合并 | 同时发起，取最高优先级的非空结果 | 多查的那次全是浪费（ECDICT 命中率本来就高）；SQLite 并发读还要多开连接 |
| C3. 同步只查 ECDICT，miss 走异步补齐 | miss 记入队列，后台补，用户下次才看到 | 「查了个词，下次才有结果」对阅读场景不可接受 |

**注意超时预算**：`ecdict.LookupRaw` 已经给自己留了 3s（`queryTimeout`，因为 `sw`/`exchange` 无索引会退化成扫表），并用 goroutine 竞速兜底 driver 取消不生效的问题。串行链的总预算必须显式设上限。**新 provider 的表必须建好索引，不要重蹈 `stardict` 无索引的覆辙。**

### D. AI 兜底算不算一次查词

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| D1. 算一次查词，共用 `dictionary_lookup_quota` | 沿用 ADR-018 B2 | **成本量级差三个数量级**。一个额度买的是一次 SQLite 读；让它也能买一次 LLM 调用，等于把 AI 成本敞口开到配额上限那么大 |
| **（推荐）D2. 查词配额照计，AI 兜底额外走 ADR-009 的积分系统** | `MeterLookup` 不变；AI provider 命中时再扣一次 AI 积分，并写候选表保证同一个词只付一次 | 与 ADR-014「AI 翻译按 token 计费、与查词配额是两个独立计量器」一致 |
| D3. 不做 AI 兜底 | 查不到就是查不到 | 若 Decision 0 的 miss 率极低，这是对的答案 |

### E. 来源对用户可见吗

| 方案 | 结论 |
| --- | --- |
| E1. 完全不可见 | ECDICT 命中和 AI 猜的在 UI 上是同一行灰字。**用户报错时（ADR-026）双方都不知道在争论什么** |
| **（采用，2026-09-17 确认）E2. 存 `source`，非 ECDICT 来源带轻量标记** | 后端一定存（Decision 5）；前端只在**非主源**时加小标（`Wiktionary` / `AI`）。若采纳 Wiktionary，CC BY-SA 的署名义务本来就要求展示处可见来源，这条已从「可选」变成「必须」 |
| E3. 存但完全不展示 | 归因能力有了，用户仍不知道自己在看什么。可作为 v1 的保守起点 |

**已定：E2。** 用户确认采纳 Wiktionary，而 CC BY-SA 的署名义务要求展示处可见来源——两者本来就不独立，选了前者就锁死了后者。

### F. 离线文件 vs 在线 API（Wiktionary 专属）

用户问了 Wiktionary 有没有在线服务。**有，但都有坑**：

| 选项 | 性质 | 评价 |
| --- | --- | --- |
| `en.wiktionary.org/api/rest_v1/page/definition/{term}` | **官方**，返回结构化释义 JSON，免注册、无 key，共享 200 req/s 限额，要求带 User-Agent | 唯一「官方 + 已解析」的一条。**但它自己标着 experimental，且 WMF 一直在逐步下线 RESTBase**——把它放进付费产品的关键路径，等于把一个随时可能消失的实验端点当基础设施 |
| MediaWiki Action API `/w/api.php` | 官方、稳定，但返回 **wikitext 原文** | 解析 wikitext 正是 wiktextract 存在的理由，自己做等于重写那个项目。**不考虑** |
| kaikki.org 的每词 HTML 页 | 抓取产物站点，非 API | 不是给程序调的，不应当服务依赖 |
| dictionaryapi.dev / freedictionaryapi.com | 第三方包装 Wiktionary，免 key | 个人维护无 SLA。**只当本地开发的快速验证工具** |
| **F1（推荐）离线 Wiktextract 子集** | 自建只读 SQLite，跟 ECDICT 同形态 | 零网络往返、零外部依赖、可复现。代价：一条构建管线 + 几百 MB PVC + 手动更新 |
| **F2 在线官方 API + 本地缓存表** | 首次查在线、结果落缓存表，之后全本地 | **起步成本低得多**（不用建构建管线），且天然就需要用户提议的那张缓存表。代价：首查延迟 + 依赖一个 experimental 端点 + 需要遵守 User-Agent 与限额 |

**建议**：如果 Decision 0 证明值得做，**用 F2 起步、F1 收尾**——先用在线 API + 缓存表跑几周拿真实命中数据，确认这个源确实解决问题，再决定要不要为它建离线管线。缓存表两种形态都要，不会白做。

### G. 新源结果放哪里（⚠️ 有冲突，已解决）

现状：`fillFromEcdict`（`translate/helpers.go:57`）在 ECDICT 命中后 `word.Save()`，把释义写进**全局共享**的 `words` 表（`english` 上有 unique index，不分用户）。

两条约束挡着往里混写：

1. **ADR-021 / ADR-026 确立的边界：「`words` 表只能由人订正」**。AI 生成的释义自动写回直接违反。
2. **CC BY-SA 的传染性**：Wiktionary 派生内容写进 `words`，与 ECDICT 来源的行混在同一张表，SA 的义务边界会说不清。

（初稿的第 3 条理由「P2P 同步会把它扩散出去」已随 enx-sync 暂停维护而撤销。）

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| G1. 照写不误 | 所有 provider 命中都 `word.Save()` | 同时踩上面两条。**否决** |
| **（采用，用户提出并确认）G2. 各源各表，与 `words` 同层** | Wiktionary 结果落自己的缓存表 `wiktionary_entries`；AI 结果落 `ai_definition_candidates`；`words` 表语义和内容完全不变，仍然只装 ECDICT 命中 + 人工订正 | **靠表的物理隔离解决授权边界**：CC BY-SA 内容始终待在自己的表里，可以单独声明、单独导出、必要时整表删除，不会污染自有数据。ADR-021/026 的「只能由人订正」边界完整保住。代价：查询链要读两三个库/表 |
| G3. 写进 `words` 但加 `source` 区分 | 一张表靠字段区分 | 字段能区分，但「整表删除/单独声明」做不到，人工订正的边界也糊。**比 G2 省事，比 G2 脆** |

**`words` 仍然加 `source` 列**（Decision 5）——不是为了混源，而是为了标记「这行是 ECDICT 来的还是人工订正过的」，这是 ADR-026 归因能力的前置。

---

## Decisions

> 0/3/5/6 与 Options G 已获用户确认（2026-09-17）；1/2/4/7 仍待 Decision 0 的数据或待定问题。

0. **✅ 先测量，再选源（已确认）。** 本 ADR 的全部实施都卡在这一步的四个数上。

   **⚠️ 阈值在测之前就要定死**，写在下面。否则数出来之后一定会替它找理由（「3% 好像也不少嘛」），测量就退化成了给既定结论背书。

   **① 线上 ECDICT 是哪个 build —— ✅ 已测（2026-09-17）：3,402,564 条，已是最全 build，闸门通过、无需换 build。③ 多词条目 ✅ 已测：2,044,859（60.1%）。** 两条 SQL 与完整结果见 Context「短语」一节。剩下 ② 与 ④ 仍需跑。

   ```sql
   SELECT COUNT(*) FROM stardict;                            -- ① build
   SELECT COUNT(*) FROM stardict WHERE word LIKE '% %';      -- ③ 多词条目
   SELECT word, translation FROM stardict
    WHERE word IN ('kick the bucket','in spite of','take it for granted','a piece of cake');
   ```


   **② 词 miss 率（主闸门）—— ✅ 埋点已实现（2026-09-17），待开启跑两周。** 新叶子包 `enx-api/dictsample`（**设计上就是用完整包删除的**，无人可依赖它、无行为可分支于它），三个调用点覆盖全部查词结局：`translate/helpers.go` 的本地 `words` 命中（`src=local`）、`dictionary/lookup.go` 的 ECDICT 命中与未命中（`src=ecdict` / `src=none`）。**本地命中也记**，否则算出来的是「新词的 miss 率」而不是用户真实体感的 miss 率。开关 `ecdict.sampling`（env `ECDICT_SAMPLING`）**默认关**——这是有保质期的测量脚手架，忘了关也不该有代价。分析用 `enx-api/scripts/dictsample-report.sh`。

   **要的是「有效 miss 率」**——剔掉专名、拼写错误、OCR 噪声之后用户真正想查的词占比。脚本因此**不只打印比率，还打印去重后的 miss 词表**：分类是人的判断，不能自动化，也不该让脚本假装能自动化。

   | 有效 miss 率 | 动作 |
   | --- | --- |
   | **< 1%** | **provider 链整个不做。** 只留 Decision 2/3/5（`source` 字段 + WordNet 喂 AI），Decision 4/6 作废 |
   | **1–5%** | 做 Wiktionary，**F2 形态**（在线官方 API + `wiktionary_entries` 缓存表），不建离线管线 |
   | **> 5%** | 值得建 F1 离线管线，并启动 AI 兜底（Decision 6） |

   ~~**③ ECDICT 多词条目数**~~ ✅ 已测：204 万，剔噪声后 ≤5 词仍有 168 万。**Decision 8 的 ECDICT 基础远超预期，这一格不再依赖 Wiktionary。**

   **④ 拖选短语的词典命中率 —— ✅ 埋点已实现（2026-09-17）。** `aitranslate/handler.go` 的 `TranslateWordInContext` 入口记录多词选中（`kind=phrase`，单词跳过——它们已经被 ② 记过，再记一次会把分母算重）。今天短语根本不到词典，所以只能先采下来、事后对 ECDICT 与 Wiktionary 离线对跑。**同时测「命中短语的词数分布」，用它的 P95 定 Decision 8 的词数上界**（起始值 5 是推测，不是结论）。

   | 命中率 | 动作 |
   | --- | --- |
   | **< 10%** | **Decision 8 不做。** 每次拖选多等一个网络往返，换不到十分之一的命中，不划算 |
   | 10–30% | 做，但收紧词数上界 |
   | > 30% | 做，上界可放宽 |
1. **`dictionary.Lookup` 改为有序 provider 链**（C1 串行短路），接口形如 `Provider{ Name() string; Lookup(ctx, word) (*enx.Dictionary, bool) }`，ECDICT 是链上第一个、行为完全不变。链的总超时显式设上限。
2. **`enx.Dictionary` 加 `Source string`**，`ecdict.Query` 填 `"ecdict"`。这一步**独立于要不要加新源**，现在就能做。
3. **✅ WordNet 先做，且只做 B2（已确认）**：构建一个 lemma → senses 的小表（CC BY 4.0，十几 MB），接进 `wordcontext.BuildUserContent`。**本 ADR 里唯一不依赖 miss 率数据就该做的事**，可以立刻开工。
4. **✅ 采纳 Wiktionary 作为备用源，接受 CC BY-SA 的署名义务（已确认，2026-09-17）。** 形态按 F2 起步（在线官方 API + `wiktionary_entries` 缓存表）、按 G2 隔离。**授权这一道闸门已开，剩下的只有 Decision 0 的数据**——若测出来 miss 率极低，「采纳了但不做」仍是一个诚实的结局，不要因为已经确认过就硬做。

   **署名具体要做什么**（CC BY-SA 3.0，落地时照做，别留给"以后想想"）：
   - **来源可见**：词卡上 Wiktionary 来源的释义带 `Wiktionary` 标记（E2 已定）。
   - **回链原词条**：标记做成指向 `https://en.wiktionary.org/wiki/{word}` 的链接。这是最干净的署名形式，**而且对用户本身有用**——想深挖的人有地方去。
   - **许可声明**：在「关于/数据来源」一类静态页（与 LAUNCH-CHECKLIST 6.2 的隐私政策、服务条款同批）写明：本产品的部分释义来自 English Wiktionary，按 CC BY-SA 3.0 提供，并给出许可原文链接；有改动（格式转换、字段裁剪）要注明「有修改」。
   - **ShareAlike 的边界靠 G2 的表隔离守住**：Wiktionary 派生内容只存在于 `wiktionary_entries`，不与 `words`、`ai_definitions`、用户数据混表。这样 SA 的义务范围清晰地落在那一张表上，不会蔓延到自有数据。**表隔离在这里做的是法律工作，不只是整洁**——实现时不要为了"少读一张表"把它合回去。
   - ⚠️ 上述是工程上的常规做法，不是法律意见；正式上线前如果对 SA 的范围仍有疑虑，值得找专业意见确认一次。
5. **✅ `words` 表加 `source` 列**（默认 `'ecdict'`），且**不接纳非 ECDICT 来源的行**。
6. **✅ AI 兜底：当场展示给用户，同时落候选表由管理员事后审核，永不自动回写 `words`（已确认，2026-09-17）。**

   **⚠️ 这意味着审核是事后纠错，不是发布前闸门**——`pending` 状态的 AI 释义**照常展示**（带 `AI` 标记），管理员是在补救而不是把关。接受这一点是「要展示」这个选择的直接后果，缓解手段只有两个：E2 的来源标记，和 ADR-026 的报告入口。

   **形态：跟 `words` 同一个 SQLite 文件里的一张新表**（不是独立文件）。ECDICT / Wiktionary 需要独立文件是因为授权与体积；AI 生成的是**我们自己的数据**，无授权问题，且需要写入、需要管理员查询、需要与审核状态一起事务更新——分文件只会带来跨库 join 的麻烦。

   ```sql
   CREATE TABLE ai_definitions (
       id             TEXT PRIMARY KEY,     -- uuid，与 words 同形态
       english        TEXT NOT NULL,        -- 原样保留大小写
       key            TEXT NOT NULL,        -- lower(english)，真正的查询键
       chinese        TEXT NOT NULL,        -- AI 给的【无语境】释义
       pronunciation  TEXT,                 -- 允许空；AI 编音标不可靠，宁可不给
       model          TEXT NOT NULL,        -- 哪个 provider / 模型生成的
       prompt_version TEXT NOT NULL,        -- 提示词版本，用于批量作废重生成
       review_status  TEXT NOT NULL DEFAULT 'pending',  -- pending / promoted / rejected
       hit_count      INTEGER NOT NULL DEFAULT 1,       -- 被查中几次 → 管理员排序依据
       created_at     INTEGER NOT NULL,
       updated_at     INTEGER NOT NULL,
       reviewed_at    INTEGER,
       reviewed_by    TEXT
   );
   CREATE UNIQUE INDEX idx_ai_definitions_key ON ai_definitions(key);
   CREATE INDEX idx_ai_definitions_review ON ai_definitions(review_status, hit_count DESC);
   ```

   设计要点，逐条说明为什么：

   - **唯一键是词，不是每次生成一行。** 一个词一行，重新生成就覆盖。AI 输出的历史版本几乎没有价值，但「这个词已经生成过」这个事实极有价值——它同时是缓存键和防重复扣费的依据。
   - **⚠️ AI provider 要的是「无语境的词典式释义」，不是 ADR-024 的「这句话里的含义」。这是两次不同的 AI 调用，不要复用 `wordcontext`。** 复用的话，会把用户 A 那一句里的临时含义缓存成通用释义、喂给用户 B。AI provider 必须有自己的 prompt：「给这个词的一般性中文释义，像词典条目那样」。ADR-024 的上下文释义照旧在它自己那条线上跑，两者互不替代。
   - **⚠️ 不存触发它的那个句子。** 存了对管理员判断确实有帮助，但这撞 [ADR-026](adr-026-user-reported-definition-issues.md) 的「不自动采集」——那份 ADR 的整个前提是句子快照必须**用户逐条主动同意**才能提交。自动存下来等于从后门破了它。管理员在无语境下审，是为守住这条隐私线该付的代价。想要语境，正道是引导用户走 ADR-026 的报告入口。
   - **`rejected` 是墓碑，不是删除。** 管理员否掉之后，下次有人查这个词**不能再生成一遍**——同样的 prompt 会给出同样的烂结果，白烧一次积分。`rejected` 行留着当拦截器：不展示、不重新生成，用户看到的就是「查无此词」。真想重试，人工删行。
   - **`promoted` 而不是 `approved`。** approve 的动作是「由人把它写进 `words`」；写完之后 `words` 命中会天然遮蔽这一行，所以它只剩审计价值。保留（量小、便宜），不删。
   - **`prompt_version` 是批量作废的抓手。** 提示词改好之后，可以把旧版本生成的 `pending` 行标记为待重生成，而不必删掉用户可见的内容。没有这一列，改 prompt 就只能全表重来或全表不管。
   - **`hit_count` 是管理员的排序依据，也是唯一的用量信号。** 它是聚合计数、不含任何用户标识，与 ADR-028 的隐私尺度一致。管理页默认按它倒序，`hit_count = 1` 的长尾可以先不看。

   **查询链上的位置**：`words` → ECDICT →（Wiktionary）→ `ai_definitions` 缓存 → 真正发起 AI 调用。放在 ECDICT **之后**是有意的——将来这个词被 ECDICT 新 build 收录、或被管理员 promote 进 `words`，AI 行会自然被遮蔽，promote 时不需要回头删它。

   **计量**：缓存命中不扣 AI 积分（但仍按 ADR-018 B2 计一次查词配额）；只有真正发起生成才扣。**已知缺口**：两个用户同时首查同一个新词会各生成一次、各扣一次。v1 接受（概率低、金额小），靠 `key` 上的唯一索引保证只留一行。要消掉它需要 single-flight，与 [#15](https://github.com/wiloon/enx/issues/15) 是同一类问题，一并处理更划算。

   **管理页复用 ADR-026 的审核队列形态**，不要做第二套。

7. **✅ UI 按 E2（已确认，2026-09-17）**：后端一律存 `source`；前端只在**非主源**时加轻量标记——`Wiktionary`（链到原词条，兼作署名）与 `AI`（未经审核的提示）。ECDICT 命中不加标，避免给正常路径添噪声。

8. **✅ 短语查词改为「词典优先 + 两阶段」，与单词走同一形状（已确认，2026-09-17）。**

   **现状（改之前是什么样）**：拖选（ADR-008 页面内 / ADR-017 侧栏内）→ `upsertPhraseCard` 建卡时把 `dictionaryStatus` 写死为 `'none'` → **跳过 `getOneWord`，完全不查词典** → 只调 `fetchContextTranslation(phrase, sentence, sentenceId)`（`SidePanel.tsx:1001`）。注意那里**只传了 3 个参数**——ADR-024 给它加的第 4 个参数 `dictionaryChinese` 是 `undefined`，所以 `POST /translate/word-in-context` 收到的词典释义是空的，按 ADR-024 Decision 4 的规则，**`why` 那一行对短语永远是空的**（没有词典义可比对）。计费上只烧 AI 积分、不占查词配额；同一短语在同一层级重选只移动卡片、不二次调用。

   **⚠️ 先修正一处错误前提。** `enx-chrome/src/sidepanel/SidePanel.tsx:980` 的注释写着：

   > `a multi-word selection never has a dictionary entry (ECDICT/words only has single words), so it skips getOneWord entirely`

   **这个前提不成立**——ECDICT《简明增强》build 是收词组短语的（作者自陈"收录还相当有限"，但不是没有），Wiktionary 更是把多词条目当一等公民。所以「短语跳过词典」不是一个经过权衡的决策，**是一个基于错误前提的默认行为**。

   **落点在前端，不在 `isSentence`。** 初稿把这件事描述成「改 `isSentence` 门槛」，不准确：真正的决策点是 `upsertPhraseCard`（`SidePanel.tsx:989`）把 `dictionaryStatus` 直接写死成 `'none'`、压根不发 `getOneWord`；服务端 `translate/service.go:24` 的 `isSentence` 只是第二道防线。两边都要改，但主改动在前端。

   **形状：AI 对短语不是「兜底」，是第二阶段。** 词典命中**不终止流程**——短语卡从 `dictionaryStatus: 'none'` 变成和单词卡一样的两半结构：词典释义先渲染，再把它拼进提示词调 AI 解释 in-context 含义（即完全复用 ADR-024 的 `fetchWordContext`）。理由：`take on` / `make out` 这类词组的词典义与句中实际含义可能差很远，这正是 ADR-024 存在的前提。
   - **因此这个改动不省 AI 调用，也不省钱——它省的是错误答案。** 若目标是省钱（命中就不调 AI），短语与单词的行为就不一致了，**不采用**。

   **三条护栏，缺一条都会出问题：**

   1. **⚠️ 短语探测只做精确匹配，`lower` 那一级也要去掉。** `lookupEntry` 的四级是 exact → lower → `sw` → `exchange`：`sw`/`exchange` **没有索引**（`queryTimeout = 3s` 与那个 goroutine 竞速兜底就是为它们存在的），而 `lower` 那级写的是 `LOWER(word) = LOWER(?)`——**函数表达式，`stardict` 上没有对应的函数索引，同样是三百万行全表扫**。对短语而言 `sw`（归一成单个词）与 `exchange`（动词变位）本来就无意义，而一个短语必然穿透 exact 后触发**三次**扫表。
      **正确做法：两次精确匹配，都打在有索引的 `word` 列上**——先按原样，再按整体小写后的字符串。两次索引读，约等于免费。（注意这与 `words` 表不同：那边有 `idx_words_english_lower` 函数索引，`LOWER` 匹配是走索引的。）
   2. **词数上限：2–5 词（✅ 已由实测数据支持）。** 下界 2——1 个词就是普通查词、走原路径。上界 5 的依据是 ECDICT 多词条目的实际词数分布：**≤3 词覆盖 87.7%，≤4 词 95.9%，≤5 词 98.6%**。取 5 换来最后 2.7 个百分点，再往上（6 词以上仅 1.4%）不值得。另加字符数保险（≤ 60 字符），防病态输入。
      **⚠️ 上限是延迟决策，不是成本决策。** 加了护栏 1 之后单次探测的 SQLite 成本可以忽略；真正的代价是 **ADR-024 特意把 AI 调用排在词典之后**（要把词典释义拼进提示词），所以探测卡在关键路径上，**每次拖选都要多等一个网络往返才开始 AI 调用**。
      **5 是推测值，最终由 Decision 0 的 ④ 定**——测命中短语的词数分布，按 P95 取。
   3. **⚠️ 计量例外（对 ADR-018 的正式例外，不是实现细节）。** ADR-018 B2 是「每次调用计一次、先扣后查、不管结果」。短语探测若直接走 `dictionary.Lookup`，每次拖选都消耗一个查词额度，且**污染 [ADR-028](adr-028-reading-stats-what-to-measure.md) 的理解阻力阶梯**——那份 ADR 特意把 L1（查词）与 L2（整句/短语）建模成不同台阶，因为「每千词查词数」是它认定的唯一能诚实表达进步的指标；短语探测混进 L1 就糊了。**规则：探测 miss 不计量**（什么都没给用户，后续 AI 调用有自己的账）**，探测 hit 才按真实查词计量**。

   **连带影响：这个决定显著抬高 Options A1（Wiktionary）的权重**——习语在 Wiktionary 是一等公民，而 ECDICT 作者自陈词组收录有限。Decision 0 的测量清单因此加一项：**拖选短语里有多少能被 ECDICT / Wiktionary 命中**。命中率过低则本 Decision 整体不做。

   3.5. **⚠️ 新增护栏：过滤噪声条目。** 实测发现 204 万多词条目里混着 272,851 条 `[网络]` 标记的劣质众包译法（`a blinding flash >>> [网络] 一闪一闪`）、55,625 条 `[地名]`、以及化学品名/标准号/畸形条目（`'d better`、`- philous`）。**这些条目本身不会主动造成问题（精确匹配命中不了没人选的词），真正的风险是「假命中」**——用户在小说里选了 `a blinding flash`，词典给出 `一闪一闪`，质量反而不如纯 AI 的上下文翻译。
      **规则：短语探测跳过 `translation` 含 `[网络]` / `[地名]` / `[人名]` 标记的条目**（单词查词路径不受影响，维持现状）。过滤后 ≤5 词的可用条目仍有 **1,686,234** 条。这条规则是 Decision 8 的护栏，不是 provider 链的通用行为。

   **⚠️ 待核实**：短语命中后 `fillFromEcdict` 会 `word.Save()` 把短语写进 `words` 表，从而进入 `user_dicts` 复习体系（`QueryCount` / `AlreadyAcquainted`）与 `paragraph-init` 的 `QueryCountInText`。习语进复习本身可能是**好事**，但 ADR-011 的单词高亮按 token 匹配、ADR-003 的雅思词表 mastery 都假设条目是单词。实现前先确认这些地方对多词条目是「天然失效（无害）」还是「会出错」。

---

## Consequences

### 正面

- ADR-024 的 `why` 第一次有了离散的义项依据，而不是一坨文本。
- ADR-026 的用户报告终于能归因到源——「这条错的释义是谁给的」变成一个可回答的问题。
- provider 链把「ECDICT 不可用」从一个用户可见的错误（`ErrEcdictUnavailable` → `RespondUnavailable`）降级成一次静默降级。
- G2 的表隔离让「哪天决定不要 Wiktionary 了」变成 `DROP TABLE` 而不是一次数据考古。

### 负面 / 风险

- **AI 候选队列会积压**。它把成本从「自动化」转移到「管理员的时间」——这在用户量小的时候是对的（质量可控），用户量一上来就变成瓶颈。`hit_count` 倒序 + 长尾不看是第一道缓解。
- **⚠️ 未经审核的 AI 释义会直接到达用户**（Decision 6 的「展示」选择）。一条错释义在管理员处理到它之前一直可见，**`AI` 标记与 ADR-026 的报告入口是仅有的两道防线**。这是一个有意识的产品取舍，不是疏漏。
- **短语卡的形态变了**（Decision 8）：从「只有 AI 一半」变成和单词卡一样的两半。这对 ADR-023 的统一历史列表是个好事（卡片形态收敛成一种），但 `dictionaryStatus: 'none'` 这条分支的既有测试与重试逻辑（ADR-024 的 `handleRetryContextTranslation` 三分支）都要跟着改。
- **多了一次 AI 调用形态**。`ai_definitions` 的无语境释义与 ADR-024 的上下文释义是两个不同的 prompt、两条不同的计费线，别在实现时合并——合并的那一刻缓存就失去正确性。
- **串行链的尾延迟**。ECDICT 的 `sw`/`exchange` 分支本来就慢（3s 超时不是摆设），链上再加一跳，p99 会变差。
- **若走 F2**：依赖一个官方标着 experimental 的端点，且要遵守 User-Agent 与 200 req/s 共享限额。它下线的那天，缓存表里已有的内容还在（这也是缓存表的额外价值），但新词查不到了。
- **CC BY-SA 的署名义务是持续的**，不是加一次就完事——UI 改版、词卡重构时最容易掉。写进 LAUNCH-CHECKLIST，而不是只写进代码注释。
- **G2 的表隔离从「整洁」升级成「法律边界」**。既然采纳了 CC BY-SA 的源，`wiktionary_entries` 不与自有数据混表这一条就不再是可以为了省事让步的设计偏好了——将来任何「合表以减少一次查询」的优化提案，都要先回到这里。
- **Decision 0 的日志采集是新的数据采集行为**。只记文本、不记用户标识/URL/所在句，但 ④ 的短语行**确实带有用户所读内容的多词片段**——这正是它默认关闭、且必须时间盒（~2 周后关掉并删包）的原因。按 ADR-026 / ADR-028 的隐私尺度，开启期间隐私政策应当有一句话覆盖它。

---

## Out of Scope（本次不做）

- ~~**改 `isSentence` 门槛**~~ —— **2026-09-17 收进本 ADR 成为 Decision 8**（并修正了落点：主改动在前端 `upsertPhraseCard`，不是 `isSentence`）。
- **换掉 ECDICT**：本 ADR 不撤销 `docs/adr/0001`，ECDICT 继续是主源。（但「升级到《简明增强》build」是 A1' 的廉价选项，值得在 Decision 0 里一起验证。）
- **P2P 同步的任何考量**：`enx-sync` 已暂停维护（2026-09-17）。
- **ADR-018 的深 seam**（本地 `words` 查询搬进 `Lookup`，前置是 #22）——与本 ADR 正交，互不阻塞。
- **管理员维护路径**（ADR-021）：`/api/admin/ecdict/:word` 等仍然只看 ECDICT 原始行，不走 provider 链。
- **把 provider 链暴露成用户可选**（「我想看 Wiktionary 的解释」）：产品决策，不在本 ADR。

---

## 待确认的问题：无（2026-09-17 全部关闭）

1. ~~**CC BY-SA 3.0 能不能接受？**~~ **已确认：接受。** Wiktionary 采纳，署名义务的具体做法见 Decision 4。
2. ~~**来源对用户可见到什么程度**（E2 还是 E3）？~~ **已确认：E2**（由 1 锁定，两者不独立）。见 Decision 7。
3. ~~**AI 生成的释义当场展示给用户吗？**~~ **已确认：展示。** 代价是审核降级为事后纠错，见 Decision 6。

**设计问题到此收敛。剩下的唯一闸门是 Decision 0 的测量**——它决定 Wiktionary 这条线做不做、以及 F2 还是 F1。Decision 2/3/5 不依赖测量，随时可以开工。

---

## Revisit Triggers

- **Decision 0 的 miss 率出来**：本 ADR 从 Proposed 走向 Accepted 或被整体否决的分水岭。
- **线上 ECDICT build 确认是基础版**：A1'（换增强版 build）会跳到最高优先级，可能让整条 provider 链变得不必要。
- **Decision 8 的短语命中率测出来很低**（拖选的绝大多数确实不是词典条目）：整条 Decision 8 不做，短语维持现状直接进 AI——护栏 2 的长度上限在这种情况下会退化成「几乎总是跳过探测」，那就不如不做。
- **短语进入 `words` 表后在复习/高亮体系里出了问题**（Decision 8 的待核实项）：要么给 `words` 加一个「条目类型」维度，要么短语走自己的表——后者与 G2 的思路一致。
- **AI 候选队列积压到管理员处理不过来**：需要重新设计——按 `hit_count` 自动 promote 的门槛？还是干脆不做 AI 兜底（D3）？
- **`pending` 长尾行占满表**（大量 `hit_count = 1` 的一次性词永不被审）：需要一个保留策略，与 ADR-018 步骤 4 的配额行清理（[#21](https://github.com/wiloon/enx/issues/21)）是同一类 GC 工作，一起做。
- **并发首查重复生成被证明不只是理论问题**（账单上看得见）：上 single-flight，与 [#15](https://github.com/wiloon/enx/issues/15) 合并处理。
- **AI 释义的错误率高到 `AI` 标记兜不住**：把 `pending` 从「展示」改回「不展示」，即退回发布前闸门——这会让 Decision 6 的「展示」决定反转，代价是用户查到新词时一无所获。
- **RESTBase definition 端点下线**（走 F2 的话）：切 F1 离线管线，缓存表里的存量数据是缓冲期。
- **署名的展示位置被改动**（词卡重构、来源标记被当成视觉噪声去掉）：这不是 UI 微调，是许可合规问题，改之前回到 Decision 4。
- **ADR-024 的 `why` 质量仍不达标**（即使接了 WordNet 义项）：说明问题不在输入而在 prompt 或模型，provider 链不是答案。
- **enx-sync 恢复维护**：Options G 的理由 3 要重新加回来（但不改结论）。
