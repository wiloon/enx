---
status: accepted
date: 2026-10-16
related: adr-018（查词唯一入口、反滥用另立 ADR）、adr-029（每日查词配额是产品规则，失败放行）、adr-040（Prometheus 指标、标签基数红线）、adr-045 / adr-048（`ailimit` 的 AI 花费安全阀）、adr-059（记查词次数的 POST 不扣配额，滥用防护靠本 ADR）、issue #185（本 ADR）、#136、#17 / #18
---

# ADR-060：已登录接口按用户做令牌桶请求限流——进程内存、全员同一条宽松规则、429 带 `Retry-After` 和独立错误码

enx-api 现在没有任何请求速度上的保护。唯一的限制是每日查词配额（ADR-029），但它不是防护机制：

- 它封的是一天的总量，不管速度：一个脚本可以在一秒内把 200 次查词用完；
- 它只管查词，其他接口（`paragraph-init`、生词本、统计上报、AI 接口……）都不管；
- 它按设计失败放行（#17 / #18），而且每次计数都是一次 SQLite 写入，本身就经不起刷。

ADR-059 让「记查词次数」的 POST 不扣配额，明确把滥用防护交给另起的限流（#185）；ADR-018 也早就说过反滥用要另立 ADR。

我们决定：**在所有已登录的 `/api` 路由上加一个 gin 中间件，按本地用户身份（`users.Id`）各给一个令牌桶，用 `golang.org/x/time/rate` 在进程内存里实现；全员同一条宽松规则（起始值每秒 5 个、桶容量 60），正常阅读的人碰不到，只拦脚本；超限返回 429、`Retry-After` 和独立的错误码 `too_many_requests`。** 它与每日配额、`ailimit` 并存，三者各管各的，不合并。

## Decision

### 1. 三层限制，各管一件事

| 层 | 管什么 | 性质 | 存在哪 |
| ---- | ---- | ---- | ---- |
| 请求限流（本 ADR） | 请求的**速度**，所有已登录接口 | 防护机制，只拦脚本 | 进程内存 |
| 每日查词配额（ADR-029） | 一天能查多少个词，分免费 / 付费 | 产品规则 | SQLite |
| `ailimit`（ADR-045 / 048） | AI 调用的每分钟 / 每天次数 | AI 花费安全阀 | 进程内存 |

- 请求限流**不区分免费与付费**。按套餐区分用量是产品规则，留给每日配额。
- 请求限流**不替代** `ailimit`。AI 接口要的是「任意 60 秒内严格不超过 N 次」，`ailimit` 的滑动窗口日志正合适；令牌桶的突发容量会让它在 60 秒内放过将近两倍（见 Considered Options）。一个 AI 请求先过本限流，再过 `ailimit`。
- 被本限流拒绝的请求**不进 handler**，所以不扣配额、不计查词、不算活跃用户（ADR-058）。

### 2. 范围：`/api` 下所有已登录路由，按本地用户身份分桶

- 中间件挂在 `enx-api.go` 的 `apiGroup` 上，**紧跟在 `clerkAuth` 之后**，在 `stats.TZOffsetMiddleware` 之前。这样已经知道是谁，被拒的请求也省掉后面的工作。
- 桶的 key 是 `clerkAuth` 放进 context 的本地用户身份 `user_id`，不是 IP，也不是 Clerk 的 `sub`。按用户分桶，共用出口 IP 的人（公司、学校、手机网络）互不影响。
- `clerkAuth` 自己的失败（401）发生在限流之前，不消耗令牌。
- **不在范围内**：未登录的路由（`/ping`、`/version`、`/api/version`）和 Stripe webhook（`/billing/webhook`，Stripe 签名校验，不该被我们拒）。未登录路由的防护放在边缘：Cloudflare 限流规则（w10n-config 的 catglish 模块），另开 issue 跟进。
- 管理员路由（`/api/admin/*`）也在 `apiGroup` 下，同样受限，不开豁免。管理员批量操作碰到限流，说明那个操作该改成批量接口。

### 3. 算法与起始值：令牌桶，每秒 5 个、桶容量 60

