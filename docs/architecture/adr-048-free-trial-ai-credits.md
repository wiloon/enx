---
status: proposed
date: 2026-10-03
related: adr-051（邀请注册在试用池上叠加奖励）、adr-009（两池积分账本，本 ADR 加第三个池）、adr-012 / adr-014（按 token 结算的 `Settle`）、adr-045（AI 单词兜底，试用期内一并开放）、adr-047（Onboarding 第 3 步的侧边栏 AI 翻译依赖本 ADR）
---

# ADR-048：新账号一次性发放 100 试用积分，独立积分池、7 天过期、扣费时最先扣

adr-047 的引导要让新用户在示例文章里体验侧边栏 AI 翻译。但 AI 功能只看积分：`entitlement.CanUseAI` 为「有订阅，或 top-up 余额 > 0」，`credit.Balance` 是订阅池 + top-up 池；免费用户两个池都是 0，一点就 402。想让新用户体验 AI，就得先给积分。AI 调用有真实成本，额度必须可控。

## Considered Options

- **直接发进 top-up 池**：零改表，`GrantTopup` 几乎原样可用。但 top-up 永不过期（adr-009 D2），「试用」就没有期限，一个很少用 AI 的免费用户会在几个月里一直开着全部 AI 功能，账面上也一直挂着一笔赠送负债。否决。
- **给免费用户每天/每月一点 AI 额度（常驻免费档）**：成本随用户数线性增长、没有终点，且削弱订阅的理由。否决；本 ADR 只做一次性试用。
- **按时间试用（14 天内 AI 无限用）**：成本没有上限，一个脚本就能刷爆。否决；以**积分数量**为成本上限，时间只是期限。

## Decision

1. **第三个积分池**：`credit_accounts` 加两列 `trial_balance INTEGER NOT NULL DEFAULT 0`、`trial_expires_at INTEGER`（Unix 秒，未发放为 NULL）。由现有 AutoMigrate 增列，不需要手写迁移。
2. **有效试用余额**：`now < trial_expires_at` 时为 `max(trial_balance, 0)`，否则为 0。过期后剩余的积分作废。
3. **发放**：`credit.GrantTrial(ctx, userID, amount, ttl)`：
   - 写 `trial_balance = amount`、`trial_expires_at = now + ttl`，流水类型新增 `GRANT_TRIAL`。
   - **每个账号终生只发一次**：幂等键 `trial:<userID>` 写进 `credit_transactions.stripe_event_id`（该列已有唯一索引，就是现成的幂等键）。过期、用完之后都不会再发。
   - 发放时机：**账号创建时**。Clerk 中间件调用 `enx.GetOrCreateByClerkUserID`，创建分支之后调用一个注入的「新用户」钩子（接口，由 `main` 接到 `GrantTrial`），`enx` 包不 import billing。已存在的账号不补发。
4. **扣费顺序：试用 → 订阅 → top-up**：
   - `Settle` 在同一条原子 UPDATE 里先从**有效**试用余额扣（不会扣成负数），剩下的再按现有逻辑走订阅池（不低于 0）、top-up 池（可以变成负数）。
   - 在同一个事务里，如果试用已过期而 `trial_balance > 0`，把它清零并写一条 `EXPIRE` 流水（`ledger.go` 里 `TypeExpire` 已定义但从未用过）。过期但再没扣过费的账号，剩余积分留在列里；因为第 2 条已经不计入，所以无害，v1 不做定时清扫。
5. **余额与权限**：
   - `credit.Balance` = 订阅池 + top-up 池 + 有效试用余额。
   - `entitlement.CanUseAI` = 有订阅 **或** top-up > 0 **或** 有效试用余额 > 0。`entitlement.Source` 的 `TopupBalance` 改为同时返回试用余额（或新增 `TrialBalance` 方法）。
   - 因此试用期内**所有 AI 功能都开放**，包括 adr-045 的 AI 单词兜底（用户已确认这是本意）。adr-045 的 `Subscribed` 判断不变，试用用户不算订阅用户。
6. **配置**（`config.toml`，可用环境变量覆盖，改了不用发版）：

   ```toml
   [credits.trial]
   amount = 100              # 0 = 不发试用（关闭开关）
   ttl-days = 7              # 2026-10-08 由 14 改为 7；邀请注册的用户另见 adr-051
   calls-per-minute = 5      # 试用用户每分钟最多几次 AI 调用；0 = 不限
   calls-per-day = 30        # 试用用户每个 UTC 日最多几次 AI 调用；0 = 不限
   ```

   环境变量：`CREDITS_TRIAL_AMOUNT`、`_TTL_DAYS`、`_CALLS_PER_MINUTE`、`_CALLS_PER_DAY`。

   与付费发放不同，这里的 0 是**安全方向**（不发 = 不花钱），所以 0 表示关闭，而不是报错。
