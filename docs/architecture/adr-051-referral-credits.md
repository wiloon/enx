---
status: proposed
date: 2026-10-08
related: adr-048（试用积分池；本 ADR 在它上面叠加邀请奖励，依赖它先实现）、adr-009（top-up 池）、adr-049（管理员页；本 ADR 不依赖它的 `Clawback`）、adr-040（Prometheus 指标）
---

# ADR-051：邀请链接——被邀请人多拿 200 试用积分（14 天），邀请人在对方首笔付款过了冷静期后得永久积分

adr-048 给每个新账号 100 试用积分、7 天过期。我们想借用户拉新：通过邀请链接注册的人多拿一些试用；邀请人在对方真正付费后拿到奖励。赠送有真实的 AI 成本，规则必须封住「自己邀请自己」的套利。

## Considered Options

- **邀请人在被邀请人注册时就得奖励**：小号注册零成本（adr-048 第一层只是提高了造号成本，并没有消除），等于给刷号的人发永久积分。否决；奖励改在被邀请人**付费**时发。
- **每次续费都给邀请人发奖励（分成制）**：要持续记账，和退款、降级、取消交织在一起，复杂度不划算。否决；只看被邀请人的**第一笔付款**，发一次。
- **付款时立即发奖励，退款时再扣回**：要把奖励接到 adr-049 的 `Clawback` 上，扣回后邀请人的 top-up 还可能变成负数。否决；改成**等冷静期过了再发**，发之前确认这笔付款没被退款，就不需要扣回逻辑。
- **充值和订阅都发固定 300**：最小充值档 $2.99 = 300 积分，用小号邀请自己再充一次就是 600 积分，相当于打五折。否决；充值按充值积分的比例发。
- **邀请奖励单独开一个积分池**：账本已经有三个池（adr-048），再加一个池会让 `Settle` 的原子 UPDATE 更难写对。否决；被邀请人的奖励进**试用池**，邀请人的奖励进 **top-up 池**。
- **注册时就把邀请码带进 Clerk（`unsafeMetadata`）**：OAuth 跳转途中参数会丢；扩展里登录也走不到网页的注册表单。否决；改成注册之后由前端**认领**邀请码。

## Decision

1. **邀请码**：每个注册用户都可以生成邀请链接，不要求付费。
   - 新表 `referral_codes(user_id 主键, code 唯一, created_at)`。`code` 是 8 位随机 base32（去掉易混字符）。第一次请求 `GET /referral/me` 时惰性生成，一人一个、不会变。
   - 链接形如 `https://catglish.com/invite/<code>`，是 enx-ui 的落地页。
2. **把邀请码带到注册之后**：
   - 落地页把 `code` 存进 localStorage（键 `enx.referral`，带写入时间，7 天后视为失效），然后引导用户登录并安装扩展。
   - enx-ui 发现「已登录 + localStorage 里有 code」时，调用 `POST /referral/claim {code}`；无论成功还是失败都清掉 localStorage（失败原因只写日志，不打扰用户）。
   - 在扩展里先注册的用户，在认领窗口内再打开一次邀请链接就能认领。
3. **认领条件**（`POST /referral/claim`，全部满足才算数，否则返回 409 并给出原因码）：
   - 被邀请人的账号创建时间在 `claim-window-hours`（默认 24 小时）以内；
   - 被邀请人从未认领过（新表 `referrals` 以 `invitee_user_id` 为主键）；
   - `code` 存在，并且不是自己的；
   - 被邀请人还没有付过费（这样「首次付费」才有确定的含义）。
4. **被邀请人的奖励：进试用池**。认领成功后，在同一个事务里：
   - `trial_balance += invitee-bonus`（默认 200），`trial_expires_at = 账号创建时间 + invitee-ttl-days`（默认 14 天）。合计 100 + 200 = 300 积分，从注册起 14 天有效。
   - 流水类型新增 `GRANT_REFERRAL_BONUS`，幂等键 `referral-bonus:<inviteeID>` 写进 `credit_transactions.stripe_event_id`（与 adr-048 的 `trial:<userID>` 用法相同）。
   - 如果此时 adr-048 的试用还没发（例如发放钩子失败过），先补发试用，再叠加邀请奖励。
   - 奖励来自试用池，所以 adr-048 的 `TrialOnly` 次数限制（每分钟 5 次、每天 30 次）同样适用；300 积分 / 14 天在每天 30 次的上限下用得完。
