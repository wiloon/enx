---
status: accepted
date: 2026-10-07
updated: 2026-10-16（删去历史迁移与回填；新增管理员扣减、订阅退款时取消订阅；跟进 adr-048 / adr-051 / adr-059）
related: adr-009（两池积分账本、Stripe webhook）、adr-021（管理员白名单与 enx-ui 管理页）、adr-032（保存的页面没有管理员路由）、adr-048（试用积分，已实现；`GRANT_TRIAL` 与本 ADR 的流水类型并列）、adr-051（邀请积分，未实现；依赖本 ADR 的管理员扣减）、adr-059（查词事件表，取代 `dictionary_lookup_quota`）
---

# ADR-049：管理员用户与账务页；Stripe 退款自动扣回积分

生产环境已经有真实用户注册和充值，但管理员只能直接查 SQLite 或翻 Stripe Dashboard，没法在 ENX 里回答这些问题：系统里有多少注册用户、每个人什么时候注册、余额多少、积分是怎么来的、又花到了哪里。

现状：

- 管理员身份已经有了：`ADMIN_CLERK_USER_IDS` 白名单和 `middleware.RequireAdmin()`（adr-021）；enx-ui 下已有 `/admin/dictionary`、`/admin/ai-words`、`/admin/page-reports`。
- 需要的数据都在应用库里：`users`（email、`created_at`、`last_login_time`）、`subscriptions`（套餐、状态、`stripe_customer_id`、`stripe_subscription_id`）、`credit_accounts`（订阅池、充值池，以及 adr-048 的试用池 `trial_balance`）、`credit_transactions`（只追加的积分流水）、`lookup_events`（每次查词一行，adr-059）。
- **管理员赠送和真实充值在流水里分不开**：`POST /api/admin/credits/grant` 走的是 `credit.GrantTopup`，写的类型就是 `GRANT_TOPUP`，只能靠 `stripe_event_id` 的 `admin-grant-` 前缀区分；请求里的 `reason` 只写进了日志，没有存库。
- **Stripe 退款不会扣回积分**：webhook 只处理 5 种事件，没有 `charge.refunded`。在 Stripe 后台退款以后，用户的积分原样保留。
- 流水只记积分，不记金额和币种。

## Considered Options

**充值金额在哪里看**

- **在 ENX 里存一份付款记录（`payments` 表，webhook 写入，历史从 Stripe 回填）**：管理员页能直接显示金额。但退款、争议、汇率、手续费都以 Stripe 为准，复制一份就要维护两边一致。现阶段用户很少，否决。
- **详情页链接到 Stripe Dashboard 的 customer 页面**：零新数据，金额永远以 Stripe 为准。**采用**（用户 2026-10-07 确认）。

**退款时积分怎么处理**

- **不处理，管理员手动扣**：用户少的时候可行，但容易忘，而且手动扣减也需要一个新入口。否决（用户 2026-10-07 决定自动扣回）。
- **扣到 0 为止，扣不够的部分记下来**：用户永远不会看到负余额，但要多记一个「欠扣」数，管理员页还要专门展示。否决。
- **按退款比例扣回；充值池允许扣成负数，订阅池扣到 0 为止**：`Settle` 已经允许充值池变负（adr-012），负余额是系统里已有的合法状态，不用新增概念。**采用**。

**退款怎么对应到当初那笔发放**

- **收到退款时现查 Stripe（用 payment_intent 反查 checkout session 或 invoice）**：不用改表，但每次退款都依赖 Stripe API，而且要从 Stripe 那边的 id 匹配回本地流水，本地流水只存了 event id，匹配不上。否决。
- **发放时就在流水上记下 `payment_intent` id，退款时按它查**：一次改表，以后退款只查本地库。**采用**。

## Decision

2026-10-23：Webhook 的 HTTP 确认与业务执行按 [ADR-067](adr-067-subscription-acceptance-and-conflicts.md) 分离。验签后的 delivery/event 持久化成功就返回 `2xx`；下面的扣回、取消和异常通知由 ENX 持久 worker 执行。原文依赖 webhook 非 `2xx` 的业务重试改为内部任务重试，财务规则保持。

### 一、流水表补三列，管理员赠送和扣减单独成类型

