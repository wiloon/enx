---
status: accepted
date: 2026-10-22
updated: 2026-10-23
related: issue #297、adr-009（订阅与积分）、adr-049（退款）、adr-051（邀请奖励）、adr-062（注销与财务留存）
---

# ADR-067：持久接收 Stripe webhook，异步处理事件，分别保存订阅归属与接受关系

两个并发 Checkout 可以产生同一用户的两份真实订阅；旧 `subscriptions` 以用户为主键，后来的写入会覆盖较早订阅。同时 Stripe 不保证 webhook 到达顺序，`invoice.paid` 可以先于建立本地订阅关联的事件到达。「本地没有映射」不能据此判定重复购买。所有者在 #297 的 2026-10-23 讨论中决定：完整保存每次接收，按事件去重后异步处理；保存全部订阅，每人至多接受一份当前订阅，竞争订阅留给管理员调查。本文是已接受的目标设计，实现步骤、迁移与验收在 #297；不表示代码已经实现。

## 接收历史与处理事件

- `stripe_webhook_deliveries` 每次有效投递新增一行，不按 Event ID 去重。保存独立 delivery ID、ENX `received_at`、Stripe Event ID/type/created/API version、Stripe account 与 test/live 环境、原始请求 payload。重复事件的 ENX 接收时间可以不同，Stripe 原事件的创建时间不随重投改变。保存发送到 ENX endpoint 的全部验签通过事件，包括暂不处理的类型；不为此订阅 Stripe 账户里的所有事件。
- `stripe_webhook_events` 每个 Event ID 一条处理记录，唯一约束在所配置的 Stripe account/test-live 范围内生效。关联不可变的首次 payload/delivery，保存类型、对象和可解析的 subscription/customer/session/invoice/payment-intent ID、可选本地用户身份、处理状态、尝试次数、首次依赖等待/截止时间、最后错误、下一次尝试时间、领取 token/到期时间、完成时间。event 自身另存人工告警的 pending/sent、尝试次数、最后错误、下次尝试、sent 时间与领取 token/到期时间；转 needs_attention 与初始化待发告警同事务，以 account/live-mode/Event ID 为告警身份。退款无法匹配、paid invoice 无法归属都用此状态，不能借用不存在的 conflict 行。管理员重试事件不清空已发/待发邮件。后来的 delivery 关联同一任务，不能重置已完成状态或创建第二次财务操作。
- HTTP handler 用 `ConstructEventWithOptions`、`IgnoreAPIVersionMismatch: true` 校验原始签名（保留正常时间容差）与基本 envelope；API version 不匹配不等于坏签名。持久保留原文及 api_version，worker 按明确支持的版本 adapter 解释业务对象，初始基线为锁定 stripe-go v86.4.2 的 `2026-08-26.dahlia`，其他已部署/队列版本须在切换前补 adapter/fixture；SDK 升级保留旧队列版本的 adapter/fixture。支持的业务类型若版本未知/缺失则 needs_attention 并可靠告警，不在接收时 400 或静默 ignored。校验所属环境后，再在同一事务里追加 delivery 并确保 event 任务存在；事务提交后立即返回 `2xx`。验签/结构失败拒绝，事务失败返回非 `2xx`。接收成功只承诺 ENX 已持久接管，不代表业务已经处理、接受订阅或发放积分。提交后响应丢失造成的重投照常新增 delivery、复用同一 event。
- 单账户 endpoint 的 account ID 在 billing 启动时用所配 API key 调 `GET /v1/account` 取得并缓存；失败则 billing 未就绪、重试发现，期间接收返回 503，不接管历史。直接账户事件 account 为空时使用此身份；非空必须一致，不扩展到 Connect。以 `sk_live_`/`rk_live_` 与 `sk_test_`/`rk_test_` 区分预期 livemode，启用 billing 时未知 key 前缀为配置错误。唯一键保持 `(stripe_account_id, livemode, event_id)`。错账户/环境、坏签名、无效 envelope 返回 400 且不保存可信 delivery，结果原因分别记录；版本不匹配按前条持久接管。
- `pending` → `processing` → `processed`；缺前置关联进入 `waiting_dependency`，临时 Stripe/数据库故障重新排队并退避，不能误判为业务冲突。可信身份矛盾等不可恢复问题或持续无法自动处理的事件进入 `needs_attention`；无需业务处理的类型进入 `ignored` 并记录原因。状态转移和领取持久化，worker 崩溃后过期领取可恢复，多个实例不能同时完成同一任务。
- 在同一数据库上运行有独立周期轮询的 worker，启动后恢复待处理任务；新消息到达时可唤醒。关联建立后唤醒同一 Subscription ID 的依赖事件，周期重试兜底；一个等待事件不阻塞后面的结账事件。按接收时间查询历史，不按接收或 Stripe `created` 时间假定因果顺序。持续无法关联的事件在配置的等待期限后转人工，原事件仍保留，可受控重试。
- 本地业务修改、积分账本幂等判定与 event 完成标记在可覆盖的同一事务内提交。跨事务的邀请记录、Stripe 调用、邮件等副作用必须独立幂等、保存恢复进度，所有必要步骤完成或已持久转交人工才结束任务；不承诺端到端 exactly-once。保留 Event ID 去重，并按对应业务对象/操作防止不同 Event ID 表达同一效果时重复发放；合法的后续 invoice/部分退款不能被粗略的对象去重吞掉。

