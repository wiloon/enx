---
status: accepted
date: 2026-10-22
updated: 2026-10-26
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

## 正常重新购买与购买阻断

- accepted A 在 Stripe 实际已结束（canceled/incomplete_expired）且无阻断冲突时，允许同档或其他已提供档位重新购买并自动接受 B，保留 A 历史。已安排期末取消（`cancel_at_period_end=true` 或 flexible billing mode 下 `cancel_at` 不晚于本期末）仍未结束。
- 有健康 live accepted 订阅时，不为改档新建 Checkout；改档走下节的 Stripe Portal。「健康」指 Stripe 实时状态为 `active`（Checkout 不提供试用，`trialing` 不算健康）。服务端在创建 Checkout 或改档 Portal session 前检查删除屏障、所属冲突与 Stripe 资格，不能只禁用按钮。其他不健康但可计费状态（`past_due`、`unpaid`、`incomplete` 等）不能据此新买第二份订阅，也不能改档：档位按钮改为打开 Portal 首页让用户补付或换卡，恢复 `active` 后才可改档。
- 任何所属 conflict 仍 open，或 resolved 但 Stripe 仍可计费时，阻止新 Checkout 与改档入口，返回 409 并指向 billing support；即使 accepted A 已结束也一样。Stripe 查询失败可重试且不放行。resolved 备注不证明停止计费。
- 被阻断用户（删除屏障生效中，有上条所述冲突，或 accepted 订阅可计费但不健康）仍可打开 Portal 首页（/billing「管理订阅」）取消订阅、换卡、看发票，但该 session 一律用关闭改档的受限 Portal 配置创建（所有者 2026-10-24 选择），不能靠 Portal 首页绕过改档阻断。是否阻断在创建每个 Portal session 前由服务端判定；判定所需查询失败时不创建 session，返回可重试错误。

## 改档由 Stripe Customer Portal 完成

所有者 2026-10-23 决定（取代 round 3–5 的 ENX 自建改档）：Stripe 官方提供的改档能力都用 Stripe 的实现，ENX 不自建改档流程、不保存改档操作记录；Stripe 不提供的部分，按 Stripe 文档建议在应用层实现。积分是 ENX 自己的概念，由 ENX 根据 Stripe 事件计算。依据是所有者在 Stripe sandbox 的实测（2026-10-23，订阅为 flexible billing mode）：

