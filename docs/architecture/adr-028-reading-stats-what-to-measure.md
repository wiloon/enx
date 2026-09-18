# ADR-028：阅读统计「测什么」——把用户动作建模成**理解阻力阶梯**（L0 开篇 / L1 查词 / L2 整句 / L3 译文内再查词），阅读量在无「读完」确认按钮的前提下按**最大阅读水位**推断（查词位置 ∪ 滚动深度），服务端**只存用户本地日期的日聚合、不存任何 URL 或会话痕迹**，v1 只做 L0+L1 两个埋点，因为「每千词查词数」是唯一能诚实表达进步的指标而它只需要这两个

| 字段 | 值 |
| --- | --- |
| **状态** | **v1 全链路已实现 — 2026-09-17**（后端 2026-09-16，扩展侧 L0 埋点 + 上报队列与 enx-ui 展示 2026-09-17）；剩部署与隐私政策页，见文末「实施进度」。**2026-09-17 修订**：`/stats` 的版式按用户意见从「日/周/月/年四个区块」改为**一张图 + 桶大小/度量两个切换**，见文末「对 `/stats` 形态的修订」。原始记录：Proposed — 2026-09-16。**当时未写任何代码。2026-09-16 修订**：用户指出配额不该是「免费/付费」的开关而是档位，由此产出 [`adr-029`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)；本 ADR 的 Context（配额表偏斜）与 L1 数据来源随之修订，见下方标注。 与 [`adr-027`](adr-027-enx-ui-app-home-workbench-and-return-path.md) 是一对：027 管应用区的交互 / 布局 / 配色，本 ADR 管「统计哪些数据、怎么采、怎么存」。本 ADR 的结论**反向修改了 027 的状态条字段与 `overview` 契约**，见文末「对 ADR-027 的影响」。 |
| **日期** | 2026-09-16 |
| **关联 Spec** | 无独立 TASK-SPEC，留到编码阶段再写 |
| **关联 ADR** | [`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（**前置**：029 把配额改成人人有额度的分档模型并解耦计数与拦截，`dictionary_lookup_quota` 因此第一次成为全体用户的每日查词计数器；本 ADR 的 L1 数据来源据此改为服务端，见 Decision 5 补注）、[`adr-027-enx-ui-app-home-workbench-and-return-path.md`](adr-027-enx-ui-app-home-workbench-and-return-path.md)（**配对 ADR**：Home 状态条与 `/stats` 曲线是本 ADR 数据的唯一消费者；027 Decision 7 的 `overview` 契约按本 ADR 重写，027 Options G「不做 streak」的结论在这里得到正式的替代方案）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（查词计量的单一 seam；本 ADR 的 L1 埋点**挂在同一个 seam 上**，但**统计不寄生于计费**，见 Options F）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（`credit_transactions` 已是一份带时间戳的 AI 动作日志——本 ADR 只拿它**回填历史**，不拿它当长期数据源；`dictionary_lookup_quota` 的免费用户偏斜见 Context）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md)、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)、[`adr-017-sidepanel-sentence-drag-select-phrase-lookup.md`](adr-017-sidepanel-sentence-drag-select-phrase-lookup.md)、[`adr-023-sidepanel-unified-history-list-nested-sentence-words.md`](adr-023-sidepanel-unified-history-list-nested-sentence-words.md)（这四份定义了阶梯上 L1'–L3 的具体动作与消息）、[`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（`enxRun` / `getArticleNodes()` / `collectTextNodes()` 是 L0 埋点的落点）、[`adr-026-user-reported-definition-issues.md`](adr-026-user-reported-definition-issues.md)（同一条隐私原则：持久化「用户在读什么」是全新性质的事，要极度克制——本 ADR 因此选择**一个 URL 都不存**） |
| **关联代码** | **待实现。** 预期落点——enx-chrome：`src/content/content.tsx`（`enxRun` 结尾算文章总词数、词点击处算阅读水位、滚动水位观察器）、新增 `src/lib/readingProgress.ts`、`src/background/background.ts`（会话缓冲 + 上报）、`src/services/api.ts`。enx-api：新薄包 `stats/`（`daily.go` + `ingest.go` + handler），`migrations/0XX_daily_stats.sql`，`enx-api.go` 注册 `POST /api/stats/ingest` 与 `GET /api/stats/overview`、`GET /api/stats/series`。enx-ui：`/stats` 页四条曲线 + Home 状态条。 |
| **关联清单** | **硬前置（同 ADR-026）**：`docs/tasks/LAUNCH-CHECKLIST.md` §6.2「隐私政策页 + 服务条款页」——本功能开始持久化用户的阅读行为数据（即使不含 URL），隐私政策必须先说清楚采什么、存多久。新增 2 个 viper 配置项（见 Decision 9）。无新增外部服务。 |

---

## 已确认的决策（2026-09-16，用户提出）

1. **统计单独成 ADR**：ADR-027 只讨论页面交互、布局、颜色，统计细节放这里。
2. **动作阶梯的语义差异是核心洞察**（用户原话概括）：点词查词 = 对该词在此句中的含义不清楚；把词/句提交到侧边栏做整句翻译 = 词典释义还不够、连句子都没理解；在侧边栏的整句译文里再点某个英文词 = 有了整句翻译仍不理解该词在此处的用法。**这三层传递的信息不同，是不同的统计维度。**
3. **阅读量在没有「读完」确认按钮的前提下降级推断**：用户点击文章中某个词，则认为文章开头到该点击位置之间的词都已读。

   > ⚠️ **这一条含一个未经确认的解读。** 用户原话的开头是残句（「有点击最后这个确认按钮的话，就只能降级成按照用户查词的位置来统计用户的阅读量」），本 ADR 按「**如果不做**一个『读完了』的确认按钮，就只能降级成按查词位置推断」来理解，并据此写了 Decision 2 与 Options A。提出这个解读时用户未纠正，但也未明确确认。**如果本意其实是「已经有/打算做一个确认按钮」，Options A 与 Decision 2 需要重写**（A1 会从「否决」变成「采用」，水位推断退为补充信号）。接手前建议先跟用户确认这一句。
4. **文章数**也要统计（用户认为相对容易，不展开）。
5. **时间维度**：今日 / 本周 / 本月 / 本年都要。
6. **要有成长曲线**，让用户看见自己的成长。
7. **第一个版本不必把所有维度做完**，需要一个「从哪个维度开始」的建议。
8. **Home 上要显示**：扩展安装状态、Subscription plan、**积分余额**。

---

## Context

### 服务端今天有什么（以及为什么都不够用）

| 数据源 | 有什么 | 为什么不能直接拿来做统计 |
| --- | --- | --- |
| `user_dicts` | `(user_id, word_id, query_count, already_acquainted, created_at, updated_at)` | `query_count` 是**终身累计**，`updated_at` 只保留**最后一次**交互时刻——两者都不带历史，画不出任何曲线。且 `repo.UpsertUserDict` 在查词**和**标记已认识两条路径上都 bump `updated_at`，语义混叠。唯一能用的是 `created_at`：可算「某天新收录了几个生词」，且**对所有用户都准**。 |
| `dictionary_lookup_quota` | `(user_id, date, count)`，UTC 日 | **写这条时的判断（机制层面）**：只对免费用户写行——订阅用户在 `quota.CheckAndIncrementLookup` 被调用前就判定豁免；`limit <= 0` 时函数直接返回、一行不写。**查证后的运行时实情更糟**：`config.toml` 里 `dictionary-lookup-daily = 0`，所以**这张表今天是空的，对所有人**。→ **[`adr-029`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md) 已修掉根因**（分档上限 + 计数与拦截解耦），之后它是全体用户的每日查词计数器，但**日界仍是 UTC**（防改时区重置额度），所以仍不能直接当本地日的学习统计用。 |
| `credit_transactions` | `(user_id, type, amount, feature, created_at)`，`feature ∈ {translate_sentence, translate_word_in_context, translate_sentence_with_word, rephrase_to_english}` | **意外地已经是一份带时间戳的 L2/L3 动作日志**——每次 AI 调用成功都会 `Settle` 出一条 CONSUME 行。但它是**会计账本**：`Settle` 失败只记日志不回滚（会少记）、未来任何计费策略变化（缓存命中不计费、某功能转免费、批量结算）都会**静默改变统计口径**。见 Options F。 |
| `reader_documents` | 粘贴文本阅读器的文档（ADR-022） | 只覆盖 `/reader` 这一条路径，不覆盖扩展在真实网页上的阅读——而后者才是主场景。 |
| — | **完全没有的** | 「读了多少词」「读了几篇文章」「某天查了几次词」的任何记录。**分母根本不存在。** |

### 客户端已经有什么（好消息：L0 的零件是齐的）

`enxRun`（用户显式开启 Catseye 处理本页）是一个天然、显式、用户发起的「开始读一篇文章」事件，而且它当场就知道：

- `WordProcessor.getArticleNodes()` → 正文节点（含每站适配器的差异）
- `WordProcessor.cleanArticleText()` / `collectTextNodes()` → 正文全文
- `WordProcessor.extractWords(textContent).length` → **文章总词数，已经算出来了**（现在只用来分块，算完就丢）
- `window.location.href` → 文章身份
- 词点击时手上有 `reference: Range`，而 `WordProcessor.getTextOffsetWithin(container, reference)` 已存在（现在是 private，服务于句子上下文抽取）

也就是说，**「文章总词数」和「点击位置的字符偏移」这两个数今天就能算出来，不需要任何新能力**——只是从来没人把它们留下来。

### 用户提出的阶梯，对到代码里的实际动作

| 级 | 语义（用户的话） | 代码里的动作 | 今天有日志吗 |
| --- | --- | --- | --- |
| **L0** | 开始读一篇文章 | `enxRun`（工具栏点击 / 右键菜单触发） | ❌ 无 |
| **L0.5** | 读到了哪里 | 词点击的 `Range` 位置；滚动位置 | ❌ 无 |
| **L1** | 「这个词在这句里什么意思，我不清楚」 | `getOneWord` → 浮层词典释义 | ⚠️ 只有终身累计 + 免费用户的 UTC 日计数 |
| **L1'** | 「这个词我其实认识 / 现在认识了」**（唯一的正向信号）** | `markAcquainted` | ⚠️ 只有一个状态位，无时间 |
| **L1.5** | 短语级困惑 | 划选短语查询（ADR-008 / ADR-017） | ⚠️ 若计费则在 `credit_transactions` |
| **L2** | 「词典释义不够，整句我也没读懂」 | `openSentencePanel` → `translateSentence` | ⚠️ 同上 |
| **L3** | 「有了整句翻译，我还是不懂这个词在这里的用法」**（最强困惑信号）** | 侧边栏译文内点词 → `translateWordInContext` | ⚠️ 同上 |
| — | 不属于阅读 | `rephrase`（`/rephrase` 页，输出导向） | ⚠️ 同上 |

### 为什么值得写 ADR

- **难以反悔的三件事**：日期边界用 UTC 还是用户本地（改口径要回填全部历史）、服务端存不存 URL（存了就删不掉「我们曾经记录过用户浏览历史」这个事实）、事件表还是日聚合表（选了聚合就永久失去事后按新维度重算的能力）。
- **反直觉**：`credit_transactions` 看起来是现成的事件日志，`dictionary_lookup_quota` 看起来是现成的日计数——**两个都是陷阱**，且两个陷阱的方向不同（一个会随计费策略静默漂移，一个对付费用户永远为 0）。
- **真实取舍**：阅读量的四种算法（确认按钮 / 点击水位 / 滚动水位 / 停留时长）各自的偏差方向完全不同，没有一个是对的，必须选一个并说清它偏在哪。
- **隐私边界**：这是 ENX 第一次持久化「用户在读什么」的行为数据。ADR-026 为了一条用户主动提交的反馈都要求隐私政策先行，被动采集的阅读统计更要把边界写死。

---

## Options Considered

### A. 阅读量（words read）怎么算

| 方案 | 偏差方向 | 结论 |
| --- | --- | --- |
| A1. 显式「读完了」确认按钮 | **样本偏斜**：只有自律的用户会点，而且读完一半就关掉的正常行为永远不被记录。给一件本该自动的事加了家务活。 | 否决作为 v1 主方案。**但保留为后续的正向动作**：它可以是一个「完成一篇」的仪式感时刻（ADR-011 的 `showProcessingIndicator` 已经有完成指示器的 UI 位），配合成就感设计比配合统计更有价值。 |
| A2. 点击水位（用户提出的降级方案） | **系统性低估**，而且**低估的方向是反的**——读得越好、查词越少的用户，被记录的阅读量越少；一篇全读懂、一个词没查的文章记 0。用在「成长曲线」上会出现「我进步了，曲线却掉下去了」。 | 单独用不行。**但它是最可信的下界**：点了这个词，说明确实读到了这里。 |
| A3. 滚动水位（正文节点的最大可见深度） | **系统性高估**：拉到底就算读完，扫一眼也算。 | 单独用不行。**但它覆盖了 A2 完全盲的场景**：不查词的流畅阅读。 |
| **A4.（采用）A2 ∪ A3 的最大水位** | `progress = max(最深点击位置, 最深滚动位置)`，全程取**单调不降的水位线**（往回点/往回滚不降低）。两者的偏差方向相反，取并集后：有查词行为时下界可信，无查词行为时靠滚动兜底。 | 采用。并且**在 UI 上诚实标注**为估算（见 Decision 8）。 |
| A5. 停留时长 × 假定阅读速度 | 开着标签页去吃饭 → 读完一本书 | 否决。 |

### B. 服务端存事件明细还是日聚合

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| B1. append-only 事件表（每个动作一行） | 最灵活，事后可按任意新维度重算 | 体量与 SQLite 不匹配（单机、无分区、ADR 里 PG 迁移还在 P2）；且事件明细天然携带更多可识别信息，隐私面最大。一个重度用户一天几百行，一年十几万行，只为画四条曲线。否决。 |
| **B2.（采用）日聚合表** `daily_stats(user_id, date, …)` | 一个用户一天一行，一年 365 行。日 / 周 / 月 / 年全部是对它做 `SUM` / `GROUP BY` | 体量可忽略，查询简单，天然不含任何可定位到「哪篇文章、哪个时刻」的信息。**加一个维度 = 加一列**，成本极低。 |
| B3. 客户端本地存明细，服务端只存聚合 | 明细留在用户自己机器上 | 和 B2 兼容、可叠加。**采纳其精神**：会话级明细（哪篇文章、水位多少）确实只留在扩展的 `chrome.storage.local`，见 Options C/D。 |

**B2 的代价要认**：选了日聚合就**永久失去**事后重算的能力。比如半年后想问「用户在哪个时段读得最多」，历史数据答不出来，只能从那天起加一列重新积累。接受——为一个还没上线的个人项目保留「任意维度事后重算」的能力，代价远大于收益。

### C. 会话状态（某篇文章读到哪了）放哪

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **C1.（采用）只放客户端 `chrome.storage.local`** | 扩展维护 `{urlKey → {totalWords, progressWords, lookups, countedAsArticle}}`；会话结束（标签关闭 / 切页 / 闲置超时 / 水位每涨 ≥N 词）时把**增量**上报服务端累加进 `daily_stats` | 服务端**零 URL 痕迹**，表最小。去重（同一篇文章不重复计入文章数）由客户端负责。 |
| C2. 服务端建 `reading_sessions(session_id, user_id, url_hash, …)` | 换设备能续、客户端不可刷 | 即使 URL 只存 HMAC：服务端持有盐，就能拿一份候选 URL 清单反查出用户读过哪些——**这是一份哈希了的浏览历史，不是零知识**。为了「换设备续读进度」这个几乎没人会注意到的好处，换一份浏览历史的保管责任，不划算。否决。 |
| C3. 纯客户端，完全不上报，统计只在本地 | 隐私最优 | 那 enx-ui 的 `/stats` 页就没数据可画，而用户明确要在网页端看成长曲线。否决。 |

**C1 的代价**：换设备或清扩展数据会让「文章数」重复计一次；客户端可以伪造自己的统计。两者都可接受——这是**用户自己的学习统计，不是计费、不是排行榜**，刷它只能骗自己。

### D. 文章身份怎么表示

| 方案 | 结论 |
| --- | --- |
| D1. 存完整 URL | 直接等于浏览历史。否决。 |
| D2. 存 host + HMAC(url, 用户盐) | 见 C2——服务端仍是哈希版浏览历史。否决。 |
| **D3.（采用）服务端什么都不存** | 上报体里**没有任何 URL 字段**，只有「本次会话新增阅读 N 词、是否算作一篇新文章（客户端判定的布尔）、新增查词 M 次」。文章身份完全是客户端概念。 |

### E. 日期边界（这决定了「今日」从几点开始）

| 方案 | 结论 |
| --- | --- |
| E1. UTC（跟现有 `dictionary_lookup_quota` 一致） | 对中国用户，「今天」从**早上 8 点**开始：晚上 11 点读的书算明天，早上 7 点读的算昨天。一个以「今日 / 连续天数」为核心体验的功能，用这个日界会持续制造困惑。否决。 |
| **E2.（采用）用户本地日期，由客户端上报** | 上报体带 `localDate: "YYYY-MM-DD"`（客户端算好）+ `utcOffsetMinutes`（存着备查）。服务端原样写入，不做时区换算。 | 
| E3. 服务端按用户 profile 里的时区换算 | Clerk 的 profile 没有可靠时区字段，还要额外维护。否决。 |

**注意口径分裂**：`dictionary_lookup_quota`（计费闸门）继续用 UTC 不动——它是配额，跨时区一致更重要；`daily_stats`（学习统计）用本地日期。**两者数字对不上是设计使然**，必须写进注释，否则以后一定有人来「修」这个 bug。这也是 ADR-027 把「今日查词 X/Y」从状态条里拿掉的又一个理由（见文末）。

### F. L2/L3 的数据从哪来——要不要复用 `credit_transactions`

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| F1. 长期直接查 `credit_transactions` | 不用新埋点，历史数据现成 | **统计寄生在计费上**：以后「缓存命中不计费」「某功能转免费」「批量结算」任何一个改动，都会让曲线在用户毫无察觉的情况下断档或跳变；`Settle` 失败只打日志不回滚，本来就会少记。ADR-018 刚把查词收敛成单一计量 seam，不该反过来让计量决定产品统计的口径。否决为长期方案。 |
| **F2.（采用）独立埋点写 `daily_stats`，`credit_transactions` 只用于一次性回填** | L2/L3 走和 L0/L1 同一条上报通道 | 口径独立、可解释、不受计费策略影响。上线时用 `credit_transactions` 回填历史那几个月的 L2/L3 列，是笔划算的一次性买卖。 |

### G. v1 从哪个维度开始（用户直接问的问题）

| 候选起点 | 评估 |
| --- | --- |
| 先做 L2/L3（用户觉得最有洞察的那两层） | **反对**。它们的价值在「**升级率**」——L2/L1 = 查了词还得看整句的比例，L3/L2 = 看了整句还得再查词的比例。这两个比率的**分母都是 L1**。L1 不存在时，L2/L3 的绝对次数只能告诉你「这周用得多」，和进步无关。而且 L2/L3 频次比 L1 低一个数量级，单看绝对值曲线抖得没法读。 |
| 先做文章数（最容易） | 太粗。一篇 300 词的推文和一篇 3000 词的长文各算一篇，曲线几乎不动。它应该跟着 L0 顺便做，不值得单独做一版。 |
| **（采用）先做 L0 阅读量 + L1 查词数** | **1)** L0 是所有归一化指标的**分母**，没有它，任何查词数都无法区分「读得多」和「读得吃力」；**2)** L0+L1 直接产出 **`每千词查词数`**——这是阅读能力最经典、最诚实的单一指标，它自带归一化，**下降 = 进步**，不会因为「这个月读得多」而虚涨；**3)** 两者的零件客户端全都现成（见 Context），后端只是一张表 + 一个上报口；**4)** L2/L3 之后只是**加两列 + 两个埋点**，不需要重新设计任何东西，而且历史能从 `credit_transactions` 回填，晚一个版本几乎零代价。 |