7. **成本控制分两层**：

   **第一层：注册端，防批量注册刷试用。** 防线放在账号的创建成本上，而不是「全站每天发几份」：
   - 金额上限：每个账号最多 100 积分，一次。
   - **不设全站每日发放上限**：全站共用的名额会被攻击者注册小号占满，让当天的真实用户拿不到试用，等于把「拒绝真实用户」的开关交给攻击者。
   - **只保留 Google / GitHub 登录，关闭邮箱注册登录**（2026-10-04 决定）：批量造号的成本因此落在 Google、GitHub 自己的风控上（新号常要手机验证、有垃圾账号检测），100 积分的英译中额度不值得去买号。邮箱通道如果留着，需要 Clerk 的「拦截一次性邮箱」「拦截邮箱别名」来防 `a+1@gmail.com`、临时邮箱这类批量注册，而这两项在生产环境需要 Clerk 付费套餐；当前阶段不值得为此付费。
   - **不按 IP 限制**：理由同上，造号成本已经在 OAuth 提供方那里；按 IP 限制还会误伤公司、校园等共享网络。
   - **Clerk 注册门槛**（Dashboard 配置，人工操作，不是代码）：在 **User & authentication** 里关闭 Email address 作为登录 / 注册方式（连同密码），只保留 Google、GitHub 两个 social connection；CAPTCHA 保持开启（2026-10-04 查 `clerk.catglish.com/v1/environment`，已开启，Smart 模式）。生产实例和 dev 实例（rational-deer-4450）都改，避免本地与线上的登录界面不一致。
   - **已执行（2026-10-04）**：生产与 dev 实例都已关闭邮箱注册登录与密码；`/v1/environment` 核对为只剩 `oauth_google`、`oauth_github`，CAPTCHA 开启。关闭后 Clerk 的 `email_address` 属性显示为 disabled，但已在 dev 用一个新 Google 账号实测：OAuth 带来的邮箱仍作为用户的主邮箱保存（Primary、Linked），session token 的 `email` claim 与 enx-api 里依赖邮箱的功能（管理员按邮箱发积分、Stripe 预填、`/me`）不受影响。
   - **重新开放邮箱登录的条件**：用户量上来或有用户明确要求时，先升级 Clerk 套餐、打开两项拦截，再开放邮箱通道，并修订本条。
   - **可观测与总开关**：`GrantTrial` 成功时给 adr-040 的 Prometheus 指标加一个计数器 `enx_trial_grants_total`，发放量异常时可以在 Grafana 上看到；紧急时把 `CREDITS_TRIAL_AMOUNT` 设为 0 即停发，已发出的试用不受影响。v1 不做自动告警（adr-040 v1 不做告警）。

   **第二层：使用端，防单个试用账号短时间烧光、或被脚本调用。**
   - **只对「试用用户」生效**：`entitlement.Status` 新增 `TrialOnly`，条件是没有订阅、top-up ≤ 0、有效试用余额 > 0，也就是 AI 权限完全来自试用。订阅和充值用户不受这两个限制。
   - **每分钟次数**（`calls-per-minute`）挡脚本和连点；**每天次数**（`calls-per-day`）把 100 积分摊到多天，不让一个账号一天用完。按现在的计价权重（`[stripe.costs.translate]`），一次整句翻译大约 1 积分，100 积分约等于 100 次调用；每天 30 次意味着试用至少要 4 天才能用完，7 天的有效期内用得完。
   - **复用 adr-045 的 `dictionary.MemoryLimiter`**（`dictionary/ai_limiter.go`，已有每分钟和每日计数，0 表示不限）：把它挪到一个不属于某个功能的包（例如 `ailimit`），AI 单词兜底和试用限制各用一个实例，配置互相独立。
   - **在哪里检查**：所有 AI 功能调用前都会先查余额，只有两个入口（`aitranslate/token_ledger.go` 与 `dictionary/adapters/adapters.go` 的 `Balance`）。试用限制就挂在这两处：`TrialOnly` 且限流器不放行时，返回 429，不调模型、不扣积分。
   - 计数在进程内存里，服务重启会清零，只会多放过几次调用。它是安全阀，不是记账系统；真正的成本上限仍然是 100 积分本身。
   - 429 的提示文案（英文 UI）：`You've reached today's trial limit. Try again tomorrow, or subscribe for more.`；每分钟超限时提示稍后再试。

   **两层之间的关系**：第一层提高「造一个试用账号」的成本，第二层封住「每个试用账号能花多少、花多快」：每个账号终生最多 100 积分、每天最多 `calls-per-day` 次调用。成本因此与「攻击者能造多少个 Google / GitHub 账号」成正比，而那一部分由 Google、GitHub 和 Clerk 承担。