- **商品模型**：Pro、Pro+、Max 权益不同，保留不同 Product；同档月付/年付是该 Product 下的不同 Price。改档替换现有 subscription item 的 Price（可跨 Product），保留 Subscription ID。
- **升档**：Portal 配置 `proration_behavior=always_invoice`。确认后立即开 `billing_reason=subscription_update` 发票收差价；付款失败时 Stripe 把变更挂在 `pending_update`，订阅保持原档位、发票 open，用户可在 Portal 换卡付款，付款成功才应用（`customer.subscription.pending_update_applied`）。未付款时 Stripe 最迟 23 小时（或本期末，取较早者）自动作废发票、丢弃变更（`customer.subscription.pending_update_expired`）。ENX 不提供主动取消待付款升级（Portal 没有此入口；Stripe 文档的应用层做法是 void 该发票），第一版沿用 Stripe 自动到期，后续需求另见 #338。
- **降档**：Portal 配置 `schedule_at_period_end.conditions=[decreasing_item_amount]`。跨 Product 降档同样安排在本期末，由 Portal 创建 Subscription Schedule；本期档位、权益和积分不变，不退款、不开发票；下期续费发票按新档位收费。实测与 Stripe 文档「Portal 期末降档仅限同 Product」的说法不符，以实测为准，上线前在 live 再核实一次。
- **撤销降档与取消订阅**：Portal 自带「Cancel scheduled update」（release 排期）。有 Portal 自建排期时，Portal 仍可取消订阅：它 release 排期并设置期末取消。ENX 不提供撤销降档入口，也不要求先撤销降档再取消。
- **ENX 入口**：/billing 的档位卡片对已订阅用户显示改档按钮。点击后服务端检查资格，再创建 `flow_data.type=subscription_update_confirm` 的 Portal session（指定现有 item 与目标 Price），用户在 Stripe 确认页付款或确认降档后回到 /billing。当前档位不显示改档按钮。订阅已有 `pending_update`、Subscription Schedule 或期末取消时，按钮改为打开 Portal 首页，让用户在 Stripe 处理现有变更。/billing 的权益说明与 Stripe Product description（Portal 选档页显示）使用同一文案和积分数值，二者与 enx-api 的积分配置同时修改。
- **Portal 配置校验**：ENX 使用两份 Portal 配置，都由 w10n-config `infra/stripe/opentofu/enx/portal-config.py` 统一定义（sandbox 与 live 同一份定义，按 lookup_key 取 Price）：
  - **改档配置**：账户默认配置。`stripe.portal-configuration-id` / `STRIPE_PORTAL_CONFIGURATION_ID` 是可选覆盖；未设置时按当前 API key 的 account/mode 查询 `active=true,is_default=true` 的默认配置，显式指定时只读该配置，失败不改选默认。要求：active；`subscription_update.enabled=true`、`proration_behavior=always_invoice`、含 `decreasing_item_amount` 期末条件；`default_allowed_updates` 恰为 `[price]`（不允许改数量或优惠码：一个用户同一时刻只有一份订阅、数量为 1）；`products[]` 每项只列该档位 ENX 配置的 Price 且 `adjustable_quantity.enabled=false`，全部条目的 Price 恰为 ENX 配置的订阅档位 Price；保留取消（期末）、付款方式与发票功能。
  - **受限配置**：给被阻断用户的 Portal session 用。`stripe.portal-restricted-configuration-id` / `STRIPE_PORTAL_RESTRICTED_CONFIGURATION_ID` 是可选覆盖；未设置时查询 `active=true` 且 metadata `enx_portal=restricted` 的配置，须恰好一份。要求：active；`subscription_update.enabled=false`；保留取消（期末）、付款方式与发票功能。
  - 两份都在 billing 启动时检查并记日志；创建 session 时按阻断判定选其一并核实，显式传入该 configuration ID。不符合、找不到、结果不唯一或查询失败都不创建 session，返回可重试错误，不改用另一份。配置准备按 P-3 交接。
- **上线前实测**：sandbox 实测只走过 Portal 自带的选档页。实现发票分类前，用 test clock 在 sandbox 再跑一次：经 ENX 深链接（`subscription_update_confirm`）升档与降档，确认同样遵守 `always_invoice` 与期末降档；推进到期末，记录降档后第一张续费发票的 `billing_reason` 与 line。升档发票与这张续费发票保存为分类测试的版本化 fixture。
- **价格来源**：accepted 订阅的有效档位就是 Stripe 订阅 item 当前 Price 对应的档位，ENX 不另存「授权改档」。订阅换到 ENX 配置之外的 Price（例如 Dashboard 误操作）时 event 进入 needs_attention 并可靠告警，不改档位、不发积分/邀请奖励，也不自动改回 Stripe。

## 积分随 Stripe 事件调整