worker 的可调正 duration 默认值在 #297 明确为 `stripe.webhook.poll-interval=5s`、`lease-duration=2m`、`operation-timeout=30s`、`backoff-min=5s`、`backoff-max=15m`、`dependency-wait-deadline=24h`、`notification-poll-interval=1h`、`notification-timeout=30s`、`notification-lease-duration=2m`，并绑定同名大写下划线环境变量。退避有上界，临时错误不按次数永久放弃；首次依赖等待开始计时，重投/重启不重置期限。领取使用 fencing token，每次业务提交与完成都核实，过期 worker 不能提交；长任务续租或停止恢复。邮件领取独立，发送超时短于领取期限，启动/每小时恢复。

## 订阅归属与接受关系

- `subscriptions` 以 Stripe Subscription ID 为主键，每份真实订阅一行，记录其 ENX 本地用户身份、Stripe Customer ID、套餐/周期/实时状态快照及单调版本。同一用户可以拥有多行，Customer ID 也允许在多份订阅上重复；无法可信归属时保留未关联记录/等待事件，不能从邮箱猜用户。
- `users.accepted_subscription_id` 是可空的当前接受关联，只能指向属于同一本地用户身份的订阅。归属回答「这是谁买的」，接受回答「ENX 当前认可哪份」；冲突订阅仍保留其用户归属。接受关联及其并发版本与订阅快照一起受数据库条件写保护，不能用毫秒 `updated_at` 充当并发版本。
- ENX 分类与 Stripe 状态分开：订阅分类可为 `unclassified`、`accepted`、`conflict`、`stale`；Stripe 仍使用自己的 `active`、`canceled` 等值。曾接受的旧订阅保留 accepted 历史；当前关联转到正常新订阅后，旧记录不因此变 conflict。冲突另外保留原因、竞争时接受的订阅 ID、发现时间、`open/resolved`、解决者/时间/备注，以及独立邮件状态。独立的 `subscription_conflicts` 和 `subscription_conflict_events` 表不再是本方案：用订阅记录表达冲突、用 event/delivery 关联调查上下文。
- 每人至多一个仍可计费的 accepted subscription，可计费状态沿用 `active`、`trialing`、`past_due`、`incomplete`、`unpaid`。同时核实 incoming 与当前 accepted 的 Stripe 状态；不能因本地缓存滞后而误判冲突或替换。Stripe I/O 不跨数据库写事务；返回后重新验证接受指针、用户 billing version 及有关 subscription version，变化就重试。所有影响接受判定的写入递增对应版本。
- 两份不同的 live 订阅并发时，第一次数据库原子接受成功的成为当前订阅，另一份标为 conflict；「第一次成功」不是 webhook/付款时间排序。同一 ID 重放不是冲突。当前 accepted 在 Stripe 已结束时允许正常重新订阅；未分类且已经结束的 checkout 保留为 stale，不覆盖当前关联。查询/存储失败由 worker 重试，不变成猜测的冲突。
- conflict 永远不取代 accepted，不获得订阅积分或邀请奖励，也不改 accepted 的 customer、套餐或余额。管理员取消/退款后记录 `resolved`，不自动提升该订阅，不删除它或重新开启告警；后续事件保留上下文。事件已归档为 `processed` 与订阅冲突仍 `open` 可以同时成立。

## 正常重新购买、升降档与购买阻断

以下是所有者在 #297 的 2026-10-23 round 3 答复，取代「现有订阅一律找管理员」的笼统规则：

