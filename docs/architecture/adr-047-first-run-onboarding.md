---
status: proposed
date: 2026-10-03
related: adr-046（角标状态，本 ADR 负责教用户认识它）、adr-027（Home 的 OnboardingChecklist，本 ADR 与它共用步骤模型）、adr-019 / adr-020（网页 → 扩展通道与登录回跳，本 ADR 加一个消息类型）、adr-039（站点自动启用）、adr-044（服务端偏好，存 `onboardingCompleted`）、adr-048（免费用户试用 AI 积分）
---

# ADR-047：首次使用引导放在 enx-ui 的 `/welcome`，扩展安装后自动打开；步骤按真实状态勾选，可跳过

adr-046 去掉了正文里的「Article processed • Click words for translation」，学习模式的状态只靠扩展图标角标表达。这要求用户在第一次使用时学会两件事：**把图标固定到工具栏**（否则角标看不见），以及**角标几种状态的含义**。此外新用户还得完成登录，并真正体验一次「点词查词」。

现状：adr-027 在 Home 上给零阅读的用户显示三步清单（安装扩展 → 打开英文页启用 → 读完第一篇），但这只覆盖「先到网站」的用户；从 Chrome Web Store 直接安装的用户，`runtime.onInstalled` 只初始化了 storage，什么页面都不打开。

## 用户从哪里进来

三种情况，`/welcome` 一个页面全部支持，靠真实状态区分（Decision 2）：

- **A. 先到网站**：catglish.com → 进入 `/welcome` → 页面经 `enx:status` 探测到扩展未安装 → 引导从「安装扩展」开始 → Chrome Web Store → 安装 → 回到 `/welcome` 继续。
- **B. 先到商店**：Chrome Web Store（搜索、推荐、视频链接）→ 安装 → 扩展打开 `/welcome` → 探测到已安装 → 引导从「登录」开始。此时用户多半还没有账号。
- **C. 重装 / 换电脑**：已有账号，`onInstalled` 的 reason 依然是 `install`。

A、B 的区别只是「进来时扩展装没装」，页面能直接探测到，不需要靠 URL 参数或来源判断。

## Considered Options

- **引导页做成扩展自带页面（`chrome-extension://…/welcome.html`）**：能直接调 `chrome.action.getUserSettings()`，不依赖网络。但登录本来就在网站上完成（adr-015 `syncHost`、adr-020），试读文章最可靠的是 enx-ui 的 `/reader`（adr-019），两者都在网站；扩展页还要再打包一套 UI 与文案。否决。
- **只在 popup 里引导**：popup 失焦即销毁（adr-001），放不下多步流程，也演示不了角标变化。否决。
- **固定顺序的向导（下一步/下一步）**：C 类用户已经登录、可能已固定图标，却被迫重走。否决；改为**按真实状态勾选的清单**，已完成的步骤一进来就是勾上的。
- **让用户在引导里给某个站点开「总是启用」**：`chrome.permissions.request` 只能在扩展自己页面的用户手势里调用，网页调不了。v1 不放进引导，只在最后给一句提示（Decision 4）。

## Decision

