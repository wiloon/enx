---
status: proposed
date: 2026-10-09
related: adr-028（阅读统计；本 ADR 复用它的 `GET /api/stats/overview`）、adr-009 / adr-048（积分池与 `GET /api/billing/me`）、adr-032（弹窗布局）
---

# ADR-052：扩展弹窗的统计卡片——两个常驻数字，积分只在快用完时出现

扩展弹窗是用户每天打开次数最多的界面，但它只用来开关学习模式，和主站之间没有入口：生词本、阅读统计、积分余额都要用户自己去主站找。PR #118 已让弹窗左上角的 logo + 名字跳到主站首页，这是一个隐性入口；本 ADR 再加一个看得见的入口，顺便让用户每次打开弹窗都看到一点自己的进度。

需要的数据现有接口都已提供，后端不改：

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

   数字按 `en-US` 千分位显示（`1,240`）。

2. **积分提醒：只在快用完时出现。** 设可用余额 `B = subscriptionBalance + topupBalance + trialBalance`，满足下面任一条件时，卡片下方多一行提醒，整行链接到 `/billing`：

   - **余额低**：`0 < B ≤ LOW_CREDIT_THRESHOLD`，文案 `Only {B} AI credits left · Get more`。
   - **订阅用户用完**：`B = 0` 且 `subscription.status` 为 `active` 或 `past_due`，文案 `Out of AI credits · Get more`。
   - **试用快过期**：余额只来自试用池（订阅池、top-up 池都为 0），且 `trialExpiresAt` 在 48 小时内，文案 `Trial credits expire {in N hours / tomorrow}`。

   不显示的情形：余额充足；**免费用户试用已用完或已过期**（`B = 0` 且无订阅）。后者是常态而不是「快用完」，每次打开弹窗都提示就成了推销；这类用户点 AI 功能时侧边栏的 402 提示已有 `Subscribe / add credit` 链接。

   `LOW_CREDIT_THRESHOLD` 初值 **20**，写成 enx-chrome 里的一个常量。AI 调用按 token 计费、单次消耗不固定，这个值是起点；付费档积分额度还待校准，校准后再一起调。

3. **取数据走 background。** 弹窗发一条新消息 `GET_POPUP_SUMMARY` 给 background，background 用现有带鉴权的 `request()` **并发**调两个接口（它已经带 `X-Enx-Tz-Offset`，所以「本周」按用户本地时区算），各自独立成功或失败，返回：

   ```ts
   interface PopupSummary {
     wordsReadThisWeek: number | null
     vocabTotal: number | null
     vocabMastered: number | null
     credit: CreditNotice | null // null = 不显示提醒
   }
   ```

   积分提醒的判定（Decision 2）是一个纯函数 `creditNotice(billingMe, now)`，放在 `src/lib/`，单测覆盖每条分支。

4. **不能挡住学习模式开关。** 卡片加载中、接口失败时，数字位显示 `—`，不显示错误、不重试、不显示积分提醒（拿不到数据就不提醒）。卡片高度固定，数据到达时不跳动布局。

5. **缓存上一次结果。** 弹窗每次打开都是新页面，直接请求会先闪一下 `—`。background 把上一次成功的 `PopupSummary` 写进 `chrome.storage.local`，**key 带用户 ID**（`enx-popup-summary:<userId>`），弹窗先显示缓存再刷新；退出登录时删除。

6. **未登录不显示卡片。** 未登录用户只看到 logo 入口和登录卡片。

## Consequences

- 每次打开弹窗多两个 API 请求（只读、已登录）。`/stats/overview` 一次会查 daily_stats 和 user_dicts；弹窗打开频率不高，现阶段不加服务端缓存，adr-040 的指标里能看到它的调用量和延迟。
- 新增消息类型 `GET_POPUP_SUMMARY`、一个 `PopupStatsCard` 组件、`creditNotice` 纯函数、一个按用户分的 storage key。后端无改动。
- 测试：`creditNotice` 单测（余额低、订阅用完、试用快过期、免费用户用完不提醒、余额充足不提醒、只有试用池时才看过期）；`PopupStatsCard` 单测（数字、链接、`—` 占位、提醒行出现与否）；background 处理函数单测（一个接口失败时另一个照常返回，缓存按用户 ID 写入）。
- `LOW_CREDIT_THRESHOLD` 与付费档积分额度绑在一起，额度改了要回来看这个值。
