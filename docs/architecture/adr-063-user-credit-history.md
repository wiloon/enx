---
status: accepted
date: 2026-10-19
related: adr-009（两池积分账本）、adr-012（Settle 事后扣费）、adr-048（试用积分与 `EXPIRE`）、adr-049（管理员流水时间线、`GRANT_ADMIN` / `DEDUCT_ADMIN` 的 `note`）、adr-051（邀请积分）、adr-062（注销账号时账本保留）、WIL-186（查词句子复习，不在本 ADR 范围）
---

# ADR-063：用户积分历史；增减同列、与管理员同源；流水补记三池合计余额

用户现在看不到积分花到了哪里、又是从哪里来的。`/billing` 只显示当前余额。管理员在 `/admin/users/[id]` 能看到一个用户的完整流水时间线（adr-049），用户自己却没有对应的页面。真有人问「我的积分怎么少了」，管理员和用户手里看到的是两样东西，对不了账。

数据其实都在 `credit_transactions` 里：AI 消耗（`SETTLE`，旧数据有 `CONSUME`）、AI 调用失败退回（`REFUND`）、充值、订阅发放、试用、邀请、管理员加减、试用过期（`EXPIRE`）、退款扣回（`CLAWBACK`），每笔一行。但是拿给用户看之前，有两个问题必须先解决：

- **`balance_after` 的含义不统一。** `SETTLE` 记的是三个池（试用、订阅、充值）的合计；`GRANT_TOPUP`、`GRANT_ADMIN`、`DEDUCT_ADMIN`、`GRANT_REFERRAL_REWARD` 只记充值池；`GRANT_SUBSCRIPTION` 只记订阅池；`GRANT_TRIAL`、`GRANT_REFERRAL_BONUS` 只记试用池；`CLAWBACK` 记它扣的那个池。按时间排在一起，这一列会忽高忽低。
- **订阅续费是覆盖，不是累加。** `GrantSubscription` 直接把 `subscription_balance` 设成本期额度，上一期没用完的积分就这样没了，流水里没有任何一行。用户看到「+500」，合计余额却没涨 500。

## Decision

### 一、一个列表，增减都在里面

1. **用户和管理员看的是同一份流水。** 读流水的逻辑（游标分页、新的在前、类型到来源的映射、筛选）从 `adminuser.Service.Transactions` 抽出来，成为管理员接口和用户接口共用的一处，标签和来源分类也只定义一次。两边的区别只在于每行显示哪些字段（见第 5 条）。
2. **增加和减少放在同一个列表里，用筛选区分**：`All` / `Added`（`amount > 0`）/ `Used`（`amount < 0`）。按金额正负划分，不按类型划分：`EXPIRE`、`CLAWBACK`、`DEDUCT_ADMIN` 都算在 `Used` 里，`REFUND` 算在 `Added` 里。金额为 0 的行（更早一期订阅被退款时，`CLAWBACK` 扣 0）只在 `All` 里出现。筛选在服务端做，接口参数 `direction=in|out`，这样分页才正确。
3. **新接口** `GET /api/me/credits/transactions?limit=&before=&direction=`，只返回当前用户自己的流水。管理员接口 `GET /api/admin/users/:id/transactions` 也增加同样的 `direction` 参数。
4. **页面在 enx-ui 的 `/billing/history`**，入口是 `/billing` 余额卡片上的 "Credit history" 链接，用户导航栏不另加一项。管理员详情页的时间线和这个页面用同一个组件，管理员模式下多显示几个字段。

### 二、每行显示什么

5. **用户看到的字段**：时间、类型标签、增减数量、变动后合计余额（第 7 条），以及 `GRANT_ADMIN` / `DEDUCT_ADMIN` 的 `note`，也就是管理员填写的原因（用户 2026-10-19 确认显示）。管理员填原因时，界面提示「用户会看到这段文字」。
   **用户看不到的字段**：Stripe payment intent、`stripe_event_id`、`related_transaction_id`、`CLAWBACK` 的 `note`（里面是 Stripe charge id），以及按池记的 `balance_after`。管理员能看到全部字段。
6. **AI 消耗只显示调用类型和时间，不显示查的单词或句子**（用户 2026-10-19 决定）。类型标签按 `feature` 区分，例如 `lookup_word_ai` → "AI word lookup"，`translate_word_in_context` → "Word translation"，`translate_sentence` → "Sentence translation"，`translate_sentence_with_word` → "Sentence translation"，`rephrase_to_english` → "Rephrase"。不认识的 `feature` 显示为 "AI usage"。流水表也**不新增**记录单词或句子内容的列。这和现行隐私政策一致（"a record of each AI call (which feature, how much it cost)"、"We do not store the sentence or the translation"），隐私政策不用改。

### 三、流水补记三池合计余额