5. **邀请人的奖励：只看被邀请人的第一笔付款，冷静期过后进 top-up 池，永不过期**。
   - **记录**：被邀请人第一笔成功付款时，在 `referrals` 行上记下 `first_payment_kind`（`subscription` / `topup`）、`first_payment_intent_id`、`first_payment_credits`（这笔付款发给被邀请人的积分）、`reward_due_at = 付款时间 + reward-delay-days`（默认 14 天，对应欧盟 14 天撤回期）。订阅走 `invoice.paid`（`amount_paid > 0`），充值走 `checkout.session.completed`（`type=topup`）。两个 handler 在原有发放之后调用 `referral.RecordFirstPayment(...)`；行上已有记录就是空操作，所以续费和后续付款都不会再触发。
   - **奖励数额**在记录时算好并写进行里（`reward_amount`），之后改配置不影响已经在排队的奖励：
     - 第一笔是**订阅**：`referrer-reward-subscription`（默认 300）。
     - 第一笔是**充值**：`floor(first_payment_credits × referrer-reward-topup-percent / 100)`，默认 20%，例如小档 300 积分 → 60。
   - **发放**：enx-api 进程内的每小时任务（与现有 `runReaderCleanup` 等同样的 ticker 写法：启动时跑一次，之后每小时一次）找出 `reward_due_at <= now` 且还没处理的行，逐行：
     1. 向 Stripe 查这笔 PaymentIntent 的 charge。只要有退款（`amount_refunded > 0`）或争议（dispute），就把这行标记为 `forfeited`，不发奖励，原因写进行里。
     2. 否则 `credit.GrantTopup(ctx, referrerID, reward_amount, "referral-reward:<inviteeID>")`，流水类型用新的 `GRANT_REFERRAL_REWARD`，在流水上和用户自己买的 top-up 区分开；行标记为 `rewarded`，记下 `rewarded_at`。
     - 幂等键保证任务重跑、多实例同时跑都不会重复发；Stripe 查询失败就跳过这行，下个小时重试。
   - 记录失败只写日志，不能让 webhook 失败。webhook 失败会让 Stripe 重试，而付款方自己的积分已经发过了。
6. **不做扣回**：奖励发出之前已经确认冷静期内没有退款。冷静期之后的退款只能由管理员在 Stripe 后台发起（adr-049），管理员可以在 adr-049 的管理员页手动调整邀请人的积分；v1 不自动扣回邀请奖励。
7. **配置**（`config.toml`，可用环境变量覆盖；0 = 关闭对应的发放）：

   ```toml
   [credits.referral]
   invitee-bonus = 200        # 在 adr-048 的试用之外额外发；0 = 关闭
   invitee-ttl-days = 14      # 从账号创建起算，覆盖 adr-048 的 ttl-days
   referrer-reward-subscription = 300  # 被邀请人第一笔付款是订阅时，发给邀请人；0 = 关闭
   referrer-reward-topup-percent = 20  # 第一笔付款是充值时，按充值积分的百分比发；0 = 关闭
   reward-delay-days = 14     # 付款后多少天发奖励（冷静期）
   claim-window-hours = 24
   ```

   环境变量：`CREDITS_REFERRAL_INVITEE_BONUS`、`_INVITEE_TTL_DAYS`、`_REFERRER_REWARD_SUBSCRIPTION`、`_REFERRER_REWARD_TOPUP_PERCENT`、`_REWARD_DELAY_DAYS`、`_CLAIM_WINDOW_HOURS`。

   **以后改成管理员可在界面上设置**：adr-049 的管理员页上线后，加一个「系统设置」表（键值对，覆盖 config/env），adr-048 与本 ADR 的数值都搬过去。v1 只用 config/env，读取统一经过一个 `CreditPolicy` 接口，届时只换实现，调用方不用改。