- accepted A 在 Stripe 实际已结束（canceled/incomplete_expired）且无阻断冲突时，允许同档或其他已提供档位重新购买并自动接受 B，保留 A 历史。已安排期末取消仍未结束。
- 健康 active 订阅升降档更新同一 Subscription ID 的 price，不取消后重买；同档请求不新建 Checkout。服务端在创建 Checkout 或发起改档前检查删除屏障、所属冲突与 Stripe 资格，不能只禁用按钮。其他不健康但可计费状态不能据此新买第二份订阅。
- 升档收取按剩余周期折算的差额，支付成功才启用高档并补 `floor((新档每期积分 - 旧档每期积分) × 剩余周期比例)`，保留余额及周期末。比例使用同一次持久改档操作的原周期起止与 Stripe proration timestamp：`clamp((period_end - proration_timestamp)/(period_end - period_start), 0, 1)`，重试复用，不按 webhook 到达时刻重算。支付失败/未确认维持原档及积分。proration invoice 不能再触发整期发放。
- 改档操作先持久化旧/新档、周期、折算时刻、invoice/付款引用、幂等键和恢复进度；用 billing revision 协调并发，Stripe 请求独立幂等。可用时用 payment-contingent pending update（`payment_behavior=pending_if_incomplete`、`proration_behavior=always_invoice`），保留 billing anchor；不支持的支付方式安全失败并给支持入口，不能先启用未付款套餐。不改变付款方式配置。
- 降档在下一期生效（例如 Stripe subscription schedule），本期权益/积分不变，下期按低档正常发放；保存排期并恢复，维持同一 Subscription ID。乱序事件不能撤回已确认的改档、重复补积分或把补差额覆盖成整期发放。
- 任何所属 conflict 仍 open，或 resolved 但 Stripe 仍可计费时，阻止新 Checkout，返回 409 并指向 billing support；即使 accepted A 已结束也一样。Stripe 查询失败可重试且不放行。resolved 备注不证明停止计费。

## 用户关联与乱序恢复

- 服务端创建订阅 Checkout 时同时写 `client_reference_id = users.id` 与 `subscription_data.metadata.enx_user_id = users.id`。前者关联 Checkout Session，后者写入 Subscription；普通 Session metadata 不会自动复制。订阅事件读取对象 metadata，订阅发票按事件 API 版本读取订阅 metadata 快照或通过关联对象取得。退款等事件不保证直接携带用户 ID，仍需按已有业务标识查询。两处用户标识矛盾时转人工，不能覆盖归属。
- 对已有订阅、缺 metadata 或 invoice-before-checkout 的事件，用可信 Checkout 关联/已有记录恢复；暂时缺失进入 `waiting_dependency`，不因本地查不到订阅立即认定冲突或永久放弃正常付款。较晚 Checkout/订阅关联建立后恢复同一订阅的事件，并重新验证原子接受结果。metadata 只解决身份，不绕过竞争订阅判定。
- 无法恢复可信关联的 invoice（包括 Stripe 已结束订阅的正金额/零金额 paid invoice）持久进入 `needs_attention`，可靠邮件通知管理员，不自动发新积分或邀请奖励。已知历史 accepted 的合法付款沿用现有权益规则，不因当前指针变化被当成未知；晚到的旧状态/周期事件不得覆盖新订阅或将当前积分周期回退。未知 ended 的非付款事件也保留处理结果与原因，不静默丢弃。
- `invoice.paid` 仍是订阅积分发放来源，Checkout 不发订阅积分；非订阅发票不误按订阅授予。冲突发票只归档调查。退款沿用 ADR-049 的金额/扣回规则，准确关联原始发放/订阅；冲突未发放的退款不能取消或扣回 accepted 订阅。接收已确认后，Stripe 查询/取消失败由 ENX 的持久任务继续重试，不能等 Stripe 再投一次。

## 积分周期与退款来源

