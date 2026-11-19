---
status: accepted
date: 2026-10-09
related: adr-028（阅读统计；本 ADR 复用它的 `GET /api/stats/overview`）、adr-009 / adr-048（积分池与 `GET /api/billing/me`）、adr-032（弹窗布局）
---

# ADR-052：扩展弹窗的统计卡片——两个常驻数字，积分只在快用完时出现

扩展弹窗是用户每天打开次数最多的界面，但它只用来开关学习模式，和主站之间没有入口：生词本、阅读统计、积分余额都要用户自己去主站找。PR #118 已让弹窗左上角的 logo + 名字跳到主站首页，这是一个隐性入口；本 ADR 再加一个看得见的入口，顺便让用户每次打开弹窗都看到一点自己的进度。

需要的数据现有接口都已提供，后端只加一个配置项（Decision 2a），并让 `/billing/me` 读余额失败时报错而不是返回 0（Decision 2b）：

- `GET /api/stats/overview`（adr-028）：`week.wordsRead`（本周阅读词数）、`vocab.total` / `vocab.mastered`（生词本词数 / 已掌握数）。
- `GET /api/billing/me`：`credits.subscriptionBalance` + `topupBalance` + `trialBalance`（有效值），`trialExpiresAt`，`subscription.status`。

我们决定：**已登录时，弹窗正文顶部放一张统计卡片，常驻两个数字——本周阅读词数（跳 `/stats`）、生词本词数（跳 `/words`）；积分不常驻，只在快用完时以一行提醒出现（跳 `/billing`）。**

## Considered Options

- **三个数字常驻（含积分）**：一直摆着余额，会让用户在意花销、少查词，和产品「多查多读」的目标相反。否决；积分只在需要行动时出现。
- **放更多数字（今日、查词次数、文章数……）**：弹窗宽 360px 左右，用户打开它主要是为了开关学习模式，统计只是顺带看一眼。否决；详细数据在 `/stats`。
- **新增一个合并接口 `GET /api/popup/summary`**：省一次请求，但为一个小卡片在 API 里开新端点，两份数据又各自有现成接口。否决；background 并发调两个现有接口即可。
- **只显示 logo 入口，不加卡片**：logo 能点这件事很难被发现。否决。

## Decision

1. **卡片内容。** 两个可点的格子，各自是新标签页链接（与 `PopupHeader` 一样用普通 `<a target="_blank">`）：

   | 格子 | 数字 | 标签 | 链接 |
   |---|---|---|---|
   | 左 | `week.wordsRead` | words read this week | `${frontendBaseUrl}/stats` |
   | 右 | `vocab.total` | words saved（副标题 `N mastered`） | `${frontendBaseUrl}/words` |

   数字按 `en-US` 千分位显示。左格 `week.wordsRead` 是推断值，按 adr-028 Decision 8 显示概数，规则与 enx-ui `approximateWords`（`enx-ui/src/lib/statsWindow.ts`）一致：`≤ 0` 显示 `0`，`< 100` 显示 `<100`，`< 10,000` 取整到百，否则取整到千（`1,237` → `1,200`）；数字带可访问的说明（`aria-label` / `title`，如 `About 1,200 words read this week (estimated from reading position)`）。扩展不能引用 enx-ui，规则在 `src/lib/` 里实现一份，测试用同样的用例。右格 `vocab.total` 是精确值，原样显示（`1,237`）。