- 只有 `invoice.paid` 改变订阅积分，按事件 API 版本规范 `billing_reason`、subscription/item、price、line period 与 proration 后分类：
  - `subscription_create`、`subscription_cycle`：正常周期发放，档位/周期取对应 subscription item 的非 proration recurring line 的 Price（必要时读取全部 invoice line 分页），重置为该档整期积分。降档后的第一张续费发票按新档位发放。Subscription Schedule 换期开出的发票可能标为 `subscription_update`：该 item 没有 proration line、只有一条覆盖整期的非 proration recurring line 时，不论 reason 都按正常周期发放。
  - `subscription_update`：升档补差积分，一张发票至多一次。旧/新档位取该 item 的负额与正额 proration line 的 Price；剩余比例 `clamp((line.period.end - line.period.start) / (周期 end - 周期 start), 0, 1)`，补 `floor((新档每期积分 - 旧档每期积分) × 剩余比例)`。分子取正额 proration line 的周期；分母的周期取同一 Subscription ID 已保存的正常发放中 period end 等于该 proration line period end 的那一期，不读 Stripe 当前 item 周期（续费后它已是下一期）、不读 `proration_details`。尚无该正常发放时事件进入 `waiting_dependency`，依赖到达后算出相同结果（不健康订阅不能改档，所以本期续费未付而升档已付只剩 session 创建后状态才变化的竞态，超期按等待期限转 needs_attention）；积分池已切到该订阅更晚的周期时，只记零效果补差（保留财务记录、实际入池 0），与迟到的正常发票相同。同一周期多次升档各自按自己的新旧差额与同一分母补差。余额与到期不变，不重置积分池，不发整期积分。不依赖 line 顺序，不按 lines[0]、金额正负或总额推断档位。新档积分不高于旧档（配置漂移导致的立即降档等）时不补不扣，转 needs_attention 可靠告警。
  - 其他/缺失 reason、无法识别或含糊的 line/price 转 needs_attention、可靠邮件，不发积分/邀请奖励。非订阅 invoice 与 conflict 沿用各自路径。
- `invoice.payment_failed`、`customer.subscription.pending_update_applied`/`pending_update_expired`、`invoice.voided`、`subscription_schedule.*` 与 `customer.subscription.updated`/`deleted` 只同步订阅状态快照（含当前 Price、是否有 pending_update/排期/期末取消），不发放或扣回积分；它们是明确支持的类型，不记 ignored。升档在付款发票与应用事件之间的先后不影响结果：积分只看已付款的 `subscription_update` 发票。
- 升档补差积分与正常发放各自按发票业务幂等（同一 scoped invoice 至多一次），不能只靠 Event ID；迟到事件不能把补差额覆盖成整期发放，也不能重复补。

## 用户关联与乱序恢复

- Checkout 的可信关联从已处理的 `checkout.session.completed` event 的 first delivery 原始 payload 中读取 `client_reference_id`，按 `first_received_at`、`event_id` 取最早一条；不新增关联列，event 完成与关联效果同事务提交。只有关联、尚无订阅快照时，新建行保存真实 Subscription ID 与 payload 的 Customer ID，`user_id = NULL`、`classification` 为空、`status = none`，其余字段沿用 schema 默认值（包括初始 `version = 1`）；`none` 仅表示尚未读取 Stripe 状态，不授予权益或占用 accepted 指针，后续 invoice/订阅事件再完成归属和分类。

- 服务端创建订阅 Checkout 时同时写 `client_reference_id = users.id` 与 `subscription_data.metadata.enx_user_id = users.id`。前者关联 Checkout Session，后者写入 Subscription；普通 Session metadata 不会自动复制。订阅事件读取对象 metadata，订阅发票按事件 API 版本读取订阅 metadata 快照或通过关联对象取得。退款等事件不保证直接携带用户 ID，仍需按已有业务标识查询。两处用户标识矛盾时转人工，不能覆盖归属。
- 对已有订阅、缺 metadata 或 invoice-before-checkout 的事件，用可信 Checkout 关联/已有记录恢复；暂时缺失进入 `waiting_dependency`，不因本地查不到订阅立即认定冲突或永久放弃正常付款。较晚 Checkout/订阅关联建立后恢复同一订阅的事件，并重新验证原子接受结果。metadata 只解决身份，不绕过竞争订阅判定。
- 无法恢复可信关联的 invoice（包括 Stripe 已结束订阅的正金额/零金额 paid invoice）持久进入 `needs_attention`，可靠邮件通知管理员，不自动发新积分或邀请奖励。已知历史 accepted 的合法付款沿用现有权益规则，不因当前指针变化被当成未知；晚到的旧状态/周期事件不得覆盖新订阅或将当前积分周期回退。未知 ended 的非付款事件也保留处理结果与原因，不静默丢弃。
- `invoice.paid` 仍是订阅积分发放来源，Checkout 不发订阅积分；非订阅发票不误按订阅授予。冲突发票只归档调查。退款沿用 ADR-049 的金额/扣回规则，准确关联原始发放/订阅；冲突未发放的退款不能取消或扣回 accepted 订阅。接收已确认后，Stripe 查询/取消失败由 ENX 的持久任务继续重试，不能等 Stripe 再投一次。