- 发放/付款效果保存真实 Subscription ID、invoice、周期起止、正常发放/升级补差额类型、购得积分、实际入池积分及 PaymentIntent/退款关联；余额保存当前来源订阅、周期和正常 invoice。业务幂等键约束同一 invoice/周期正常发放与同一改档补差额，不能仅靠 Event ID。
- 正常 invoice 仅能为当前 accepted 的新周期重置积分；同一订阅的同/更早周期和历史 A 的迟到付款保留财务记录（含购得积分、PaymentIntent、实际入池 0），不重置当前池。周期顺序在同一 Subscription ID 内比较，不能用接收/created_at 排序，也不能用不同订阅的 period_end 大小拒绝合法的正常替换：新 B 可以有不同周期长度，其首个有效周期只初始化一次。
- 退款判断是否当前池来自原发放确实入池且订阅/周期与池来源一致，而非「最后插入一条 GRANT_SUBSCRIPTION」。A 结束但未被 B 周期替换时仍保留池来源供退款；B 已替换后，A 的历史/未入池发放只记零效果扣回，不扣 B。正常发放与同周期升级补差额各自按原付款适用 ADR-049 比例累计扣回、订阅池不低于零，充值池可负；退款取消仅针对原发放的订阅。缺失/含糊旧关联进入恢复/人工，不能从当前指针猜或改写原发放金额。

## 一次性充值与 Stripe Customer

- 当前代码在 `subscriptions` 中还保存仅充值用户的 Customer 映射（Subscription ID 为空），实际充值流水与余额在 `credit_transactions` 和 `credit_accounts`。改主键前把所有 Customer 归属迁入独立 `stripe_customers` 关系，一份 Customer 一行，以本地用户身份关联；一人可以有多个 Stripe Customer，不把 Customer 唯一到一人只能一条。
- 无 live accepted 时可使用用户正常的 Customer 关联；有 live accepted 时 Portal 与后续 Checkout 优先使用该订阅的 Customer。充值完成只补充 Customer 归属，不覆盖 live accepted 的 Customer。并发操作和迁移都保留此规则。
- 只有真实 Subscription ID 的旧行迁入新 `subscriptions`，不为仅充值用户虚构订阅。迁移保留全部充值余额、原积分流水、Event ID/PaymentIntent ID 及退款关联。原子、可重复的数据库迁移取代仅靠 AutoMigrate 改主键；迁移边界和演练在 #297，不在运行中直接删旧表试错。

## 管理员处理与邮件

- 系统自动记录、通知；取消竞争订阅、调查原始 Stripe 数据和退款由管理员手动执行。冲突与持续无法关联的事件有可查询的持久人工事项；普通重复投递不重复产生事项/告警。event 告警与 subscription conflict 告警都走同一启动/每小时恢复驱动，管理员重试不重发已确认告警。
- 使用现有邮件服务的可靠 adapter，pending 状态与异常分类同事务保存；API key、sender、管理员收件人缺失或提供方失败都记错误并重试。worker 启动和每小时处理待发邮件，有发送超时、到期领取、尝试次数/最后错误；仅提供方确认成功标记 sent。发送后确认前崩溃允许少量重复，日常 webhook 重放不刷邮件；解决异常不丢待发告警。
- 现有 `/api/page-reports` 要求页面 URL，不是任意账务反馈。阻断的 `/billing` 提供 billing-support 表单；新增认证的 `POST /api/billing/support` 只接受当前用户所属 conflict、非空至多 2000 字符消息。首条消息/时间与独立的 support 告警 pending 状态同事务保存于该订阅，邮件复用 Resend 的可靠恢复；每个用户/conflict 只通知一次，重复点击返回既有结果，不重新发邮件。自动发现告警不依赖用户反馈。此支持入口是所有者要求的产品工作，不扩大成通用反馈平台。
- 沿用 #297 的管理员查询/解决 API 意图，查询订阅冲突与关联 event/delivery，无需建同名表或新增用户端财务操作 UI。解决操作认证、幂等、有非空备注与操作者/时间；`resolved` 仅表示管理员记录调查结果，不自动证明已取消或退款。worker 失败和超期等待可被管理员发现；原始 payload 仅限必要的管理员访问，不写入普通日志。

## 注销与财务留存

