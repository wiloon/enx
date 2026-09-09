# ADR-020：扩展登录回跳收尾 —— 扩展从 popup / 侧栏打开网站登录页时带回跳标记，Clerk 登录成功后落到 enx-ui 的 `/extension/connected` 回跳页；该页经 ADR-019 通道通知扩展，扩展关掉登录 tab、把用户切回原来在读的页面并发登录成功通知（`externally_connectable` 第 3 个消息类型 `enx:signed-in`）

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-09-07（本次对话提出，待用户确认 / 编码） |
| **日期** | 2026-09-07 |
| **关联 ADR** | [`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（`syncHost`：网站登录 → 扩展即登录态。本 ADR 补上「登录动作完成后，把用户送回扩展 / 原页面」这段 syncHost 不管的收尾）、[`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md)（`externally_connectable` + `onMessageExternal`，现有 `enx:ping` / `enx:enable-reader` 两个类型。本 ADR 加第 3 个 `enx:signed-in`，并兑现其 Revisit Trigger 第 1 条「加第二个网页→扩展动作时评估要不要泛化协议」的评估——结论是暂不泛化）、[`adr-001-chrome-oauth-in-background.md`](adr-001-chrome-oauth-in-background.md)（popup 失焦即销毁的生命周期教训。本 ADR 让登录全程在网站 tab、扩展只做 background 收尾，绕开这个坑） |
| **关联代码** | enx-chrome：`src/components/Login.tsx`（`openWebSignIn`）、`src/background/background.ts`（`onMessageExternal`、`ENX_UI_ORIGINS`、`isSignedIn`）；enx-ui：`src/app/sign-in/[[...sign-in]]/page.tsx`、新增 `src/app/extension/connected/page.tsx`、`src/lib/enxExtension.ts` |
| **关联清单** | [`../tasks/LAUNCH-CHECKLIST.md`](../tasks/LAUNCH-CHECKLIST.md) §0.1（生产品牌域未定 → `ENX_UI_ORIGINS` / redirect URL 的 prod 值待回填，homelab `enx.wiloon.lab` + dev `localhost:3000` 先跑通） |

---

## Context

**现状（`Login.tsx`）**：扩展未登录时点「Sign in on the web」→ `chrome.tabs.create({ url: '${clerkSyncHost}/sign-in' })` 开一个新 tab。用户在网站用 Google / GitHub 登录，Clerk 会话经 `syncHost` 同步回扩展，`useUser()` 自动翻成登录态。

**三个体验断点**：

1. 登录 tab 登完就停在那儿，不会自己关。
2. 用户此刻在网站 tab 上，没有任何提示告诉他「可以回扩展 / 回刚才在读的那个页面了」。
3. 如果登录是从 **popup** 发起的，popup 早在 `chrome.tabs.create` 抢焦点时就销毁了；用户得自己想起来重新点扩展图标。

`syncHost` 只解决「会话到了扩展这一侧」，不解决「登录这个动作完成后，把用户带回原来的上下文」。

**约束**：

- 登录必须走网站整页 Clerk UI —— OAuth 在扩展 popup / side panel 内跑不完（[ADR-015](adr-015-cognito-to-clerk-auth-migration.md) Rationale 2、[ADR-001](adr-001-chrome-oauth-in-background.md)）。
- 网页**无法关闭**一个 `chrome.tabs.create` 打开的 tab —— `window.close()` 只对脚本 `window.open` 出来的窗口有效。关 tab、切 tab 只能由扩展做。
- 复用 [ADR-019](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) 已有的 `externally_connectable` 通道，origin 白名单不放宽。

---

## Options Considered

### A. 只加一个静态回跳页，协议不动

Clerk `forceRedirectUrl` → `/extension/connected`，页面显示「✓ 已登录，可以关掉这个标签页回到刚才的页面」。扩展侧零改动。

- **Pros**：零新增信任面；一天的活。
- **Cons**：tab 要用户自己关；切不回原页面；从 popup 发起的仍要手点图标。断点 1、3 只是「给了句提示」，没真正消除。