## 积分周期与退款来源

- 发放/付款效果保存真实 Subscription ID、invoice、周期起止、正常发放/升级补差额类型、购得积分、实际入池积分及 PaymentIntent/退款关联；余额保存当前来源订阅、周期和正常 invoice。业务幂等键约束同一 invoice/周期正常发放与同一 `subscription_update` invoice 的升档补差积分，不能仅靠 Event ID。
- 正常 invoice 仅能为当前 accepted 的新周期重置积分；同一订阅的同/更早周期和历史 A 的迟到付款保留财务记录（含购得积分、PaymentIntent、实际入池 0），不重置当前池。周期顺序在同一 Subscription ID 内比较，不能用接收/created_at 排序，也不能用不同订阅的 period_end 大小拒绝合法的正常替换：新 B 可以有不同周期长度，其首个有效周期只初始化一次。
- 退款判断是否当前池来自原发放确实入池且订阅/周期与池来源一致，而非「最后插入一条 GRANT_SUBSCRIPTION」。A 结束但未被 B 周期替换时仍保留池来源供退款；B 已替换后，A 的历史/未入池发放只记零效果扣回，不扣 B。正常发放与同周期升级补差额各自按原付款适用 ADR-049 比例累计扣回、订阅池不低于零，充值池可负；退款取消仅针对原发放的订阅。缺失/含糊旧关联进入恢复/人工，不能从当前指针猜或改写原发放金额。

## 一次性充值与 Stripe Customer

- 当前代码在 `subscriptions` 中还保存仅充值用户的 Customer 映射（Subscription ID 为空），实际充值流水与余额在 `credit_transactions` 和 `credit_accounts`。改主键前把所有 Customer 归属迁入独立 `stripe_customers` 关系，一份 Customer 一行，以本地用户身份关联；一人可以有多个 Stripe Customer，不把 Customer 唯一到一人只能一条。
- 无 live accepted 时可使用用户正常的 Customer 关联；有 live accepted 时 Portal 与后续 Checkout 优先使用该订阅的 Customer。充值完成只补充 Customer 归属，不覆盖 live accepted 的 Customer。并发操作和迁移都保留此规则。
- 只有真实 Subscription ID 的旧行迁入新 `subscriptions`，不为仅充值用户虚构订阅。迁移保留全部充值余额、原积分流水、Event ID/PaymentIntent ID 及退款关联。原子、可重复的数据库迁移取代仅靠 AutoMigrate 改主键；迁移边界和演练在 #297，不在运行中直接删旧表试错。
- 所有者在 #426 round 2 答复中选择 A：cutover 前已发放的一次性充值不由新路径按 Checkout Session 去重。旧 `GRANT_TOPUP` 只有 Event ID/PaymentIntent ID，没有持久 webhook event/Checkout Session 关联；保留原流水和 Event ID 唯一性，接受以不同 Event ID 人工重放旧充值时可能再次发放。迁移不新增 Checkout Session 列或索引，不从 Stripe 恢复旧关联，也不为旧重放新增人工处理路径。所有者确认生产没有真实用户或订阅，只有测试用户的一次已发放充值，cutover 前也不预期有真实用户；旧 webhook 已返回 2xx，风险限于人工重发给测试账户重复发放。
- 上述例外仅适用于 cutover 前的旧充值。cutover 后同一 Checkout Session 无论 Event ID 如何都至多发放一次：在所配置 endpoint account/mode 内，以 `stripe_webhook_events.checkout_session_id` 查 event，并以 event ID 关联 `credit_transactions.stripe_event_id` 的 `GRANT_TOPUP`。effects/task 同一事务中再次检查该业务键，发放时即使 Customer 归属未变也须从 `Effects.Observed.Revision` 条件递增付款用户的 `billing_version`；版本过期不提交效果或任务完成并重试。事务内重查还覆盖重复查询后、读取 Owner 前另一发放已提交的竞态，不能只靠版本栅栏；保留 Event ID 唯一性。
- 旧 `GRANT_SUBSCRIPTION` 流水没有 Subscription ID、invoice 与周期起点，升档补差分母找不到同期正常发放。数据库迁移本身不调用 Stripe；迁移后、worker 处理订阅发票前，一次性、可重复的回填任务为每份迁入的真实订阅中「当前积分池来自旧流水」的那条发放，经其 PaymentIntent（零金额时经该订阅 period end 等于 `credit_accounts.period_end` 的 paid invoice）从 Stripe 读取 invoice，取 recurring line 的周期，仅当周期 end 等于 `credit_accounts.period_end` 时补记来源（Subscription ID、invoice、周期起止），不改金额、余额或流水。回填失败可重试；Stripe 无法唯一确定时不猜，标为无来源旧发放，该期升档发票直接 needs_attention（reason `legacy_grant_without_period`）并可靠告警。更早的旧流水不回填，只作历史/退款审计。生产尚未开放内测，影响限于 sandbox/homelab 数据。