1. **入口**：`runtime.onInstalled` 且 `reason === 'install'` 时，background 打开 `${uiOrigin}/welcome?src=install`（`uiOrigin` 取 `targets.ts` 当前 target 的 enx-ui 地址）。Chrome Web Store 安装完成后会触发这个事件，这是从商店进来的用户唯一的落地点。`update` 不打开。**A 路径防重复开页**：用户从 `/welcome` 去商店安装时，`/welcome` 标签页还开着；background 先用 `chrome.tabs.query({ url: '${uiOrigin}/welcome*' })` 找它（构建出的 manifest 对 enx-ui origin 有 host 权限，可以按 URL 查），找到就切回那个标签页并聚焦窗口，不另开新页；找不到才新开。`/welcome` 也允许用户直接访问（官网、Home 清单都链过去）。
1a. **老用户不看引导**：扩展卸载时本地存储全部清除，重装 / 换电脑后扩展无法知道「这是老用户」，所以判断放在 `/welcome` 上、按账号做：
   - **已完成标记**：adr-044 的服务端偏好加一个布尔键 `onboardingCompleted`（与 `aiWordFallbackNoticeAck` 同类，用户不可在设置里编辑）。引导到达完成态、或用户点「Skip setup」时写入 true。
   - **既有用户不需要迁移**：`onboardingCompleted` 为真，**或** adr-028 的累计查词数 > 0，都视为老用户。
   - **已登录、经安装进入 `/welcome?src=install`**（同一浏览器重装时网站登录态还在）：老用户直接跳到 `/app`，带一句「Catglish extension connected」，不显示步骤。
   - **未登录进入 `/welcome`**（换电脑）：页面先只显示「Welcome to Catglish — sign in to get started」。这一屏对新老用户都成立，老用户本来也必须重新登录扩展；登录回跳后按上一条判断，老用户直接去 `/app`。
   - 因此老用户最多看到一次本来就需要的登录页，看不到任何引导步骤。
   - 判断不了的情况（例如用户换电脑后不登录、直接关掉）就让引导出现一次：这种情况概率低，代价只是多看一页。**每一步都显示「Skip setup」**，点了即写入 `onboardingCompleted`（已登录时）并去 `/app`。
2. **步骤**（全部按真实状态显示勾选，不按顺序锁定）：
   0. **安装扩展**（只在探测到未安装时出现）：「Add to Chrome」按钮在新标签页打开 Chrome Web Store。页面可见时每 2 秒发一次 `enx:status`，探测到安装后自动勾上（同时扩展会把用户切回这个标签页，见 Decision 1）。非 Chromium 浏览器给出「Catglish needs Chrome」说明。
   1. **登录**：已登录则勾上；未登录时给 Sign in / Sign up，登录回跳回到 `/welcome`（沿用 adr-020 的 `src=extension` 回跳机制，目标改成 `/welcome`）。
   2. **固定图标**（可跳过）：一张示意图，展示「点拼图图标 → 点 Catglish 旁的图钉」。页面在这一步可见时每 2 秒向扩展查询 `isOnToolbar`，固定后自动勾上。点「Skip」直接进入下一步；跳过的人之后由 adr-046 Decision 6 的固定提示最多再提醒两次，本 ADR 不另做计数。
   3. **读一篇示例文章**：一个按钮打开 `/reader`，预填一段内置的示例英文短文（约 150–250 词，写在 enx-ui 里，挑几个中等难度的词让下划线有东西可画），并经 adr-019 的 `enx:enable-reader` 自动启用学习模式。这一步分两个小项：
      - **点词查词**：用户亲眼看到角标从 `…` 变成 `✓`，然后点一个词看到释义。`/welcome` 上同时放一张角标图例（adr-046 Decision 1 的四个状态：无角标 / `…` / `✓` / `!`，字符 + 颜色 + 一句话含义）作为说明。
      - **侧边栏 AI 翻译**：提示用户拖选一句话（adr-007），在侧边栏看到整句 AI 翻译。这会消耗 AI 积分，免费用户的试用积分见 adr-048；积分不足时侧边栏显示现有的额度提示，这一小项不阻塞完成。
