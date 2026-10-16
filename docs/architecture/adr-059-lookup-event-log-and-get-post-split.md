---
status: proposed
date: 2026-10-15
related: adr-018（查词唯一入口 `dictionary.Service.Resolve`）、adr-028（阅读统计 `daily_stats`，Options B1 否决过事件表、Decision 10 不存时间戳）、adr-029（配额 UTC 日、计数与拦截分离、Decision 6 两表口径分裂）、adr-058（活跃用户复用配额表并长期保留）、issue #136（查词不幂等）、#133（可选重试，PR #184）、#146（活跃用户实现）
---

# ADR-059：查词事件表取代两个查词计数器；读释义（GET）与记查词次数（POST）分开

现在一次查词（`GET /api/word/:word`）要写三处：

| 写到哪 | 粒度 | 用途 |
| ---- | ---- | ---- |
| `dictionary_lookup_quota` | 用户 × UTC 日 | 每日配额（ADR-029）；ADR-058 拿它算活跃用户 |
| `daily_stats.word_lookups` | 用户 × 本地日 | `/stats` 与 Home 的「今天查了几个词」（ADR-028） |
| `user_dicts.query_count` | 用户 × 词 | 查词次数 → 复习档位、单词高亮颜色；同时清掉「认识」标记 |

这带来两个问题。

1. **GET 有副作用，不能重试（#136）。** 回复丢了再重试，查词次数就多加一次，词会被分到另一个复习档位。所以查词无法加入 #133 的重试机制，Side Panel 还得专门防止同一张卡调两次 `getOneWord`。
2. **同一件事记两遍。** 前两个计数器都是「这个用户查了一次词」，只因日界不同（UTC 日防用户改时区重置额度，本地日贴合「我今天学了多少」）才分成两张汇总表。ADR-058 又把配额表兼作活跃用户的长期数据，一张表背了三种用途。

我们决定：

- **每次查词请求写一行查词事件**，配额、查词统计、活跃用户都从事件推导，去掉 `dictionary_lookup_quota`，`daily_stats.word_lookups` 改为由汇总任务写入。事件只保留 N 天，过期前汇总成按天的数字再删除明细。
- **读释义和记查词次数拆成两个请求**：GET 只读释义（照常扣配额、写查词事件），可以重试；新增 POST 只加查词次数，不扣配额、不重试，失败就少记一次。

## Decision

### 1. 查词事件表 `lookup_events`

```sql
CREATE TABLE lookup_events (
  user_id     TEXT    NOT NULL,
  at          INTEGER NOT NULL,  -- UTC Unix 毫秒
  tz_offset_minutes INTEGER NOT NULL,  -- 这次查词时用户的 UTC 偏移（北京 +480），取自 X-Enx-Tz-Offset
  outcome     TEXT    NOT NULL   -- 'allowed' | 'rejected'（429）
);
CREATE INDEX idx_lookup_events_user_at ON lookup_events (user_id, at);
CREATE INDEX idx_lookup_events_at      ON lookup_events (at);
```

- **一次查词请求写一行，且只写这一行。** 写入点是 `dictionary.MeterLookup`（ADR-018 唯一入口），替换现在的 `quota.IncrementLookup` + `stats.AddLookup`。
- **不存查的是哪个词**，也不存 URL、页面、文章。哪个词查了几次已经在 `user_dicts` 里；事件只服务于计数。
- **时间精确到毫秒。** 配额要按 UTC 日边界算，排查问题也要看先后。毫秒明细只存在 N 天（Decision 4）。
- **存这次查词时的时区偏移，不存本地日期。** 本地日 = `at + tz_offset_minutes` 所在的日期，统计和每日汇总都直接从这一行算，不必另外维护「用户当前时区」。偏移在请求头里本来就有，只是多存一个整数。用户之后换时区，已有事件仍按当时的偏移算，不会换日。缺时区头时记 0（按 UTC），与现在 `stats.OffsetFromContext` 的回退一致。
- **`outcome`**：被 429 拒绝的请求也写一行，保持 ADR-029 C2 的口径——配额看「请求数」，活跃用户也把撞了额度的人算作活跃（ADR-058 Decision 1）。查词统计只数 `allowed`。

### 2. 三个数字怎么从事件推导