## 管理员处理与邮件

- 系统自动记录、通知；取消竞争订阅、调查原始 Stripe 数据和退款由管理员手动执行。冲突与持续无法关联的事件有可查询的持久人工事项；普通重复投递不重复产生事项/告警。event 告警与 subscription conflict 告警都走同一启动/每小时恢复驱动，管理员重试不重发已确认告警。
- 使用现有邮件服务的可靠 adapter，pending 状态与异常分类同事务保存；API key、sender、管理员收件人缺失或提供方失败都记错误并重试。worker 启动和每小时处理待发邮件，有发送超时、到期领取、尝试次数/最后错误；仅提供方确认成功标记 sent。发送后确认前崩溃允许少量重复，日常 webhook 重放不刷邮件；解决异常不丢待发告警。
- 现有 `/api/page-reports` 要求页面 URL，不是任意账务反馈。阻断的 `/billing` 提供 billing-support 表单；新增认证的 `POST /api/billing/support` 只接受当前用户所属 conflict、非空至多 2000 字符消息。首条消息/时间与独立的 support 告警 pending 状态同事务保存于该订阅，邮件复用 Resend 的可靠恢复；每个用户/conflict 只通知一次，重复点击返回既有结果，不重新发邮件。自动发现告警不依赖用户反馈。此支持入口是所有者要求的产品工作，不扩大成通用反馈平台。
- 改档入口因 `subscription_conflict` 返回 409 时，同时返回当前用户所属、导致阻断的 conflict 的 `subscriptionId`，供 /billing 将其传给上述支持表单；不能用 accepted 订阅 ID 代替。存在多份阻断冲突时，返回其中一份，按 Subscription ID 字典序选最小值，且不依赖存储返回顺序：候选只含 open 冲突（即使已结束）及 resolved 但 Stripe 实时仍可计费的冲突。resolved 且实时状态未知的不作候选；没有已知阻断者而存在未知状态时，仍返回可重试错误。删除屏障优先，其 409 不携带 `subscriptionId`；支持提交仍须独立核实归属与 conflict 分类。#424 的未挂载组件允许该字段缺失以兼容当前响应，#297 cutover 必须补齐此上下文后再挂载支持表单。此为既有支持入口的数据交接，不改变阻断或支持请求规则。
- 沿用 #297 的管理员查询/解决 API 意图，查询订阅冲突与关联 event/delivery，无需建同名表或新增用户端财务操作 UI。解决操作认证、幂等、有非空备注与操作者/时间；`resolved` 仅表示管理员记录调查结果，不自动证明已取消或退款。worker 失败和超期等待可被管理员发现；原始 payload 仅限必要的管理员访问，不写入普通日志。

## 注销与财务留存

