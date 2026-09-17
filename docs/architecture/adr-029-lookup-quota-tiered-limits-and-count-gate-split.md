# ADR-029：查词配额从「免费有限 / 订阅无限」的二元开关改为**人人都有额度、只是档位不同**，并把**计数与拦截解耦**——`limit <= 0` 的语义从「既不计数也不拦截」改为「照常计数、不拦截」；修订 ADR-009 决策 6、ADR-018 决策 2/5/8

| 字段 | 值 |
| --- | --- |
| **状态** | **已实现 — 2026-09-16**（代码 + 配置 + 文案全部落地；两档默认值仍为 0 = 「计数开、拦截关」，具体数值等上线后的真实用量）。修订两份已 Accepted 的 ADR 的具体决策，并修正 `LAUNCH-CHECKLIST` §1.5 里一个**无法自洽的上线计划**（见 Context）。**Decision 7a（L1 改服务端记 + 时区头）不在本次实现范围**，它属于 ADR-028 落地时的选型。 |
| **日期** | 2026-09-16 |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-billing-stripe-subscription.md`](../tasks/TASK-SPEC-enx-billing-stripe-subscription.md) §1.4 / §4.2（配额表与拦截语义，本 ADR 改动其口径） |
| **关联 ADR** | [`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（**修订其决策 6**「免费用户每日上限值待定；**订阅用户不限量**」→ 改为分档上限，订阅档高到正常用户碰不到，但**存在**）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（**修订其决策 2「订阅用户跳过」、决策 8「`limit <= 0` 维持无限语义」**；其决策 5 的 fail-open 策略**保留但改写**：失败时用最高档而不是「跳过计量」，#18「付费用户不被 DB 抖动降级 429」的不变量继续成立）、[`adr-028-reading-stats-what-to-measure.md`](adr-028-reading-stats-what-to-measure.md)（本 ADR 让 `dictionary_lookup_quota` 第一次成为**全体用户**的每日查词计数器，028 Context 里「该表对订阅用户偏斜」的描述随之修订，L1 的数据来源可改为服务端，见 Decision 7）、[`adr-027-enx-ui-app-home-workbench-and-return-path.md`](adr-027-enx-ui-app-home-workbench-and-return-path.md)（剩余额度的显示方式随之改为**状态驱动**，见 Decision 8） |
| **关联 Issue** | 与 [#21](https://github.com/wiloon/enx/issues/21)（配额行清理）直接相关：本 ADR 让配额行从「只有免费用户在限额生效时才有」变成「人人每天一行」，行数上升，清理策略的优先级提高。 |
| **关联代码** | **已实现（2026-09-16）。** `enx-api/billing/quota/lookup_quota.go`（`CheckAndIncrementLookup` → `IncrementLookup`，无条件计数 + `RETURNING count`；已验证 `glebarez/sqlite` 支持 `RETURNING`，采用 Options D1、未用回退方案）、`enx-api/dictionary/lookup.go`（`isActiveSubscriber` → `resolveLookupLimit`；`MeterLookup` 先计数再比较；429 文案按档位分层）、`enx-api/utils/viper.go` + `config.toml`（两档 + 旧键回退 + 新增 `BindEnv`）、`enx-api/utils/sqlitex/billing_models.go`（model 注释：`count` 可超 `limit`、与 `daily_stats` 口径不同）、`enx-api/billing/handler.go`、`enx-ui/src/app/(app)/billing/plans.ts`、`w10n-config/infra/stripe/opentofu/enx/main.tf`（`name` / `description`，**`lookup_key` 未动**；尚未 `tofu apply`）。 |

---

## 已确认的决策（2026-09-16，用户提出）

> 「`dictionary_lookup_quota` 的问题，我觉得不需要区分免费用户和收费用户，或者说，对于免费用户和收费用户，它不是一个开启和关闭的问题。免费用户的上限可能低一些，收费用户的上限会高很多很多，直到用不完。」

---

## Context

### 现状（三个事实，逐个查证过）

1. **`dictionary-lookup-daily = 0`**（`enx-api/config.toml:171`，viper 默认值也是 0）。
2. **`limit <= 0` 时 `CheckAndIncrementLookup` 直接 `return nil`，一行都不写**（`billing/quota/lookup_quota.go`）。
3. 因此 **`dictionary_lookup_quota` 表今天是空的——对所有人，不只是订阅用户。**

我在 ADR-028 里把这张表的毛病写成「只对免费用户写行」，那是**机制**层面的描述；**运行时**的实际情况更糟：谁的行都没有。

### 这不只是统计的问题——它让上线计划自相矛盾

`LAUNCH-CHECKLIST` 里两条：

- §1.5：「决策是『上线前不设、**上线后按真实用量再定**』，保持 `dictionary-lookup-daily = 0`（= 无限制）。**确认一下这个决策仍然成立**即可，无需改代码。」
- §8（P1）：「免费查词每日配额定具体数值（机制 `billing/quota` 已实现）。」

这个计划**永远执行不了**：`limit = 0` 的语义是「不计数也不拦截」，所以上线后**不会积累任何用量数据**，「按真实用量再定」的那个「真实用量」根本不存在。等到真想定数字的那天，手上只有零。

**根因不是配额值设成了 0，是「计数」和「拦截」共用同一个开关。** `CheckAndIncrementLookup` 用一条语句同时做两件事：

```sql
INSERT INTO dictionary_lookup_quota (user_id, date, count) VALUES (?, ?, 1)
ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?
```

这条语句的原子性是**对的**、是有意设计的（ADR-018：没有「读-改-写」窗口，同一用户并发查词既不会多计也不会撞键）。问题在于**它把「要不要拦」和「要不要记」绑成了一件事**：关掉拦截 = 关掉记录。

### 用户的修正为什么是对的（不止修 bug）

把配额从「开关」改成「档位」，顺带解决四件互不相干的事：

1. **付费账号第一次有了滥用天花板。** 现在订阅用户的词典查询是**字面意义上的无限**——账号被盗、脚本挂机、共享账号，都没有任何上限。一个高到正常人碰不到的天花板不是产品限制，是安全阀。
2. **每日查词数第一次对全体用户存在**（ADR-028 的 L1、ADR-027 的状态条都依赖它）。
3. **「Upgrade to enx Pro for unlimited lookups」这句文案目前是准确的，改了之后会变成假话**——反过来说，现在的实现逼着产品对外承诺一个「真·无限」，而那是个不该做的承诺。分档让文案变成可兑现的「高得多的每日上限」。
4. **配合下面的「计数与拦截解耦」，上线计划才闭环**：可以带着「拦截关闭、计数开启」上线，两三周后拿真实分布定数字——这正是 §1.5 本来想做的事。

### 为什么值得写 ADR

- **推翻两份 Accepted ADR 的明文决策**（ADR-009 决策 6「订阅用户不限量」、ADR-018 决策 2「订阅用户跳过」+ 决策 8「`limit <= 0` 维持无限语义」）。不留记录的话，下一个人读到那两条会以为现在的实现是违规的。
- **改动触及一条已经被专门推敲过原子性的 SQL**，以及一条被 #18 专门修过的 fail-open 路径。这两处都有「看起来可以简化、实际上不能」的陷阱。
- **口径变化会追溯影响数据**：改之前的历史行和改之后的行语义不同（前者只有免费用户且只在限额生效时存在），做趋势分析时必须知道分界点。

---

## Options Considered

### A. 配额模型

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| A1. 二元开关（现状） | 免费用户有上限，订阅用户完全跳过 | 付费账号零滥用保护；统计对付费用户永远空白；逼着对外承诺「unlimited」。否决。 |
| **A2.（采用）分档上限** | 人人都走同一条计量路径，只是 `limit` 不同：免费档低，订阅档高到正常用户碰不到 | 用户提出的模型。代码路径统一（少一个 `if subscriber` 分支）、付费账号有安全阀、统计对所有人成立、文案可兑现。 |
| A3. 查词也扣积分 | 和 AI 调用统一 | ADR-009 决策 6 已经否决过：为「边际成本近乎 0」的操作引入为「边际成本会变化」设计的账本，是过度设计，还会把免费查词从「钩子」变成「阉割版」。**本 ADR 不翻这个案。** |

### B. 计数与拦截的关系

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| B1. 合一（现状） | 一条 SQL 同时计数和拦截，`limit <= 0` 两个都不做 | 「不拦截」和「不记录」无法分开 → 上线计划死锁。否决。 |
| **B2.（采用）解耦** | **计数无条件发生**；拦截是计数之后的一次比较，`limit <= 0` 时跳过比较 | 让「先观察、后定值」成为可能。`limit <= 0` 的新语义：**照常计数，不拦截**。 |

### C. 超过上限之后还计不计数

| 方案 | 结论 |
| --- | --- |
| C1. 不计（现状语义：「被拒绝的调用什么都不碰」） | 上限设成 50，用户实际想查 200 次，你永远只看到 50。**恰好丢掉了最该知道的那部分信息。** |
| **C2.（采用）继续计，允许 `count` 超过 `limit`** | 超出的部分正是**被压抑的需求**——「有多少人撞墙了、撞得多狠」是定价和档位设计最直接的信号。代价：`count > limit` 的行会存在，任何读这张表的代码不能假设 `count <= limit`（写进表注释）。另外它把语义从「已服务的查询数」微调为「查询请求数」，429 的那些也算——这正是想要的口径。 |

### D. 「总是计数 + 之后比较」怎么保持原子

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **D1.（首选）`RETURNING`** | `INSERT … ON CONFLICT DO UPDATE SET count = count + 1 RETURNING count`，一条语句拿到自增后的值再比较 | 保持单语句原子，和现状同级。**实现时先验证 `glebarez/sqlite`（纯 Go modernc 驱动）支持 `RETURNING`**——SQLite 3.35+ 才有。 |
| D2.（回退）upsert 后再 `SELECT` | 两条语句 | **自增本身仍然原子**，不会多计也不会撞键；只有「读回来的值」可能已被同一用户的并发请求推高。最坏后果是边界处多 429 一次请求。对一个非 paywall 的用量闸门，完全可接受。 |
| D3. 事务包起来 | — | 为上述那点边界误差引入事务，不值得。否决。 |

### E. 档位粒度

| 方案 | 结论 |
| --- | --- |
| **E1.（采用）两档：`free` / `subscribed`** | v1 不区分 pro / pro-plus / max。没有任何证据表明这三档的查词行为不同，而查词的边际成本本来就近乎 0——分四档是把定价结构的复杂度提前泄漏到一个不需要它的地方。 |
| E2. 按 plan 四档 | 等真有订阅用户撞到 `subscribed` 上限、且撞的人集中在某一档时再拆。写进 Revisit Trigger。 |

### F. 日期边界

维持 **UTC**（不跟 ADR-028 的 `daily_stats` 走本地日期）。除了「配额跨时区一致」这个原有理由，还有一条更硬的：**本地日期可被用户自己改**——把设备时区往前拨就能重置当日额度。配额是对抗性场景，统计不是。两张表日期口径不同是**设计使然**，见 Decision 6。

### G. fail-open 怎么改

ADR-018 决策 5 + #18 确立的不变量是：**付费用户不能因为 DB 抖动被降级成 429**。它必须继续成立，但实现方式要改：

| 方案 | 结论 |
| --- | --- |
| G1. 失败 → 跳过计量（现状） | 保住了不变量，但丢了计数。 |
| **G2.（采用）失败 → 用最高档上限，但照常计数** | 档位解析失败（订阅表读不出来）时按 `subscribed` 档处理，不拦截任何人；计数照写。不变量成立，数据不丢。 |
| — | 计数本身写失败 | 维持 ADR-018 决策 5：log warn + 放行。**配额不是 paywall，绝不能因为计数写不进去就拒绝服务。** |

---

## Decision

### 1. 配额模型改为分档

每个用户都有一个 `limit`，由订阅状态决定：

```
无 active 订阅  → stripe.quota.dictionary-lookup-daily.free
有 active 订阅  → stripe.quota.dictionary-lookup-daily.subscribed
解析失败        → subscribed（最高档），且照常计数（Options G2）
```

**不再有「跳过计量」这条路径。** `dictionary/lookup.go` 里的 `isActiveSubscriber(userID) (bool, error)` 换成 `resolveLookupLimit(userID) int64`。

### 2. 计数与拦截解耦

```go
// 伪码：计数无条件发生，拦截是之后的一次比较
count, err := quota.IncrementLookup(ctx, userID, now)   // 总是执行
if err != nil {
    logger.Warnf(...)      // 计数失败 → 放行（ADR-018 决策 5 不变）
    return nil
}
if limit > 0 && count > limit {
    return ErrQuotaExceeded
}
return nil
```

- **`limit <= 0` 的新语义：照常计数，不拦截。**（旧语义：既不计数也不拦截。）
- `count` 允许超过 `limit`（Options C2）。**任何读这张表的代码都不得假设 `count <= limit`**，写进 model 注释。
- 计数函数 `IncrementLookup` 不再接收 `limit`，它不知道也不需要知道拦截策略——`billing/quota` 包变得更纯粹：**它只数数**。判断归 `dictionary.MeterLookup`。

### 3. 配置项从 1 个变 2 个

```toml
[stripe.quota]
# 每日词典查询上限。0 = 不拦截（但**仍然计数**，ADR-029）。
# 两档都设 0 = 只观察不限制，这是上线时的初始状态。
dictionary-lookup-daily-free = 0
dictionary-lookup-daily-subscribed = 0
```

旧键 `dictionary-lookup-daily` 保留一个版本作为 `-free` 的回退（读到旧键时打 warn），下个版本删。

### 4. 上线策略：带着「计数开、拦截关」上线

两档都设 0 上线 → 累积 2–4 周真实分布 → 定数字。这正是 `LAUNCH-CHECKLIST` §1.5 本来的意图，**解耦之后它才第一次变得可执行**。

定值建议（届时按真实数据校）：

- `free` ≈ 免费用户日查词量的 **p95 上浮一档**——目标是「几乎没人正常阅读会碰到，碰到的基本是重度用户或脚本」，不是「逼人付费」。ADR-018 决策 8 的原话：初值要**明显高于**一次正常长阅读会话点词总量的数倍。
- `subscribed` ≈ `free` 的 **20–50 倍**，且必须**高到正常人一天碰不到**（用户原话：「高很多很多，直到用不完」）。它是安全阀，不是产品档位。

### 5. 429 文案改写（以及所有对外承诺「unlimited」的地方）

现文案：`"Daily dictionary lookup limit reached. Upgrade to enx Pro for unlimited lookups."`

`unlimited` 在分档模型下是假的。改为：

```
"Daily dictionary lookup limit reached. Upgrade to Catglish Pro for a much higher daily limit."
```

（顺带把 `enx Pro` 改成对外品牌名 **`Catglish Pro`**——正式名见 `LAUNCH-CHECKLIST` §7.4，`adr-010` 的 `Catseye` 已 Superseded。）订阅用户自己撞到 `subscribed` 上限时，不能给这条「去升级」的文案，应给一条独立的「今日用量异常，请联系支持」——因为对他们来说撞墙意味着账号异常，不是该掏钱。

**同一句假话还在另外两处，必须一起改**（否则是白纸黑字写在结账页上的不可兑现承诺）：

- `enx-api/billing/handler.go:109` —— `an active enx Pro (or higher) subscription is required...`（品牌名也要换）
- **`w10n-config/infra/stripe/opentofu/enx/main.tf` 的 `stripe_product.*.description`** —— 现文是 `"... — unlimited dictionary lookups and AI translation credits each billing period"`。**这段会显示在 Stripe 结账页和收据上**，是三处里最该先改的。注意只改 `name` / `description`，**`lookup_key` 必须保持原样**（代码按它解析价格，改了直接查不到价）。

### 6. 与 `daily_stats` 的口径分裂（写进两处注释）

| | `dictionary_lookup_quota` | `daily_stats`（ADR-028） |
| --- | --- | --- |
| 日界 | **UTC** | **用户本地日期** |
| 目的 | 用量闸门 / 滥用天花板 | 学习统计 |
| 为什么不统一 | 本地日期可被改设备时区重置额度——对抗性场景 | 本地日贴合「我今天学了多少」的体感 |
| 口径 | 查询**请求**数（含被 429 的） | 用户**动作**数 |

**两张表的数字对不上是设计使然**，各自的 model 注释里必须互相指认，否则一定会有人来「修」这个 bug。

### 7. ADR-028 的 L1 数据来源可以简化

本 ADR 之后，服务端在 `MeterLookup` 这一个点上就掌握了全体用户的查词计数。ADR-028 原本让扩展客户端上报 L1，现在多一个选项：

| 方案 | 说明 |
| --- | --- |
| **7a.（推荐）L1 服务端记，L0 客户端记** | 扩展在查词请求上带一个 `X-Enx-Tz-Offset`（或本地日期）头，`MeterLookup` 顺手往 `daily_stats` 也写一笔本地日期的 `word_lookups`。好处：不可篡改、不受上报队列丢包影响、和配额计数同源不会漂移。代价：每次查词多一次 upsert；且**只有 L0（阅读量）需要客户端上报通道**。 |
| 7b. 维持 ADR-028 原案，L0/L1 都走客户端上报 | 通道单一，服务端不动。代价：`每千词查词数`的分子分母都带客户端丢包噪声。 |

**推荐 7a**：`每千词查词数`是 ADR-028 的核心指标，让它的分子精确、只有分母是估算，比两头都模糊要好得多。这条同时强化了 ADR-018「单一计量 seam」的价值——那个 seam 现在一处做三件事：计量、拦截、统计。

### 8. 剩余额度在 UI 上怎么显示（修订 ADR-027）

分档之后「今日查词 X / Y」对所有用户都算得出来了，但对一个上限 5,000 的订阅用户显示 `12 / 5000` 是纯噪声。所以**不是「显示 / 不显示」，而是状态驱动**——和配额本身「不是开关、是档位」同构：

- 用量 **< 70%**：状态条不显示额度；只在 Billing 卡里作为一行细节。
- 用量 **≥ 70%**：状态条出现一行额度提醒（免费用户可带升级入口）。
- 用量 **≥ 100%**：显著提示 + 升级入口。
- 两档都是 0（未启用拦截）时：**任何地方都不显示额度**——没有上限就没有「剩余」可言。

---

## Rationale

- **「不是开关，是档位」这个提法本身就是答案**：二元开关制造了三个互不相干的毛病（付费账号无天花板、统计对付费用户空白、被迫承诺 unlimited），而它们全都消失在同一个改动里。凡是一个改动同时解决三个不相关的问题，通常说明原来的抽象错了——这里错在把「用户类型」当成了配额的维度，其实用户类型只该决定**数值**。
- **计数与拦截必须解耦**，否则「先观察后定值」这个几乎所有用量型产品都要走的路径根本走不了。现状之所以没暴露，是因为还没上线——上线后要到「想定数字」的那天才会发现手上是零，那时已经损失了几个月的数据。
- **超限仍计数**：被拒绝的请求是信息量最大的那部分。丢掉它等于只测量「我允许发生的事」，测不到「用户想做的事」。
- **配额留 UTC、统计用本地日**：看起来是不一致，其实是两个不同的威胁模型。配额面对的是**会主动钻空子的用户**（改时区重置额度），统计面对的是**想看懂自己数据的用户**。同一个日界服务不了这两件事。
- **两档而不是四档**：查词边际成本近乎 0，按订阅档细分是把定价结构的复杂度泄漏进一个不需要它的机制。等有人真撞到墙再说。
- **文案诚实**：一旦上限存在，`unlimited` 就是可被用户验证为假的承诺。这种承诺不值得为它保留一个没有天花板的付费账号。

---

## Consequences

### Positive

- 付费账号第一次有了滥用天花板（被盗号 / 挂机脚本 / 共享账号的成本上限）。
- 每日查词量对**全体用户**开始积累，`LAUNCH-CHECKLIST` §1.5 → §8 的「先观察后定值」第一次可执行。
- ADR-027 的状态条、ADR-028 的 L1 有了可靠且可能免客户端上报的数据源。
- `billing/quota` 包变纯粹：只计数，不判断；策略全部收在 `dictionary.MeterLookup`。
- 对外文案从不可兑现的 `unlimited` 变成可兑现的「高得多的上限」。
- 代码少一个 `if subscriber { return }` 的提前返回，所有用户一条路径。

### Negative

- `dictionary_lookup_quota` 行数从「几乎为零」涨到「活跃用户数 × 天数」，#21（配额行清理）从「以后再说」变成**需要排期**。
- `count > limit` 的行会出现，任何假设 `count <= limit` 的读代码都会错。
- 每次查词多一次写（原先订阅用户这条路径一次写都没有）。SQLite 单机，量级要在真实负载下确认。
- 口径分界：改动上线前后的历史数据语义不同（之前只有免费用户、且只在限额生效时才有行），做趋势分析必须知道这条线在哪。
- 与 `daily_stats` 的 UTC / 本地日分裂会持续引发「这是不是 bug」的疑问。
- 采纳 Decision 7a 的话，查词请求要带时区头 —— 扩展、`enx-ui`、未来任何客户端都要记得带；漏带的客户端其统计会落到错误的日期（回退用 UTC）。

### Mitigation

- **行数增长**：#21 提到当前迭代；清理策略建议「保留 N 天明细 + 更早的滚进 `daily_stats` 或直接删」，与 ADR-028 的 `stats_ingest_log` TTL 复用同一个清理 goroutine。
- **`count > limit`**：写进 `DictionaryLookupQuota` 的 model 注释，并在改动的 PR 里 grep 一遍所有读这张表的地方。
- **每次查词多一次写**：`(user_id, date)` 是主键，单行 upsert；若成为瓶颈，先考虑批量/延迟写而不是回退到「订阅用户跳过」。
- **口径分界**：在 `LAUNCH-CHECKLIST` 和 model 注释里记下切换日期。
- **漏带时区头**：服务端缺头时回退 UTC 并打 debug 日志，不报错。

---

## 需要回写的其他文档

1. **`docs/tasks/LAUNCH-CHECKLIST.md` §1.5**：现文「保持 0（= 无限制），无需改代码」不再成立——**需要改代码**（解耦计数与拦截），然后才谈得上「上线后按真实用量再定」。
2. **ADR-009 决策 6**、**ADR-018 决策 2 / 8**：加一行指向本 ADR 的修订标注。
3. **ADR-028**：Context 里对 `dictionary_lookup_quota` 的描述（「只对免费用户写行」→ 运行时实际是「谁的行都没有」，且本 ADR 之后变成「人人有行」）；L1 来源改为 Decision 7a。
4. **ADR-027**：剩余额度的显示改为 Decision 8 的状态驱动。
5. **`TASK-SPEC-enx-billing-stripe-subscription.md` §1.4 / §4.2**：配额表与拦截语义。

---

## Out of Scope

- 具体数值（`free` / `subscribed` 各是多少）——同 ADR-009 / ADR-018 的惯例，属产品侧定价决策，且本 ADR 的整个要点就是**先收集数据再定**。
- 按 plan 细分四档（Options E2）。
- 查词接入积分系统（ADR-009 已否决，本 ADR 不翻案）。
- 反滥用 / 反刷单检测规则（ADR-009 决策 7：设计出来后保持私有，另立 ADR）。
- 配额行清理策略的具体设计（#21）。

---

## Revisit Trigger

- 上线后累积 2–4 周真实用量 → 回来填 `free` / `subscribed` 的数值，并回写 ADR-009 决策 6 的占位符。
- 如果有订阅用户真的撞到 `subscribed` 上限，且集中在某一个 plan → 重新评估 Options E2（按 plan 分档）。
- 如果配额行数或每次查词的额外写入成为 SQLite 的瓶颈 → 评估批量写 / Redis 计数器（ADR-009 已把「Redis / DynamoDB 做配额计数器」列在 P2）。
- 如果 Decision 7a 落地后发现时区头的漏带率很高 → 退回 ADR-028 的客户端上报方案（7b）。
