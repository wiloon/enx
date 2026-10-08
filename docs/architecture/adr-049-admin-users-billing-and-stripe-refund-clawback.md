---
status: proposed
date: 2026-10-07
related: adr-009（两池积分账本、Stripe webhook）、adr-021（管理员白名单与 enx-ui 管理页）、adr-032（保存的页面没有管理员路由）、adr-048（试用积分，未实现；它的 `GRANT_TRIAL` 与本 ADR 的流水类型并列）
---

# ADR-049：管理员用户与账务页；Stripe 退款自动扣回积分

生产环境已经有真实用户注册和充值，但管理员只能直接查 SQLite 或翻 Stripe Dashboard，没法在 ENX 里回答这些问题：系统里有多少注册用户、每个人什么时候注册、余额多少、积分是怎么来的、又花到了哪里。

现状：

- 管理员身份已经有了：`ADMIN_CLERK_USER_IDS` 白名单和 `middleware.RequireAdmin()`（adr-021）；enx-ui 下已有 `/admin/dictionary`、`/admin/ai-words`、`/admin/page-reports`。
- 需要的数据都在应用库里：`users`（email、`created_at`、`last_login_time`）、`subscriptions`（套餐、状态、`stripe_customer_id`）、`credit_accounts`（订阅池、充值池）、`credit_transactions`（只追加的积分流水）、`dictionary_lookup_quota`（每日查词次数）。
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

### 一、流水表补三列，管理员赠送单独成类型

1. `credit_transactions` 增加三列，均可为空，由现有 AutoMigrate 增加，不需要手写迁移：
   - `stripe_payment_intent_id`：Stripe 付款发放（`GRANT_TOPUP`、`GRANT_SUBSCRIPTION`）时记下对应的 payment intent；其他行为空。加普通索引。
   - `related_transaction_id`：扣回行指向它扣回的那条发放行。
   - `note`：自由文本。管理员赠送存 `reason`，扣回行存退款 id。
2. 新增流水类型 **`GRANT_ADMIN`**：管理员赠送改为 `credit.GrantAdmin(ctx, userID, amount, note)`。积分进**充值池**（和现在一样，永不过期），只是类型不同、`note` 存原因。`POST /api/admin/credits/grant` 的 `reason` 改为必填。
3. **历史数据**：一次性 UPDATE，`stripe_event_id LIKE 'admin-grant-%'` 的 `GRANT_TOPUP` 行改成 `GRANT_ADMIN`。只改应用库，可重复执行。写成 `enx-api/migrations/009_credit_grant_admin_type.sql`，与 adr-043 的 `008_words_english_nocase.sql` 同样的方式执行。

### 二、Stripe 退款自动扣回积分

4. **新增 webhook 事件 `charge.refunded`**：
   - `dispatchWebhookEvent` 和 `webhookEventLabel` 各加一个分支。
   - w10n-config 里 OpenTofu 管理的 webhook endpoint 事件列表（`infra/stripe/opentofu/enx`，test 和 live 两个 workspace）同时加上 `charge.refunded`。
5. **发放时记录 payment intent**：
   - 充值：`checkout.session.completed` 的 payload 里带 `session.payment_intent`，直接传给 `GrantTopup`。
   - 订阅：`invoice.paid` 的 payload 默认不带 payment intent，由 handler 通过 Stripe 的 invoice payments 接口取当期这张 invoice 的 payment intent，再传给 `GrantSubscription`。拿不到时（比如 0 元 invoice）照常发放，该列留空。
   - **实现时须用 Stripe CLI 的真实事件确认**这两个字段在 stripe-go v86 里的位置。
6. **扣回规则**：`credit.Clawback(ctx, paymentIntentID, amountRefunded, amountCaptured, stripeEventID)`。
   - 按 `payment_intent` 找发放行。找不到就**不扣**：记 error 日志，给管理员发邮件（复用 `RESEND_ADMIN_TO`，和 page report 通知走同一个 email 包），webhook 返回 200，不让 Stripe 重试好几天。
   - 应扣总数 = `floor(发放积分 × amount_refunded ÷ amount_captured)`。`charge.refunded` 里的 `amount_refunded` 是累计值，所以本次扣回 = 应扣总数 − 这条发放行已有扣回行的合计。部分退款多次触发时结果正确，全额退款就是全部扣回。
   - **充值发放**：从 `topup_balance` 扣，可以扣成负数（与 `Settle` 一致）。负余额时 `CanUseAI` 为假，用户以后再充值会先抵掉欠的部分。
   - **订阅发放**：只有当这条发放行是该用户**最近一条** `GRANT_SUBSCRIPTION` 时，才从 `subscription_balance` 扣，扣到 0 为止。更早周期的积分已经被下一期覆盖，扣回 0，但仍写一行流水留痕。
   - 新流水类型 **`CLAWBACK`**，`Amount` 为负（与 `SETTLE` 的符号约定一致）。**不复用已有的 `REFUND`**：`REFUND` 的意思是「AI 调用失败，把扣掉的积分还给用户」，方向正好相反。
   - 幂等：`stripe_event_id` 写这次 `charge.refunded` 的 event id，沿用唯一索引，重放无副作用。
   - 余额更新、写流水在同一个事务里。