1. `credit_transactions` 增加三列，均可为空，由现有 AutoMigrate 增加，不需要手写迁移：
   - `stripe_payment_intent_id`：Stripe 付款发放（`GRANT_TOPUP`、`GRANT_SUBSCRIPTION`）时记下对应的 payment intent；其他行为空。加普通索引。
   - `related_transaction_id`：扣回行指向它扣回的那条发放行。
   - `note`：自由文本。管理员赠送和扣减存 `reason`，扣回行存被退款的 charge id 和累计退款额（如 `Stripe charge ch_…, 150 of 499 refunded`）：`charge.refunded` 默认不带 refund 对象，charge id 足以在 Stripe Dashboard 里找到这次退款。
2. 新增流水类型 **`GRANT_ADMIN`**：管理员赠送改为 `credit.GrantAdmin(ctx, userID, amount, note)`。积分进**充值池**（和现在一样，永不过期），只是类型不同、`note` 存原因。`POST /api/admin/credits/grant` 的 `reason` 改为必填。
3. 新增流水类型 **`DEDUCT_ADMIN`**：管理员扣减，`credit.DeductAdmin(ctx, userID, amount, note)`。传入正数，流水 `Amount` 记负数（与 `SETTLE`、`CLAWBACK` 的符号约定一致）；从**充值池**扣，可以扣成负数（与 `Settle` 一致）；`amount ≤ 0` 或 `note` 为空时报错。用途：纠正送错的积分、冷静期后退款时手动扣回邀请奖励（adr-051 第 6 条），以及第 8 条不自动处理的争议。
4. **不迁移历史数据**：截至 2026-10-16 没有真实付费，生产库已重置过，没有需要从 `GRANT_TOPUP` 改成 `GRANT_ADMIN` 的旧行。

### 二、Stripe 退款自动扣回积分

5. **新增 webhook 事件 `charge.refunded`**：
   - `dispatchWebhookEvent` 和 `webhookEventLabel` 各加一个分支。
   - w10n-config 里 OpenTofu 管理的 webhook endpoint 事件列表（`infra/stripe/opentofu/enx`，test 和 live 两个 workspace）同时加上 `charge.refunded`。
6. **发放时记录 payment intent**：
   - 充值：`checkout.session.completed` 的 payload 里带 `session.payment_intent`，直接传给 `GrantTopup`。
   - 订阅：`invoice.paid` 的 payload 默认不带 payment intent，由 handler 通过 Stripe 的 invoice payments 接口取当期这张 invoice 的 payment intent，再传给 `GrantSubscription`。拿不到时（比如 0 元 invoice）照常发放，该列留空。
   - **实现时须用 Stripe CLI 的真实事件确认**这两个字段在 stripe-go v86 里的位置。
7. **扣回规则**：`credit.Clawback(ctx, paymentIntentID, amountRefunded, amountCaptured, stripeEventID)`。
   - 按 `payment_intent` 找发放行。找不到就**不扣**：记 error 日志，给管理员发邮件（复用 `RESEND_ADMIN_TO`，和 page report 通知走同一个 email 包），通过 ADR-067 的持久人工事项与待发邮件记录处理，不重复扣积分；HTTP 接收已在入库后确认，不能只记日志后丢掉通知。
   - 应扣总数 = `floor(发放积分 × amount_refunded ÷ amount_captured)`。`charge.refunded` 里的 `amount_refunded` 是累计值，所以本次扣回 = 应扣总数 − 这条发放行已有扣回行的合计。部分退款多次触发时结果正确，全额退款就是全部扣回。本次扣回**不小于 0**：Stripe 不保证事件顺序，全额退款的事件可能先于更早那次部分退款的事件到达，晚到的那次只能扣 0，不能反过来加回积分。
   - **充值发放**：从 `topup_balance` 扣，可以扣成负数（与 `Settle` 一致）。负余额时 `CanUseAI` 为假，用户以后再充值会先抵掉欠的部分。
   - **订阅发放**：只有当这条发放行是该用户**最近一条** `GRANT_SUBSCRIPTION` 时，才从 `subscription_balance` 扣，扣到 0 为止。更早周期的积分已经被下一期覆盖，扣回 0，但仍写一行流水留痕。
   - 新流水类型 **`CLAWBACK`**，`Amount` 为负（与 `SETTLE` 的符号约定一致）。**不复用已有的 `REFUND`**：`REFUND` 的意思是「AI 调用失败，把扣掉的积分还给用户」，方向正好相反。
   - 幂等：`stripe_event_id` 写这次 `charge.refunded` 的 event id，沿用唯一索引，重放无副作用。
   - 余额更新、写流水在同一个事务里。
   - 试用池（adr-048）不是付款发放，不参与扣回。
