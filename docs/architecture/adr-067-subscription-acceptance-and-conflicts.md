---
status: accepted
date: 2026-10-22
related: issue #297、adr-009（订阅与积分）、adr-049（退款）、adr-051（邀请奖励）、adr-062（注销与账本保留）
---

# ADR-067：原子接受订阅，持久保存订阅冲突与管理员告警

## 背景

`subscriptions` 的用户主键只能保证一人一行。两个尚未完成的 Checkout 都能付款，现有 `upsertSubscription` 会覆盖其中一个真实订阅的映射；被覆盖的订阅仍可能扣款，后续 invoice 无法归属。#297 的所有者决定：每人只接受一个仍可计费的订阅，竞争订阅不发积分，保存异常后确认 webhook，由管理员通过邮件获知并在 Stripe 人工调查处理。

## 决策

### 接受与生命周期

- **Accepted subscription** 是 ENX 接受并映射到本地用户身份的 Stripe 订阅；每人至多一个仍可计费的 accepted subscription。同一订阅 ID 的通知是幂等重放，不是冲突。不同订阅的 webhook 到达先后不代表付款先后。
- 可计费状态沿用现有 `billing/subscription.go`：`active`、`trialing`、`past_due`、`incomplete`、`unpaid`。同时取回待接受订阅和现有 accepted subscription 的 Stripe 实时状态，不能用滞后的本地状态断定冲突或允许替换。Stripe 查询失败返回非 `2xx`，不猜测业务结论；理由与 ADR-049 第 8 条、`syncSubscriptionState` 一致。
- 尚未分类且已经结束的 incoming subscription 的 checkout 是过期通知：`2xx`，不接受、不新建冲突、不告警、不改当前映射。已经记录的冲突即使结束仍保持拒绝。现有 accepted subscription 已结束时，按其 ID 与版本有条件地同步状态，重试原子接受，让正常重新订阅继续可用。
- 两个不同订阅都仍可计费时，数据库原子操作只允许一个被接受；另一个成为 **Subscription conflict**。接受结果、同 ID 重放、过期 checkout、冲突和依赖/存储失败要能区分。Stripe I/O 后重新检查当前行的 ID 与版本；行已变化就重试分类，不能把旧的查询结果用在新的 accepted subscription 上。写事务不跨 Stripe 调用。
- 冲突记录和首次待发告警一起持久化后才确认 `2xx`。普通数据库错误不是冲突；正常处理和异常记录都未持久成功时返回非 `2xx`。冲突不修改 accepted subscription 的 customer、状态、套餐、余额，不发订阅积分或邀请奖励。财务副作用必须与分类保持一致。
- top-up 的 customer 更新也用数据库条件保护：已有 accepted live subscription 时保留其 customer；没有 customer 或没有 accepted live subscription 才允许 top-up 建立/更新 customer。两种 checkout 的并发完成顺序都不能把 Portal 和未来 checkout 指向另一个无订阅的 customer；充值积分与邀请规则照旧。
- 并发令牌明确为 `subscriptions.version INTEGER NOT NULL DEFAULT 0`，通过现有 AutoMigrate 加列；已有行使用默认值，不改写或回填历史业务数据。所有行更新（包括 top-up customer、plan/status/period 同步与替换）都在同一写入中递增版本。Stripe I/O 后的条件写入比较已观察的 subscription ID 和 version，接受/替换或记录冲突的事务也验证此条件；不能用毫秒 `updated_at` 充当版本。

### 持久异常与乱序事件

- `subscription_conflicts` 以 `(user_id, conflicting_subscription_id)` 唯一去重。保留 kind `competing_live_subscription`、本地用户 ID、accepted/conflicting subscription ID、分别保存的 customer ID、可用的 session/event ID 与时间。处理状态分为 `open` / `resolved`；通知状态独立为 `pending` / `sent`，附尝试次数、最后尝试时间/错误、发送成功时间。记录解决者、解决时间与备注；不删除异常来「解决」问题。
- Checkout 继续使用现有 `client_reference_id` 归属用户。invoice 和 subscription 事件以 subscription ID 查询 accepted mapping 或 conflict；两处都没有时查询 Stripe 实时状态，查询后再次检查分类；并发出现的 accepted/conflict 分类优先。仍未知且可计费时维持非 `2xx`，等待 checkout 分类。仍未知且已结束的 `invoice.payment_failed`、`customer.subscription.updated/deleted` 返回 `2xx`，结构化 warning 记录 event ID/type 与 subscription ID，不修改当前映射或财务状态；覆盖已被替换的旧订阅和被 checkout 跳过的过期订阅。Stripe/存储失败仍返回非 `2xx`；Stripe 对象不存在不等于已确认结束。不从 customer 猜测用户。未知且已结束的 `invoice.paid` 涉及历史付款权益，等待下文所有者决定，不能套用此确认规则。此决策不要求新增 Stripe subscription metadata。
- 已知冲突的 `invoice.paid`、`invoice.payment_failed`、`customer.subscription.updated/deleted` 只保留调查上下文。`subscription_conflict_events` 关联冲突，以 Stripe event ID 唯一保存事件类型、Stripe 创建时间、接收时间、subscription ID 和可用的 customer/session/invoice/payment-intent ID，落库后 `2xx`。同一事件重放不新增记录或邮件，不同事件保留各自上下文；落库失败可重试。
- 订阅积分仍只由 accepted subscription 的 `invoice.paid` 发放，不由 checkout 发放。已拒绝订阅即使冲突已经人工解决也不能重新接受或发积分；后续事件可以追加上下文，但不重新打开异常或再次排队告警。
- 正常退款沿用 ADR-049。冲突没有发放记录，其退款进入现有 `ErrGrantNotFound` 路径，管理员邮件含 charge/payment-intent ID，可据此调查，不扣积分且不到达取消 accepted subscription 的分支。本决策不要求把 unmatched refund 接到冲突事件表，也不改用户当前订阅的正常退款取消规则；较早 accepted subscription 的退款误取消新订阅是 P-2 下的独立 bug。

