---
status: accepted
date: 2026-10-19
related: adr-015（Clerk 认证）、adr-048（试用积分，幂等键 `trial:<userID>`）、adr-049（管理员用户页）、adr-051（被邀请人奖励进试用池）、issue #217（本 ADR）
---

# ADR-062：注销账号是硬删除，按邮箱 HMAC 记一条试用发放记录；管理员可撤销会话、禁用、删除

现在用户没有办法注销 ENX 账号。GDPR 的删除权、计划中 iOS 版的 App Store 审核（WIL-128）都要求提供这个入口。可一旦用户能注销，adr-048 的试用积分就能被反复领取：试用积分按 `trial:<userID>` 只发一次，但同一个 Google 账号注销后再登录，Clerk 会给一个新的 user id，`GetOrCreateByClerkUserID` 就建一个新的本地用户，再发 100 积分。adr-051 的被邀请人奖励同理。今天管理员在 Clerk 后台删掉一个用户，也会出现同样的情况。

另外，管理员现在也管不住用户：遇到滥用的账号没法禁用，怀疑某个用户的会话被盗也没法让它下线。管理员在生产环境测试新用户流程（试用积分、新手引导）时，还需要把一个测试账号彻底删掉，让它重新注册时被当作全新的用户。

## Decision

1. **注销账号（account deletion）是硬删除，不是软删除。** 删掉这个本地用户身份下的所有数据（生词本、查词事件、阅读统计、收藏、偏好、阅读器文档、邀请码等），删掉 `users` 行，再通过 Clerk Backend API 删掉对应的 Clerk 用户（同时撤销该用户的全部会话）。下面两类数据保留：
   - **账本与财务接收历史**：`credit_transactions`、`subscriptions`、独立 Stripe Customer 关联、adr-051 的 `referrals`，以及 ADR-067 的 `stripe_webhook_deliveries` / `stripe_webhook_events` 保留。**2026-10-23 所有者修订**：原始 webhook payload 和每次重复接收记录注销后也保留，可能含邮箱、姓名等 Stripe 提供的数据；因此原先「留存数据只有不透明 UUID、无法再关联个人信息」的保证不再适用于这些财务原文。它们不加入 personalTables，不随 users 行级联删除；访问仅限必要的管理员用途，普通个人业务数据仍硬删除。
   - **试用发放记录**：见第 3 条。
   Stripe 那边的 customer 和付款记录也不删。
   邀请人已注销时，尚未发放的邀请人奖励按 adr-051 第 5 条作废（`referrer_deleted`）；发奖与本地删除并发时也不得重建已删除的余额行。