8. **订阅付款被退款时，立即取消订阅**（用户 2026-10-16 决定）：
   - 触发条件：扣回找到的发放行是 `GRANT_SUBSCRIPTION`，且 Stripe 上这个订阅的**实时状态**（取回订阅对象，与 `syncSubscriptionState` 同一理由：事件乱序时本地 `subscriptions.status` 可能是旧的）仍是生效状态（`active` / `trialing` / `past_due`）。全额和部分退款都触发；只想补偿一部分、又要保留订阅时，管理员改用 `GRANT_ADMIN` 补积分，不要在 Stripe 里退款。
   - 动作：用 `stripe_subscription_id` 调 Stripe 的 cancel subscription 接口**立即取消**（不是 `cancel_at_period_end`），不按比例退款（`prorate=false`）、不出最终账单（`invoice_now=false`）：钱已经由这次退款处理过了。
   - 本地状态不在这里改：Stripe 随后发来的 `customer.subscription.deleted` 由现有 handler 处理，订阅状态只有一个写入路径。
   - 先扣回、后取消。取消调用失败时保留事件处理进度，由 ENX worker 重试；重试时扣回因幂等不重复，只重做取消。Stripe 回复「订阅已经取消」视为成功。
   - 充值发放被退款时不碰订阅。
   - 取消订阅不另外清空订阅池：被退款那一期的积分已经按第 7 条扣回；订阅结束后其余积分怎么处理沿用现有逻辑，本 ADR 不改。
9. **不迁移历史 payment intent**：截至 2026-10-16 没有真实付费发放，不写回填命令。部署之后的发放都会带上 payment intent；万一有漏的行，退款时走第 7 条的「找不到就通知管理员」。
10. **不在本 ADR 范围**：争议（`charge.dispute.*`）、撤销退款。真遇到时由管理员手动处理（第 2、3 条的赠送和扣减，订阅在 Stripe 后台取消）。

### 三、管理员用户页（只读为主）

11. **API**，都挂在现有的 `/api/admin` 分组下，经过 `RequireAdmin`：
    - `GET /api/admin/users?q=&sort=&limit=&offset=`：用户列表。`q` 按 email 子串匹配；`sort` 支持注册时间、最近登录、余额；默认按注册时间倒序，`limit` 默认 50、上限 200。每行返回：
      - id、email、名字、注册时间、最近登录
      - 套餐与订阅状态
      - 订阅池、充值池、试用池余额（试用池按 adr-048 只算未过期部分，另给过期时间）
      - 累计积分，分四个口径：
        - 付费获得：`GRANT_TOPUP` + `GRANT_SUBSCRIPTION`
        - 赠送：`GRANT_ADMIN` − `DEDUCT_ADMIN`，加上 adr-051 落地后的 `GRANT_REFERRAL_BONUS`、`GRANT_REFERRAL_REWARD`
        - 试用：`GRANT_TRIAL`
        - 消耗：`CONSUME` + `SETTLE` − `REFUND`
      - 是否有过退款扣回
    - `GET /api/admin/users/:id`：
      - 用户详情：上面的全部字段，加上 `stripe_customer_id` 和 **Stripe Dashboard 链接**（按 secret key 前缀 `sk_live_` / `sk_test_` 生成 `https://dashboard.stripe.com[/test]/customers/<id>`）
      - 近 30 天每日查词次数（按 UTC 日期统计 `lookup_events`，adr-059；被配额拒绝的也算，与配额口径一致）
      - 近 30 天 AI 消耗按 `feature` 汇总
    - `GET /api/admin/users/:id/transactions?limit=&before=`：积分流水，倒序，游标分页。每行带类型、数量、变动后余额、时间、`note`，以及来源：Stripe 付款、管理员、退款扣回、试用、AI 使用。
    - 送积分仍用 `POST /api/admin/credits/grant`（按 email），并把它挪进 `RequireAdmin` 分组，去掉 handler 里那份重复的白名单检查。
    - 扣积分新增 `POST /api/admin/credits/deduct`，请求体与 grant 相同（email、amount、必填 `reason`），走 `credit.DeductAdmin`。
