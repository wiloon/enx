---
status: accepted
date: 2026-10-03
revised: 2026-10-19
related: adr-046（角标状态）、adr-027（Home 的 OnboardingChecklist，本 ADR 与它共用步骤模型）、adr-019 / adr-020（网页 → 扩展通道与登录回跳，本 ADR 加一个消息类型）、adr-039（站点自动启用）、adr-044（服务端偏好，存 `onboardingCompleted`）、adr-048（免费用户试用 AI 积分）
---

# ADR-047：首次使用引导放在 enx-ui 的 `/welcome`，扩展安装后自动打开；步骤按真实状态勾选，可跳过

> **2026-10-19 修订**（为内测准备，参考沉浸式翻译的引导）：引导收敛为「固定图标 + 在示例文章上亲手启用一次、点一个词」，之后放手让用户自己用。
> - 示例文章嵌在 `/welcome` 页内，**不自动启用学习模式**，由用户自己点工具栏图标 →「Read with Catglish」；扩展在 `<html>` 上写 `data-enx-learning` 让页面知道已启用（Decision 2 第 3 步、Decision 4a）。
> - 删去侧边栏整句翻译小项和角标图例 `BadgeLegend`：留给用户自己探索 / 帮助文档。
> - 完成页给一组推荐的英文站点（Decision 3）。
> - 不让用户选母语：第一版只服务「中文母语者学英语」，由 Chrome Web Store 介绍页说明「目前只支持英文 → 中文」。
> - 商店链接在扩展上架前用占位（Decision 2 第 0 步）。

adr-046 去掉了正文里的「Article processed • Click words for translation」，学习模式的状态只靠扩展图标角标表达。这要求用户在第一次使用时**把图标固定到工具栏**（否则角标看不见、也找不到启用入口）。此外新用户还得完成登录，并**亲手**启用一次学习模式、点一次词——在真实网站上每次都要点图标启用，这是用户必须学会的唯一习惯。

现状：adr-027 在 Home 上给零阅读的用户显示三步清单（安装扩展 → 打开英文页启用 → 读完第一篇），但这只覆盖「先到网站」的用户，且第 2、3 步无法自动勾选；从 Chrome Web Store 直接安装的用户，`runtime.onInstalled` 只初始化了 storage，什么页面都不打开。

## 用户从哪里进来

三种情况，`/welcome` 一个页面全部支持，靠真实状态区分（Decision 2）：

- **A. 先到网站**：catglish.com → 进入 `/welcome` → 页面经 `enx:status` 探测到扩展未安装 → 引导从「安装扩展」开始 → Chrome Web Store → 安装 → 回到 `/welcome` 继续。
- **B. 先到商店**：Chrome Web Store（搜索、推荐、视频链接）→ 安装 → 扩展打开 `/welcome` → 探测到已安装 → 引导从「登录」开始。此时用户多半还没有账号。
- **C. 重装 / 换电脑**：已有账号，`onInstalled` 的 reason 依然是 `install`。

A、B 的区别只是「进来时扩展装没装」，页面能直接探测到，不需要靠 URL 参数或来源判断。

## Considered Options

- **引导页做成扩展自带页面（`chrome-extension://…/welcome.html`）**：能直接调 `chrome.action.getUserSettings()`，不依赖网络。但登录本来就在网站上完成（adr-015 `syncHost`、adr-020），试读文章最可靠的是 enx-ui 的 Reader 页面（adr-019），两者都在网站；扩展页还要再打包一套 UI 与文案。否决。
- **只在 popup 里引导**：popup 失焦即销毁（adr-001），放不下多步流程，也演示不了角标变化。否决。
- **固定顺序的向导（下一步/下一步）**：C 类用户已经登录、可能已固定图标，却被迫重走。否决；改为**按真实状态勾选的清单**，已完成的步骤一进来就是勾上的。
- **引导里自动启用示例文章的学习模式**（`/reader/sample` 现在的做法，经 `enx:enable-reader`）：用户能直接点词，但从没点过图标，换到真实网站就不知道怎么开。否决（2026-10-19）；引导里由用户自己点。
- **示例文章在新标签页打开 `/reader/sample?guide=1`**：步骤说明和文章分在两个标签页，用户要来回切；检测启用要跨页面。否决；文章嵌进 `/welcome`，左（上）步骤、右（下）文章，与沉浸式翻译第 3 步同形。
- **在引导里选母语 / 演示侧边栏整句翻译 / 角标图例**：母语第一版只有中文；侧边栏和角标对「开始用起来」不是必需，多一步就多一分流失（Mozilla 对安装后页面的建议：只放开始使用必需的东西）。否决。
- **让用户在引导里给某个站点开「总是启用」**：`chrome.permissions.request` 只能在扩展自己页面的用户手势里调用，网页调不了。不放进引导。