3. **完成**：三步都勾上（或第 2 步被跳过）后写入 `onboardingCompleted`，显示「You're all set」和两条后续提示：打开任意英文文章点 Catglish 图标启用；在常读的站点上用 popup 里的「Always enable on this site」（adr-039）。之后用户**主动**打开 `/welcome`（不带 `src=install`）时直接显示完成态和图例，图例因此兼作日后的「角标说明」页面。
4. **新的网页 → 扩展消息 `enx:status`**：返回 `{ ok, version, isOnToolbar }`。与 `enx:ping` 一样只认 `ENX_UI_ORIGINS` 来源，只读，不改任何状态。登录状态由网页自己的 Clerk 得出，不经扩展。`enx:ping` 保留不动（Home、`/reader` 在用）。
5. **第 3 步怎么判断完成**：复用 adr-028 的 `daily_stats.word_lookups`（服务端、按用户累加，经现有 stats 接口可读）：累计查词数 > 0 就勾上。不新增事件类型、不新增表。注意 adr-028 的上报是扩展侧攒批的增量，查完词后可能要过一会儿才反映出来；`/welcome` 在用户从 `/reader` 回来（页面重新可见）时重新查询一次即可，不追求实时。
6. **与 Home 清单的关系**：adr-027 的 `OnboardingChecklist` 与 `/welcome` 共用一个步骤模型（`onboardingSteps({ installed, signedIn, isOnToolbar, hasLookedUp, pinSkipped })` 纯函数）。Home 清单是同一套步骤的精简版（零阅读用户在 Home 上看到，点任一步跳 `/welcome`）。文案与图例只写一份。
7. **不做的事（v1）**：不做产品导览式的页面遮罩高亮；不收集引导漏斗指标（需要时按 adr-040 再加）；不做 `setUninstallURL` 的卸载反馈页；不在引导里设置词汇水平或高亮偏好。

## 实现要点（给实现者 / AFK agent）

- enx-chrome：`background.ts` 的 `onInstalled` 在 `install` 时 `chrome.tabs.create({ url: welcomeUrl })`；`onMessageExternal` 加 `enx:status`（`getUserSettings()` 取 `isOnToolbar`）。单测：`install` 且没有 `/welcome` 标签页时新开、已有时切回该标签页不新开，`update` 不打开；`enx:status` 只响应 `ENX_UI_ORIGINS`、返回 `isOnToolbar`。
- enx-api：`preferences` 注册表加 `onboardingCompleted`（布尔，默认 false，不可在设置页编辑）；单测覆盖默认值与写入。
- enx-ui：新路由 `src/app/(app)/welcome/page.tsx` 或公开路由（登录前也要能看，取决于 `(app)` 布局是否强制登录——实现时先确认，未登录必须能看到第 1 步）；`src/lib/enxExtension.ts` 加 `extensionStatus()`；`src/lib/onboarding.ts` 放 `onboardingSteps` 纯函数，`OnboardingChecklist` 改用它；角标图例组件 `BadgeLegend`。`/reader` 支持「示例文章」入口（预填内置短文，不需要用户粘贴）。
- 单测（Vitest/Jest，随 enx-ui 现有配置）：`onboardingSteps` 各状态组合；`/welcome` 已登录 + 已固定 + 已查词时直接显示完成态；固定步骤可跳过；`extensionStatus` 超时返回未安装。
- e2e（adr-037 / enx-ui e2e）：已登录用户打开 `/welcome` 看到第 1 步已勾；示例文章按钮打开 `/reader` 并预填正文。
- **人工验证项**：真实 Chrome 中全新安装扩展 → 自动打开 `/welcome` → 登录回跳回 `/welcome` → 固定图标后第 2 步自动勾上 → 示例文章里看到角标 `…` → `✓`、点词出释义 → 第 3 步勾上。

## Consequences

- 从商店直接安装的用户第一次有了明确的下一步，不再落在一个什么都没发生的浏览器里。
- 引导依赖网络和 enx-ui；enx-ui 不可达时安装后打开的是错误页。可接受：没有 enx-api/enx-ui，扩展本来也用不了。
- 角标图例活在 enx-ui 的 `/welcome` 上，而角标定义（adr-046 的 `badgeFor`）在 enx-chrome，两个包不共享代码，图例是一份手写副本。改角标状态时必须同步改图例；在 `badgeFor` 旁边留注释指向 `BadgeLegend`，反之亦然。
- 第 3 步依赖用户在 `/reader` 实际查一次词；只看不点的人这一步会一直不勾，但不阻碍使用。