7. **历史发放没有 payment intent**：部署后跑一次回填命令（`enx-api/cmd/backfill-payment-intents`）。对已有的 Stripe 发放行，用 `stripe_event_id` 向 Stripe 取回原事件，补上 `stripe_payment_intent_id`。Stripe 事件只保留 30 天，生产上线不久，现有数据都在这个范围内；取不回的行，退款时走第 6 条的「找不到就通知管理员」。
8. **不在本 ADR 范围**：争议（`charge.dispute.*`）、撤销退款。真遇到时由管理员手动处理（第三部分的赠送，加上后续可能补的手动扣减）。

### 三、管理员用户页（只读为主）

9. **API**，都挂在现有的 `/api/admin` 分组下，经过 `RequireAdmin`：
   - `GET /api/admin/users?q=&sort=&limit=&offset=`：用户列表。`q` 按 email 子串匹配；`sort` 支持注册时间、最近登录、余额；默认按注册时间倒序，`limit` 默认 50、上限 200。每行返回：
     - id、email、名字、注册时间、最近登录
     - 套餐与订阅状态
     - 订阅池、充值池余额
     - 累计付费获得积分（`GRANT_TOPUP` + `GRANT_SUBSCRIPTION`）、累计赠送积分（`GRANT_ADMIN`）、累计消耗积分（`CONSUME` + `SETTLE` − `REFUND`）
     - 是否有过退款扣回
   - `GET /api/admin/users/:id`：
     - 用户详情：上面的全部字段，加上 `stripe_customer_id` 和 **Stripe Dashboard 链接**（按 secret key 前缀 `sk_live_` / `sk_test_` 生成 `https://dashboard.stripe.com[/test]/customers/<id>`）
     - 近 30 天每日查词次数（`dictionary_lookup_quota`）
     - 近 30 天 AI 消耗按 `feature` 汇总
   - `GET /api/admin/users/:id/transactions?limit=&before=`：积分流水，倒序，游标分页。每行带类型、数量、变动后余额、时间、`note`，以及来源：Stripe 付款、管理员、退款扣回、AI 使用。
   - 送积分仍用 `POST /api/admin/credits/grant`（按 email），并把它挪进 `RequireAdmin` 分组，去掉 handler 里那份重复的白名单检查。
10. **分层**（AGENTS.md）：
    - 新建领域包 `adminuser`：`Service` 通过构造函数拿到仓储接口（用户、订阅、积分账户、流水、查词配额），负责组装和汇总；单测跑 fake。
    - SQL 放在 `repo/`。
    - handler 只做 HTTP。
    - `credit.GrantAdmin`、`credit.Clawback` 留在 `billing/credit`，和其他账本操作在一起。
11. **enx-ui**：
    - `/admin/users`：列表、email 搜索、排序。负余额用醒目颜色显示。
    - `/admin/users/[id]`：概要卡片、Stripe 链接、30 天使用量、流水时间线（加载更多）、送积分表单（数量 + 必填原因）。
    - 在现有 admin 导航里加 Users 入口。界面英文，和其他管理页一致。
12. **隐私边界**：管理员页只展示账号、账务和使用量**计数**，**不展示**用户保存的页面、reader 文档、查过哪些词（adr-032 定过保存的页面没有管理员路由，这里保持一致）。上线前确认隐私政策里有「运营方为客服与账务目的可以查看账号与账单数据」的表述，没有就补上。
13. **「注册用户」的口径**：`users` 表里的行，也就是至少用 Clerk 登录过一次、调用过 enx-api 的账号。只在 Clerk 注册、从没调用过 API 的账号不计入；要看那部分，去 Clerk Dashboard。

### 不做