## Decision

1. **入口**：`runtime.onInstalled` 且 `reason === 'install'` 时，background 打开 `${uiOrigin}/welcome?src=install`（`uiOrigin` 取 `targets.ts` 当前 target 的 enx-ui 地址）。Chrome Web Store 安装完成后会触发这个事件，这是从商店进来的用户唯一的落地点。`update` 不打开。**A 路径防重复开页**：用户从 `/welcome` 去商店安装时，`/welcome` 标签页还开着；background 先用 `chrome.tabs.query({ url: '${uiOrigin}/welcome*' })` 找它（构建出的 manifest 对 enx-ui origin 有 host 权限，可以按 URL 查），找到就切回那个标签页并聚焦窗口，不另开新页；找不到才新开。`/welcome` 也允许用户直接访问（官网、Home 清单都链过去），且**不登录也能打开**（放在 `(app)` 布局之外，或该布局对它放行）。
1a. **老用户不看引导**：扩展卸载时本地存储全部清除，重装 / 换电脑后扩展无法知道「这是老用户」，所以判断放在 `/welcome` 上、按账号做：
   - **已完成标记**：adr-044 的服务端偏好加一个布尔键 `onboardingCompleted`（与 `aiWordFallbackNoticeAck` 同类，用户不可在设置里编辑）。引导到达完成态、或用户点「Skip setup」时写入 true。
   - **既有用户不需要迁移**：`onboardingCompleted` 为真，**或**累计查词数 > 0，都视为老用户。
   - **已登录、经安装进入 `/welcome?src=install`**（同一浏览器重装时网站登录态还在）：老用户直接跳到 `/app`，带一句「Catglish extension connected」，不显示步骤。
   - **未登录进入 `/welcome`**（换电脑）：页面先只显示「Welcome to Catglish — sign in to get started」。这一屏对新老用户都成立，老用户本来也必须重新登录扩展；登录回跳后按上一条判断，老用户直接去 `/app`。
   - 因此老用户最多看到一次本来就需要的登录页，看不到任何引导步骤。
   - 判断不了的情况（例如用户换电脑后不登录、直接关掉）就让引导出现一次：这种情况概率低，代价只是多看一页。**每一步都显示「Skip setup」**，点了即写入 `onboardingCompleted`（已登录时）并去 `/app`。
2. **步骤**（全部按真实状态显示勾选，不按顺序锁定；文案全英文）：
   0. **安装扩展**（只在探测到未安装时出现）：「Add to Chrome」按钮在新标签页打开 Chrome Web Store。链接取现有的运行时配置 `ENX_EXTENSION_WEB_STORE_URL`；扩展上架前它为空，按钮显示为不可点的「Coming soon to the Chrome Web Store」（与 `OnboardingChecklist` 现有的空链接处理一致），上架后填上配置即可，不改代码。页面可见时每 2 秒发一次 `enx:status`，探测到安装后自动勾上（同时扩展会把用户切回这个标签页，见 Decision 1）。非 Chromium 浏览器给出「Catglish needs Chrome」说明。安装过程本身由商店页面完成，不需要截图或视频；产品演示视频已在官网首页。
   1. **登录**：已登录则勾上；未登录时给 Sign in / Sign up，登录回跳回到 `/welcome`（沿用 adr-020 的 `src=extension` 回跳机制，目标改成 `/welcome`）。
   2. **固定图标**（可跳过）：一张示意图，展示「点拼图图标 → 点 Catglish 旁的图钉」（静态图片，用本地构建的扩展截取，放在 enx-ui 的 `public/` 下）。页面在这一步可见时每 2 秒经 `enx:status` 查询 `isOnToolbar`，固定后自动勾上；进来时已固定（包括被 Chrome 自动固定的用户）则直接是勾上的。点「Skip」直接进入下一步；跳过的人之后由 adr-046 Decision 6 的固定提示最多再提醒两次，本 ADR 不另做计数。
   3. **在示例文章上试一次**：`/welcome` 页内直接渲染示例文章（与 `/reader/sample` 同一份 `SAMPLE_ARTICLE`，容器同为 `#enx-reader-article`），**不调用 `requestReaderMode()`**。两个小项：
      - **启用**：提示「Click the Catglish icon in your toolbar, then *Read with Catglish*」。扩展启用学习模式后在 `<html>` 上写 `data-enx-learning="on"`（Decision 4a），页面观察到即勾上，提示换成下一项。
      - **点一个词**：提示「Click any word in the article」。累计查词数 > 0 即勾上（现有 stats 接口；页面可见时每几秒重查一次，直到勾上）。
      - 用户未登录扩展时点「Read with Catglish」会得到扩展自己的登录提示；第 1 步本来就在前面，不另做处理。