2. **两个入口共用同一条删除流程**（`account` 领域服务里的 `Delete`，Clerk、Stripe 和仓储都通过接口注入）：
   - **用户自助注销**：enx-ui 的 `/settings` 页面，要求用户输入自己的邮箱来确认。剩余的试用、订阅、充值积分全部作废，注销流程本身不退款；要退款的用户必须在注销**之前**走 adr-049 的退款流程，两条流程相互独立。确认文案写明这两点。接口为 `DELETE /api/me`。
   - **管理员删除**：在 `/admin/users/:id` 页面操作，接口为 `DELETE /api/admin/users/:id`，可以带 `resetTrial=true`（见第 4 条）。
   - **有续费中的订阅或未解决冲突时拒绝删除**：2026-10-23 所有者确认按 ADR-067 查询用户所属的全部订阅，不只查当前 accepted 指针；存在 open 订阅冲突就拒绝删除，并显示 `Contact an administrator to resolve your subscription issue before deleting your account.`。即使标 resolved，任何仍会续费的所属订阅也须先取消；普通 accepted 可从 `/billing` 的 Portal 操作；若有降档 schedule，Portal 不支持取消，`/billing` 与用户/管理员注销拒绝须指导先选当前有效档位撤销降档、真正 release schedule，再到 Portal 取消（英文文案及恢复约束见 ADR-067）。不在注销流程自动取消排期/订阅；release 后仍须确认不再续费才允许注销，期末取消资格照旧。异常订阅由管理员在 Stripe 处理。未由 Stripe 权威确认 canceled/incomplete_expired 的全部所属订阅均须实时查询，包括本地 unpaid/incomplete/未知或滞后状态；终态证据受版本重验，不明确时重查。确认不再续费才放行，任何查询错误（含不明确的 resource_missing）不能放行，不能只凭缓存/人工备注判定取消。正常订阅已设置 `cancel_at_period_end` 时沿用原有允许注销规则。管理员删除同样受限；不在注销中自动取消或退款。并发接受/分类与注销须受同一持久删除屏障协调。注销前打开的充值/订阅 Checkout 注销后才付款时，保存财务上下文并进入 needs_attention、可靠告警，不重建用户/余额/奖励/接受指针，不自动退款取消或关联同邮箱新账号；删除进行中的付款等待持久结果，中止后才重新验证处理。具体见 ADR-067 和 #297。
   - **执行顺序**：先写试用发放记录（幂等），再删 Clerk 用户，最后在一个事务里删本地数据。Clerk 调用失败时整体中止、返回错误，本地数据不动。本地事务失败时 Clerk 用户已经删了，但用户也登不上来了，残留的本地数据由管理员重试删除来清理（删除流程对「Clerk 用户已不存在」视为成功）。

3. **试用发放记录（trial grant record）按邮箱的 HMAC 记录，不随账号删除。** 新建表 `trial_grants(email_hmac PRIMARY KEY, user_id, granted_at)`，`user_id` 是领取试用的那个本地用户身份（不透明 UUID，账号删除后也保留）：
   - `email_hmac = HMAC-SHA256(key, lower(trim(email)))`。密钥来自新配置项 `account.email-hmac-key`（环境变量 `ACCOUNT_EMAIL_HMAC_KEY`），**一经上线就不能轮换**，轮换会让所有已有记录失效。不直接用 SHA-256，是因为邮箱的取值范围小，拿常见邮箱字典就能撞出明文。
   - 邮箱取自 session token 里的 `email` claim，也就是 `GetOrCreateByClerkUserID` 已经拿到的那个邮箱。不额外调用 Clerk API。
   - `GrantTrial` 发放试用之前先查这张表：查到就不发；没查到就在发放的同一个事务里写入一条记录。原来的 `trial:<userID>` 幂等键保留不变。
   - adr-051 的认领也查这张表：**有这个邮箱的记录、且记录里的 `user_id` 不是当前账号**，说明这个邮箱以前的账号领过试用（新账号自己在创建时写下的记录不算）。这样的账号认领邀请码时，邀请关系照常建立，但**邀请人和被邀请人的奖励都不发**。被邀请人奖励在认领时直接跳过；`referrals` 新增一列 `rewards_blocked`，认领时写为真，之后记录首笔付款时把状态记为现有的 `no_reward`，邀请人奖励也不发。否则注销再注册就成了用小号给自己刷邀请人奖励的办法。`no_reward` 原本只表示「付款当时该类奖励被配置为 0」，现在多一个来源，代码注释要一起改。
   - **邮箱为空时不发试用**（fail closed），并打一条警告日志。我们只开放 Google 和 GitHub 登录（adr-048），正常情况下一定有邮箱。
   - 迁移时用现有 `users.email` 回填这张表，已有用户注销后再注册同样拿不到试用。
   - **第一版只记邮箱**。同一个人先用 Google 登录、再用相同邮箱的 GitHub 登录时，Clerk 会按已验证邮箱把 GitHub 关联到同一个 Clerk 用户上（见 Verification），本来就是同一个账号；即使注销之后再换 provider 登录，邮箱 HMAC 也能命中。在 GitHub 上改了邮箱再来注册的情况拦不住，到时再加上 OAuth provider 的账号 ID（Google `sub`、GitHub 数字 id）。