2. **积分提醒：只在快用完时出现。** 设可用余额 `B = subscriptionBalance + topupBalance + trialBalance`（`B` 可以为负：一次实际花费超额的结算会把余额留在负数，见 `enx-api/billing/credit/balance.go`；AI 调用在 `B < 1` 时就拒绝），满足下面任一条件时，卡片下方多一行提醒，整行链接到 `/billing`。只有一行，多条同时满足时按下面的顺序取第一条：

   - **试用快过期**：余额只来自试用池（订阅池、top-up 池都为 0，`trialBalance > 0`），且 `0 < trialExpiresAt − now ≤ 48h`，文案：剩余 `< 24h` 为 `Trial credits expire in N hours`（`N = ceil(剩余小时)`，最少 1；`N = 1` 用 `hour`），`24h ≤ 剩余 ≤ 48h` 为 `Trial credits expire tomorrow`。排第一：过期会让这些积分整体作废，比「余额低」更该先说；`lowBalanceThreshold = 0` 不影响这一条。
   - **订阅用户用完**：`B ≤ 0` 且 `subscription.status` 为 `active` 或 `past_due`，文案 `Out of AI credits · Get more`。
   - **余额低**：`0 < B ≤ lowBalanceThreshold`，文案 `Only {B} AI credits left · Get more`。

   不显示的情形：余额充足；**免费用户试用已用完或已过期**（`B ≤ 0` 且无订阅）。后者是常态而不是「快用完」，每次打开弹窗都提示就成了推销；这类用户等到使用 AI 功能时，由侧边栏的 402 提示（已有 `Subscribe / add credit` 链接）告诉他们。

   2a. **阈值可配置，放在 enx-api。** 新配置项 `credits.low-balance-threshold`（环境变量 `CREDITS_LOW_BALANCE_THRESHOLD`），默认 **20**，不能为负；`0` 表示关掉「余额低」提醒（「订阅用户用完」「试用快过期」两条不受影响）。`GET /api/billing/me` 的 `credits` 增加 `lowBalanceThreshold` 字段，扩展从这里读，不写死在扩展里：扩展发版要过 Chrome Web Store 审核，改服务端配置只需部署 enx-api。旧版 API 没有这个字段时，扩展按 20 处理。

   2b. **`/billing/me` 只返回真正读到的余额。** 现在的 `Me` 忽略 `credit_accounts` 查询的错误，试用池读失败也只记日志，数据库故障时订阅用户会拿到 HTTP 200 + 全 0 余额，弹窗就会误报「Out of AI credits」。改为：三个池从同一次 `credit_accounts` 读取得出（试用池按 ADR-048 Decision 8 取有效值）；没有这一行（`gorm.ErrRecordNotFound`）仍是全 0 的正常情况；其他读取错误返回现有的 503 `Billing information is unavailable right now. Please try again later.`。

   AI 调用按 token 计费、单次消耗不固定，20 是起点；付费档积分额度还待校准，校准后再一起调这个值。

3. **取数据走 background。** 弹窗发一条新消息 `GET_POPUP_SUMMARY` 给 background（在现有的 `chrome.runtime.onMessage` 监听里加一个分支），background 用现有带鉴权的 `makeApiRequest`（`enx-chrome/src/background/background.ts`；它已经带 `X-Enx-Tz-Offset`，所以「本周」按用户本地时区算，也负责 401 重放和会话过期）**并发**发起两个请求，传 `{ gatewayRetry: false }`（Decision 4：不重试），两个结果各自独立处理（`{success: false}` 或抛错只影响自己那一半），返回：

   ```ts
   interface PopupSummary {
     stats: {
       wordsReadThisWeek: number
       vocabTotal: number
       vocabMastered: number
       weekStart: string // 取数时用户本地的本周一，YYYY-MM-DD
     } | null // null = stats 这次没取到
     billing: BillingInputs | null // creditNotice 需要的 /billing/me 字段（三个池、trialExpiresAt、subscription.status、lowBalanceThreshold）；null = 没取到
   }
   ```

   积分提醒的判定（Decision 2）是一个纯函数 `creditNotice(billing, now)`，放在 `src/lib/`，单测覆盖每条分支。提醒不缓存、不由 background 算好，弹窗每次渲染时用当前时间现算（见 Decision 5）。

4. **不能挡住学习模式开关。** 卡片加载中、接口失败时，数字位显示 `—`，不显示错误、不重试、不显示积分提醒（拿不到数据就不提醒）。卡片高度固定，数据到达时不跳动布局。一次刷新里两半各自生效：stats 成功就显示新数字，失败就显示 `—`（有当周缓存时保留缓存的数字）；billing 成功就按新数据算提醒，失败就不显示提醒（有缓存时按缓存现算）。