### B.（推荐）回跳页 + 第 3 个消息类型 `enx:signed-in`

扩展开登录 tab 前，background 记下 `{ originTabId, originWindowId }`；`chrome.tabs.create` 的 URL 带 `?src=extension`，Clerk `forceRedirectUrl=/extension/connected`。回跳页渲染后 `chrome.runtime.sendMessage(EXT_ID, { type: 'enx:signed-in' })`。background 收到（`sender.origin` 校验同 ADR-019）→ 确认 `isSignedIn()` → 关登录 tab（满足下 Decision 的三个前置条件）→ `chrome.tabs.update(originTabId, {active:true})` + `chrome.windows.update(originWindowId, {focused:true})` → `chrome.notifications` 弹「已登录」。回跳页的文字说明**保留为兜底**（消息没送达 / 非 Chromium / 用户直接访问该 URL）。

- **Pros**：三个断点全消除；协议仍是平铺的固定小词表（3 个类型，都不透传内部 `action`）。
- **Cons**：`externally_connectable` 多一个类型；background 要存一小段跨 `tabs.create` 的状态。

### C. 把外部协议泛化成带能力清单的 RPC

[ADR-019](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) Revisit Trigger 第 1 条设想的方向。

- **Cons**：现在只有 3 个稳定、无副作用的类型，泛化是为不存在的需求预付设计成本。**否决**，留给「第 4 个类型」时再评。

### 收尾时登录 tab：关掉 / 保留

方案 B 定了「回跳后切回原 tab」，剩一个子决策——那个登录 tab 怎么处理：

| 选法 | 做法 | 评价 |
| --- | --- | --- |
| **关掉**（采用） | `chrome.tabs.remove(loginTabId)` + 切回原 tab | 见下 Rationale |
| 保留、只切焦点 | 不 `remove`，只 `chrome.tabs.update(originTabId, {active:true})` | tab 停在 `/extension/connected` 的「正在返回…」死页上，没意义 |
| 保留但导去真实页面 | 先把登录 tab 导到 Catseye 首页，再切回原 tab | 比「关掉」多写一次导航，换来一个用户多半也会手动关的 tab |

**Rationale（关掉）**：

1. `/extension/connected` 是一次性中转页，上面没有值得留的东西——它就是「登录成功 → 通知扩展 → 请回去」的跳板。保留就得再导航一次（否则 tab 永久停在 spinner 状态），是给「整洁」这个理由额外加活。
2. 对上用户已有的心智模型：OAuth 弹窗就是「用完自己消失」，登录 tab 表现一致，不突兀。
3. 重复登录（会话过期、换设备、登出后重登）不堆 tab。
4. 这个 tab 是扩展自己几秒前为单一目的 `chrome.tabs.create` 出来的，用完清理是本分。

---

## Decision

**选 B。**

### enx-chrome

- `Login.tsx` 的 `openWebSignIn` 改为发 `chrome.runtime.sendMessage({ action: 'openWebSignIn' })` 给 background（popup 和 sidepanel 共用一条路径，不各自 `tabs.create`）。
- background 新增 `openWebSignIn` handler：把 `sender.tab`（发起时的活动 tab）连同其 `windowId` 存进 `chrome.storage.session`，然后 `chrome.tabs.create({ url: '${clerkSyncHost}/sign-in?src=extension&redirect_url=/extension/connected' })`，把 `loginTabId` 一并记下。
- `onMessageExternal` 加 `enx:signed-in` 分支：校验 `sender.origin ∈ ENX_UI_ORIGINS` → 先停留 3s（`SIGNIN_RETURN_HOLD_MS`，测试环境为 0；回跳页同步显示倒计时）让用户看清 `/extension/connected` 的「You're signed in」→ 关登录 tab、激活并聚焦记录的 origin tab / window、发通知；state 用完即清。消息体里的任何 tab id / URL 一律不信。

  **关登录 tab 的三个前置条件（缺一就只切焦点、不关）**：
  1. `isSignedIn()` 确认为真（签出态回 `{ ok:false, reason:'signed-out' }`，不动 tab）；
  2. 待关的是当初记进 `chrome.storage.session` 的那个 `loginTabId` —— 用它，不用 `sender.tab.id`，更不猜；
  3. 该 tab 当前 URL 仍在 `/extension/connected`（同源即可）。用户若在这个 tab 里手动导航走了，只切焦点、保留 tab。

  这样即便检测误触发，最坏也只是留一个 tab，不会关掉用户正在用的页面。