- 所有者已确认：存在 `open` 的订阅冲突就拒绝用户和管理员删除，提示 `Contact an administrator to resolve your subscription issue before deleting your account.`；不能只检查 accepted 指针。即使冲突标 resolved，仍会续费的所属订阅也必须先取消，查询 Stripe 失败不能放行。普通 accepted 的自助取消入口沿用 Billing Portal；Portal 自建的降档排期不妨碍取消（实测 Portal 会 release 排期再设期末取消），不需要先撤销降档。此路径不自动取消订阅、不要求管理员介入；普通取消经 Stripe 确认后沿用期末取消/注销资格。异常订阅仍由管理员处理。
- 注销检查不能以本地 active/trialing/past_due 三状态筛掉 unpaid/incomplete 或未知/滞后状态：每份未由 Stripe 权威确认 canceled/incomplete_expired 的所属订阅都查实时续费，终态证据也受版本重验；不明确的 resource_missing 和其他查询错误阻止注销，不能猜测已结束。期末取消资格同时认 `cancel_at_period_end=true` 与 flexible billing mode 下不晚于本期末的 `cancel_at`（Portal 取消只设后者，见 #337）。
- 删除资格与并发接受/分类共用持久协调机制：建立删除屏障后停止接受新订阅和发放新权益；用户硬删除后仍保留屏障的不透明本地身份和 deleted 终态（不含姓名/邮箱），使迟到 metadata 不被当作临时缺映射或重建账户的理由；发现并发新增未解决冲突或仍续费订阅则中止删除。后续 webhook 仍保存财务历史，不能用 metadata 或历史映射重建已删用户/余额。管理员标 resolved 不能绕过实时续费检查。
- 注销前已打开的 Checkout 在注销后收款（充值或订阅），保存付款/Customer/订阅上下文，event 进入 `needs_attention`、reason `payment_after_account_deletion` 并可靠告警；不发积分/邀请奖励、不建余额/用户/接受指针、不自动退款取消，也不绑定同邮箱新账号。删除屏障期间付款等待持久删除结果；仅删除中止且重新验证资格才正常处理。删除后旧退款只做可恢复财务审计，不重建余额。
- 所有者明确将 webhook delivery/event 历史纳入财务留存：账号注销后仍保留完整 payload、重复接收记录、事件状态、订阅归属/冲突/Customer 记录及原积分账本。原 payload 可能包含邮箱等个人信息，这明确修订 ADR-062 的「保留数据无法再关联个人信息」假设；保持用户行和普通个人业务数据硬删除，隐私告知同步说明财务 webhook 原文例外。本次不规定自动过期、脱敏或删除这些历史。

## 部署边界

ADR-064 会在 main 合并后自动部署。#297 的 characterization/fixture 可先独立 PR。所有者 2026-10-27 决定（#297）：cutover 不再是单一部署 PR，而是按切片逐个合并，全部藏在 `BILLING_CUTOVER` 开关（默认关闭）之后；开关关闭时运行时行为与旧路径完全一致，不执行任何 ADR-067 迁移。原子边界由「同一 PR」改为「同一次启用」：改变 subscriptions 主键的迁移只在开关打开时随启动执行，而启用前必须合并所有读写方、accepted entitlement 查询、接收/worker、原子分类、积分/退款来源、删除屏障、必要管理员告警/查询以及改档和 billing-support 的后端 endpoint，不能先迁移再等后续切片修调用者。所有者在 #482 确认 HomeLab 已启用并完成基本 sandbox 支付冒烟；/billing 挂载已有改档按钮和 billing-support 表单（#482）在 HomeLab 启用后进行，这不表示已完成全面付款/退款验证。生产启用仍由所有者决定，须先合并改档入口、billing-support 表单及隐私告知等全部切片；最后一个切片删除开关与旧路径。迁移后的数据库不能再以关闭开关的旧路径启动：启动校验 schema，迁移过的库在开关关闭时拒绝启动（在任何写入或后台任务之前），旧 AutoMigrate 不能作用于迁移改形过的表；不能只回滚旧 binary。生产启用时旧进程停止/排空后切换，备份恢复方案与演练由发布流程承接。所有者 2026-10-23 决定：生产尚未开放内测，Portal 改档、改档入口、发票分类与升档补差积分、billing-support 表单与上述 cutover 同一次启用，不再拆后续改档切片，也不在上线前临时关闭 Portal 改档。sandbox 默认 Portal 配置已按上节开启改档；live 配置随生产上线按 P-3 交接。全部完成前不关闭 #297。具体切片与测试在 issue，主机配置/发布动作按 P-3 交 Linear；不改变 ADR-066 内测付款策略。