---

## Decision

### 1. 动作模型：理解阻力阶梯（Comprehension Friction Ladder）

把用户动作建模成一条**升级链**，每一级代表用户在上一级没得到满足：

```
L0  开始读一篇文章          enxRun                      → 阅读量、文章数的来源
L0.5 读到哪了（水位）        点击位置 ∪ 滚动深度          → 阅读量
L1  点词 → 词典释义         getOneWord                  → 「这个词不认识」
L1' 标记已认识              markAcquainted              → 唯一的正向信号
L1.5 划选短语查询            ADR-008 / ADR-017           → 短语级困惑
L2  提交整句 → 整句翻译      openSentencePanel/translateSentence → 「词典不够，句子也没懂」
L3  译文内再点词             translateWordInContext      → 「看了整句翻译还是不懂这个词」
```

**核心指标是升级率，不是绝对次数**：

- `L1 / 千词` —— 生词密度。**下降 = 词汇量在长**
- `L2 / L1` —— 查了词还得看整句的比例。**下降 = 句子结构能力在长**
- `L3 / L2` —— 看了整句还得再查词的比例。**下降 = 语境推断能力在长**

绝对次数只回答「这周用得多不多」，升级率才回答「我有没有变强」。四条曲线的设计（Decision 7）以升级率为主。