12. **分层**（AGENTS.md）：
    - 新建领域包 `adminuser`：`Service` 通过构造函数拿到仓储接口（用户、订阅、积分账户、流水、查词事件），负责组装和汇总；单测跑 fake。
    - SQL 放在 `repo/`。
    - handler 只做 HTTP。
    - `credit.GrantAdmin`、`credit.DeductAdmin`、`credit.Clawback` 留在 `billing/credit`，和其他账本操作在一起。
    - 第 8 条的取消订阅：webhook handler 通过一个注入的接口（如 `SubscriptionCanceller`）调 Stripe，测试用 fake。
13. **enx-ui**：
    - `/admin/users`：列表、email 搜索、排序。负余额用醒目颜色显示。
    - `/admin/users/[id]`：概要卡片、Stripe 链接、30 天使用量、流水时间线（加载更多）、送积分和扣积分表单（数量 + 必填原因；扣积分提交前确认，提示扣后余额可能为负）。
    - 在现有 admin 导航里加 Users 入口。界面英文，和其他管理页一致。
14. **隐私边界**：管理员页只展示账号、账务和使用量**计数**，**不展示**用户保存的页面、reader 文档、查过哪些词（adr-032 定过保存的页面没有管理员路由，这里保持一致）。上线前确认隐私政策里有「运营方为客服与账务目的可以查看账号与账单数据」的表述，没有就补上。
15. **「注册用户」的口径**：`users` 表里的行，也就是至少用 Clerk 登录过一次、调用过 enx-api 的账号。只在 Clerk 注册、从没调用过 API 的账号不计入；要看那部分，去 Clerk Dashboard。

### 不做

- 不在 ENX 里存付款金额（见 Considered Options）。
- 不提供直接修改余额数字的接口，所有变动都走流水（赠送和扣减都是流水）。
- 不在 ENX 里删除、封禁用户，也不做「以某用户身份登录」；需要时用 Clerk Dashboard。
- 管理员页不提供取消订阅；除了第 8 条的退款自动取消，取消订阅在 Stripe 后台做。
- 总览页（用户总数、新增、付费数、活跃度）放到后续：v1 的列表页已经能数出来，等有实际需要再做。

## 实现要点（给实现者 / AFK agent）

按 TDD 顺序，每一步先写失败的测试：

1. **`billing/credit`**（现有测试风格，真实 SQLite 临时库）：
   - `GrantAdmin`：进充值池、类型 `GRANT_ADMIN`、`note` 落库；`amount ≤ 0` 或 `note` 为空时报错。
   - `DeductAdmin`：从充值池扣、类型 `DEDUCT_ADMIN`、`Amount` 为负、`note` 落库；可以扣成负数；`amount ≤ 0` 或 `note` 为空时报错。
   - `GrantTopup`、`GrantSubscription` 记录传入的 payment intent。
   - `Clawback`：
     - 全额退款扣回全部
     - 两次部分退款（累计 30%、再到 100%）合计扣回全部，每次都按差额扣
     - 同一 event id 重放无副作用
     - 充值池可以扣成负数
     - 最近一期的订阅发放扣到 0 为止；更早一期的订阅发放扣 0，但仍写流水
     - 试用池不受影响
     - 找不到发放行时返回一个可识别的错误（例如 `ErrGrantNotFound`），不改余额
     - 返回值告诉调用方发放行是订阅还是充值（第 8 条要用）
     - 并发两次不同 event 的扣回，合计正确
2. **webhook**（现有 `webhook_test.go` 风格）：
   - `charge.refunded` 分派到 `Clawback`
   - `ErrGrantNotFound` 时返回 200 并调用管理员通知（通知接口注入，测试用 fake）
   - 订阅发放被退款、订阅仍生效：调用 `SubscriptionCanceller`，参数是该用户的 `stripe_subscription_id`；订阅已取消或没有订阅：不调用
   - 充值发放被退款：不调用 `SubscriptionCanceller`
   - 取消失败返回 500；重放同一事件时不再扣回、只重试取消；Stripe 回「已取消」视为成功
   - `webhookEventLabel` 认识新事件
   - checkout 和 invoice 两条发放路径把 payment intent 传下去
