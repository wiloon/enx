# ADR-018：查词计量收敛到一个函数——删掉没人调的 `GET /ecdict`，`dictionary.MeterLookup` 成为所有查词路径唯一的计量点，每次调用计一次每日配额（不去重、缓存命中也算），SQLite 单条 upsert 计数，配额存储出错时 fail-open

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-06。删掉死接口 `GET /ecdict`（#19/#20 随之消失）、seam 收敛（A2，收敛后只剩 `translateWord` 一个 caller）、每次调用计量不去重（B2）、SQLite 不上 Redis（C2）、单条 upsert（D2）、词典路径 fail-open（E2）、#17/#18 一并修均已确认。TDD 进度：**步骤 0（删 `/ecdict`，`abbb590`）、1（单条 upsert，`ce0dc13`）、2（`Lookup` fail-open #17/#18，`bbf0d44`）、3（`MeterLookup` 收敛 + 本地命中也计量 B2）已完成**。剩余步骤 4（配额行清理）。A2 的「本地 `words` 查询搬进 `dictionary.Lookup`」这部分因 `translateWord` 复习计数无测试覆盖而推迟，见 Decision 1。 |
| **日期** | 2026-09-06 |
| **关联 Spec** | [`TASK-SPEC-enx-billing-stripe-subscription.md`](../tasks/TASK-SPEC-enx-billing-stripe-subscription.md) §4.2 已把 `dictionary.Lookup` 定位为「统一查词入口，在返回结果前插入配额检查」——本 ADR 是**把这个意图补齐**（实现时 `fillFromEcdict` 把「先查本地」的分支留在了 seam 外）；配套 TASK-SPEC 增补留到编码阶段（同 ADR-008 / ADR-011 / ADR-017 的做法） |
| **关联 ADR** | [`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（Decision 6：免费查词走独立每日配额、不进积分系统；本 ADR **澄清并延续**它——配额覆盖**所有释义查询**，含本地缓存命中，并把计量点收敛到一个 seam）、[`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（AI 翻译按 token 计费、与查词配额是两个独立计量器；本 ADR 不动 AI 侧） |
| **关联 Issue** | 解决 [#16](https://github.com/wiloon/enx/issues/16)（配额先扣后查——本 ADR 确认这是有意的）、[#17](https://github.com/wiloon/enx/issues/17)（非 sentinel error 被当「查无此词」）、[#18](https://github.com/wiloon/enx/issues/18)（`isActiveSubscriber` 吞错误、订阅者被降级 429）、[#19](https://github.com/wiloon/enx/issues/19) + [#20](https://github.com/wiloon/enx/issues/20)（`/ecdict` 的错误处理 / 计量不一致——**通过删除这个无客户端的死接口解决**，见 Decision 0） |

---

## Context

### 查词有两条 handler，其中一条是死的

**翻译路径**（`GET /translate`、`GET /word/:word` → `translate/service.go` 的 `translateWord`）——两个真实客户端都走这条：enx-chrome 查词浮层（`getOneWord` → `/api/translate?word=`）、enx-ui `/lookup` 页（`/api/word/:word`）。

1. `word.SetEnglish(raw); word.Translate(userId)` —— 查本地 `words` 表（+ `user_dicts` join 拿 `LoadCount`/`QueryCount`），命中则 `word.Id != ""`。
2. `fillFromEcdict(c, &word, userId)`（`translate/helpers.go:27`）：
   ```go
   if word.Id != "" {
       return true, false        // 本地命中 → 不查 ECDICT、不走配额
   }
   epc, err := dictionary.Lookup(c.Request.Context(), word.English, userId)  // 只有新词才走到这
   ```

**`GET /ecdict`（`DoSearchEcdict`）**：直接 `dictionary.Lookup(ctx, key, userID)`，没有「先查本地」这一步，每次都走配额。**这个接口没有任何客户端在调**——2026-07-30 ECDICT 集成 PR（#6）加进来，之后 `stripe` commit 还认真地「把它路由过 `dictionary.Lookup` 以防绕过配额」，给一个没人用的接口加防护。enx-ui / enx-chrome / enx-api-java / mock-api / `.http` 测试文件 / smoke 脚本里都没有对它的引用。

计量口径的不一致（#20：本地命中在翻译路径免费、在 `/ecdict` 收费）**只存在于这个死接口和翻译路径之间**——今天零用户影响。但不一致的死代码是给以后复活它的人埋的坑，且 #19（`/ecdict` 通用错误返回 `200 {Dict:null}`）也挂在它上面。最干净的处理是删掉它，见 Decision 0。

### seam 在错的位置

TASK-SPEC-billing §4.2 写的是「`dictionary.Lookup` = 统一查词入口」。实现时没做到：`dictionary.Lookup` 名字像「查一个词」，实际只是「查 ECDICT + 配额」的薄包装——「先查本地库、本地没有再查 ECDICT」这个决策留在 caller 里（`fillFromEcdict` 自己判 `word.Id != ""` 提前返回）。应用层本该只说「查这个词」、不关心命中的是本地缓存还是 ECDICT，现在做不到，配额也就跟着漏在了「本地命中」这条路径上——今天所有真实查词都走翻译路径，所以**本地命中的词永远不计配额**。

### 这条路径的错误处理很脆（#17 / #18）

- `fillFromEcdict` 只认两个 sentinel error（`ErrEcdictUnavailable` / `ErrQuotaExceeded`），任何其他错误（比如配额事务里的 DB 故障）落到 `epc == nil` 分支，被当成「ECDICT 里没这个词」，用户看到「查无此词」——真释义被一次基建抖动藏掉了。
- `isActiveSubscriber`（`dictionary/lookup.go:44`）丢弃 GORM 查询错误：`Count` 出错 → `count` 保持 0 → 返回 `false` → 给一个正在付费的订阅者跑了免费配额，配额用满就 429。

（#19：`DoSearchEcdict` 通用错误返回 `200 {Dict:null}`——随死接口一起删掉，不单独修。）

### 计数器是读后写的事务

`CheckAndIncrementLookup`（`billing/quota/lookup_quota.go`）现在是**先 `First` 再 `Create`/`Update`** 的事务。理论上当天首查并发时 N 个 goroutine 全部 `ErrRecordNotFound` → 全部 `tx.Create` 同一个 `(user_id, date)` PK → 冲突。

**实测（2026-09-06，`TestCheckAndIncrementLookupConcurrentFirstOfDay`，30 goroutine × 5 轮）：不复现。** `_txlock=immediate` 让每个 `Transaction()` 在 `BEGIN IMMEDIATE` 就拿 RESERVED 锁，事务被完全串行化，第二个 goroutine 进来时行已存在、走 `Update` 分支。所以这不是一个当前可复现的 bug（review 给的是 PLAUSIBLE）。

但读后写的形态本身是脆的：换掉 `_txlock=immediate`、或极端争用下超过 `busy_timeout(10000)`，窗口就回来了。而且三分支事务比一条语句难读。D 节把它换成单条原子 upsert——**纯简化 + defense in depth，不改语义**。

### 设计问题：要不要 Redis

讨论中提出：计数器放 SQLite 够不够，要不要引 Redis。本 ADR 一并回答。

### 已确认的取舍（2026-09-06，用户确认）

1. **不去重**：查一次算一次，缓存命中也算。上限设高，正常用户碰不到。理由：抗滥用的威胁是「一个用户 / 一个 token 每小时刷上万个词」，答案来自缓存还是 ECDICT 跟这个威胁无关；不去重实现最简单。是**为未来收窄免费额度打基础、并防攻击流量恶意查询**的一层用量封顶。
2. **先扣后查是有意的**（#16）：`CheckAndIncrementLookup` 在实际查询之前，查了就算，不管结果是否为空。
3. **SQLite，不上 Redis**。

---

## Options Considered

### 0. 死接口 `GET /ecdict` / `DoSearchEcdict` 怎么处理

| 方案 | 结论 |
| --- | --- |
| 修它（#19 的 5xx 分支、#20 的计量一致） | 花力气修一个没人调的接口的错误处理 |
| **（采用）删掉它**：两条路由（`authGroup` + `apiGroup`）、`DoSearchEcdict`、`SearchResult` struct、随之无用的 `"enx-api/dictionary"` import | 无客户端、无测试覆盖、无 `.http` / smoke 引用；删了 #19 / #20 就不存在（「一个不存在的接口没法不一致」）；`dictionary.Lookup` 收敛后只剩 `translateWord` 一个 caller，seam 重构面更小。已实现（`enx-api.go`），`go build` + `dictionary`/`translate`/`billing` 包测试通过 |

### A. seam 放哪 / 封装边界

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| A1. 现状：`dictionary.Lookup` = ECDICT-only 包装，「先查本地」留在 caller | `fillFromEcdict` 判 `word.Id` 提前返回，本地命中的词绕过配额 | seam 太浅；配额漏在本地命中路径上（今天所有真实查词都命中这条）|
| **A2.（部分采用）「一个计量点」立刻做，「深 seam」推迟** | **本次**：抽 `dictionary.MeterLookup(ctx, userID)`，所有查词路径（`Lookup` 的 ECDICT 分支 + `fillFromEcdict` 的本地命中分支）都调它 → 计量收敛到一个函数、B2 达成。**推迟**：把本地 `words` 查询也搬进 `dictionary.Lookup`（让 caller 只说「查这个词」）——因为 `translateWord` 的本地查询紧挨着 `user_dicts.QueryCount` 复习计数记账，而**那段记账零测试覆盖**，盲改风险大 | 计量收敛 + `/ecdict` 已删 + 单 caller，已经消掉「某条路径漏计量」的风险；深 seam 的额外收益（应用层完全不碰本地/ECDICT 之分）等它值得的时候再做，见 Revisit |

**`QueryCount` 复习计数无论如何不进 seam**：`translateWord` 在本地命中时会 `user_dicts.QueryCount++`（并在标过「已掌握」时翻回未掌握）——这是复习系统的熟悉度追踪（CONTEXT.md「复习档位」），跟「把词解析成释义」是两个 concern。

### B. 计量口径：去重 vs 不去重，缓存命中算不算

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| B1. 按去重词数（每人每天每词只计一次） | 配额表键 `(user_id, date, word)` 或每日 distinct 计数 | 「重看自己查过的词不花钱」对用户更友好，但实现更复杂（每人每天一个词集合 / distinct 计数）。**放弃**（用户确认） |
| **B2.（采用）每次调用计一次，不去重，缓存命中也算** | `dictionary.Lookup` 每成功进入一次（非订阅用户）就 `+1` | 实现最简单；抗滥用效果不打折（scraper 要的是广度，去重不去重都撞墙）；上限设高，正常阅读用户碰不到。**明确澄清 ADR-009 Decision 6：配额覆盖所有释义查询，含本地缓存命中** |

### C. 计数器存哪

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| C1. Redis：`INCR` + `EXPIRE` | 原子自增、TTL 自动过期昨天的计数 | 引一个有状态服务进 homelab k8s，要自己的持久化 / 备份；**多副本共享计数器**才需要它，homelab 是单 pod（PVC RWO），没这个问题 |
| **C2.（采用）SQLite，复用现有 `dictionary_lookup_quota` 表** | 跟 `billing/credit`（AI 积分账本）同一套存储；SQLite 已配 WAL + `synchronous(NORMAL)` + `busy_timeout(10000)` + `_txlock=immediate`，已有 40-goroutine 并发不超发测试 | 每人每天一次自增的量离 SQLite 单写者瓶颈差几个数量级；少一个 homelab 组件；跟 AI 积分一套心智模型。行累积用清理 job（见 G），不是上 Redis 的理由 |

### D. 并发下的 check + increment

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| D1. 现状：事务内 `First` → 没有则 `Create`、有则条件 `UpdateColumn` | 读后写，三分支 | 靠 `_txlock=immediate` 串行化才不出问题；形态脆、难读 |
| **D2.（采用）单条 upsert，`DO UPDATE` 带 `WHERE`**（**已实现**） | `INSERT INTO dictionary_lookup_quota (user_id, date, count) VALUES (?, ?, 1) ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?`。`RowsAffected == 0` → `ErrQuotaExceeded` | `WHERE count < limit` 让被拒的调用**不落库**——与现状**语义完全一致**（`TestCheckAndIncrementLookupExceedsLimit` 的「rejected attempt shouldn't count」原样绿），没有 `RETURNING` 方案那种「多放 1 次」的妥协。一条语句、无事务、无读后写窗口。`(user_id, date)` 已是复合主键，唯一约束现成 |

### E. 配额存储读写出错时怎么办

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| E1. fail-closed：错误冒泡 → 5xx / 拒绝查词 | 跟 AI 积分路径一致 | 一次词典查询边际成本 ≈ 0，为它在存储抖动时挡住用户不划算；#17/#18 已经证明 fail-closed 的 bug 容易误伤真实用户 |
| **E2.（采用）fail-open：配额表读/写出错时，放行这次查词 + 记 `warn`** | **策略在 `dictionary.Lookup` 层**，`billing/quota` 保持诚实：`CheckAndIncrementLookup` 仍返回真实错误，`Lookup` 把非 `ErrQuotaExceeded` 的错误 log warn 后放行。`isActiveSubscriber` 出错 → log warn、当作**订阅者**处理（跳过配额）。`limit <= 0 = 无限` 的既有惯例本来就是这个方向（ADR-009 Decision 6 的注释已写明「配额失败开放，最坏是免费查词多放一会儿，不是坏掉的 paywall」） | 存储故障期间配额短暂完全失效——可接受，它不是 paywall。**AI 积分路径维持 fail-closed**（那是真钱，ADR-014） |

### F. #17 / #18 的错误处理（随本 ADR 一并修）

| Issue | 修法 |
| --- | --- |
| #17 | **由 E2 直接解决**：`Lookup` 对配额存储错误 fail-open（放行 + warn），不再把它冒泡成 `(nil, err)` 让 `fillFromEcdict` 当「查无此词」。`fillFromEcdict` 里 `epc == nil` 现在只可能是「ECDICT 真没这个词」（已加注释说明这个契约）。测试：`TestLookupFailsOpenWhenQuotaStoreUnavailable`（删掉配额表 → `Lookup` 仍成功） |
| #18 | `isActiveSubscriber` 改签名返 `(bool, error)`；`Lookup` 出错 → log warn + 当订阅者处理（跳过配额），不 429 付费用户。测试：`TestLookupTreatsSubscriberCheckFailureAsSubscriber`（删掉 subscriptions 表 → 免费上限也不触发） |
| #19 | 不单独修——挂在死接口 `DoSearchEcdict` 上，随 Decision 0 一起删掉 |

### G. 旧配额行清理

| 方案 | 结论 |
| --- | --- |
| 每个活跃用户每天一行、永久累积 | 行很小不急，但加一个定期 `DELETE FROM dictionary_lookup_quota WHERE date < <N 天前>`（复用 w10n-config 已有的 cron job 模式，如 `nexus clean up job`），或 enx-api 启动时跑一次。**不是**上 Redis（TTL 白送清理）的充分理由 |

---

## Decision

0. **删掉死接口 `GET /ecdict`**（已实现）：移除 `authGroup` / `apiGroup` 两条 `GET("/ecdict", DoSearchEcdict)` 路由、`DoSearchEcdict` 函数、`SearchResult` struct、随之无用的 `"enx-api/dictionary"` import（`enx-api.go`）。`go build` + `dictionary`/`translate`/`billing` 包测试通过。#19、#20 随之不存在。

1. **计量收敛到一个函数 `dictionary.MeterLookup(ctx, userID)`**（采用 A2 的「一个计量点」部分，**已实现**）：
   - `MeterLookup` = 订阅判断（fail-open 到订阅者）+ 配额 upsert（非 `ErrQuotaExceeded` 错误 fail-open 放行）。是所有查词路径唯一的计量入口。
   - `dictionary.Lookup`（ECDICT 路径）调它；`translate/helpers.go` 的 `fillFromEcdict` 在**本地命中分支**也调它（今天这条路绕过配额——正是 B2 要改的）。
   - **`dictionary.Lookup` 内联本地 `words` 查询这部分（A2 的深 seam）本次不做**——`translateWord` 的本地查询 + `user_dicts.QueryCount` 复习计数记账**完全没有测试覆盖**（`translate` 包只测了鉴权和 sentence-unavailable），盲改风险 > 收益。留作独立后续（先补 QueryCount 覆盖，再把本地查询搬进 seam）。当前 caller 只有一个、`/ecdict` 已删，「计量漏一条路径」的风险已经被计量收敛 + 单 caller 压住。

2. **计量：每次调用 `+1`，不去重，缓存命中也算**（采用 B2，**已实现**）。非订阅用户每次查词（本地命中 or ECDICT）配额 `+1`（**先扣后查**，#16 确认为有意；空结果也算）。订阅用户跳过。澄清 ADR-009 Decision 6：配额是「释义查询」的每日封顶，不区分数据来源。测试：`TestTranslateWordMetersLocalCacheHit`（本地已有的词，limit=1，第二次 429）。

3. **存储：SQLite，复用 `dictionary_lookup_quota`**（采用 C2）。不引 Redis。

4. **`CheckAndIncrementLookup` 改单条 upsert**（采用 D2，**已实现**）：`INSERT ... ON CONFLICT(user_id, date) DO UPDATE SET count = count + 1 WHERE count < ?`，`RowsAffected == 0` → `ErrQuotaExceeded`。删掉读后写事务。语义与现状完全一致（6 个现有测试 + 新增 `TestCheckAndIncrementLookupConcurrentFirstOfDay` 全绿）。

5. **失败策略：词典路径 fail-open**（采用 E2，**已实现**）。策略在 `dictionary.Lookup` 层：`isActiveSubscriber` 返 `(bool, error)`，出错 → warn + 当订阅者；`CheckAndIncrementLookup` 的非 `ErrQuotaExceeded` 错误 → warn + 放行。`billing/quota` 保持返回真实错误。AI 积分路径不动。

6. **#17/#18 一并修**（见 F 表，**已实现**：#18 显式修，#17 由 E2 覆盖）。

7. **加旧配额行清理**（采用 G）：定期 `DELETE ... WHERE date < <保留窗口>`，窗口值 TASK-SPEC 定（够短、又能覆盖任何「回看昨天用量」的需求，如 7–30 天）。

8. **免费每日上限的具体数值**不在本 ADR 内确定（同 ADR-009 惯例，属产品侧定价决策）。初值要求：**明显高于**一次正常长阅读会话的点词总量（含重复点击）的数倍，先放开观察真实分布再收。`limit <= 0` 维持「无限」语义。

---

## Rationale

- **先删 `/ecdict`（Decision 0）**：修一个没客户端、没测试、没引用的接口的错误处理是纯浪费；删掉之后 #19/#20 从字面上不存在，且 `dictionary.Lookup` 的 caller 从两个变一个，seam 重构面小一圈。
- **A2（深 seam）而不是 A1**：把「先本地后 ECDICT + 计量」这段编排放进 `dictionary.Lookup`，`translateWord` 从「自己拼装、还把配额漏在本地命中路径上」变成「只说查词」。#20 那类不一致不是加个判断能根治的，是 seam 位置的问题——计量逻辑跟着数据源走，就必然有人漏掉某条路径。`QueryCount` 不进 seam：那是复习系统的 concern，不是查词的 concern。
- **B2（不去重）而不是 B1**：去重要维护「每人每天的词集合」，为一个「上限设高、正常用户碰不到」的抗滥用机制付这个复杂度不值。缓存命中也计量看起来「对缓存不公平」，但配额不是成本核算、是用量封顶——一个每小时刷上万词的 scraper，它刷的是不是缓存命中，跟「该不该拦它」无关。
- **C2（SQLite）而不是 C1（Redis）**：Redis 解决的是「多副本要共享计数器」，homelab 是单 pod，没有这个问题。每人每天一次自增，SQLite 轻松。引 Redis 等于给 homelab 加一个要备份、要监控的有状态服务，换不到任何东西。真到了 enx-api 多副本 + 外部 DB 的那天，这是个会被架构本身逼着重新回答的问题（见 Revisit）。
- **D2（单条 upsert）而不是 D1（读后写）**：不是为了修一个 bug（实测当前实现的并发首查不出问题，`_txlock=immediate` 串行化了），是为了**去掉脆的形态**——读后写窗口不复存在，三分支事务变一条语句。`DO UPDATE ... WHERE count < limit` 保住了「被拒不落库」这个现状语义，不用像 `RETURNING count` 方案那样接受「多放 1 次」。
- **E2（fail-open）而不是 E1**：ADR-009 Decision 6 的注释已经确立了方向——「配额失败开放，最坏是免费查词多放一会儿，不是坏掉的 paywall」。#17/#18 是 fail-closed 思路（把错误当拒绝信号）写出来的 bug。词典查询边际成本≈0，存储抖动时优先保用户体验。AI 积分是真钱，维持 fail-closed。
- **先扣后查（#16）**：查询本身（不管命中与否）就是要计量的那个动作。「查了个不存在的词不该扣」在去重模型下才有意义；不去重模型里「查一次算一次」是自洽的，把这条写进 ADR 就能关掉 #16。

---

## Consequences

### Positive

- 死接口 `GET /ecdict` / `DoSearchEcdict` / `SearchResult` 删除，`enx-api` 少一段没人走、还行为不一致的代码。#19 / #20 消失。
- 一个计量点（`dictionary.MeterLookup`），一个 caller（`translateWord`）。#16 / #20 那类「某条路径漏了计量或计量不一致」从设计上消失。
- #17 / #18 随重构一并修：基建抖动不再表现为「查无此词」，付费订阅者不再被 DB 抖动降级 429。
- 配额自增从三分支读后写事务变成一条原子 upsert，读后写窗口彻底消失（不是当前 bug，是去掉脆形态）。
- 跟 `billing/credit` 一套存储、一套并发模式，少一个 homelab 组件。
- 为未来「收窄免费额度」和「加反滥用信号」留好了口子——收窄只改一个配置数字，不动调用点。

### Negative

- **缓存命中现在也计量**：阅读时重复点同一个词会消耗配额，靠「上限设高」兜底。上限初值必须按真实阅读会话的点词**总量**（含重复）留足余量，不能按「查字典」的直觉设。
- **本地命中的词从「永远免费」变成「计量」**：今天所有真实查词都命中翻译路径的本地分支、绕过配额；本 ADR 之后它们开始计数。这是把 ADR-009 Decision 6 落到实处，但对一个重度阅读用户是可感知的用量增加——同样靠「上限设高」兜。
- **fail-open 意味着配额在存储故障期间完全失效**——可接受（它不是 paywall），但要清楚这不是一个能在 DB 出问题时兜住成本的机制。
- **A2 的深 seam 只做了一半**：计量收敛了（`MeterLookup`），但本地 `words` 查询还在 `translateWord`/`word.Translate` 里，`dictionary.Lookup` 仍是「ECDICT + 计量」。原因：`translateWord` 的 `QueryCount` 记账零测试覆盖，盲改不安全。完整深 seam 留作后续（Revisit）。
- **`translateWord` 的 `user_dicts.QueryCount` 复习计数记账至今无测试覆盖**——本 ADR 没碰它，但这是一块该补的债。

### Mitigation

- 实施顺序建议：
  0. 删掉 `GET /ecdict` / `DoSearchEcdict`（**已完成**，`abbb590`）。
  1. `CheckAndIncrementLookup` 改单条 upsert（**已完成**，语义不变，6 现有 + 1 新增测试全绿）。
  2. `isActiveSubscriber` 返 `(bool, error)` + `dictionary.Lookup` fail-open（#17/#18）（**已完成**，`bbf0d44`，2 新 + 4 现有测试全绿）。
  3. 抽 `dictionary.MeterLookup`；`fillFromEcdict` 的本地命中分支也调它 → 计量收敛 + B2（**已完成**，新增 `TestTranslateWordMetersLocalCacheHit`，`translate`/`dictionary` 单测 + 集成测试全绿）。**深 seam（本地查询搬进 `Lookup`）推迟**——见 Decision 1 / Revisit。
  4. 配额行清理 job（G）。
  5. 每步独立可验证、可回滚。
- 上限数值：初值给一个明显偏高的数（阅读会话点词量的数倍），上线后看真实分布再逐步收。

---

## Out of Scope（本次不做）

- **`GET /paragraph-init` / 复习档位计数**（`enx.QueryCountInText`）：那是「这些词用户查过几次」的本地批量统计，不返回释义、不查 ECDICT、用户没主动查任何东西，**不计入配额**。配额只管「把一个词解析成释义」。
- **按去重词数计量**（B1）。
- **Redis / 多副本共享计数器**。
- **反滥用 / 反刷检测规则**（按 IP、按 token、滑动窗口等）——ADR-009 E2 已说另立 ADR。每日计数器是「用量封顶」，不是「滥用检测」。
- **免费每日上限的具体数值**（产品定价决策）。
- **AI 翻译计费**（ADR-014，token 计费，独立计量器，不动）。
- **`user_dicts.QueryCount` 复习计数机制**本身不变，留在 `translateWord`，不进 seam。
- **恢复 / 重建一个词典搜索接口**：`/ecdict` 删了；如果以后 enx-ui 要一个独立的「查词搜索框」，它应该直接用现有的 `GET /api/word/:word`（`translate.TranslateByWord`），不需要单独的端点。

---

## Revisit Trigger

- **要把本地 `words` 查询搬进 `dictionary.Lookup`（A2 深 seam）**：前置条件是先给 `translateWord` 的 `user_dicts.QueryCount` 复习计数记账补上测试覆盖（现在零覆盖）。有覆盖之后这个重构才安全。触发点：加第二个查词 caller，或 `translateWord` 本身要大改。
- **enx-api 变多副本 + 换外部共享 DB（Postgres）**：SQLite 单文件单写者不再成立，重新评估 Redis / 外部计数器 / DB 原生原子自增。
- **真实数据显示正常阅读用户会撞上限**：要么提高上限，要么回到「按去重词数」计量（B1）——那时候复杂度是值得付的。
- **需要把配额做成用户可见的用量条**：「缓存命中也算」会让用户困惑（「我就重看了个查过的词怎么也扣」），届时考虑 B1，或分级展示（不到 80% 不显示数字）。
- **反滥用需要更细的信号**（识别刷子而不只是封顶）：每日计数器不够，单独设计滑动窗口 / 多维度限流，可能连配额表结构一起改。
- **fail-open 被证明会被利用**（有人专门在 DB 抖动窗口刷）：把词典路径也改 fail-closed，但要先修完 #17/#18 那类误伤 bug。