3. **完成**：第 3 步两项都勾上后写入 `onboardingCompleted`，显示「You're all set」，然后放手：
   - 一句话：在任意英文文章页点 Catglish 图标 →「Read with Catglish」即可。
   - **推荐站点**：一组可以马上去读的英文站点链接（新标签页打开）。清单写在 enx-ui 一个常量里，按需增删；入选条件是**免登录、无付费墙、正文结构普通、实测学习模式可用**。初始候选：InfoQ（infoq.com）、Anthropic News（anthropic.com/news）、BBC News、The Guardian、AP News、NPR、Wikipedia（扩展有专门适配器）。实现时逐个在真实 Chrome 里验证，不能用的移出清单。
   - 不介绍侧边栏、角标、「Always enable on this site」：这些留给用户自己发现，或写进日后的帮助文档。
   - 之后用户**主动**打开 `/welcome`（不带 `src=install`）时直接显示完成态，示例文章仍可在页内试用。
4. **新的网页 → 扩展消息 `enx:status`**：返回 `{ ok, version, isOnToolbar }`。与 `enx:ping` 一样只认 `ENX_UI_ORIGINS` 来源，只读，不改任何状态。登录状态由网页自己的 Clerk 得出，不经扩展。`enx:ping` 保留不动（Home、`/reader` 在用）。
4a. **学习模式状态标记 `data-enx-learning`**：与 adr-019 的 `data-enx-extension` 版本戳同一机制、同一限制（只在 enx-ui 页面上写）：content script 在本页学习模式启用成功后写 `<html data-enx-learning="on">`，关闭（`enxStop`）时移除。只是给 enx-ui 页面看的只读信号，不参与扩展内部逻辑。
5. **自动启用由页面决定，不由 URL 决定**：enx-ui 上的学习模式自动启用一直是页面主动发 `enx:enable-reader`（adr-019）。`/reader` 提交后与 `/reader/sample` 保持自动启用；`/welcome` 不发。Reader 适配器（`siteAdapters.ts` 的 `pageSupport`）现在只放行 `/reader` 与 `/reader/*`，需加上 `/welcome`。
6. **与 Home 清单的关系**：adr-027 的 `OnboardingChecklist` 与 `/welcome` 共用一个步骤模型（`onboardingSteps({ installed, signedIn, isOnToolbar, pinSkipped, learningEnabled, hasLookedUp })` 纯函数，放 `src/lib/onboarding.ts`）。Home 清单是同一套步骤的精简版（零阅读用户在 Home 上看到，点任一步跳 `/welcome`）；它现在第 3 步链接的是 `/reader` 粘贴页，改为指向 `/welcome`。文案只写一份。
7. **不做的事**：不选母语；不演示侧边栏整句翻译；不做角标图例；不做产品导览式的页面遮罩高亮；不收集引导漏斗指标（需要时按 adr-040 再加）；不做 `setUninstallURL` 的卸载反馈页；不在引导里设置词汇水平或高亮偏好；不放视频（官网首页已有）。
8. **示例文章是 enx-ui 内置的固定公开文章**（2026-10-13 修订）：
   - 正文是写在 enx-ui 代码里的一篇英文短文（`src/lib/sampleArticle.ts`，约 200 词，大众话题，几个中等难度的词，并自然带上撇号词、连字符词、句首大写词和多个段落，方便同时当测试素材）。全站只有这一篇。
   - 两处渲染：独立页 `/reader/sample`（自动启用，给 `/reader` 的「Try a sample」和 `task dev:verify` 用），以及 `/welcome` 页内（不自动启用，Decision 2 第 3 步）。两处结构都与 `/reader` 的阅读态相同（`#enx-reader-article`）。
   - **不登录也能看**：都放在 `(app)` 布局之外。查词仍要登录扩展，那是扩展自己的提示。
   - **不写后端**：不创建 Reader 文档，所以不受 adr-022 的 7 天删除影响，也不占「My Documents」的名额。
   - 否决的替代：让用户把 N 篇 Reader 文档标为永久保留——那是另一个面向用户的功能（配额、存储、UI），而且内容存在数据库里、各环境不同，做不到「固定、跟代码一起版本化」。