7. **`credit_transactions` 新增可空列 `total_balance_after`**：写这一行时，三个池的可用积分合计，算法和 `Settle` 的 `spendable` 一样（未过期的试用池 + 订阅池（负数按 0 算）+ 充值池，充值池可以是负数）。写入集中在 `insertLedgerRow`：同一个事务里，余额更新完以后读一次账户，算出合计再写行，各个 `Grant*` / `Settle` / `Clawback` 不用各自去算。原来的 `balance_after` 保持按池记录，语义不变，只给管理员排查用。
8. **订阅续费前，先把上一期的剩余记一行 `EXPIRE`。** `GrantSubscription` 覆盖 `subscription_balance` 之前，如果旧余额大于 0，在同一个事务里先写一行 `EXPIRE`：`feature = "subscription"`，`amount` 为负的旧余额。这样「上期剩余作废」和「本期发放」各占一行，每一行的 `amount` 都等于 `total_balance_after` 的变化量。用户界面上，`feature = "trial"` 的 `EXPIRE` 显示为 "Trial credits expired"，`feature = "subscription"` 的显示为 "Unused subscription credits expired"。
9. **试用过期仍然懒写入，但改为任何一次写流水之前都先结算。** 现在只有 `Settle` 会先调用 `expireTrial`。如果试用过期后用户先充了值，充值那一行的合计余额已经不含试用（`effectiveTrial` 为 0），之后 `Settle` 再补写的 `EXPIRE` 行却带着负数金额，这两行就对不上了。所以每个会写流水的事务都先调用 `expireTrial`，再更新余额。`EXPIRE` 行的时间戳仍然是写入时刻，不改成真正的到期时间：时间线按写入顺序排，改了时间反而会出现乱序。
10. **不回填老数据。** 订阅被覆盖掉的那部分没有任何记录，老行的合计余额算不准，所以 `total_balance_after` 留空，页面显示 "—"。生产库 2026-10-14 重置过，受影响的行很少。

### 四、按天聚合 AI 消耗

11. **数据库里仍然逐笔记录；界面把同一天、同一类型的 AI 消耗合并成一行**，例如 "Oct 19 · Word translation ×37 · −74"，点开能看到每一笔。合并是 enx-ui `src/lib/` 里的纯函数，输入已加载的流水行，输出分组。分组跨分页边界时，加载下一页后合并进同一组。只合并 `SETTLE` / `CONSUME`；`REFUND` 和其他类型照常逐行显示。聚合行的「变动后余额」取组内最后一笔（最早时间在下，最新在上，取最新那笔）。
12. **注销账号**沿用 adr-062：账本保留，只带不透明的 user id。流水里没有单词和句子，不用额外清理。

## Considered Options

**AI 消耗要不要显示内容**

- **显示单词，句子只记前几十个字符**：用户更清楚钱花在哪。但存句子前缀和隐私政策的 "We do not store the sentence" 直接冲突，截断也不能真正保护隐私。存单词又会产生「什么时间查了哪个词」这种长期保留的组合，而 adr-059 的查词事件当初特意没有记录单词。否决。
- **只显示类型和时间**：不新增任何内容数据，隐私政策不用改。**采用**。句子作为复习素材另做功能，开关默认关闭，用户手动打开后才保存句子（WIL-186，第一版不做）。

**变动后余额怎么显示**

- **不显示余额列，只在页面顶部显示当前余额**：改动最小，但做不到逐行对账，而用户要积分历史就是为了对账。否决。
- **把 `balance_after` 统一改成合计并回填**：老数据算不准，管理员也就看不到按池的余额了。否决。
- **新增 `total_balance_after`，续费前补记 `EXPIRE`，老行留空**：新行全部能对上，按池的数据也保留。**采用**（用户 2026-10-19 确认）。

**增减分两个列表还是一个**

- **分成「消耗记录」和「充值记录」两个列表**：各自更短，但合计余额只有在完整的时间顺序里才对得上。否决。
- **一个列表加筛选**：**采用**。

**用户页单独写还是和管理员共用**

- **用户页单独写一套查询**：两边很快就会对不上（比如新增一种流水类型，只改了其中一边的标签）。否决。
- **共用读取逻辑和组件，只在显示字段上区分**：**采用**。

## Consequences

- 用户能自己查积分去向，管理员在客服对话里看到的和用户看到的是同一个列表。
- 订阅用户每次续费会多一行 `EXPIRE`（上期有剩余时）。管理员页 adr-049 的累计数里，`EXPIRE` 以前只来自试用，现在也会来自订阅，`sourceOf` 需要按 `feature` 区分。
- 以后新增流水类型，只要经过 `insertLedgerRow` 就自动带上合计余额；标签在共用的一处添加，两个页面同时生效。
- 老行显示 "—"，直到用户的流水完全是新数据为止。

## Verification

1. **enx-api 单测**（假仓储或真实 SQLite，和现有 `credit` 包测试一致）：
   - 依次执行「试用发放 → 充值 → AI 消耗 → 订阅发放 → 订阅续费 → 管理员扣减 → 退款扣回」，每一行的 `amount` 等于相邻两行 `total_balance_after` 之差。
   - 续费时旧订阅余额 > 0，写出 `EXPIRE`（`feature = "subscription"`）；旧余额为 0 时不写。
   - 试用过期后，第一次写流水的是充值（不是 `Settle`）：先写出 `EXPIRE`，再写充值行，两行都满足上一条的等式。
   - `direction=in` / `out` 的筛选和游标分页正确；金额为 0 的行只出现在不筛选的结果里。
   - `GET /api/me/credits/transactions` 只返回当前用户的行，不返回第 5 条列出的内部字段，只有管理员类型的行带 `note`。
2. **enx-ui 单测**：聚合纯函数（同一天同一类型合并、跨页合并、`REFUND` 不合并、余额取最新一笔）；标签映射（每个 `feature` 和两种 `EXPIRE`）；`total_balance_after` 为空时显示 "—"。
3. **e2e**（已登录用户）：`/billing` → "Credit history"，能看到列表，切换筛选后列表更新。
4. **手动验证**：在 homelab 用测试账号充值一次、用几次 AI、管理员加一次积分，对照用户页和管理员页，两边的行和余额一致，管理员填的原因在用户页可见。