4. **管理员删除可以带 `resetTrial=true`**：同时删掉这个邮箱的试用发放记录，重新注册时又是一个能领试用、会走新手引导的全新用户。这个选项只给管理员测试用，界面上默认不勾选，勾选框旁写明「仅用于测试账号」。处理滥用的账号应该禁用，不是删除。

5. **禁用账号（disabled account）**：
   - 复用 `users.status` 列（现在一律是 `active`），新增取值 `disabled`。
   - Clerk 中间件拿到本地用户后检查状态：`disabled` 时返回 403，错误码 `account_disabled`，`message` 为 `This account has been disabled.`。enx-ui 和 enx-chrome 都显示这条消息，并且不自动重试。
   - 同时调用 Clerk 的 ban 接口：撤销该用户的全部会话，并且之后不能再登录。enx-api 自己的检查用来挡住还没过期的 token，以及 Clerk 调用失败的情况。
   - 可以解除（enable = 本地改回 `active` + Clerk unban）。
   - 被禁用的账号本人无法自助注销（登录不了）。管理员仍然可以删除它；不带 `resetTrial` 时，它的邮箱以后也领不到试用。

6. **撤销会话（revoke sessions）**：管理员调用 Clerk 撤销该用户的全部会话，所有设备下线，账号状态不变，用户可以重新登录。用于怀疑会话被盗的情况：被盗的是用户本人，不应该禁用他。

7. **管理员接口**都挂在现有的 `clerkAuth + RequireAdmin` 后面：`POST /api/admin/users/:id/revoke-sessions`、`POST /api/admin/users/:id/disable`、`POST /api/admin/users/:id/enable`、`DELETE /api/admin/users/:id`。**目标账号的 Clerk user id 在 `ADMIN_CLERK_USER_IDS` 里时，禁用和删除都拒绝**（包括管理员自助注销），避免手滑把自己 ban 掉：Clerk ban 之后就登不上管理页，只能去 Clerk 后台解封；删掉之后环境变量里的 id 也失效了。要注销管理员账号，先从环境变量里去掉它。每次操作都由 `middleware.RequestLog` 记一行请求日志，另外记录操作者和目标用户。

8. **enx-api 新增 Clerk Backend API 的密钥**（`CLERK_SECRET_KEY`）。现在 enx-api 只用 JWKS 公钥验证 token，没有调用过 Clerk 的后台接口。本 ADR 有四处要调用：删除用户（自助注销和管理员删除）、ban、unban、撤销会话。enx-api 里只在 `account` 包注入的 Clerk 客户端里用到它。homelab 和生产环境的密钥模板要在 w10n-config 里加上。

9. **隐私政策**（enx-ui `/privacy`）说明注销后删除哪些数据、保留哪些数据及理由：账本、Stripe Customer/订阅记录、包含潜在个人信息的原始财务 webhook 与重复接收历史、事件处理记录，以及防止重复领取赠送的邮箱 HMAC。2026-10-23 的 webhook 原文留存例外必须明确告知，不能继续承诺注销后所有留存数据均已匿名。

## Considered Options