| 数字 | 查询 | 日界 |
| ---- | ---- | ---- |
| 每日配额 | `COUNT(*) WHERE user_id=? AND at >= 今天的 UTC 零点` | UTC |
| 查词统计（`/stats`、Home） | `COUNT(*) WHERE user_id=? AND outcome='allowed'`，按 `at + tz_offset_minutes` 的日期分组 | 用户本地日 |
| 活跃用户（ADR-058） | `COUNT(DISTINCT user_id)`，按 UTC 日 / 最近 7 天 / 最近 30 天 | UTC |

- **配额：先写事件，再数。** `INSERT` 与 `COUNT` 放在同一个事务里，数到的个数包含刚写的这一行，超过上限就返回 429，这一行的 `outcome` 记为 `rejected`（或在同一事务内改成 `rejected`）。这和现在「先计数、再比较」等价。
- **出错放行不变**（ADR-029 E2、#17/#18）：事件写失败只记 warning，照常返回释义。
- ADR-029 Decision 6 的「两种日界」照旧，只是不再需要两张表：同一行事件同时带 `at`（UTC）和这次查词的时区偏移。

### 3. GET 读释义，POST 记查词次数（#136）

| | `GET /api/word/:word`（及 `GET /api/translate?word=`） | `POST /api/me/words/:english/lookups`（新） |
| ---- | ---- | ---- |
| 查词事件 / 配额 | 写一行，超额返回 429 | 不写，不扣配额 |
| `user_dicts.query_count` | 不动 | +1，并清掉「认识」标记（`repo.RecordWordLookup` 原样搬过来） |
| 返回 | 释义 + 该词**当前**的查词次数与「认识」状态（只读） | 加完之后的查词次数与「认识」状态 |
| 重试 | 用 #133 的 `{ retry: true }` | 不重试；失败就少记一次 |

- **GET 重试会让配额和查词统计多算一次，这是接受的。** 两者都只是用量和体感数字，多一次无伤大雅；能重试换来的是读释义在网络抖动下不失败。所以 GET 是「可以安全重试」，不是严格幂等——写在这里，免得以后被当成 bug 修掉。
- **POST 只在 GET 成功且词有 `words` 行（`id` 非空）时发**，一次点击查词只发一次。「一次查词只发一次 POST」的规则放进 enx-chrome 的 `src/lib/`，带单元测试；Side Panel 现在防止重复调 `getOneWord` 的那段改为防止重复发 POST。
- **POST 不重试的理由**：它不幂等，重试会重复计数；少记一次只让词晚一点升档。
- **POST 不扣配额**：配额是产品规则（每天能查多少个词），一次查词只算一次，就算在 GET 上。滥用防护交给另起的令牌桶限流（不在本 ADR 范围，见 Consequences）。
- **AI 兜底查词**（`POST /api/dictionary/ai-word`，ADR-044/045）现在也会调 `RecordWordLookup`。改为同样的规则：它只负责出释义和扣积分，查词次数由客户端在成功后发同一个 POST 记录。这样查词次数只有一个写入口。

### 4. 保留期与汇总：N = 90 天

明细只留 90 天，一个每日任务做两件事：

1. **查词统计汇总**：对已经结束、且仍在保留期内的本地日，把 `allowed` 事件的个数**覆盖写入** `daily_stats.word_lookups`（覆盖而不是累加，任务重跑也不会算错）。
2. **活跃用户汇总**：对已经结束的 UTC 日，把 DAU / WAU / MAU 写入新表 `active_users_daily(date, dau, wau, mau)`。WAU / MAU 要回看 30 天，所以 N 必须大于 30。
3. 然后删除 `at` 早于 90 天前的事件。

读的一侧：

- **配额**只看今天，永远读事件。
- **查词统计**：最近 2 个本地日（今天、昨天，可能还在变）从事件现算，更早的读 `daily_stats.word_lookups`。
- **活跃用户**：今天的 gauge 从事件现算；ADR-058 Decision 4 的按天历史接口读 `active_users_daily`，今天这一行现算。
- 清理任务与 ADR-028 的 `stats_ingest_log` TTL 清理复用同一个 goroutine。

### 5. 迁移

- 上线前把现有 `dictionary_lookup_quota` 的行回填进 `active_users_daily`（只有 DAU 准确；WAU / MAU 按回填数据算），然后删表。生产库 2026-10-14 刚重置过，历史很短。
- `daily_stats.word_lookups` 的已有值保留，就是汇总结果；上线后今天和昨天改从事件算。
- **上线当天的配额从 0 重新数**（事件表是空的）：用户当天多得一份额度，可以接受，不做回填。
- `quota.IncrementLookup`、`stats.AddLookup` 删除；`translate` 两个 handler 不再调 `RecordWordLookup`。

