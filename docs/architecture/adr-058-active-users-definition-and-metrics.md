---
status: proposed
date: 2026-10-12
related: adr-018（查词唯一入口 `dictionary.Service.Resolve`）、adr-029（`dictionary_lookup_quota` 计数与拦截分离）、adr-028（`daily_stats`，用户本地日）、adr-040（Prometheus 指标、Grafana Cloud、标签基数红线）、adr-049（管理员用户页）、issue #21（配额行清理）
---

# ADR-058：活跃用户的定义与统计——按查词算，数据复用配额表，Grafana 展示

上线后要回答几个运营问题：一共有多少用户、每天 / 每周 / 每月有多少人在用。现在答不上来：ADR-040 的指标全是运维指标，ADR-028 的阅读统计是给单个用户自己看的，ADR-049 的管理员用户页还没实现。

`users.last_login_time` 看起来能用（每次带登录态的请求都会按间隔刷新它），但它只保留最近一次时间：能算出「当前」有多少人 30 天内来过，却画不出过去每天的曲线。而且打开扩展弹窗、后台自动刷新 token 也会刷新它，并不代表这个人在用 ENX 学英语。

我们决定：**某个 UTC 日内至少查过一次词（`dictionary_lookup_quota` 里有这个用户当天的一行）的用户，就是当天的活跃用户。** 数据不新建表，直接用已有的配额计数表，并且长期保留。enx-api 把几个汇总数字作为 Prometheus gauge 暴露出来，在 Grafana 里看。

## Decision

### 1. 活跃的定义：查过词

- **活跃用户（某 UTC 日）**：当天在 `dictionary_lookup_quota` 里有行的用户。每次查词都会经过 `dictionary.MeterLookup` → `quota.IncrementLookup`（ADR-018 唯一入口），付费、免费、缓存命中、被 429 拒绝的都算。
- **被 429 拒绝的也算活跃**：用户确实来查词了，只是额度用完。把他们排除会让「额度太紧」看起来像「用户流失」。
- **只打开弹窗、只登录、只读文章不查词的不算。** 这比按请求算严格，是有意的：ENX 的核心动作是查词，一个从不查词的人没有在用它。若以后发现大量用户只读不查（例如粘贴阅读器 ADR-019 的用户），再考虑把阅读上报（ADR-028）也算进来，那是对本定义的修订，不是另起一套。
- **日界用 UTC**，与配额表一致。它和用户本地日（`daily_stats`）不对齐，对全站汇总来说无所谓。
- **DAU / WAU / MAU**：截至今天（UTC）的最近 1 / 7 / 30 个 UTC 日内（含今天，今天尚未结束）有过查词的去重用户数。
- **用户总数**：`users` 表里 `clerk_user_id` 非空的行数。用户第一次带 Clerk token 请求时自动建档，Clerk 之前的遗留账号不计入。

### 2. 存储：复用 `dictionary_lookup_quota`，长期保留

- 这张表已经是「每个用户每个 UTC 日一行」，正好是活跃数据，**不新建表**。
- **它的行必须长期保留。** 这与 issue #21（按 7–30 天删除旧行）冲突：删掉就再也算不出历史上的 DAU / MAU。#21 改为「不删除」，按 #21 自己的估算，1000 个活跃用户一年约 18 MB，SQLite 承受得起。将来确实需要清理时，先把按日汇总写进一张汇总表再删明细，那时另起 ADR。
- 给 `date` 列加索引（主键是 `(user_id, date)`，按日期范围查会全表扫描）。

### 3. 展示：Prometheus gauge → Grafana

enx-api 新增三个 gauge，加进 ADR-040 的指标清单：

- `enx_users_total` —— 用户总数。
- `enx_active_users{window}` —— `window ∈ {1d, 7d, 30d}`，即 DAU / WAU / MAU。
- `enx_new_users{window}` —— 同样的窗口内新注册的用户数（按 `users.created_at`）。

实现方式：在 `enx-api/metrics` 注册一个自定义 `prometheus.Collector`，抓取时查库，**结果缓存 5 分钟**，避免每次抓取都打 SQLite。查询放在 `repo/`，Collector 通过接口拿到它（DDD 约定），单测用假实现。

标签只有 `window` 一个、取值三个，总共 7 条时间序列，符合 ADR-040 Decision 3 的基数红线：**用户 id 永远不进标签**。

生产走 ADR-040 已有的链路（Alloy → Grafana Cloud），homelab 走 kube-prometheus-stack，两边都不需要新配置，只需在 Grafana 里加一个看板。每日 DAU 曲线用 `max_over_time(enx_active_users{window="1d"}[1d])` 取每天的峰值，即当天结束时的数值。

### 4. 超过 14 天的历史：查库

Grafana Cloud 免费版只保留 14 天（ADR-040 Decision 5）。更长的曲线不靠 Prometheus，而从保留的明细里直接算，例如每日 DAU：

```sql
SELECT date, COUNT(*) AS dau
FROM dictionary_lookup_quota
GROUP BY date
ORDER BY date;
```

WAU / MAU 同理按滑动窗口 `COUNT(DISTINCT user_id)`。需要在 Grafana 里看长期曲线时，再做一个管理员 JSON 接口给 Grafana Infinity 数据源读，或放进 ADR-049 的管理员页面，两者都不在 v1。

## Considered Options

- **按任意带登录态的请求算（`last_login_time`）**：最宽松，零开发。但它不留历史，画不出趋势；而且弹窗打开、token 刷新也会触发，会把「装了扩展但不用」的人算成活跃。否决。
- **按 `daily_stats` 算（ADR-028）**：数据由客户端上报，日期是用户本地日，上报可能延迟或丢失，作为全站口径不如服务端计数可靠。否决，但保留为将来「只读不查」场景的补充数据源。
- **新建 `user_activity_daily` 表**：和配额表内容几乎一样，等于每次查词多写一行。否决。
- **在 Grafana 里直接连 SQLite**：生产库在 EC2 上，Grafana Cloud 访问不到；为此开放数据库端口不值得。否决。
- **只在管理员页面（ADR-049）展示**：可以，但那个页面还没做，而 Grafana 本来就在看服务指标，趋势图、时间范围这些也是现成的。v1 先用 Grafana，管理员页面以后可以复用同一个 repo 查询。

## Consequences

- 「活跃」只有一个口径：查词。看板、运营讨论、将来的管理员页面都用这个定义；改口径要修订本 ADR。
- 配额表从「临时计数」变成「长期数据」：#21 需要按本 ADR 修改或关闭；以后任何改动 `dictionary_lookup_quota` 的写法、日界或清理策略的变更，都要考虑活跃统计。
- 测试账号（e2e、开发者自己）会算进数字。用户量小的时候影响明显，可在看板上注明；需要时再加排除名单配置。
- 时间序列只增加 7 条，对 Grafana Cloud 免费额度没有影响。