### 2. 阅读水位 = 点击位置 ∪ 滚动深度，取单调不降的最大值

客户端每篇文章维护一个 `progressWords` 水位：

- **`enxRun` 时**：把已经算出来的 `WordProcessor.extractWords(textContent).length` 存为 `totalWords`（现在这个数算完就丢）。同时把正文节点的**累计字符偏移表**建好，供后面把「字符偏移」换算成「词序号」。
- **点词时**：用已有的 `getTextOffsetWithin(container, reference)`（需从 private 提升为 internal）拿到点击词在正文中的字符偏移 → 换算成词序号 → `progressWords = max(progressWords, 该词序号)`。
- **滚动时**：一个节流的 `IntersectionObserver` / `scroll` 监听，算正文节点最深的已进入视口位置 → 同样换算 → 取 max。**保守折扣**：滚动水位按「视口底部往上一屏」计（刚滚到的那一屏不算读过），避免「拉到底 = 读完」。
- **水位单调不降**：往回点、往回滚都不降低。

**多正文节点**：`getArticleNodes()` 返回数组，偏移换算要跨节点用累计基址，不能各算各的。

### 3. 「算作读过一篇文章」的门槛

`progressWords >= 100` **且** `progressWords / totalWords >= 0.2` 才计入文章数。两个条件同时要，是为了同时挡住「打开长文看两眼」和「打开一条 30 词的推文就算一篇」。阈值写成常量并在注释里标为「拍脑袋的初始值，上线后按真实分布校一次」。