- **软删除用户行（打 `deleted_at` 标记）**：重新注册的人会拿到新的 Clerk user id，按 id 对不上软删除的那一行，最后还得按邮箱去匹配；而留着整行就等于留着姓名、邮箱等个人信息，不符合删除权。否决；改为硬删除，只留不可逆的邮箱 HMAC。
- **直接用 SHA-256 存邮箱哈希**：可以被字典撞出明文。否决；改用带服务端密钥的 HMAC。
- **第一版就同时记 OAuth provider 账号 ID**：需要额外调用 Clerk API 或者自定义 JWT 模板，而邮箱已经能覆盖「注销后用同一邮箱重新注册」这个主要场景。推迟。
- **管理员删除一律清除试用发放记录**：管理员顺手删掉一个刷积分的人，他回来就又能领。否决；默认保留，测试时显式勾选。
- **在 `subscriptions` 表加一列 `cancel_at_period_end`，由 webhook 同步**：删除时就不用查 Stripe 了。但现有的订阅要回填，而且列只是 Stripe 状态的副本，可能和 Stripe 不一致；而注销很少发生，查一次 Stripe 的代价很小。推迟；等 `/billing` 页面需要显示「将于某日取消」时再加。
- **删除时自动取消订阅**：要决定取消时机、是否按比例退款，还要和 adr-049 的退款扣回交织在一起。否决；要求先取消订阅。
- **只在 enx-api 本地禁用，不调用 Clerk ban**：用户还能登录 Clerk，只是每个请求都被拒，体验差，而且会话仍然有效。否决；两边都做。

## Consequences

- 刷试用的成本从「再登录一次」恢复为 adr-048 设想的「多注册一个 Google / GitHub 账号，而且要用另一个邮箱」。
- 用户注销后用同一邮箱重新注册，得到的是一个没有试用积分的新账号；认领邀请码时双方都没有奖励；新手引导照常显示。这一点要写进确认文案：「注销后用同一邮箱重新注册，不会再获得试用积分或邀请奖励」。
- 付费积分在注销时作废，用户仍须在注销前申请退款；Stripe 之后送来的退款事件继续保留并按 ADR-067 恢复/调查，不因用户行已删而永久失败或重建余额。注销后才完成的既有 Checkout 交管理员调查，不自动退款。
- `account.email-hmac-key` 丢失或轮换后，所有试用发放记录都会失效。密钥要和其他生产密钥一样备份。

## Verification

- **单元测试**（假的 Clerk、Stripe、仓储）：自助注销和管理员删除都删光用户数据、保留账本行；有续费中的订阅时拒绝；Clerk 失败时本地数据不动；同一邮箱（大小写、前后空格不同）重新注册不发试用、认领邀请码时双方都不发奖励（之后首付记为 `no_reward`）；`resetTrial=true` 之后重新注册能领试用；邮箱为空不发试用；禁用的用户请求返回 403 `account_disabled`，解除后恢复；不能禁用或删除 `ADMIN_CLERK_USER_IDS` 里的账号（包括自助注销）。
- **人工验证**：
  - 在 Clerk dev 实例（rational-deer-4450）里，先用一个 Google 账号登录，再用同一邮箱的 GitHub 账号登录，确认 Clerk 把两者关联到同一个用户（同一个 `user_xxx`）。没有关联的话修订第 3 条。
  - 在生产环境用测试账号走一遍：管理员勾选 `resetTrial` 删除 → 重新注册 → 看到 100 试用积分和新手引导；不勾选删除 → 重新注册 → 没有试用积分。
  - 管理员禁用一个已登录的账号后，enx-ui 和扩展在一分钟内都显示 `This account has been disabled.`，且无法重新登录；解除后能正常登录。

## 修订记录

- 2026-10-22（#245）：明确保留邀请关系不代表继续向已注销邀请人发奖，待发奖励作废并由账本事务防止并发注销后重建余额；规则见 adr-051 第 5 条。

- 2026-10-23（#297、ADR-067）：未解决订阅冲突阻止用户和管理员注销并提示联系管理员；resolved 不绕过实时续费检查。财务 webhook 原始 payload、重复 deliveries 与 events 注销后保留，明确修订旧匿名留存假设，并更新隐私告知要求。

- 2026-10-23（#297 round 3）：补齐 unpaid/incomplete 与滞后状态的权威续费检查，明确注销后完成 Checkout 的人工终态，遵循不重建用户/余额的既定删除屏障。

- 2026-10-23（#297 round 5）：补齐降档 schedule 阻止 Portal 取消时的既有自助退出路径，保持原续费/期末取消注销资格，不增加自动取消。