5. **缓存上一次结果。** 弹窗每次打开都是新页面，直接请求会先闪一下 `—`。background 把每一半最近一次成功的结果写进 `chrome.storage.local`；某一半刷新失败时不覆盖它的旧缓存。弹窗先显示缓存再刷新；退出登录时删除。

   - **按账号分。** key 是 `enx-popup-summary:<clerkUserId>`，`clerkUserId` 是 background 确认过的 Clerk 身份（账号会话 owner，即 `clerk.user.id`），不是弹窗 `userAtom.id`（那里对所有用户都是 `0`）。读缓存、写缓存、把结果回给弹窗之前都用 `accountSession.capture()` 检查账号代数没变：请求发出后账号退出或切换（A → B），A 迟到的响应既不显示在 B 的弹窗里，也不重新写回已删除的 A 的缓存。
   - **显示前校验时效。** 缓存的 `stats.weekStart` 不等于当前本地的本周一时，缓存的「本周阅读」按无数据处理（显示 `—`，生词本数字不受影响）；积分提醒总是用 `creditNotice(缓存的 billing, now)` 现算，试用已过期就不会再显示「expires tomorrow」。

6. **未登录不显示卡片。** 未登录用户只看到 logo 入口和登录卡片。

## Consequences

- 每次打开弹窗多两个 API 请求（只读、已登录）。`/stats/overview` 一次会查 daily_stats 和 user_dicts；弹窗打开频率不高，现阶段不加服务端缓存，adr-040 的指标里能看到它的调用量和延迟。
- 新增消息类型 `GET_POPUP_SUMMARY`、一个 `PopupStatsCard` 组件、`creditNotice` 纯函数、一个按用户分的 storage key。后端只加 `credits.low-balance-threshold` 配置和 `/billing/me` 的 `lowBalanceThreshold` 字段，并把 `/billing/me` 的余额读取错误改成 503（config 单测覆盖默认值与负数校验）。
- 测试：`creditNotice` 单测（固定时钟；余额低、订阅用完含负余额、试用快过期、低余额与快过期重叠时取过期、正好 48h、24h 前后的文案、过期时刻、阈值为 0 时过期提醒照常、免费用户用完或负余额不提醒、余额充足不提醒、只有试用池时才看过期）；`PopupStatsCard` 单测（数字、阅读数概数与说明、生词本精确值、链接、`—` 占位、提醒行出现与否）；background 处理函数单测（一个接口失败时另一个照常返回、刷新失败不覆盖旧缓存、缓存按 Clerk 用户 ID 写入、两个响应之间退出登录或 A→B 切换时 A 的结果不回给 B 也不重建 A 的缓存、跨周一与跨试用过期时刻重新打开时缓存按时效处理）；`/billing/me` 测试（经配置加载传入非默认阈值与 0 后原样返回、无 `credit_accounts` 行时全 0、读取失败时 503）；`e2e/popup-layout.spec.ts` 覆盖弹窗打开到数据到达的全过程。
- `credits.low-balance-threshold` 与付费档积分额度绑在一起，额度改了要回来看这个值。

## 修订记录

- 2026-11-19（#122 规格评审）：Decision 1 本周阅读数按 adr-028 Decision 8 显示概数；Decision 2 定下多条提醒的优先级（试用快过期优先）、`in N hours` / `tomorrow` 的分界，「订阅用户用完」改为 `B ≤ 0`（余额可以为负）；新增 2b，`/billing/me` 读余额失败返回 503 而不是全 0；Decision 3 改用实际的 `makeApiRequest`（关掉网关重试），`PopupSummary` 改存原始数据、提醒在显示时现算；Decision 4/5 定下部分成功的规则、缓存按确认过的 Clerk 身份分并用账号代数防串号、显示前按周和试用过期时刻校验缓存。原因：评审指出原文在这些情形下会显示错误的提醒或别的账号的数据。