8. **展示**（英文 UI）：
   - enx-ui 新增 `/invite` 页：显示邀请链接（一键复制）、已邀请人数、已付费人数、待发奖励（含预计发放日期）、累计获得积分。数据来自 `GET /referral/me`。
   - 邀请落地页文案：`Join via this link and get 300 free AI credits (valid for 14 days).`
   - 认领成功后的提示：`+200 bonus credits from your invite · expires Oct 22`。
9. **可观测**：计数器 `enx_referral_claims_total{result}`（ok / 各拒绝原因）、`enx_referral_rewards_total{result}`（rewarded / forfeited）。

## 分层（给实现者）

- 新的领域包 `referral/`：`Service` 负责认领规则、记录第一笔付款、到期发奖，通过构造函数接收接口（`CodeRepo`、`ReferralRepo`、`CreditGranter`、`PaymentChecker`（查 Stripe 退款 / 争议）、`Clock`、`CreditPolicy`），单测跑在 fake 上，不需要数据库，也不需要 Stripe。
- SQL 放在 `repo/`。handler 只做 HTTP。`billing/webhook.go` 只调用 `referral.RecordFirstPayment`，不知道规则细节。每小时任务在 `main` 里接线。
- 只依赖 adr-048 的试用池。实现顺序：048 → 本 ADR；与 adr-049 互不依赖。

## 测试要点

- 认领：窗口内成功；超出窗口、重复认领、用自己的码、码不存在、已付过费，都返回 409，并且不发积分。
- 认领后 `trial_balance` 增加 200，`trial_expires_at` = 创建时间 + 14 天；幂等（重放不重复发）；`invitee-bonus = 0` 时不发。
- 记录第一笔付款：订阅和充值两条路径都会记录；第二次付款、续费都是空操作；Stripe 重放同一事件不重复记录；订阅的 `reward_amount` 为 300，充值为积分 × 20% 向下取整；没有邀请关系的用户付费没有任何副作用。
- 到期发奖：未到 `reward_due_at` 不发；到期且无退款、无争议 → 邀请人 top-up 增加，流水类型是 `GRANT_REFERRAL_REWARD`；有部分或全额退款、或有争议 → `forfeited`，不发；Stripe 查询失败 → 这行保持待处理，下次重试；任务重跑不重复发。
- 配置改动不影响已经记录的 `reward_amount`；`referrer-reward-* = 0` 时不记录奖励。
- 记录失败时，webhook 仍返回成功，付款方自己的积分不受影响。

## 待决定

- **奖励数值未校准**：与 adr-048 一样，等 `[stripe.costs.*]` 有真实成本数据后再调。

## Consequences

- 被邀请人在 onboarding 时就能多用两周 AI；邀请人的奖励只有真金白银进账、并且过了冷静期没退款才发，不会被注册小号或「付款再退款」刷到。
- 邀请人要等 14 天才能拿到奖励，`/invite` 页要把「待发放」和预计日期展示清楚，免得用户以为没生效。
- 仍然存在的自邀折扣：用小号邀请自己后订阅最低档 Pro（$3.99 / 500 积分），第一个月多得 300 积分；充值则多得 20%。都只有一次、要真付款，作为拉新成本接受。
- 账本只新增流水类型，不新增池；三个池的扣费顺序不变（试用 → 订阅 → top-up）。新增一个每小时任务和一次 Stripe 查询（只在奖励到期时）。
- 认领依赖前端主动调用：用户在窗口期内清掉了浏览器数据、或者 24 小时后才打开邀请链接，就拿不到邀请奖励。这是为了不让老用户事后补认领而接受的代价。
- 邀请人的奖励永不过期，会形成长期的赠送负债；规模可以从 `enx_referral_rewards_total` 看到，必要时把 `referrer-reward-*` 设为 0 止损（已在排队的奖励仍按记录时的数额发放）。