8. **展示**：`GET /billing/me` 的 `credits` 增加 `trialBalance`（有效值）和 `trialExpiresAt`。enx-ui 的 billing 页与侧边栏的余额处显示「100 trial credits · expires Oct 15」这类文案（英文 UI）。

## 实现要点（给实现者 / AFK agent）

- `utils/sqlitex/billing_models.go`：`CreditAccount` 加 `TrialBalance`、`TrialExpiresAt`；`CreditTransaction.Type` 注释加 `GRANT_TRIAL`。
- `billing/credit`：
  - 新增 `trial.go`，放 `GrantTrial` 与有效余额的计算（一个纯函数 `effectiveTrial(balance, expiresAt, now)`）。
  - 改 `Balance`、`Settle`。
  - 现有 `Settle` 的「两次并发 Settle 不会重复扣订阅池」性质必须对三个池同样成立：仍然用单条 UPDATE，所有右侧表达式都基于更新前的值。
- 新用户钩子：`enx` 包定义接口（例如 `NewUserHook`），由 `main` 注入；`GrantTrial` 失败只记日志，不能让登录请求失败。
- 单测（`billing/credit` 现有测试风格，真实 SQLite 临时库）：
  - `GrantTrial` 幂等，第二次调用是空操作；`amount = 0` 时不发；成功发放时 `enx_trial_grants_total` 加 1。
  - 试用限制：`TrialOnly` 用户超过每分钟 / 每日次数时返回 429，且不调模型、不扣费；订阅用户、top-up > 0 的用户不受限；`calls-per-* = 0` 时不限；限流器从 `dictionary` 挪走后，adr-045 的单词兜底限制行为不变（现有测试照常通过）。
  - `Balance` 不计入已过期的试用余额。
  - `Settle` 先扣试用、再扣订阅、最后扣 top-up；试用不会变负；扣费时如果已过期，清零并写 `EXPIRE` 流水；并发两次 `Settle` 总扣费正确。
  - `entitlement`：只有试用余额时 `CanUseAI` 为真、`Subscribed` 为假；过期后两者都为假。
  - 中间件：钩子只在创建分支调用；钩子返回错误时请求照常通过。
  - `/billing/me` 返回 `trialBalance`、`trialExpiresAt`。
- enx-ui / enx-chrome：余额展示加试用一行；402 的提示文案在试用用完或过期时引导去订阅或充值。
- **人工验证项**：Clerk 生产与 dev 实例关闭邮箱注册登录，`/v1/environment` 里 `email_address.used_for_first_factor` 为 false、`password.enabled` 为 false，只有 `oauth_google`、`oauth_github` 启用；`/sign-in`、`/sign-up` 页面只显示两个 OAuth 按钮；CAPTCHA 仍为开启；新注册账号在 `/billing` 看到 100 积分与到期日；在 `/reader` 拖选整句看到 AI 翻译、余额减少。

## Consequences

- 新用户在 Onboarding 里能真正用到 AI，而不是第一次点 AI 就碰到付费墙。
- 100 积分 / 7 天是**未校准的初值**：积分与真实成本的换算比例（`[stripe.costs.*]`）还是占位值（LAUNCH-CHECKLIST §1.2）。生产环境跑一段时间、有了真实的 `cost=` 日志之后，与订阅、充值档位的积分数一起重新定。目前的判断是：真实成本很低，现有付费档给的积分偏少，校准时大概率上调，试用额度随之调整。
- 账本从两个池变成三个池，`Settle` 的原子 UPDATE 更复杂；它是唯一的扣费入口，正确性靠上面的并发测试兜住。
- 发放时机选在账号创建时，而不是第一次使用 AI 时：实现最简单，代价是只注册不用的账号也会拿到一份（之后在 7 天后自然过期），因为有第二层限制，这部分不产生成本，只是账面上多一笔会过期的赠送。
- 没有 Google / GitHub 账号、或不愿用它们登录的用户暂时无法注册。目标用户（会装 Chrome 扩展读英文文章的人）绝大多数有其中之一，现阶段可以接受。
- 没有全站发放上限，所以无法从配置算出「单日最坏成本」；真遇到批量造号，靠指标发现、靠 `amount = 0` 止损。