## 实现要点（给实现者 / AFK agent）

- enx-chrome：
  - `background.ts` 的 `onInstalled` 在 `install` 时打开或切回 `/welcome?src=install`（Decision 1）；`onMessageExternal` 加 `enx:status`（`getUserSettings()` 取 `isOnToolbar`）。把「找已有 `/welcome` 标签页还是新开」写成纯函数放 `src/lib/`，background 只做接线。
  - content script：学习模式启用 / 关闭时写 / 删 `data-enx-learning`，与 `extensionPresence.ts` 同处，只在 `isEnxUiHost` 上生效。
  - `siteAdapters.ts`：Reader 适配器的 `pageSupport` 放行 `/welcome`。
  - 单测：`install` 且没有 `/welcome` 标签页时新开、已有时切回不新开，`update` 不打开；`enx:status` 只响应 `ENX_UI_ORIGINS`、返回 `isOnToolbar`；`data-enx-learning` 启用后出现、关闭后消失、非 enx-ui 页面不写；`/welcome` 被 Reader 适配器判为支持。
- enx-api：`preferences` 注册表加 `onboardingCompleted`（布尔，默认 false，不可在设置页编辑）；单测覆盖默认值与写入。
- enx-ui：
  - 公开路由 `/welcome`（未登录必须能看到第 1 步）；`src/lib/enxExtension.ts` 加 `extensionStatus()`；`src/lib/onboarding.ts` 放 `onboardingSteps` 纯函数，`OnboardingChecklist` 改用它并链到 `/welcome`；推荐站点常量；固定图标示意图放 `public/`。
  - 单测：`onboardingSteps` 各状态组合；`/welcome` 不发 `enx:enable-reader`；`data-enx-learning` 出现后第 3 步「启用」勾上；已登录 + 已固定 + 已查词时直接显示完成态；固定步骤可跳过；`extensionStatus` 超时返回未安装；老用户经 `src=install` 进入跳 `/app`；商店链接为空时安装按钮不可点。
- e2e（adr-037 / enx-ui e2e）：已登录用户打开 `/welcome` 看到第 1 步已勾；未登录打开 `/welcome` 看到登录入口和示例文章；未登录打开 `/reader/sample` 直接看到文章正文，不跳登录页。
- **人工验证项**：真实 Chrome 中全新安装扩展 → 自动打开 `/welcome` → 登录回跳回 `/welcome` → 固定图标后第 2 步自动勾上 → 点图标「Read with Catglish」，角标 `…` → `✓`、第 3 步「启用」勾上 → 点词出释义 → 完成页出现推荐站点；推荐站点逐个可用。

## Consequences

- 从商店直接安装的用户第一次有了明确的下一步，不再落在一个什么都没发生的浏览器里。
- 用户在引导里亲手点过一次图标，换到真实网站上知道怎么开学习模式。
- 引导依赖网络和 enx-ui；enx-ui 不可达时安装后打开的是错误页。可接受：没有 enx-api/enx-ui，扩展本来也用不了。
- 侧边栏整句翻译、角标含义、站点「总是启用」没有在引导里教，靠用户自己发现；若内测反馈说找不到，再加帮助文档或完成页提示。
- 推荐站点会改版、加付费墙；清单要偶尔复查，失效就移除。
- 扩展上架前，从网站进来的新用户卡在第 0 步（没有安装链接）；内测期间由邀请消息另给安装方式。