- 所有者已确认：存在 `open` 的订阅冲突就拒绝用户和管理员删除，提示 `Contact an administrator to resolve your subscription issue before deleting your account.`；不能只检查 accepted 指针。即使冲突标 resolved，仍会续费的所属订阅也必须先取消，查询 Stripe 失败不能放行。普通 accepted 的自助取消入口沿用 Billing Portal；异常订阅由管理员处理。
- 注销检查不能以本地 active/trialing/past_due 三状态筛掉 unpaid/incomplete 或未知/滞后状态：每份未由 Stripe 权威确认 canceled/incomplete_expired 的所属订阅都查实时续费，终态证据也受版本重验；不明确的 resource_missing 和其他查询错误阻止注销，不能猜测已结束。保留 cancel_at_period_end 的既有资格。
- 删除资格与并发接受/分类共用持久协调机制：建立删除屏障后停止接受新订阅和发放新权益；用户硬删除后仍保留屏障的不透明本地身份和 deleted 终态（不含姓名/邮箱），使迟到 metadata 不被当作临时缺映射或重建账户的理由；发现并发新增未解决冲突或仍续费订阅则中止删除。后续 webhook 仍保存财务历史，不能用 metadata 或历史映射重建已删用户/余额。管理员标 resolved 不能绕过实时续费检查。
- 注销前已打开的 Checkout 在注销后收款（充值或订阅），保存付款/Customer/订阅上下文，event 进入 `needs_attention`、reason `payment_after_account_deletion` 并可靠告警；不发积分/邀请奖励、不建余额/用户/接受指针、不自动退款取消，也不绑定同邮箱新账号。删除屏障期间付款等待持久删除结果；仅删除中止且重新验证资格才正常处理。删除后旧退款只做可恢复财务审计，不重建余额。
- 所有者明确将 webhook delivery/event 历史纳入财务留存：账号注销后仍保留完整 payload、重复接收记录、事件状态、订阅归属/冲突/Customer 记录及原积分账本。原 payload 可能包含邮箱等个人信息，这明确修订 ADR-062 的「保留数据无法再关联个人信息」假设；保持用户行和普通个人业务数据硬删除，隐私告知同步说明财务 webhook 原文例外。本次不规定自动过期、脱敏或删除这些历史。

## 部署边界

ADR-064 会在 main 合并后自动部署。#297 的 characterization/fixture 可先独立 PR；改变 subscriptions 主键的迁移必须与所有读写方、accepted entitlement 查询、接收/worker、原子分类、积分/退款来源、删除屏障、必要管理员告警/查询及隐私告知在同一兼容部署 PR 完成，不能先迁移再等后续 PR 修调用者。旧进程停止/排空后切换，启动校验 schema，不能只回滚旧 binary；备份恢复方案与演练由发布流程承接。后续独立 PR 才开放完整同 ID 改档与支持表单；此前保留现有重复购买阻断和已公布的支持联系方式，proration invoice 若尚无可恢复改档处理须转人工，不能发整期积分。各切片必须独立安全，全部完成前不关闭 #297。具体切片与测试在 issue，主机配置/发布动作按 P-3 交 Linear；不改变 ADR-066 内测付款策略。

## 取舍

- 拒绝同步业务完成后才确认 webhook：乱序和外部服务失败会依赖 Stripe 重投；改为 ENX 持久接管，代价是必须维护 worker、恢复和积压监测。
- 分开每次 delivery 与唯一 event，保留审计事实与幂等处理；单张去重历史表会丢接收记录，单张不去重任务表会重复财务效果。
- 保存全部订阅、单独指向当前 accepted；不再用用户主键覆盖 Stripe 事实，也不另建重复的 conflict 订阅模型。代价是现有主键/Customer 混用必须迁移。
- 采用数据库任务与轮询，不引入独立消息队列，不建设通用通知平台。财务副作用仍用独立幂等约束，而不是依靠处理标记宣称 exactly-once。

## 修订记录

- 2026-10-22：#297 round 1/2 确认原子接受、冲突人工处理、邮件恢复；旧稿按用户保存订阅并另建 conflict 表，paid invoice 与注销存在待决项。
- 2026-10-23：所有者确认完整 delivery 历史、去重 event 与异步恢复、按 Subscription ID 保存全部订阅、用户当前接受指针、Subscription metadata、本地 Customer 关联拆分、异常未解决禁止注销、原始财务 webhook 注销后留存。替换旧同步确认/依赖 Stripe 乱序重投及独立 conflict 表方案，关闭上述待决项。实现任务与验证见 #297。
- 2026-10-23（#297 round 3）：补齐 API 版本与 endpoint 身份边界、event 人工告警状态、积分周期/退款来源、注销后付款终态及默认 worker 时序；按所有者答复记录正常重购、同 ID 支付确认后升档补差额、下期降档及冲突支持入口，并约束自动部署下的原子迁移边界。

## 参考

- [Stripe webhook 顺序、重复与异步处理](https://docs.stripe.com/webhooks#event-ordering)
- [Stripe metadata 传递规则](https://docs.stripe.com/metadata#set-metadata-indirectly)
- [Stripe 支付确认后应用改档](https://docs.stripe.com/billing/subscriptions/pending-updates)