### enx-ui

- 新增 `src/app/extension/connected/page.tsx`（`'use client'`）：显示「登录成功 · 正在返回…」，兜底文案「如果你是从扩展进来的，可以关闭本页回到刚才的标签页」。`useEffect` 里调 `enxExtension.ts` 新增的 `notifySignedIn()`（`send(id, { type: 'enx:signed-in' }, () => void rt?.lastError)`，扩展没装即 no-op）。
- `sign-in` 页读到 `?src=extension` 时把 `forceRedirectUrl` 设为 `/extension/connected`（否则维持默认跳转）。`/extension/connected` 是同域路径，Clerk allowed redirect origins 默认已覆盖。

### CONTEXT.md

「会话同步」词条补一句：登录动作的收尾（关登录 tab、切回原页面）见 adr-020；或新增「登录回跳页（`/extension/connected`）」词条。

---

## Consequences

### Positive

- 从扩展发起的登录，登完**自动回到原来在读的页面**，登录 tab 自己消失，并有系统通知。
- popup 被销毁不影响结果 —— 收尾发生在 background + 网站页，跟 popup 生命周期解耦（延续 ADR-001 的思路）。
- 协议仍是「固定词表、无副作用、不透传内部动作」，审计面没扩大。

### Negative / 风险

| 风险 | 缓解 |
| --- | --- |
| `externally_connectable` 第 3 个消息类型 | 仍是无副作用固定词表；`enx:signed-in` 只触发「关 sender tab + 切回**记录的** origin tab + 通知」，不接受消息里的任何 tab id / URL |
| background 要跨 `tabs.create` 存一小段状态 | 用 `chrome.storage.session`（SW 回收后仍在）；加时限 / 只认最近一次，用户中途手动登录或多开时不误切 |
| 普通 web 用户直接访问 `/extension/connected` 会看到「正在返回」 | `enx:signed-in` 没有扩展接就是 no-op；文案写成条件句「如果你是从扩展进来的…」 |
| `?src=extension` 只是 UX 提示、可伪造 | 它不承担安全职责；真正的信任边界是 `onMessageExternal` 里的 `sender.origin` 白名单校验（同 ADR-019） |
| 关登录 tab 属轻度破坏性操作，误触发可能关掉用户在用的页面 | Decision 的三个前置条件：`isSignedIn()` 为真 + 只关记下的 `loginTabId`（不猜、不用 `sender.tab.id`）+ 该 tab 仍在 `/extension/connected`；任一不满足只切焦点、留 tab |

---

## Revisit Triggers

- **要加第 4 个「网页→扩展」消息类型** → 回 [ADR-019](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) Option C，重新评估要不要把协议泛化成带能力清单的形式。
- Chrome 改变 `externally_connectable` / `chrome.tabs` / `chrome.storage.session` 的行为。
- **side panel 成为主登录入口**，且 Clerk 的 side panel + `syncHost` 刷新问题（需关闭重开才更新登录态）仍未修 → 回跳后可能要额外 `chrome.sidePanel.open()` 兜一下。
- **生产品牌域敲定**（LAUNCH-CHECKLIST §0.1）→ 回填 `ENX_UI_ORIGINS` 与 redirect URL 的 prod 值。

---

## Out of Scope（本次不做）

- 网站侧（非扩展发起）的登录不变，不加任何 `?src` 分支逻辑。
- 不做「记住用户上次读到哪、回跳后滚动到原位置」之类的深度恢复 —— 切回 tab 即可。
- 不把回跳收尾泛化给「其它扩展动作也能要求回跳」——只服务登录这一个场景。