### 4. 服务端只存日聚合，且一个 URL 都不存

```sql
CREATE TABLE daily_stats (
  user_id                TEXT    NOT NULL,
  date                   TEXT    NOT NULL,  -- YYYY-MM-DD，用户本地日期（不是 UTC）
  utc_offset_minutes     INTEGER NOT NULL DEFAULT 0, -- 备查，不参与聚合
  words_read             INTEGER NOT NULL DEFAULT 0,
  articles_read          INTEGER NOT NULL DEFAULT 0,
  word_lookups           INTEGER NOT NULL DEFAULT 0,  -- L1
  words_mastered         INTEGER NOT NULL DEFAULT 0,  -- L1'
  new_words              INTEGER NOT NULL DEFAULT 0,  -- 生词本新增（可由 user_dicts.created_at 校验）
  -- v1.1 增列，v1 建表时就留好，默认 0：
  phrase_lookups         INTEGER NOT NULL DEFAULT 0,  -- L1.5
  sentence_translations  INTEGER NOT NULL DEFAULT 0,  -- L2
  context_lookups        INTEGER NOT NULL DEFAULT 0,  -- L3
  PRIMARY KEY (user_id, date)
);
```

一个用户一年 365 行。**表里没有任何 URL、域名、标题、文章 ID、时刻**——只有「某人某天读了多少、查了多少」。这是本 ADR 最重要的一条边界。