## 取舍

- 拒绝同步业务完成后才确认 webhook：乱序和外部服务失败会依赖 Stripe 重投；改为 ENX 持久接管，代价是必须维护 worker、恢复和积压监测。
- 分开每次 delivery 与唯一 event，保留审计事实与幂等处理；单张去重历史表会丢接收记录，单张不去重任务表会重复财务效果。
- 保存全部订阅、单独指向当前 accepted；不再用用户主键覆盖 Stripe 事实，也不另建重复的 conflict 订阅模型。代价是现有主键/Customer 混用必须迁移。
- 采用数据库任务与轮询，不引入独立消息队列，不建设通用通知平台。财务副作用仍用独立幂等约束，而不是依靠处理标记宣称 exactly-once。
- 改档用 Stripe Portal 原生能力，不自建：放弃 ENX 持久改档操作、重叠请求 409 规则与主动取消待付款升级（#338 备查），换来付款失败、3DS、排期与撤销都由 Stripe 处理、ENX 代码路径大幅减少。代价是改档交互受 Portal 能力约束，积分只能事后从发票推导，且需校验 Portal 配置防止被改成不安全设置。
- 被阻断用户用第二份关闭改档的 Portal 配置，而不是只在 ENX 隐藏改档按钮：ADR 要求服务端阻断，Portal 首页本身就能改档。代价是多维护、多校验一份 Stripe 配置。

## 修订记录

- 2026-10-22：#297 round 1/2 确认原子接受、冲突人工处理、邮件恢复；旧稿按用户保存订阅并另建 conflict 表，paid invoice 与注销存在待决项。
- 2026-10-23：所有者确认完整 delivery 历史、去重 event 与异步恢复、按 Subscription ID 保存全部订阅、用户当前接受指针、Subscription metadata、本地 Customer 关联拆分、异常未解决禁止注销、原始财务 webhook 注销后留存。替换旧同步确认/依赖 Stripe 乱序重投及独立 conflict 表方案，关闭上述待决项。实现任务与验证见 #297。
- 2026-10-23（#297 round 3）：补齐 API 版本与 endpoint 身份边界、event 人工告警状态、积分周期/退款来源、注销后付款终态及默认 worker 时序；按所有者答复记录正常重购、同 ID 支付确认后升档补差额、下期降档及冲突支持入口，并约束自动部署下的原子迁移边界。

- 2026-10-23（#297 round 4）：封闭 Portal 绕过服务端改档规则的入口，明确未授权 price 与 invoice 分类/line 来源；落实所有者重叠请求、撤销降档与期末取消规则，防止未付款改档及重复整期发放。cutover 已须实施 Portal 边界和未知改档隔离，不能等待后续改档 PR。

- 2026-10-23（#297 round 5）：补齐改档终态、所需事件及无 webhook 的定期核实，避免失效操作永久阻断；按既有撤销降档决定说明 schedule release 后再 Portal 取消/注销的路径。当时未决的未付款升级立即取消动作由下条所有者答复确定。

- 2026-10-23（#297 round 5 所有者答复）：所有者选择 B，授权认证自助取消未付款升级；补齐持久取消意图、原 invoice void、付款竞态与崩溃恢复及确认后解锁，替换未决 A/B 选择，保持原订阅和积分规则。