### 注销与账本保留

- 根据 ADR-062 第 1 条，两个 conflict 表作为账本保留，不加入账号删除的 personalTables；仅保留不透明本地用户/管理员 ID、Stripe 标识符和调查结果，不复制姓名、邮箱或原始 payload，解决备注不得包含个人信息。删除后待发邮件与事件追加仍可运行，不依赖 users 行，不重建用户或余额。
- ADR-062 第 2 条禁止存在续费订阅时注销。是否把 conflict 纳入查询、或允许仍续费的 conflict 作为例外，涉及既有注销产品规则，等待所有者决定；账本保留不代表已批准此例外。

### 邮件与人工解决

- 使用现有邮件能力的专用 conflict adapter；缺少 Resend API key、管理员收件人或必需的 sender 配置都返回错误，不能沿用已有 best-effort 方法「未配置就返回 nil」的成功语义。邮件包含 conflict ID、调查标识符与读取/解决 API 用法；不增加 Telegram 或面向用户的通知系统。
- 进程启动后跑一次待发任务，随后每小时跑一次，沿用 `enx-api.go` 的 ticker 模式。每轮对每个到期 pending 告警尝试一次，无最终放弃次数；有发送超时、持久化尝试次数/最后错误、带到期时间的数据库领取机制。崩溃后过期领取可恢复，普通并发 worker 不重复发送。每次失败按 logging 规范记录 conflict ID、次数与错误，不记录邮件正文或秘密。
- 仅邮件提供方确认成功才标记 `sent`。发送后、标记前崩溃可能重复邮件，接受这个窗口；普通 webhook 重放不新建待发告警。解决异常不丢弃尚未发送的通知。
- 提供管理员 API，无 UI：`GET /api/admin/subscription-conflicts`（可选 `status=open|resolved`，默认全部；`limit` 默认 50、上限 200，`offset` 默认 0，按创建时间倒序）、`GET /api/admin/subscription-conflicts/:id`（异常与事件上下文）、`PATCH /api/admin/subscription-conflicts/:id`（`status=resolved` 与必填非空 `notes`）。挂在现有认证和管理员 allowlist 分组，沿用其鉴权；未登录 401、非管理员 403、不存在 404、无效输入 400。
- PATCH 原子记录解决者的本地用户 ID、时间、备注；完全相同的重放不重复改时间，不同的后续解决请求返回 409。不提供 reopen 或 promote。`resolved` 仅代表管理员记录了调查结果，不证明已经退款，也不强制某种退款或取消方案；Stripe 操作仍由管理员判断并手动完成。这是既有「拒绝订阅在解决后也不能被接受」规则的记录接口，不引入新的金钱语义。
- 领域规则放在无框架和 I/O 的核心中，以构造函数注入仓储、Stripe 状态读取和通知依赖；SQL 在 `repo/`，handler 只做事件/API 翻译，遵守 AGENTS.md。

## 待所有者决定（#297 round 2）

- 未知且已结束的 `invoice.paid`：建议持久记录、按 event ID 去重并以可恢复邮件通知管理员后确认，不自动发积分或邀请奖励；另一选择是恢复历史归属后明确发放规则。包括正金额与零金额 invoice，均需所有者确认；这是新的财务例外，不能从冲突永久拒绝规则推出。决定前维持非 `2xx`，不得静默丢弃。
- 冲突仍续费时注销：建议沿用 ADR-062 第 2 条，对 accepted 与 conflict 都查实时续费状态，无法通过 Portal 操作的 conflict 由管理员先在 Stripe 手工取消；另一选择是明确批准 conflict 例外，保留账本与邮件但允许注销。后者需要修订 ADR-062，不能仅从现有 adapter 只查单行的实现推定。决定后补齐并发分类/注销与错误处理测试。

## 取舍

- 不采用仅靠进程内锁或读取后无条件覆盖：无法防止多实例和 webhook 并发。
- 不自动取消、退款或提升冲突订阅：所有者已决定不猜测用户购买意图。人工解决保留永久分类，避免重放产生财务效果。
- 不依赖 webhook 重试发送邮件：异常持久化后已确认交付，邮件失败必须独立恢复。使用只服务本异常的 pending 状态，不建设通用消息平台。
- 不用直接 SQL 作为管理员日常解决接口：已有管理员认证 API 可复用，能验证权限、备注、幂等和终态。

## 修订记录

- 2026-10-22：#297 round 1，记录所有者已确认的一人一个 accepted live subscription 与永久拒绝冲突规则；根据代码审查补明实时状态校验、top-up customer 保护、乱序重试、邮件恢复和人工解决接口。不修改 ADR-049 的正常退款或任何定价规则。

- 2026-10-22：#297 round 2，明确单调版本列及所有写入的条件比较、未知已结束订阅的非付款事件终态、注销后冲突账本保留；未知已结束 paid invoice 的财务处理与续费 conflict 的注销资格保留为所有者问题，不把建议写成已接受决策。