### 5. 上报协议 `POST /api/stats/ingest`

```jsonc
{
  "clientEventId": "uuid-v4",     // 幂等键，重试用同一个
  "localDate": "2026-09-16",      // 客户端算好的本地日期
  "utcOffsetMinutes": 480,
  "delta": {                      // 全部是增量，不是绝对值
    "wordsRead": 340,
    "articlesRead": 1,            // 0 或 1
    "wordLookups": 7,
    "wordsMastered": 2,
    "phraseLookups": 0,
    "sentenceTranslations": 1,
    "contextLookups": 0
  }
}
```

- **幂等**：`clientEventId` 先 `INSERT` 进轻量去重表 `stats_ingest_log(client_event_id PK, user_id, created_at)`，冲突即丢弃；该表 7 天 TTL（复用 ADR-022 reader 文档那套清理 goroutine 的模式）。
- **上报时机**：水位每提升 ≥ 100 词、或标签页 `visibilitychange → hidden`、或闲置 5 分钟、或扩展会话结束，取先到者。发送后客户端把已上报部分从本地水位里扣掉。
- **失败**：留在 `chrome.storage.local` 的待发队列，下次机会重发（同一个 `clientEventId`）。丢了就丢了——**统计允许有损，不重试到死**。
- **服务端校验**：单次 `delta` 各字段有上限（防手滑/防刷，例如 `wordsRead <= 50000`），超限截断并打日志。
- **计量边界**：这个端点**不查词、不调 AI、不动积分**，显式在 ADR-018 的计量 seam 之外（同 ADR-021 / ADR-026 的处理）。
- **L1 改走服务端（ADR-029 Decision 7a）**：ADR-029 之后，`dictionary.MeterLookup` 是全体用户查词的唯一必经点。扩展在查词请求上带 `X-Enx-Tz-Offset`，由 `MeterLookup` 顺手往 `daily_stats` 写一笔**本地日期**的 `word_lookups`。于是 **`ingest` 通道只需承载 L0（阅读量）**——只有客户端知道阅读进度，而查词数服务端本来就知道。好处：`每千词查词数`的**分子精确**，只有分母是估算；且不受上报队列丢包影响。缺失时区头时回退 UTC 并打 debug 日志。

### 6. 读取端点

- `GET /api/stats/overview` —— Home 用。今日 + 本周汇总 + 最近 7 天 sparkline + 生词本规模。契约见「对 ADR-027 的影响」。
- `GET /api/stats/series?period=day|week|month|year&from=&to=` —— `/stats` 页曲线用。服务端按 `date` 做 `SUM` / `GROUP BY`，返回等间隔点（**缺失的日期补 0，不能跳过**，否则曲线会撒谎）。

### 7. `/stats` 的四条曲线

| 曲线 | 指标 | 方向 | 说明 |
| --- | --- | --- | --- |
| ① 阅读量 | `words_read`（柱）+ `articles_read`（点） | 上升 = 读得多 | 最直观、最容易有成就感，放第一屏 |
| ② **生词密度** | `word_lookups / words_read * 1000` | **下降 = 进步** | **核心指标。** 自带归一化，不会因为读得多而虚涨 |
| ③ 升级率 | `L2/L1` 与 `L3/L2` 两条线 | **下降 = 进步** | v1.1 才有数据；v1 先不画这一格 |
| ④ 词汇积累 | `生词本总量` 与 `已掌握` 的堆叠面积 | 上升 = 积累 | 累计量，永远向上，是情绪上的「压舱石」 |

**②③ 是下降代表进步**，图上必须显式标注（副标题写 "lower is better"），否则用户会把进步读成退步。分母过小时（当周 `words_read < 500`）不画点而不是画一个噪声尖峰。

### 8. 诚实标注估算

阅读量是推断值，不是测量值。UI 上：数字旁一个 `ⓘ`，说明「按你查词的位置和滚动到的位置估算，实际可能更多」。**不四舍五入成看起来很精确的数**（显示 `1,200` 不显示 `1,237`）。

### 9. 配置项

新增两个 viper 项：`stats.ingest.max_words_per_report`（上报上限）、`stats.ingest_log_ttl_days`（去重表保留天数）。

### 10. 明确不采集的东西

URL、域名、页面标题、正文内容、阅读时刻（精确到秒/小时）、IP、设备指纹。**一个都不存。** `daily_stats` 的每一行都应当能直接给用户看而不引起任何不适——这是本 ADR 的验收标准。

---

## 指标字典（实现时以此为准）

