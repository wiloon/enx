# ADR-042：移动端 Phase 1 —— 仅 iOS 原生；收藏 → WebView → 用户触发只读抽正文 → TextKit 原生阅读视图点击查词（不用 RN / Capacitor 主路径；不做移动浏览器扩展；服务端不存正文；App 内无付费引导）

| 字段 | 值 |
| --- | --- |
| **状态** | **Proposed — 2026-09-30**（Decision 与原 Open Questions 均已按用户拍板写死；**仍待用户明确 Accept** 后再改 Accepted）。在用户 Accept 之前，**不以本 ADR 启动编码或改仓库实现**。Accept 后以 Decision 为实现依据（同 adr-012 Decision 10 / adr-034），**不要求**先写 `TASK-SPEC`。 |
| **日期** | 2026-09-30 |
| **关联 Spec** | 无。本 ADR 即 Phase 1 产品与技术边界；编码走 domain-modeling / TDD，不强制配套 TASK-SPEC（见 `docs/agents/domain.md` §ADR vs TASK-SPEC）。 |
| **关联清单** | **iOS 提审硬前置**：账号删除（Web + App 均可发起，级联 `saved_pages` / `page_reports` / reader 文档 / 配额行 / Clerk 用户等）——对齐 adr-032 关联清单里已欠的前置；App Store 隐私标签 / Privacy Manifest；`docs/tasks/LAUNCH-CHECKLIST.md` 隐私政策与服务条款须补 iOS（本机正文缓存、WebView Cookie 仅在设备）。**Clerk**：Native API + iOS App 登记（Team ID + Bundle ID）+ 开启 Sign in with Apple（网页与 App 均提供）。 |
| **关联 ADR** | [`adr-032-saved-pages-and-no-passive-reading-history.md`](adr-032-saved-pages-and-no-passive-reading-history.md)（收藏只存 URL+标题；Decision 5 预留「移动端 WebView + 本机抽文本」——本 ADR 把载体锁成 iOS 原生并补全产品流。**收窄其 Decision 4**：Phase 1 **不做**移动端系统分享菜单；App **无**收藏写入口，收藏只在桌面扩展完成，见本文 Decision 5。注：adr-032 文首「关联代码 / 待实现」已过期——api 与扩展收藏已落地，见本文关联代码）、[`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) / [`adr-022-enx-ui-reader-persistence-and-retention.md`](adr-022-enx-ui-reader-persistence-and-retention.md)（桌面 Reader 把查词交给扩展；移动端无扩展，由原生阅读视图承接点击查词）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（Clerk JWT → 本地 `users.Id`；本 ADR 在 iOS 复用同一合同，并新增 Sign in with Apple）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md) / [`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（查词计量与时区头）、[`adr-034-site-support-on-demand-injection-and-generic-content-detection.md`](adr-034-site-support-on-demand-injection-and-generic-content-detection.md)（扩展侧因需保留原 DOM **不**整库引入 Readability.js；iOS 抽到独立原生视图，前提不同，**允许**引入 Readability 类库）、[`adr-035-global-and-china-editions-dual-deployment.md`](adr-035-global-and-china-editions-dual-deployment.md) / [`adr-036-china-edition-authentication-logto.md`](adr-036-china-edition-authentication-logto.md)（**均为 Proposed**；Phase 1 **不上**中国大陆区，海外版 Clerk，见 Decision 9） |
| **关联代码** | **iOS 客户端：待实现（Accept 之后）。** 预期落点：新建 `enx-ios/`（与 `enx-chrome` / `enx-ui` / `enx-api` 并列；Swift / SwiftUI 或团队惯用 iOS 栈，本 ADR 不锁 UIKit vs SwiftUI）。**已实现（收藏数据面）**：enx-api `/api/saved-pages*`（`savedpage/`、`urlnorm/`，PR #61）；enx-chrome popup「Save this page」（`pageSave.ts` / `PageSavePrompt.tsx`）。**未实现**：enx-ui Saved 页（仍属 adr-032 Decision 4）。`GET /api/saved-pages` 无分页（上限 1000 条一次返回），对 iOS Phase 1 足够。查词：`GET /api/word/:word` → `dictionary.Service.Resolve`（adr-018）。认证：Clerk session JWT（adr-015）。**不**新增「上传全文」类 API。 |

---

## Context

### 这个 ADR 是怎么来的

ADR-032 锁定「收藏 = URL + 标题、服务端不存正文」，并把移动端续读写成：App 内 WebView 打开 URL，在设备上抽文本，再走现有查词接口。当时「移动端」另行立项。

2026-09-30 产品侧锁死了 Phase 1 的技术载体与交互形状，并在审阅后补齐注入边界、原生渲染载体、App Store 硬约束与 WebView 登录现实：

1. 不用 React Native；Capacitor / 跨端 Web 壳不作 App 主路径。
2. 长期仍是 iOS + Android **双原生**，但 **Phase 1 只做 iOS**；Android 不进第一阶段。
3. 产品流：桌面 Chrome 扩展收藏（仅 URL+标题）→ iOS 收藏列表 → WebView 打开 → **用户点击按钮**触发只读抽正文 → **TextKit / UITextView 原生阅读视图**内点击查词（禁止为点词做交互式 DOM 注入；禁止用本地 WebView 渲染抽出的正文）。
4. 认证：Clerk iOS SDK，复用现有 enx-api JWT 合同；**Sign in with Apple** 在 enx-ui 与 iOS App 均提供。
5. 不做移动浏览器扩展战略；桌面仍以 `enx-chrome` 为主。
6. 服务端不存正文（对齐 adr-032）。
7. App 内**无**升级提示与外部购买引导；StoreKit 内购 Phase 1 不做。
8. 账号删除（Web + 移动）为 iOS 提审硬前置。
9. Phase 1 **不上**中国大陆区；**不做**系统分享写入口（收窄 adr-032 Decision 4）；抽正文失败**不**做选中/粘贴降级。

这些决定难以反悔（原生工程与商店身份、与扩展的分工边界、版权边界、审核条款），且与「先做响应式 / Capacitor 壳」的旧假设相反，需要单独 ADR 写清否决项。

### 现状（以 2026-09-30 的仓库为准）

- 客户端只有 `enx-chrome`（桌面 Chromium 扩展）与 `enx-ui`（Web）；**无** `enx-ios` / Android / Capacitor / RN 工程。
- 桌面核心价值是「在别人的网页上」学习模式 + 点击查词（content script）。移动端无法对等复制这条注入路径，也不追求系统浏览器扩展。
- enx-ui Reader（adr-019）刻意把查词交给扩展；无扩展时没有完整点词体验——移动 App 必须自建查词 UI。
- 收藏：api + 扩展已落地；enx-ui Saved 页尚未做（adr-032 文首「待实现」表述过期，以本文关联代码为准）。
- 认证：Clerk JWT → 本地 `users.Id`（UUID）。CORS 只约束浏览器；原生 `URLSession` 不带 `Origin`。`azp` 校验为「缺省放行，有则比对 `clerk.authorized-parties`」。
- 查词超额 429 文案目前含「Upgrade to Catglish Pro…」（`dictionary/lookup.go`），**不可**原样展示在 iOS App 内（见 Decision 7）。
- 仓库尚无账号删除端点（adr-032 已列为硬前置）。
- `enx-sync` 已暂停维护；移动设计忽略 P2P。

### 术语（本 ADR 行文）

- 中文统一称「**收藏**」，英文 `saved` / `saved-pages`（见 `CONTEXT.md`、adr-032）。
- 桌面扩展交互仍叫 **学习模式** / **点击查词**；**不要**把移动端原生阅读视图叫成学习模式。
- 移动端抽取正文后的界面叫 **原生阅读视图**（见 `CONTEXT.md`）：原生文本渲染 + 原生层高亮与点击查词。口头「进阅读模式」即指用户触发抽取并进入该视图。

---

## Options Considered

### A. App 技术载体

| 方案 | 结论 |
| --- | --- |
| A1. React Native / Flutter 跨端 | **否决。** 点击查词与正文排版是强原生交互；跨端既要大量原生桥接 WebView / 文本选区，又摊薄 iOS 打磨时间；与「长期双原生」目标最终仍要写两套原生能力，中间多一层抽象。 |
| A2. Capacitor / Cordova 包装 enx-ui（或假想的移动 Web 阅读页）作主路径 | **否决作主路径。** 壳只解决「能上架」，不解决「抽正文 + 原生点词」；最终仍要落到原生层。允许将来用 Web 技术做**非阅读主路径**的辅助页（账户等），但不作为阅读助手载体；**不**在 App 内嵌定价 / 购买引导页（见 Decision 7）。 |
| A3. 响应式 enx-ui / PWA 当移动 MVP | **否决作阅读主路径。** 可作账户 / Lookup 等触控验证面（低成本），但不能替代「WebView 打开第三方页 → 抽正文 → 原生点击查词」。 |
| **A4.（采用）原生 App；Phase 1 仅 iOS** | 与锁定产品流同构；Android 留作长期双原生的下一阶段，不并行进 Phase 1。 |

### B. Phase 1 是否含 Android

| 方案 | 结论 |
| --- | --- |
| B1. Phase 1 同步开 iOS + Android 双原生 | **否决。** 双端并行会把「验证阅读闭环」稀释成「两套工程脚手架」。 |
| B2. Phase 1 用 RN「先双端再换原生」 | **否决**（同 A1）；且与「不用 RN」锁定冲突。 |
| **B3.（采用）Phase 1 = iOS only；Android 另阶段再开** | 长期目标仍是双原生，不在本文改口为「永远不做 Android」。 |

### C. WebView 注入与点击查词发生在哪里

| 方案 | 结论 |
| --- | --- |
| C1. 在打开第三方页的 WebView 内注入 **交互式** JS（模拟 content script：点词监听、高亮、查词 UI） | **否决。** 会把移动端拖回「扩展注入」模型；第三方 DOM / CSP / 登录墙摩擦大；与「原生 UI 点击查词」锁定冲突。**注意**：否决的是**交互式**注入，不是一切脚本——只读抽正文见 C3。 |
| C2. WebView 内叠加原生透明命中层，仍对着网页排版点词 | **否决。** 坐标映射 / 重排 / 缩放失败模式多；收益只是「看起来还在原页上点」。 |
| C2b. 抽出 HTML 后用**本地** `WKWebView`（`loadHTMLString`）渲染正文，再在其上或旁挂点词 | **否决。** 用户已拍板：正文用原生文本渲染；不以本地 WebView 承载阅读视图。 |
| **C3.（采用）允许只读抽正文脚本 + 原生阅读视图内点词** | 向加载第三方页的 `WKWebView` 注入**只读**抽取脚本（如 Readability，放在**隔离 content world**），由**用户点击按钮**触发，不自动跑；脚本只读 DOM、返回正文结构，**禁止**在该 WebView 内渲染任何 ENX UI、禁止为高亮 / 点词挂交互监听。抽出的正文用 **TextKit 2 / `UITextView`（或等价原生文本控件）** 渲染；高亮与点击查词只在原生层。与 adr-032 Decision 5「设备上抽取文本」一致；与 adr-034「扩展不整库引入 Readability」不冲突（扩展要留在原 DOM，iOS 要离开原 DOM）。 |

### D. Phase 1 的 URL 入口范围

| 方案 | 结论 |
| --- | --- |
| D1. 系统分享 / 剪贴板 / 精选库 / 收藏列表**全部作为 Phase 1 必达** | **否决作 Phase 1 必达包。** 入口过多会拖住主闭环验证。 |
| D2. 仅系统分享进 App，不做收藏列表 | **否决作 Phase 1 主路径。** 跨设备续读的数据面是 adr-032 的 `saved-pages`；桌面已收藏、手机打开，才是锁定叙事。 |
| **D3.（采用）Phase 1 主路径 = 桌面扩展收藏 → iOS 只读收藏列表 → 打开** | **收窄 adr-032 Decision 4**：Phase 1 **不做**系统分享入口；App **无**收藏写入口，收藏只在桌面扩展完成。精选库等另议。 |

### E. 移动浏览器扩展战略

| 方案 | 结论 |
| --- | --- |
| E1. 以 Safari / Android Chrome 扩展对等桌面「任意网页点词」 | **否决。** 能力与分发均不构成可依赖主战略；桌面继续 `enx-chrome`。 |
| **E2.（采用）不做移动浏览器扩展战略** | 移动阅读助手 = 原生 App；桌面阅读助手 = 扩展。 |

### F. 正文存哪里

| 方案 | 结论 |
| --- | --- |
| F1. 服务端存正文或译文供 App 拉取 | **否决。** 对齐 adr-032 Options B2/B3。 |
| F2. 服务端代抓 URL 取正文 | **否决。** adr-032 已禁止服务端主动抓 URL。 |
| **F3.（采用）只在本机抽正文；服务端仅 URL+标题** | 可选本机离线缓存（adr-032 B4），永不上传正文。 |

### H. 抽正文失败时怎么办

| 方案 | 结论 |
| --- | --- |
| H1. WebView 选中文字 →「在阅读视图中打开选中内容」 | **否决（Phase 1）。** |
| H2. 粘贴纯文本进入原生阅读视图 | **否决（Phase 1）。** |
| **H3.（采用）直接提示失败** | 保留 WebView 可读 + 明确失败文案；不进入原生阅读视图；**不**上传正文。 |

### G. App 内付费

| 方案 | 结论 |
| --- | --- |
| G1. App 内引导到 Stripe / 网站升级 | **否决（Phase 1）。** 触犯 App Store Guideline 3.1.1 / 3.1.3 外链购买风险；ENX 亦不构成 3.1.3(a) reader app。 |
| G2. Phase 1 上 StoreKit 内购并与 Stripe 权益同步 | **否决作 Phase 1。** 列为**后续选项**：须另立 ADR，写清 Apple 分成、收据校验、与现有 Stripe 订阅 / 积分的双向同步与对账代价。 |
| **G3.（采用）Phase 1 App 内零购买入口、零升级引导** | 配额不足只提示「配额不足」（或等价中性文案）；已在 Web 订阅的用户在 App 内静默享受权益。429 文案须按客户端区分或由 App 使用本地文案（见 Decision 7）。 |

---

## Decision

### 1. Phase 1 载体：仅 iOS 原生；不用 RN；Capacitor 不作主路径

- 新建顶层工程 **`enx-ios/`**（名称与现有 `enx-*` 并列；Accept 后立项时若需微调目录名，以仓库惯例小改，不另开 ADR）。App Store 显示名 / Bundle ID 随产品品牌（Catglish）另定，不在本 ADR 锁死。
- **不做** React Native / Flutter 客户端。
- **不做** 以 Capacitor / Cordova 包装 Web 作为阅读助手主路径。
- **长期**仍计划 Android 原生（Kotlin 等），**不进入 Phase 1**；开 Android 时另立阶段 / ADR，默认仍原生而非回头选 RN。

### 2. Phase 1 产品流（主路径）

1. 用户在桌面用 `enx-chrome` **收藏**当前页（adr-032：仅规范化 URL + 标题）。
2. iOS App 拉取同一用户的 **收藏列表**（`GET /api/saved-pages`）。
3. 用户点开一条：App 内 **WKWebView** 加载该 URL。WebView 使用 App 自己的持久化网站数据（如 `WKWebsiteDataStore.default()`）。产品接受的站点打开方式是：**只读公开站点，或用户在该 WebView 内单独登录**——**不是**「沿用 Safari 已有登录态」。已知限制（**不做规避**）：与 Safari **不共享** Cookie / 登录态；依赖 Google 登录的站点在内嵌 WebView 中会被拒（`disallowed_useragent`），这类站点在 App 内基本登不上。
4. WebView 加载完成后显示「进入阅读视图」（或等价）按钮；**仅当用户点击**时，向该 WebView 注入**只读**抽正文脚本（如 Readability，**隔离 content world**），在本机得到正文结构。服务端不持有、不接收全文。抽取失败、结果过短或判为非正文时：按 Options H3 **直接提示失败**，保留 WebView 可读；**不做**「选中文字送入阅读视图」「粘贴文本」等降级（具体「过短」阈值实现期用样本定）。
5. 仅抽取成功时进入 **原生阅读视图**：用 **TextKit 2 / `UITextView`（或等价原生文本控件）** 渲染抽出的正文；**高亮与点击查词只在原生层**。禁止用本地 `WKWebView`（`loadHTMLString` 等）渲染该正文；禁止在第三方页 WebView 内做点击查词、高亮或渲染任何 ENX UI。
6. 查词请求走现有 enx-api 合同（见 Decision 2a）；只上传词或（若后续做划词）用户选中的片段，不上传文章全文。

### 2a. 查词计量、错误展示与统计（Phase 1）

- **必达**：点击查词走 `GET /api/word/:word` → `dictionary.Service.Resolve`（adr-018）；计入每日查词配额（adr-029），并经 `RecordWordLookup` 递增复习计数，与桌面同一口径。
- 客户端须发 **`X-Enx-Tz-Offset`**（adr-029 Decision 7a），否则按 UTC 日计数。
- 每次请求用 Clerk iOS SDK `getToken()` 取短期 session token，放 `Authorization: Bearer …`。
- **HTTP 展示**：429（配额）在 App 内只显示中性「配额不足」（或等价），**不得**展示含 Upgrade / 外链购买的文案——可由 enx-api 按客户端区分（例如请求头 `X-Enx-Client: ios`）返回不同 `message`，或由 App **忽略**服务端营销文案、改用本地字符串。402（积分）/ 503（词典不可用）同样不得夹带付费引导。
- **Phase 1 不做**：AI 类接口（`/api/translate/word-in-context`、`sentence-with-word` 等，adr-014 token 计费）；阅读统计上报 `/api/stats/ingest`（adr-028）——二者留到后续迭代。

### 3. 认证

- Phase 1 使用 **Clerk iOS SDK** 登录（海外版 Clerk 实例）。
- enx-api 继续验 Clerk session JWT，映射到本地用户身份（`users.Id`）；**不**为移动端另发明一套 session。
- **Sign in with Apple**：在 Clerk 开启 Apple social connection；**enx-ui 与 iOS App 都提供**该入口（网页登录选项会一并出现）。注意 Apple「隐藏邮箱」中继地址对按邮箱操作的管理接口（如 `/api/admin/credits/grant`）的影响，实现期核对。
- **CORS**：不适用于原生 `URLSession`，Phase 1 **不必**为 iOS 改 CORS。`azp`：缺省即放行；若 Clerk iOS SDK 签发的 token **带** `azp`，把该值加入 `CLERK_AUTHORIZED_PARTIES`。真正要做的是 Clerk 侧：开启 Native API、登记 iOS App（Team ID + Bundle ID），生产实例清单见 `docs/tasks/TASK-SPEC-enx-clerk-production-cutover.md`。
- 国内版 IdP（adr-035/036，**均为 Proposed**）与中国大陆区上架见 Decision 9；不在 Phase 1 另造第三套用户模型。

### 4. 桌面与移动的分工

- **桌面**阅读助手主路径仍是 `enx-chrome`（学习模式 + 点击查词）；**收藏写入**也只在桌面扩展完成（Phase 1）。
- **移动**不做浏览器扩展战略，不对外承诺与桌面「任意网页注入点词」对等。
- enx-ui 继续承担账户、Billing（**Web 上**）等；**Saved 管理**待 adr-032 的 enx-ui Saved 页落地后承担。enx-ui **不是** Phase 1 移动阅读主路径。

### 5. 服务端与收藏边界（继承 adr-032；收窄其 Decision 4）

- 服务端**不存**正文、**不存**译文、**不**代抓 URL。
- 收藏数据与桌面共用 `saved-pages`；Phase 1 iOS App **只读**列表（`GET`），**没有**收藏写入口（无系统分享、无 App 内 Save）。**明确收窄 adr-032 Decision 4**：该条把「移动端系统分享菜单」列为收藏显式入口之一——Phase 1 **不做**；收藏只在桌面 `enx-chrome` 完成后再到 App 打开。
- 本机可按 adr-032 Options B4 做离线正文缓存；缓存不得上传；**排除 iCloud 备份**；登出 ENX 时清除；设置里提供一键清除网站数据与正文缓存。登出时是否同时清 WebView 网站数据：默认**清除**（实现期可做成设置项，默认开）。

### 6. 明确不做（Phase 1 / 本 ADR 范围）

- React Native / Flutter；Capacitor 主壳。
- Phase 1 内的 Android 工程与上架。
- 中国大陆区 App Store 上架、ICP 备案、国内版 IdP（见 Decision 9）。
- 移动浏览器扩展战略。
- 系统分享 / App 内收藏写入（收窄 adr-032 Decision 4）。
- 抽正文失败后的选中文字送入阅读视图、粘贴文本等降级（Options H1/H2）。
- 在第三方页 WebView 内做点击查词 / 高亮 / 渲染 ENX UI（只读抽正文脚本除外，见 Decision 2）。
- 用本地 WebView 渲染抽出的正文。
- 服务端全文 / 译文存储；「上传全文」API。
- App 内任何购买入口、升级提示、外链购买引导；StoreKit 内购（后续另 ADR）。
- Phase 1 的 AI 划词 / 上下文翻译与 `/api/stats/ingest`。
- 为移动端复活 `enx-sync` / P2P。
- 以本 ADR 为由要求先写 `TASK-SPEC`（不需要）。

### 7. App Store 上架约束（Phase 1）

- **付费（Guideline 3.1.1 / 3.1.3）**：按 Decision G3 / 2a——App 内零购买、零升级引导；多平台订阅权益在 App 内静默生效。
- **Sign in with Apple（Guideline 4.8）**：见 Decision 3。
- **账号删除（Guideline 5.1.1(v)）**：**Web 与移动端都要能发起**；级联清理业务数据与 Clerk 用户。此为 **iOS 提审硬前置**（对齐 adr-032 关联清单；今日仓库尚未实现，须在提审前补齐端点与 UI）。
- 隐私标签 / Privacy Manifest / 隐私政策补 iOS 本机缓存与 WebView Cookie 表述，见关联清单。
- **上架地区**：见 Decision 9（不含中国大陆区）。

### 8. Phase 1 完成定义（验收口径）

事先登记样本与门槛（参照 adr-030「测之前定死阈值」的精神；具体数字 Accept 前可在实现 issue 里填，但类别如下不可缺）：

1. **样本站点**：至少覆盖 adr-034 Context 中扩展原支持的静态文章站若干 + 1–2 个公开页；登录墙 / 付费墙站点单独标注「仅验证 WebView 打开与失败提示，不计入抽取成功率」。
2. **抽取成功路径**：用户点击触发后，在样本公开页上达到事先登记的成功率门槛；过短 / 非正文计为失败。
3. **抽取失败路径**：对至少一条故意失败样本，App **只**展示失败提示并保留 WebView 可读；**不**出现选中送入阅读视图 / 粘贴文本等降级入口。
4. **端到端**：桌面扩展收藏 → iOS 列表出现同一条（App 侧无写收藏动作）→ 打开 WebView → 进入原生阅读视图 → 点击查词返回释义且计入配额 → 超额时 App 内仅见中性「配额不足」、无升级引导。
5. **认证与地区**：Clerk 登录（含 Sign in with Apple）成功拿到可验签 JWT；账号删除路径在提审前可用；上架配置不含中国大陆区。

### 9. Phase 1 不上中国大陆区

- Phase 1 只面向**非中国大陆** App Store 区；使用**海外版** Clerk。
- **ICP 备案、国内版部署 / Logto（adr-035/036）不在 Phase 1 范围**；若日后要上大陆区，另立 ADR / 阶段，不 silently 扩本 ADR。

---

## Rationale

- **原生而非壳 / RN**：Phase 1 要验证的是「抽正文 + 原生点击查词」闭环，不是「把现有 Web 塞进商店」。
- **先 iOS 后 Android**：双端并行会让第一阶段变成脚手架竞赛。
- **只读注入 ≠ 交互注入**：本机抽正文在 iOS 上现实路径就是对第三方页 WebView 跑抽取脚本；把边界画在「只读 + 用户手势 + 隔离 world」上，既让 Decision 可实现，又不滑回扩展模型。
- **TextKit 而非本地 WebView 渲染**：高亮与点词命中落在原生文本系统上，避免「阅读视图仍是 WebView」的灰色地带。
- **查词离开第三方页 DOM**：稳定排版与系统字体在原生侧更可控；WebView 只负责打开原站（公开只读或用户在 App 内另登）。
- **WebView 登录现实写进 Decision**：避免实现者误以为能复用 Safari 订阅 Cookie；Google 内嵌登录被拒是平台限制，不在 Phase 1 做 UA 伪装等规避。
- **App 内零付费引导**：用最小合规面先上架验证阅读闭环；StoreKit + Stripe 双账本成本高，留给专门 ADR。
- **Sign in with Apple 网页一并开**：满足 4.8 的同时避免「仅 App 有 Apple、网页没有」的身份分裂；隐藏邮箱副作用在管理接口侧消化。
- **账号删除硬前置**：审核条款 + adr-032 已要求的数据义务，不能再欠到上架当天。
- **不要求 TASK-SPEC**：决策面已可编码；细节用 TDD 与实现期 issue（`docs/agents/domain.md`）。

---

## Consequences

### Positive

- 移动与桌面分工清晰：扩展管桌面原页点词，App 管原生阅读视图点词。
- 版权与隐私边界与 adr-032 一致；只读抽正文不扩大服务端持有面。
- 注入 / 渲染 / 审核边界可验收，降低实现期争吵成本。
- Phase 1 范围可交付：一条主路径，一个平台，一套认证，零 IAP。

### Negative

- 需从零建 `enx-ios/`、商店账号与 CI；短期无 Android 客户端。
- 公开页以外，用户须在 WebView 内重新登录；Google OAuth 站点基本不可登；付费墙体验弱于「Safari 已登录」。
- 桌面与移动查词 UI 两套实现。
- 账号删除与 Sign in with Apple 会波及 enx-api / enx-ui，不只是 App 工程。
- 抽正文失败时，若无降级（见 Open Questions），用户在 App 内可能暂时无法点词。

### Mitigation

- 抽正文失败：至少保留 WebView 可读 + 明确「无法进入原生阅读视图」提示；进一步降级见 Open Questions，**不**改为服务端存正文。
- 设置页提供「清除网站数据」；登出默认清 WebView 数据与正文缓存。
- Android 在 iOS 主路径验证后再立项。
- 429 等文案在 api 或客户端侧按 Decision 2a 处理，提审前用真机配额打满验收。

---

## Out of Scope（本次不做）

- Android 工程、上架与 CI。
- 正文抽取库的最终选型细节与「过短」字数阈值（实现期用样本定；**允许**在 iOS 整库引入 Readability 类实现，与 adr-034 扩展侧决定前提不同）。
- UIKit vs SwiftUI 导航与设计系统；iOS 查词 UI 的最终组件命名（不称「查词浮层」）。
- 划词整句翻译、单词高亮档位、生词本复习在 iOS 上的完整对等（Phase 1 以点击查词闭环为必达）。
- StoreKit 内购与 Stripe 权益同步（后续 ADR）。
- 国内版 App 登录与中国大陆区上架（Open Questions / adr-035·036）。
- enx-ui 无扩展时的 Web 内点词（adr-019 Revisit）。
- iOS 是否展示 adr-022 的 Reader「我的文档」（`/api/reader/documents`）——不做进 Phase 1 主路径。
- App Store 显示名与 Bundle ID 的最终字符串。

---

## Open Questions（尚未拍板，实现前须用户确认）

1. **是否上中国大陆区 App Store？** 涉及 ICP 备案、Clerk 在大陆可用性，以及与 Proposed 的 adr-035/036 关系。未拍板前，本文**不**假定上架地区名单。
2. **抽正文失败的降级**是否采用、采用哪一种（可多选）：(a) 在 WebView 中选中文字 → 原生菜单「在阅读视图中打开选中内容」；(b) 粘贴纯文本进入原生阅读视图。二者仍是本机、不上传全文，与 F3 一致；**本文不预选**。
3. **系统分享入口 Phase 1 是否必做？** adr-032 Decision 4 将「移动端系统分享菜单」写为收藏的显式入口之一；本文 Options D3 把 Phase 1 **主路径**定为桌面扩展收藏 → iOS 列表只读打开。若分享不做，则 Phase 1 iOS **可能没有任何收藏写入口**（只读列表）——这是对 adr-032 Decision 4 的**收窄**，须显式拍板：必做 / 可延期 / 改由其它写入口替代。

---

## Revisit Trigger

- **iOS 主路径已验证且需要 Android 用户**：另阶段立项 Android 原生（仍非 RN），产品流与本文 Decision 2/5 对齐。
- **WebView 打开 / 登录在目标站点上系统性失败**：收窄入口（更多依赖粘贴文本 / 精选库等——若 Open Questions 2 已采纳），**不**改为服务端存正文；**不**做 Google `disallowed_useragent` 规避。
- **人力无法维持单端原生、且移动需求已被证明**：另立 ADR 重开载体选择；默认仍优先「单端原生做深」，而非先引入 RN。
- **App Store 条款变化**（尤其 3.1.x 付费、4.8 登录、5.1.1(v) 删号）或 Clerk 移动登录阻塞：付费面另立 IAP ADR；身份走 adr-015 退出路径（Logto / OIDC），若 adr-036 Accepted 则可复用其认证 seam。
- **平台出现可依赖的通用网页注入扩展能力**：可评估，**当前不作为战略**，需新 ADR 才能改 E2。
- **需要 App 内购买**：走 Options G2，另立 ADR（StoreKit 分成 + 与 Stripe 权益同步）。

---

## 待用户 Accept 时确认

Decision 1–8 与 Options 否决项已按锁定项写死。Accept 时请：(1) 关闭或回答 **Open Questions**；(2) 状态栏改为 Accepted 并注明日期。下列项**不阻塞 Accept**，留到实现期：

1. `enx-ios/` 内模块切分与 Xcode / CI 骨架。
2. Readability（或同类）的具体集成方式与「过短」阈值数字。
3. `X-Enx-Client: ios` 与 429 文案分流的精确实现（api 改 message vs 客户端本地文案）。