## Considered Options

- **维持两个计数器（现状）**：语义清楚、每次只是两次 upsert，开销可以忽略。但同一件事记两遍，配额表还背着活跃用户的长期数据；以后每加一种「按查词算」的指标都要再加一张汇总表或再改配额表。否决。
- **合成一个计数器、统一日界**：按本地日，用户改时区就能重置额度；按 UTC，中国用户的「今天」早上 8 点才切换。一个日界服务不了两个场景（ADR-029 Decision 6）。否决。
- **事件永久保留，不汇总**：最简单，但毫秒级的行为明细会一直留着，违背数据最小化；也和 ADR-028 Decision 10「每一行都能原样给用户看」的立场冲突太大。否决，改为 90 天。
- **事件里存 `word_id`**：能分析「哪些词什么时候被查」，但每行都带上了阅读内容的线索，而查词次数本来就在 `user_dicts`。否决。
- **只存 UTC 日和本地日，不存时间戳**：隐私上和 ADR-028 一致，但配额要算 UTC 日边界、排查要看先后，按小时分布也无从谈起。毫秒明细只存 90 天，风险可控。否决。
- **事件只存 UTC，读的时候按请求带来的时区算本地日**：实时查询可行，但每日汇总由服务端定时跑，没有请求也就没有时区，还得另存一份「用户当前时区」并维护它的更新。不如每行多存一个偏移。否决。
- **#136 的其他做法**：
  - 客户端生成 lookup ID、服务端去重：一个请求搞定，但要多一张去重表、多一套 TTL 清理，只为保住一个「少记一次也无所谓」的计数。否决。
  - 不拆，查词永不重试：读释义是最常用的操作，网络一抖就失败，体验最差。否决。
- **POST 也扣配额**（把配额当 API 限流用）：每次查词消耗两份额度，免费上限得翻倍，「每天能查多少个词」也说不清了。限流是令牌桶的事。否决。

## Consequences

- **推翻 ADR-028 Options B1**（否决事件表）。当时的两条理由：体量——按现在几百用户的规模，一年最多几百万行，SQLite 加索引承受得起，且只留 90 天；隐私——不存词、不存页面，毫秒明细只存 90 天，长期只剩按天数字。ADR-028 Decision 10 改为「长期数据只有按天聚合；查词事件的时间明细最多保留 90 天」。
- **修订 ADR-029**：配额的数据源从 `dictionary_lookup_quota` 改为 `lookup_events`；口径（UTC 日、请求数、含 429、出错放行）不变。
- **修订 ADR-058 Decision 2 / 4**：活跃用户不再复用配额表，改为事件现算加 `active_users_daily` 汇总；#146 按本 ADR 实现，gauge 和按天接口的口径不变。
- **隐私政策补一句**：记录每次查词的时间（保留 90 天，之后只保留按天的次数），不记录查了哪个词、在哪个页面。
- **体量**：每次查词一行，约 60–80 字节加两个索引。1000 个活跃用户、每人每天 50 次、留 90 天，约 450 万行、几百 MB；到那个规模再看是否缩短保留期或把 `user_id` 换成整数 id。
- **扩展要改**：查词变成两个请求。GET 返回后，客户端直接按「当前次数 + 1、清掉认识标记」渲染查词浮层的复习档位和单词高亮颜色，同时发 POST，**不等 POST 返回**。这条规则放在 enx-chrome 的 `src/lib/`，带单元测试；POST 失败时界面已经显示的档位不回退，下次查词以服务端为准。
- **令牌桶限流另起 issue / ADR**：对所有已登录接口用同一套宽松规则（例如每用户每秒 5 次、突发 20），正常人碰不到；与配额分开，配额只是产品规则。
- **术语**：Accepted 后在 `CONTEXT.md` 加「查词事件」，并写明「查词次数」只由「记查词次数」的 POST 增加。

## 已确认（2026-10-15）

- 保留期 N = 90 天。
- 复习档位由客户端按「当前次数 + 1」先显示，不等 POST。
- POST 路径 `POST /api/me/words/:english/lookups`。
- 上线当天配额从 0 重新数：生产尚无用户，无影响。
- 保留 `outcome`，被 429 的请求也写事件。
- AI 兜底查词的查词次数也由客户端发同一个 POST 记录（Decision 3 最后一条）。
- 令牌桶限流：#185。
- 事件存 UTC 毫秒时间戳加这次查词的时区偏移；不另存「用户当前时区」，也不专门处理用户跨时区查词。