| 指标 | 定义 | 来源 | v1 |
| --- | --- | --- | --- |
| `wordsRead` | Σ 各会话的最大阅读水位（词） | 客户端推断，见 Decision 2 | ✅ |
| `articlesRead` | 满足 Decision 3 门槛的会话数 | 客户端判定 | ✅ |
| `wordLookups` | L1 点词查词次数（含缓存命中，与 ADR-018 的计量口径一致） | **服务端 `MeterLookup`（ADR-029 Decision 7a）**，本地日期由请求头带 | ✅ |
| `newWords` | 当天首次进入生词本的词数 | 客户端埋点，可用 `user_dicts.created_at` 校验 | ✅ |
| `wordsMastered` | 当天标记「已认识」的词数 | 客户端埋点 | ✅ |
| `lookupsPer1k` | `wordLookups / wordsRead × 1000` | 计算得出，不落表 | ✅ |
| `sentenceTranslations` | L2 次数 | 客户端埋点 | v1.1 |
| `contextLookups` | L3 次数 | 客户端埋点 | v1.1 |
| `phraseLookups` | L1.5 次数 | 客户端埋点 | v1.1 |
| `escalationL2` / `escalationL3` | `L2/L1`、`L3/L2` | 计算得出 | v1.1 |
| `vocabTotal` / `vocabMastered` | `user_dicts` 计数（当前快照，非每日） | 直接查 | ✅ |
| ~~`streak`~~ | 连续活跃天数 | **`daily_stats` 就位后即可算**（有行 = 活跃），解决 ADR-027 Options G 的阻塞 | v1.1 |

---

## Rationale

- **从 L0+L1 起步，而不是从最有洞察的 L2/L3 起步**：升级率的分母是 L1，归一化指标的分母是 L0。先做分子等于先做一个除不了的除法。而且 L0+L1 的客户端零件全是现成的（总词数已经在算、偏移函数已经存在），后端就一张表——这是投入产出比最高的一刀。
- **日聚合而非事件表**：SQLite 单机、PG 迁移在 P2、用户是个位数到几百，用事件表换「事后任意重算」的能力，是为一个可能永远不会到来的分析需求预付成本。而且事件明细天生带隐私负担。
- **一个 URL 都不存**：这是能力问题也是立场问题。一个「帮你读英文网页」的扩展，一旦开始往服务器写你读过什么，它的性质就变了。ADR-026 为一条用户**主动提交**的反馈都要求隐私政策先行；被动采集的阅读统计只能更严。D3 让这件事没有灰度——不是「加密存」「哈希存」「脱敏存」，是**不存**。
- **本地日期而非 UTC**：一个以「今日」「连续天数」为核心体验的功能，日界必须和用户的「一天」对齐。为此接受和 `dictionary_lookup_quota` 口径分裂——后者是配额闸门，跨时区一致比贴合用户直觉更重要。两个表答的是两个问题。
- **L1 放服务端而不是客户端**（ADR-029 之后才可行）：`每千词查词数`是本 ADR 的核心指标，分母（阅读量）天然只能估算，那就更要让分子精确。服务端计数还顺带不可篡改、且和配额计数同源不会漂移。
- **不复用 `credit_transactions` 做长期数据源**：它现在确实免费提供了 L2/L3 的历史，很诱人。但把产品统计挂在会计账本上，等于让未来每一次计费策略调整都变成一次静默的统计口径变更。用它回填一次历史，然后各走各路。
- **升级率而非绝对次数**：用户这次提出的洞察（三层动作语义不同）真正的价值在这里。绝对次数会因为「这个月读得多」而全线上涨，看起来很励志但什么也没说明；升级率随阅读量归一化，下降就是真的变强了。
- **诚实标注估算**：阅读量是推断的，且两个来源的偏差方向相反。把它显示成一个精确数字是在撒谎；显示成带 `ⓘ` 的概数是在给用户一个他能正确使用的信号。

---

## Consequences

### Positive

- 第一次有了「阅读量」这个分母，之前所有孤立的计数（查词数、翻译数）才开始有意义。
- 「每千词查词数」给了用户一个**会下降的**进步指标——比任何累计计数都更接近他真正关心的事。
- `daily_stats` 一张表同时喂 Home 状态条、`/stats` 四条曲线、streak，解开了 ADR-027 Options G 留下的阻塞。
- 服务端零 URL 痕迹，隐私政策那一段可以写得非常短而且是真的：「我们记录你每天读了多少词、查了多少次，不记录你读的是什么。」
- v1.1 加 L2/L3 只是加两列 + 两个埋点，且历史可回填——增量路径干净。

### Negative

- 阅读量是**推断值**，两个来源的偏差方向相反且无法校准（没有 ground truth）。用户可能会说「我明明读了更多」。
- 日聚合永久放弃了事后按新维度重算历史的能力。
- 会话状态放客户端 → 换设备 / 清数据会重复计文章数，且用户可以伪造自己的统计。
- 客户端新增一个滚动监听器，要小心不要在长文页面上拖慢滚动（必须节流 + `passive`）。
- `daily_stats` 的本地日期和 `dictionary_lookup_quota` 的 UTC 日期**天然对不上**，会持续引发「这是不是 bug」的疑问。
- 又一个上报通道要考虑离线、重试、幂等——扩展侧的复杂度实打实上升。

### Mitigation

- **推断值**：Decision 8 的诚实标注 + 概数显示；`ⓘ` 文案直说「估算」。
- **口径分裂**：在两张表的模型注释里互相指认，并在 `/stats` 页脚一句话说明日界按本地时间算。
- **滚动性能**：`{passive: true}` + `requestAnimationFrame` 节流，水位计算只做一次除法；优先用 `IntersectionObserver` 哨兵元素而不是 `scroll` 事件。
- **重复计数**：客户端去重键用 `origin + pathname`（丢掉 query 和 hash），减少同一篇文章因为跟踪参数被算成两篇。
- **上报复杂度**：待发队列封在 `background` 里一个不超过 100 行的模块，**允许丢数据**——不做无限重试，不做本地持久化补偿，统计不是账。