- 不在 ENX 里存付款金额（见 Considered Options）。
- 不提供直接修改余额数字的接口，所有变动都走流水。
- 不在 ENX 里删除、封禁用户，也不做「以某用户身份登录」；需要时用 Clerk Dashboard。
- 总览页（用户总数、新增、付费数、活跃度）放到后续：v1 的列表页已经能数出来，等有实际需要再做。

## 实现要点（给实现者 / AFK agent）

按 TDD 顺序，每一步先写失败的测试：

1. **`billing/credit`**（现有测试风格，真实 SQLite 临时库）：
   - `GrantAdmin`：进充值池、类型 `GRANT_ADMIN`、`note` 落库；`amount ≤ 0` 或 `note` 为空时报错。
   - 历史迁移：`admin-grant-` 前缀的 `GRANT_TOPUP` 行变成 `GRANT_ADMIN`，其他行不动，执行两次结果相同。
   - `GrantTopup`、`GrantSubscription` 记录传入的 payment intent。
   - `Clawback`：
     - 全额退款扣回全部
     - 两次部分退款（累计 30%、再到 100%）合计扣回全部，每次都按差额扣
     - 同一 event id 重放无副作用
     - 充值池可以扣成负数
     - 最近一期的订阅发放扣到 0 为止；更早一期的订阅发放扣 0，但仍写流水
     - 找不到发放行时返回一个可识别的错误（例如 `ErrGrantNotFound`），不改余额
     - 并发两次不同 event 的扣回，合计正确
2. **webhook**（现有 `webhook_test.go` 风格）：
   - `charge.refunded` 分派到 `Clawback`
   - `ErrGrantNotFound` 时返回 200 并调用管理员通知（通知接口注入，测试用 fake）
   - `webhookEventLabel` 认识新事件
   - checkout 和 invoice 两条发放路径把 payment intent 传下去
3. **`adminuser.Service`**（fake 仓储）：
   - 列表的累计口径：付费、赠送、消耗分开算，`REFUND` 从消耗里减掉，`CLAWBACK` 单独标记
   - 搜索、排序、分页的边界：`limit` 上限、空结果
   - Stripe 链接按 key 前缀区分 live 和 test；没有 customer id 时不给链接
   - 30 天查词和 AI 消耗的汇总
4. **路由**（`router_test.go` 风格）：三个新 GET 和挪过来的 grant 接口，非管理员一律 403、未登录 401。
5. **集成测试**（`//go:build integration`）：真实库跑一遍「充值 → 消耗 → 部分退款 → 全额退款」，流水和余额对得上；管理员接口返回的累计数与之一致。
6. **enx-ui**：列表和详情页的组件测试（现有 `admin/__tests__` 风格）；送积分表单原因为空时不能提交。
7. **人工验证**（homelab，Stripe test mode）：
   - 充一笔 → 在 Stripe 后台部分退款 → 管理员页看到 `CLAWBACK` 行和变化后的余额 → 再全额退款 → 余额回到充值前（扣掉期间消耗之后可能为负）
   - w10n-config 的 webhook endpoint 已包含 `charge.refunded`（test 和 live）
   - 生产 `ADMIN_CLERK_USER_IDS` 填的是**生产 Clerk 实例**里的 user id（与 dev 实例不同）
   - 部署后在生产跑一次 payment intent 回填，日志里没有回填失败的行

## Consequences

- 管理员第一次能在 ENX 里看到全部用户和每个人的积分来龙去脉；金额以 Stripe 为准，ENX 不负责对账。
- 赠送和付费分开记账以后，「付费获得的积分」才能用来估算收入和成本；adr-048 落地时 `GRANT_TRIAL` 也照此单独成类型（它已经是这么设计的）。
- 退款以后，用户的充值池可能变成负数，这个用户的 AI 功能会被关掉，直到再次充值抵平。退款都是管理员在 Stripe 后台主动操作的，管理员如果不想让用户背负负余额，可以只退一部分，或者退款后用 `GRANT_ADMIN` 补平。
- 订阅退款只扣当期积分；如果退款发生在下一期已经开始之后，用户可能已经用掉了当期积分，这部分不追。用户少、退款罕见，可以接受。
- webhook 多处理一种事件，`invoice.paid` 多一次 Stripe API 调用（取 payment intent），会影响 adr-040 的 webhook 延迟指标，但量很小。
- 流水表多了三列，以后新的流水类型可以直接用 `note` 和 `related_transaction_id`，不用再改表。