- 每个用户一个 `rate.Limiter`，速率 `requests-per-second`，桶容量 `burst`。
- **两个数的含义。** 桶里最多存 60 个令牌，每个请求取走一个；令牌每秒补 5 个，补满 60 就不再加。所以一个闲了十几秒的用户可以一口气连发 60 个请求（突发），之后只能按每秒 5 个的速度继续；停下来 12 秒，桶又满了。
- **起始值：每秒 5 个，桶容量 60。** 按扩展的真实请求形状估算（代码见 `enx-chrome/src/content/content.tsx`、`background/background.ts`）：

  | 场景 | 请求从哪来 | 短时间内的请求数 | 结果 |
  | ---- | ---- | ---- | ---- |
  | 在一篇普通文章上启用学习模式（约 1500 词、600 个不重复的词） | 校验登录、取偏好、`paragraph-init` 每 200 个不重复的词一块、**依次**发 | 约 5～6 个 | 远低于 60 |
  | 一篇很长的文章（3000 个不重复的词） | 同上，`paragraph-init` 15 块 | 约 17～20 个 | 低于 60 |
  | 浏览器恢复会话，10 个标签页自动启用学习模式 | 每页约 5 个 | 约 50 个 | 接近但低于 60 |
  | 点词查词 | 查释义，可能加整句翻译、词在句中的释义、AI 兜底、统计上报 | 每次点击 1～4 个，人点词间隔至少一两秒 | 平均远低于每秒 5 个 |
  | 在 X 上快速刷时间线 | 每条新推文一次 `paragraph-init`（词都已缓存时跳过） | 每秒 2～3 个 | 低于每秒 5 个，最需要观察的场景 |
  | 脚本 | 连续请求 | 每秒几十到几百个 | 前 60 个放行，之后每秒 5 个，其余 429 |

  正常使用的峰值在 20～50 个之间，桶容量 60 留了余量；持续速率每秒 5 个（每分钟 300 次）远超人读文章的节奏。脚本仍能以每分钟 300 次的速度持续请求，但这只是速度上限，每天能查多少词还由每日配额管。
- 这两个数是起始值，上线后按 Decision 6 的指标调。issue #185 里提过的「每秒 5 个、突发 20」，在长文和恢复会话的场景下太紧。
- 配置照 `ailimit` 的惯例：`[rate-limit]` 下 `requests-per-second`、`burst`，环境变量覆盖；**`requests-per-second = 0` 表示关闭限流**，用于本地开发和 e2e。负数在启动时报错（与 `notNegative` 校验一致）。

### 4. 超限的响应：429、`Retry-After`、独立错误码

```http
HTTP/1.1 429 Too Many Requests
Retry-After: 2

{"success": false, "code": "too_many_requests", "message": "Too many requests. Please slow down and try again in a moment."}
```

- `Retry-After` 是秒数，取「下一个令牌到达的时间」向上取整，至少 1。用 `ReserveN(now, 1)` 拿到等待时间后立即 `Cancel()`，被拒的请求**不消耗令牌**。
- **客户端按 `code` 区分 429，不按状态码。** 现在 enx-api 已有好几种 429：每日查词配额、AI 查词限流（`rate_limited`）、试用每日 / 每分钟限制（`trial_limit_day` / `trial_limit_minute`）。而 enx-chrome 的 Side Panel 把所有 429 都当成「每日配额用完」（`SidePanel.tsx` 的 `HTTP_QUOTA_EXCEEDED`）。所以本 ADR 一并要求：
  - 每日查词配额的 429（`dictionary.RespondQuotaExceeded`）补上 `code: "lookup_quota_exceeded"`；`aitranslate` 两处没有 `code` 的 429 补上 `trial_limit_day` / `trial_limit_minute`，与 `translate/ai_word.go` 一致。
  - enx-chrome 和 enx-ui 的错误判断改成看 `code`；遇到 `too_many_requests` 显示上面的 message，**不**显示配额用完或 "Session Expired"，也不引导去 /billing。
  - 没有 `code` 的 429 仍按旧逻辑当作配额用完，兼容还没升级的服务端。
- **后台重试必须遵守 `Retry-After`。** `paragraph-init` 的分块重试（`sendChunkWithRetry`）和统计上报（`statsReporter.ts`，429 已被当作可重试）碰到 `too_many_requests` 时，至少等 `Retry-After` 秒再试，不能立即重试，否则只会一直撞限。
- **例外：记查词次数的 POST 不重试。** ADR-059 的 `POST /api/me/word-lookups` 同样在限流范围内，一次点词查词是 GET 加 POST，用两个令牌（Decision 3 的「每次点击 1～4 个」已算进去）。它不幂等，ADR-059 规定失败不重试；收到 `too_many_requests` 也一样直接放弃，这次查词少记一次。

### 5. 存储与清理：进程内存，闲置的桶定期删除

- 桶放在进程内存的 map 里（用户身份 → 桶 + 最后使用时间），一把锁保护。不写 SQLite。
- **重启丢状态没问题。** 重启后每个人拿到一个满桶，最多多放过一个桶容量的请求。
- map 不能无限长：照 `ailimit` 的 `pruneAbove` 做法，用户数超过阈值时删掉闲置超过 10 分钟的桶（闲置 10 分钟的桶早已补满，删掉再建等价）。
- 只有一个 enx-api 实例（SQLite 单写），所以进程内存就是全局状态。以后要多实例时，按 Decision 7 的接口换成 Redis 实现（如 `go-redis/redis_rate`，GCRA 算法），那时修订本 ADR。