---

## 对 ADR-027 的影响（需回写）

1. **状态条字段全换**。027 原本写「今日查词 12 / 50 · 生词本 348 · 已掌握 96 · 今天新增 7」，其中「12 / 50」是**配额视角**，对订阅用户不成立（Context 里的 `dictionary_lookup_quota` 偏斜）。改为**学习视角**：`今日阅读 1,200 词 · 查词 12 次 · 每千词 10 次 · 生词本 348`。**免费配额余量移到 Billing 卡里**，它是计费信息，不是学习信息。
2. **`GET /api/stats/overview` 契约重写**：`today` 块从 `{lookups, limit, unlimited, newWords}` 改为 `{wordsRead, articlesRead, wordLookups, newWords, wordsMastered}`；新增 `week` 同构块、`sparkline`（最近 7 天 `wordsRead` 数组，缺失补 0）、保留 `vocab` 与 `recent`。
3. **Home 状态条加一条 7 天 sparkline**（027 的 `StatStrip` 组件要能画一条极简折线）。
4. **新用户引导第 ③ 步**从「查第一个词」改为「**读完第一篇文章**」——和阅读量这个新的核心指标对齐，也是个更有意义的里程碑。
5. **streak 解禁**：027 Options G 因为没有可信活跃数据而否决了 streak；`daily_stats` 有行即活跃，v1.1 可以加回，027 的 Revisit Trigger 相应更新。
6. **套餐 / 余额卡明确口径**（用户本次确认要显示）：显示 `Subscription plan` + **积分余额**。ADR-009 的余额是**两个池**（`subscriptionBalance` 订阅赠送 + `topupBalance` 充值），建议**主显示合计**（用户只关心「我还能用多少」），hover / 次行再拆两个池——因为两个池的过期规则不同，完全不拆会在余额突然变少时造成困惑。
7. **扩展安装状态**保持 027 Decision 1 的设计不变（用户本次确认要显示）。

---

## 实施进度（2026-09-16 更新）

**✅ 已完成 —— v1 后端**

- `utils/sqlitex/stats_models.go`：`daily_stats`（v1.1 的三列一并建好、默认 0）+ `stats_ingest_log`，登记进 `AutoMigrate`。**按仓库既有惯例（`reader_documents`、计费三表）只走 AutoMigrate，没有写 `migrations/*.sql`**——本 ADR 原文提的 `migrations/0XX_daily_stats.sql` 与实际惯例不符，以实现为准。
- `stats/daily.go`：`Ingest`（幂等 + 截断 + 日期合理性校验）、`AddLookup`（服务端 L1）、`PurgeIngestLog`。**去重行与计数更新同一个事务**——分开提交的话，崩在中间会永久丢一次会话的数据（日志写了、计数没写，重试又被去重吃掉）。
- `stats/query.go`：`GetOverview`（today / week / sparkline / vocab / recent）、`GetSeries`（day/week/month/year 分桶，空桶补 0）。周一起算。
- `stats/handler.go`：`POST /api/stats/ingest`、`GET /api/stats/overview`、`GET /api/stats/series`，加 `X-Enx-Tz-Offset` 的读取与中间件。
- `enx-api.go`：三条路由注册在 `apiGroup`（不进查词计量路径）、`runStatsIngestLogCleanup()` 每小时清理去重行、两个鉴权组挂上 `stats.TZOffsetMiddleware()`。
- **Decision 7a 落地**：`dictionary.MeterLookup` 在放行后顺手 `stats.AddLookup`，best-effort。同一个动作现在被记两次，口径不同且**有意不一致**：`dictionary_lookup_quota` 是 UTC 日 / 记**请求数**（含被 429 的），`daily_stats` 是用户本地日 / 记**已服务的查词**。
- `utils/viper.go`：`stats.ingest.max-words-per-report`（默认 50000）、`stats.ingest.log-ttl-days`（默认 7）。
- 测试：`stats/daily_test.go` + `stats/query_test.go`，覆盖累加、幂等重放、日期越界拒绝、截断与负值丢弃、空 delta 无副作用、本地日分桶、sparkline 补零、周一起算、系列空桶补零、TTL 清理。`go build ./...` / `go vet` / `go test ./...` 通过。

**✅ 已完成 —— v1 客户端埋点（2026-09-17）**

- `enx-chrome/src/lib/readingProgress.ts`：`ReadingSession` 持有一篇文章的阅读水位。`charOffsetToWords()` 按**均匀词密度**把字符偏移折算成词序号——不建精确的 offset→word 表，是因为那张表每次 DOM 变动都要失效，换来的精度又被 Decision 8 的取整扔掉。多正文节点用累计基址（`NodeSpan.charBase`），不各算各的。水位单调不降；`takeDelta()` 交出增量的**同时**就地清零（统计允许有损，重复计数比丢一次更糟）。
- 滚动水位按 Decision 2 的保守折扣实现：判读线取**视口底部往上一屏**，刚滚进来的那一屏不算读过。用 `getBoundingClientRect()` 的客户端坐标，因此在内部 div 滚动的站点上同样成立。
- `enx-chrome/src/content/readingTracker.ts`：四个触发器（水位 +100 词 / 标签页 `visibilitychange → hidden` / `pagehide` / 闲置 5 分钟）。`pagehide` 与 `visibilitychange` 都挂上——前者在被丢弃或进 bfcache 的标签页上不保证触发，重复 flush 无代价（第二次拿到的增量是 0）。
- `enx-chrome/src/background/statsReporter.ts`：幂等队列。`clientEventId` 由 `crypto.randomUUID()` 生成，**重试复用同一个 ID**；队列存 `chrome.storage.local`（MV3 会回收 worker，模块变量活不过一次回收）；4xx（除 429）判定为永久失败直接丢弃，其余重试 3 次后放弃；上限 50 条。worker 每次启动顺手 drain 一次。
- **`X-Enx-Tz-Offset` 补上了**：挂在 `makeApiRequest` 这一个地方（enx-chrome）和 `ApiService.makeRequest`（enx-ui），所以**查词请求也带**。此前两端都没发这个头，Decision 7a 的「本地日」实际一直按 UTC 日在记——对 UTC+8 的用户，早上 8 点前查的词记到了前一天。
- 测试：`readingProgress.test.ts`（24 例，含跨节点累计偏移、单调性、滚动折扣、增量只报一次、文章只计一次）、`statsReporter.test.ts`（幂等 ID 复用、4xx 丢弃 / 429 重试、按序停在第一个瞬时失败）。`pnpm test` 210 例通过，`tsc` + `vite build` 通过。