- 2026-10-23（所有者，Stripe 原生改档）：sandbox 实测确认 Portal 升档付款确认后才生效、跨 Product 降档可期末生效、Portal 可撤销降档并可取消带排期的订阅。所有者据此决定：改档全部经 Stripe Portal，ENX 不保存改档操作，只按 `invoice.paid` 的 billing_reason 发正常积分或升档补差积分；补差比例取 proration line 周期；降档下期生效；第一版不做主动取消待付款升级（#338）；Portal 改档不临时关闭，与 cutover 同一 PR 上线。取代 round 3–5 的 ENX 自建改档操作、重叠 409、未授权改档隔离、取消待付款升级及撤销降档后再取消的注销指引；吸收 #336 的独立 Product 建模与可选 configuration 覆盖，改为要求改档开启的安全配置。

- 2026-10-24（#297 round 7，含所有者答复）：升档补差的分母改取已保存的同期正常发放，补齐依赖等待、续费后零效果与同期多次升档；Portal 配置要求只允许改 Price、数量固定为 1；Schedule 换期发票按整期 line 识别为正常发放，并要求实现前用 test clock 实测深链接与降档续费发票；所有者选择 (b)，被阻断用户的 Portal session 用关闭改档的受限配置。

- 2026-10-24（#297 round 8）：定义「健康」为 Stripe `active`；其他可计费状态按所有者 round 3「健康订阅可自助改档」与 round 7 (b) 归入受限 Portal 配置，只能补付/换卡/取消，避免续费未付时升档补差无分母。迁移后一次性从 Stripe 回填当前周期旧发放的来源，无法确定时该期升档转人工。

- 2026-10-26（#424 spec round 1）：补齐改档冲突响应到既有 billing-support 表单的所属冲突 ID 交接，避免误用 accepted ID 或无法提交支持请求；保留服务端归属校验与 #297 同次上线边界。

- 2026-10-26（#426 spec round 2）：明确阻断冲突 ID 只在实际阻断候选中按字典序选择，保留未知实时状态的重试语义与删除屏障优先级，补齐 eligibility 到 Portal 响应的数据交接，避免依赖存储顺序或误传非阻断订阅。

- 2026-10-26（#426 spec round 2 所有者答复）：选择 A，明确旧测试充值不按 Checkout Session 去重并接受人工重放风险，保持迁移不变、不新增 Stripe 恢复或人工处理路径；记录 cutover 后的会话查询、版本栅栏与事务内重查，区分旧数据例外和新充值的幂等保证。

- 2026-10-27（#484 spec round 1，记录所有者 2026-10-27 #297 决定）：部署边界由「同一兼容部署 PR」改为「切片逐个合并、`BILLING_CUTOVER` 开关默认关闭、全部切片合并后同一次启用」；保留原子启用、启动 schema 校验、生产停旧进程与备份要求，补充迁移后的库禁止以关闭开关启动、旧 AutoMigrate 不作用于改形表，避免分片合并后提前迁移或回退到不兼容 schema。

- 2026-10-29（#482 spec round 1）：记录所有者授权的 HomeLab 先启用、随后挂载 /billing 组件的顺序，区分后端 endpoint 就绪与 UI 挂载；保留生产启用前全部切片合并及所有者控制的边界，消除与已启用 HomeLab 的冲突。

## 参考

- [Stripe webhook 顺序、重复与异步处理](https://docs.stripe.com/webhooks#event-ordering)
- [Stripe metadata 传递规则](https://docs.stripe.com/metadata#set-metadata-indirectly)
- [Stripe 支付确认后应用改档](https://docs.stripe.com/billing/subscriptions/pending-updates)
- [Stripe Portal 的 subscription schedule 限制](https://docs.stripe.com/customer-management#limitations)

- [Stripe Customer Portal 配置项](https://docs.stripe.com/customer-management/configure-portal)
- [Stripe Portal deep links（subscription_update_confirm）](https://docs.stripe.com/customer-management/portal-deep-links)
- [Stripe 默认 Portal 配置查询](https://docs.stripe.com/api/customer_portal/configurations/list)
- [Stripe Product 与 Price 的官方建模](https://docs.stripe.com/products-prices/how-products-and-prices-work#model-your-product-catalog)