### 6. 可观测：Grafana 上看次数，日志里查是谁

被限流的请求在两处都能看到，各管一件事：

- **指标（看多不多）。** 新增 `enx_rate_limited_total{route}`，加进 ADR-040 的指标清单。`route` 用 gin 的路由模板，与 `enx_http_requests_total` 一致，基数有界；**用户身份不进标签**（ADR-040 Decision 3）。已有的 `enx_http_requests_total{status="429"}` 分不清是限流还是配额，所以要单独的 counter。enx-api 的 Grafana 看板（w10n-config `observability/grafana/dashboards/enx-api.json`，生产看板同步）加一个面板，按路由画每分钟被限次数。
- **日志（查是谁）。** `middleware.RequestLog` 每个请求已经写一行，带 `route`、`status`、`user_id`。被限流的那一行再加 `rate_limited=true` 字段，与配额的 429 区分；不另起日志行（docs/agents/logging.md）。日志经 Alloy 进 Loki（ADR-040 Decision 4），在 Grafana 里用 `rate_limited="true"` 过滤，就能看到是哪个用户、在哪个接口、什么时候被限。
- 调 Decision 3 的数值时：看板上次数一直接近 0，说明没误伤；某些正常用户反复出现在日志里，说明太紧。v1 不配告警（与 ADR-040 一致）。

### 7. 代码位置：规则在 `ratelimit` 包，中间件只做翻译

- 新包 `enx-api/ratelimit`：`Limiter` 接口 `Allow(userID string) (ok bool, retryAfter time.Duration)`，内存实现 `MemoryLimiter` 包着 `x/time/rate`，时钟通过构造函数传入（`AllowN` / `ReserveN` 本来就接收 `now`），单测用假时钟，不 sleep。不 import gin。
- `middleware/ratelimit.go`：从 context 取 `user_id`、调 `Limiter`、写 429 / `Retry-After` / 计数。在 `main` 里接线。
- `golang.org/x/time` 从间接依赖改为直接依赖。**不自己写令牌桶。**

## Considered Options

- **自己写令牌桶。** 算法几十行就能写完，但并发、补充时机、取消预留这些边界情况 `x/time/rate` 已经处理好了，而且它是 Go 团队维护的事实标准，本来就在依赖树里。否决。
- **滑动窗口日志（`ailimit` 的做法）。** 任意 60 秒内严格不超过 N 次，但每个请求存一个时间戳。N 小时（AI 调用）合适；这里要容纳每分钟几百个请求，每个用户存几百个时间戳不划算，也不需要那么严格。否决，`ailimit` 保持原样。
- **固定窗口计数（每分钟 / 每秒清零）。** 实现最简单，但窗口边界处能放过两倍，且对阅读这种一阵一阵的请求形状不友好。否决。
- **令牌桶直接替换 `ailimit` 的每分钟上限。** 速率 N/60 秒、容量 N 的令牌桶在 60 秒内最多放过约 2N 次，对控制 AI 花费太松。否决。
- **只在 Cloudflare 做限流。** Cloudflare 只能看到 IP 和请求头，按 IP 限会误伤共用出口 IP 的用户；按 JWT 分桶要在边缘解析 token，免费版做不到。登录接口在 enx-api 里按用户限，未登录接口交给 Cloudflare。
- **按套餐分档（免费紧、付费松）。** 把产品规则混进防护机制，两头都说不清。用量分档已有每日配额。否决；AI 接口以后需要更严的一档时，单独加，不按套餐。
- **用 Redis 等外部存储。** 单实例下没有收益，还多一个依赖。推迟到多实例时。
- **把限流计入每日配额（让 POST 也扣配额）。** ADR-059 已否决：配额是产品规则，不是 API 限流。

## Consequences

- ADR-059（已合并，代码未实现）记查词次数的 POST 依赖本 ADR 做滥用防护，两者应一起上线，或本 ADR 先上。
- **服务端和客户端在同一个实现里一起改**（#185）：enx-api 的限流中间件和各处 429 的 `code`，enx-chrome / enx-ui 按 `code` 区分 429、后台重试遵守 `Retry-After`。还没升级的旧扩展会把 `too_many_requests` 显示成配额用完，因为只有超限时才出现，影响很小。
- 起始值是猜测。上线头一两周看 `enx_rate_limited_total`，正常用户被限就放宽。
- 重启会让每个人拿到满桶；滚动部署时这不是问题，因为只有一个实例。
- 未登录路由的防护（Cloudflare 规则）不在本 ADR，另开 issue；在它落地前，`/ping`、`/version` 只受 Cloudflare 默认防护。
- 将来扩成多实例时，`ratelimit.Limiter` 接口不变，换成 Redis 实现，并修订 Decision 5。