3. **`adminuser.Service`**（fake 仓储）：
   - 列表的累计口径：付费、赠送（减去 `DEDUCT_ADMIN`）、试用、消耗分开算，`REFUND` 从消耗里减掉，`CLAWBACK` 单独标记
   - 搜索、排序、分页的边界：`limit` 上限、空结果
   - Stripe 链接按 key 前缀区分 live 和 test；没有 customer id 时不给链接
   - 30 天查词（来自 `lookup_events`，按 UTC 日期分组，没有查词的日子补 0）和 AI 消耗的汇总
4. **路由**（`router_test.go` 风格）：三个新 GET、挪过来的 grant 接口和新的 deduct 接口，非管理员一律 403、未登录 401。
5. **端到端测试**：经签名的 `/billing/webhook` 在真实 SQLite 上跑一遍「充值 → 消耗 → 部分退款 → 全额退款」，流水和余额对得上；管理员接口返回的累计数与之一致。不依赖外部服务，放在普通测试套件里（不加 `//go:build integration`），CI 每次都跑。
6. **enx-ui**：列表和详情页的组件测试（现有 `admin/__tests__` 风格）；送积分、扣积分表单原因为空时不能提交；扣积分要先确认。
7. **人工验证**（homelab，Stripe test mode）：
   - 充一笔 → 在 Stripe 后台部分退款 → 管理员页看到 `CLAWBACK` 行和变化后的余额 → 再全额退款 → 余额回到充值前（扣掉期间消耗之后可能为负）
   - 订阅一个月 → 在 Stripe 后台退掉这张 invoice → 订阅池扣回，Stripe 里订阅变成 canceled，ENX 里订阅状态随 `customer.subscription.deleted` 更新
   - 管理员页送积分、扣积分各一次，流水里出现 `GRANT_ADMIN`、`DEDUCT_ADMIN` 和原因
   - w10n-config 的 webhook endpoint 已包含 `charge.refunded`（test 和 live）
   - 生产 `ADMIN_CLERK_USER_IDS` 填的是**生产 Clerk 实例**里的 user id（与 dev 实例不同）

## Consequences

- 管理员第一次能在 ENX 里看到全部用户和每个人的积分来龙去脉；金额以 Stripe 为准，ENX 不负责对账。
- 赠送和付费分开记账以后，「付费获得的积分」才能用来估算收入和成本；`GRANT_TRIAL`（adr-048）和 adr-051 的邀请积分也各自单独成类型。
- 退款以后，用户的充值池可能变成负数，这个用户的 AI 功能会被关掉，直到再次充值抵平。退款都是管理员在 Stripe 后台主动操作的，管理员如果不想让用户背负负余额，可以只退一部分，或者退款后用 `GRANT_ADMIN` 补平。
- 订阅退款只扣当期积分；如果退款发生在下一期已经开始之后，用户可能已经用掉了当期积分，这部分不追。用户少、退款罕见，可以接受。
- 在 Stripe 里退订阅的钱就等于取消订阅，没有「退一部分钱、继续订阅」的路径；要补偿又保留订阅，只能送积分。管理员在 Stripe 后台退款前要知道这一点。退款政策据此写明：订阅扣款一经退款订阅即结束，长时间停机以补发积分补偿，不退部分款项（2026-10-17 用户决定）。
- webhook 多处理一种事件；`invoice.paid` 多一次 Stripe API 调用（取 payment intent），订阅退款多一次（取消订阅）。会影响 adr-040 的 webhook 延迟指标，但量很小。
- 流水表多了三列，以后新的流水类型可以直接用 `note` 和 `related_transaction_id`，不用再改表。


## 2026-10-23 修订（#297）

- 按 ADR-067 持久接管退款事件，将接收确认后的失败恢复交给 ENX worker；退款调查通过原始发放/PaymentIntent 及关联订阅，不能把竞争订阅或历史订阅的退款错误作用于用户当前另一份 accepted 订阅。原有比例扣回、部分退款、零金额与立即取消参数保持。