**✅ 已完成 —— v1 展示端（2026-09-17）**

- `enx-ui`：`/stats` 从「日 / 周 / 月 / 年三张静态卡片」改成**一张图 + 两个切换**（桶大小 × 度量），见下方「对 /stats 形态的修订」。曲线 ① 阅读量、② 生词密度已上线；③ 等 v1.1；④ 词汇积累暂以 Home 状态条的数字承载，没单独画堆叠面积。
- `enx-ui`：Home 状态条 `StatStrip` 接 `overview`，**取代了原来的 "Continue reading"**（ADR-027 阶段 2 落地，见该 ADR 的修订）。
- Decision 8 落到了每一处：`approximateWords()` 用在状态条、汇总小卡、图表 y 轴刻度、tooltip 和表格视图上——早先只在小卡上取整，表格里却印着 `1,237`，反而显得小卡在撒谎。

**⏳ 待做**

- 部署：`task deploy:homelab`。
- 上线前硬前置未解除：`LAUNCH-CHECKLIST` §6.2 隐私政策页。**客户端埋点已经开始采集阅读行为**（仍然一个 URL 都不存），隐私政策必须先说清楚采什么、存多久。

---

## 对 `/stats` 形态的修订（2026-09-17，用户提出）

原 Decision 7 把四条曲线列成四格，加上日 / 周 / 月 / 年，隐含的版式是「很多块」。用户指出这不对：**日 / 周 / 月 / 年不是四个区块，而是同一张图的一个开关**。

落地形态：

- **桶大小**（day / week / month / year）是页面级开关，切换只换 `GET /stats/series` 的 `period` 与窗口宽度（30 天 / 12 周 / 12 月 / 5 年，见 `lib/statsWindow.ts` 的 `BUCKETS`）。
- **度量**（阅读词数 / 文章数 / 生词密度）是图内开关，**不重新请求**——一次 `series` 的返回够画所有度量。
- **一次只画一个度量，绝不上第二根 y 轴。** 阅读词数和查词次数差两个数量级，双轴图的两条线想让它们「相关」就能相关，度量开关就是用来替掉那根第二轴的。
- 图表是自己写的 SVG，没引第三方图表库：单序列的柱 / 线 + 网格 + tooltip + 表格视图，比一个依赖轻，也省掉私有源装包（见 `nexus-npm-registry-ca`）。

---

## 实施顺序

**v1（本 ADR 的最小集）**

1. enx-api：`migrations/0XX_daily_stats.sql`（建表，v1.1 的三列一并建好默认 0）+ `stats_ingest_log`。
2. enx-api：`stats/` 薄包——`POST /api/stats/ingest`（幂等 + 上限截断）、`GET /api/stats/overview`、`GET /api/stats/series`；TTL 清理 goroutine 复用 reader 那套。
3. enx-chrome：`src/lib/readingProgress.ts`——`enxRun` 存 `totalWords` + 累计偏移表；点击水位；滚动水位（节流）；本地会话状态。
4. enx-chrome：`background` 里的上报缓冲 + 幂等队列。
5. enx-ui：Home 状态条接真数据（ADR-027 阶段 2 合并进来做）。
6. enx-ui：`/stats` 画曲线 ①②④（③ 等 v1.1），带日 / 周 / 月 / 年切换。

**v1.1**

7. L1.5 / L2 / L3 埋点（三列已在表里），曲线 ③ 上线。
8. 用 `credit_transactions` 一次性回填 L2/L3 的历史列。
9. streak（`daily_stats` 有行即活跃），回写 ADR-027。

---

## Out of Scope（本次不做）

- 「读完了」确认按钮与完成仪式感设计（Options A1，留作正向激励而非统计手段）。
- 阅读时长 / 阅读速度（wpm）——需要可信的「在读」判定，而标签页可见性不等于在读。
- 按内容领域 / 难度分层的统计（需要正文分类，且要存正文特征，和 Decision 10 冲突）。
- 复习系统的统计（复习正确率、遗忘曲线）——那是复习功能自己的 ADR。
- `/rephrase` 的使用统计（不属于阅读阶梯，输出导向，独立维度）。
- 跨设备合并、数据导出、排行榜 / 社交对比。
- `reader_documents`（粘贴文本阅读器）的阅读量纳入——同一套水位逻辑可复用，但 `/reader` 是受控 DOM，实现路径不同，单独一版。

---

## Revisit Trigger

- 真实用户的 `wordsRead` 分布出来后 → 校准 Decision 3 的文章门槛（100 词 / 20%）。
- 如果有用户反馈「阅读量明显偏低」→ 重新评估滚动水位的保守折扣，或考虑 Options A1 的显式确认作为补充信号。
- 如果需要「哪个时段读得最多」「按站点分」这类 `daily_stats` 答不了的问题 → 重新评估 Options B1（事件表），届时应同时评估 PG 迁移。
- 一旦 SQLite → PostgreSQL 迁移（LAUNCH-CHECKLIST §8 P2）落地 → 事件表的成本结构改变，B1 重新可行。
- 一旦计费策略变更（缓存命中不计费 / 某功能转免费）→ 检查是否有人偷偷把统计又挂回了 `credit_transactions`。
