# ADR-042：移动端 Phase 1 —— 仅 iOS 原生；收藏 → WebView → 用户触发只读抽正文 → TextKit 原生阅读视图点击查词（不用 RN / Capacitor 主路径；不做移动浏览器扩展；服务端不存正文；App 内无付费引导）

| 字段 | 值 |
| --- | --- |
| **状态** | **Proposed — 2026-09-30**（Decision 与原 Open Questions 均已按用户拍板写死；**仍待用户明确 Accept** 后再改 Accepted）。在用户 Accept 之前，**不以本 ADR 启动编码或改仓库实现**。Accept 后以 Decision 为实现依据（同 adr-012 Decision 10 / adr-034），**不要求**先写 `TASK-SPEC`。 |
| **日期** | 2026-09-30 |
| **关联 Spec** | 无。本 ADR 即 Phase 1 产品与技术边界；编码走 domain-modeling / TDD，不强制配套 TASK-SPEC（见 `docs/agents/domain.md` §ADR vs TASK-SPEC）。 |
| **关联清单** | **Phase 1 发布目标 = 仅 TestFlight 内测，不上 App Store**（见 Decision 10）。**正式 App Store 提审前硬前置**（**不**阻塞 Phase 1 TestFlight）：Sign in with Apple（enx-ui + iOS）；账号删除（Web + App，级联 `saved_pages` / `page_reports` / reader 文档 / 配额行 / Clerk 用户等，对齐 adr-032）；App Store 隐私标签 / Privacy Manifest；`docs/tasks/LAUNCH-CHECKLIST.md` 隐私政策与服务条款补 iOS。**外部前置（用户本人执行）**见文末「外部前置清单」。 |
| **关联 ADR** | [`adr-032-saved-pages-and-no-passive-reading-history.md`](adr-032-saved-pages-and-no-passive-reading-history.md)（收藏只存 URL+标题；Decision 5 预留「移动端 WebView + 本机抽文本」——本 ADR 把载体锁成 iOS 原生并补全产品流。**收窄其 Decision 4**：Phase 1 **不做**移动端系统分享菜单；App **无**收藏写入口，收藏只在桌面扩展完成，见本文 Decision 5。注：adr-032 文首「关联代码 / 待实现」已过期——api 与扩展收藏已落地，见本文关联代码）、[`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) / [`adr-022-enx-ui-reader-persistence-and-retention.md`](adr-022-enx-ui-reader-persistence-and-retention.md)（桌面 Reader 把查词交给扩展；移动端无扩展，由原生阅读视图承接点击查词）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（Clerk JWT → 本地 `users.Id`；本 ADR 在 iOS 复用同一合同，并新增 Sign in with Apple）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md) / [`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（查词计量与时区头）、[`adr-034-site-support-on-demand-injection-and-generic-content-detection.md`](adr-034-site-support-on-demand-injection-and-generic-content-detection.md)（扩展侧因需保留原 DOM **不**整库引入 Readability.js；iOS 抽到独立原生视图，前提不同，**允许**引入 Readability 类库）、[`adr-035-global-and-china-editions-dual-deployment.md`](adr-035-global-and-china-editions-dual-deployment.md) / [`adr-036-china-edition-authentication-logto.md`](adr-036-china-edition-authentication-logto.md)（**均为 Proposed**；Phase 1 **不上**中国大陆区，海外版 Clerk，见 Decision 9） |
| **关联代码** | **iOS 客户端：待实现（Accept 之后）。** **已确认落点**：本 monorepo 顶层 **`enx-ios/`**（与 `enx-chrome` / `enx-ui` / `enx-api` 并列），**不**单独建仓库；SwiftUI / UIKit 分工待定（下一轮再补）。**已实现（收藏数据面）**：enx-api `/api/saved-pages*`（`savedpage/`、`urlnorm/`，PR #61）；enx-chrome popup「Save this page」（`pageSave.ts` / `PageSavePrompt.tsx`）。**未实现**：enx-ui Saved 页（仍属 adr-032 Decision 4）。`GET /api/saved-pages` 无分页（上限 1000 条一次返回），对 iOS Phase 1 足够。查词：`GET /api/word/:word` → `dictionary.Service.Resolve`（adr-018）。认证：Clerk session JWT（adr-015）。**不**新增「上传全文」类 API。 |

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
8. Sign in with Apple 与账号删除仍是已定需求，但是 **正式 App Store 提审前**硬前置；Phase 1 发布目标仅为 **TestFlight 内测**，不上 App Store。
9. Phase 1 **不上**中国大陆区；**不做**系统分享写入口（收窄 adr-032 Decision 4）；抽正文失败**不**做选中/粘贴降级。
10. 工程落在 monorepo 的 `enx-ios/`；主验收站点为 InfoQ 英文站。

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

### 1. Phase 1 载体：仅 iOS 原生；工程在 monorepo 的 `enx-ios/`

- **已确认**：在本 monorepo 新建顶层工程 **`enx-ios/`**（与 `enx-chrome` / `enx-ui` / `enx-api` 并列），**不**单独建 iOS 仓库。
- **不做** React Native / Flutter 客户端。
- **不做** 以 Capacitor / Cordova 包装 Web 作为阅读助手主路径。
- **长期**仍计划 Android 原生（Kotlin 等），**不进入 Phase 1**；开 Android 时另立阶段 / ADR，默认仍原生而非回头选 RN。
- SwiftUI / UIKit 分工待定（下一轮再补）；Bundle ID / 商店显示名随产品品牌（Catglish）另定。

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
- **Sign in with Apple**：**已定需求**——在 Clerk 开启 Apple social connection；**enx-ui 与 iOS App 都提供**该入口。注意 Apple「隐藏邮箱」中继地址对按邮箱操作的管理接口（如 `/api/admin/credits/grant`）的影响。其为 **正式 App Store 提审前硬前置**，**不**阻塞 Phase 1 TestFlight（见 Decision 10）；TestFlight 阶段可用 Clerk 已有登录方式（如 Google / GitHub）跑通闭环。
- **CORS**：不适用于原生 `URLSession`，Phase 1 **不必**为 iOS 改 CORS。`azp`：缺省即放行；若 Clerk iOS SDK 签发的 token **带** `azp`，把该值加入 `CLERK_AUTHORIZED_PARTIES`（实测见外部前置清单）。Clerk 侧 Native API / App 登记等由用户在后台配置，见「外部前置清单」。
- 国内版 IdP（adr-035/036，**均为 Proposed**）与中国大陆区见 Decision 9；不在 Phase 1 另造第三套用户模型。

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
- 单独的 iOS 仓库（工程只在 monorepo `enx-ios/`）。
- Phase 1 内的 Android 工程。
- Phase 1 **上架 App Store**（只做 TestFlight，见 Decision 10）。
- 中国大陆区、ICP 备案、国内版 IdP（见 Decision 9）。
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

### 7. 商店合规与「何时必须做完」

- **付费（Guideline 3.1.1 / 3.1.3）**：Phase 1 即按 Decision G3 / 2a——App 内零购买、零升级引导；多平台订阅权益在 App 内静默生效（TestFlight 构建同样遵守，避免习惯性带上营销文案）。
- **Sign in with Apple（Guideline 4.8）**与**账号删除（Guideline 5.1.1(v)）**：需求已定（Apple：enx-ui + iOS；删号：Web + App，级联见关联清单），但是 **正式向 App Store 提审前的硬前置**，**不**阻塞 Phase 1 TestFlight 内测。今日仓库尚未实现账号删除端点，须在正式提审前补齐。
- 隐私标签 / Privacy Manifest / 隐私政策补 iOS：随正式提审清单走，见关联清单。
- **地区**：见 Decision 9（不含中国大陆区）。日后正式上架也不在 Phase 1 范围。

### 8. Phase 1 完成定义（验收口径）——目标为 TestFlight 内测可交付

事先登记样本与门槛（参照 adr-030「测之前定死阈值」的精神；具体成功率数字可在实现 issue 里填）：

1. **主测试站点**：**InfoQ 英文站**（`https://www.infoq.com`）——Phase 1 端到端与抽取成功路径以此站公开文章页为主。登录墙 / 付费墙站点若另测，只验证 WebView 打开与失败提示，不计入抽取成功率。
2. **抽取成功路径**：用户点击触发后，在 InfoQ 样本页上达到事先登记的成功率门槛；过短 / 非正文计为失败。
3. **抽取失败路径**：对至少一条故意失败样本，App **只**展示失败提示并保留 WebView 可读；**不**出现选中送入阅读视图 / 粘贴文本等降级入口。
4. **端到端**：桌面扩展收藏 InfoQ 文章 → iOS 列表出现同一条（App 侧无写收藏）→ 打开 WebView → 进入原生阅读视图 → 点击查词返回释义且计入配额 → 超额时 App 内仅见中性「配额不足」、无升级引导。
5. **认证（TestFlight）**：Clerk iOS SDK 登录成功拿到可验签 JWT 即可；**不**要求 Phase 1 已上 Sign in with Apple 或账号删除。
6. **分发**：构建可上传 **TestFlight**；Phase 1 **不**提交 App Store 正式审核。若使用 TestFlight **外部测试**，须通过 Apple **Beta App Review**；**内部测试**不需要 Beta App Review。

### 9. Phase 1 不上中国大陆区

- Phase 1（含日后若上架）默认**不含**中国大陆区；使用**海外版** Clerk。
- **ICP 备案、国内版部署 / Logto（adr-035/036）不在 Phase 1 范围**；若日后要上大陆区，另立 ADR / 阶段，不 silently 扩本 ADR。

### 10. Phase 1 发布目标 = 仅 TestFlight 内测

- Phase 1 **不上 App Store**；交付物是可供内部（及可选外部）测试的 TestFlight 构建。
- **内部测试**：无需 Beta App Review，适合尽早验证 Decision 8 闭环。
- **外部测试**：仍须通过 Apple Beta App Review；评审可能触及部分指南，但正式上架前的 Sign in with Apple / 账号删除硬前置仍按 Decision 7 卡在 **App Store 提审**，不因 Phase 1 选择内部 TestFlight 而取消这些已定需求。
- 从 TestFlight 走到正式上架时，另开阶段 / checklist，完成本文关联清单中的提审硬前置。

---

## Rationale

- **原生而非壳 / RN**：Phase 1 要验证的是「抽正文 + 原生点击查词」闭环，不是「把现有 Web 塞进商店」。
- **工程留在 monorepo**：与现有 `enx-*` 并列，共享 issue / CI / API 合同，避免双仓漂移。
- **先 TestFlight、后上架**：把阅读闭环与商店合规拆开；SiWA / 删号仍做，但不堵第一轮真机验证。
- **先 iOS 后 Android**：双端并行会让第一阶段变成脚手架竞赛。
- **只读注入 ≠ 交互注入**：本机抽正文在 iOS 上现实路径就是对第三方页 WebView 跑抽取脚本；把边界画在「只读 + 用户手势 + 隔离 world」上，既让 Decision 可实现，又不滑回扩展模型。
- **TextKit 而非本地 WebView 渲染**：高亮与点词命中落在原生文本系统上，避免「阅读视图仍是 WebView」的灰色地带。
- **WebView 登录现实写进 Decision**：避免实现者误以为能复用 Safari 订阅 Cookie；Google 内嵌登录被拒是平台限制，不在 Phase 1 做 UA 伪装等规避。
- **App 内零付费引导**：即使只发 TestFlight 也不夹带升级文案，避免养成违规构建习惯。
- **Sign in with Apple / 删号绑正式提审**：满足日后 4.8 / 5.1.1(v)，同时不拖慢 InfoQ 闭环验证。
- **不上大陆区 / 不做分享写入口 / 失败不降级**：把 Phase 1 钉在「海外只读续读 + 抽取成败二元」上。
- **不要求 TASK-SPEC**：决策面已可编码；细节用 TDD 与实现期 issue（`docs/agents/domain.md`）。

---

## Consequences

### Positive

- 移动与桌面分工清晰：扩展管桌面原页点词与收藏写入，App 管原生阅读视图点词。
- 版权与隐私边界与 adr-032 一致；只读抽正文不扩大服务端持有面。
- TestFlight 先行，可在 SiWA / 删号未齐时验证 InfoQ 主路径。
- Phase 1 范围可交付：一条主路径、monorepo 内一个工程、零 IAP、不上架。

### Negative

- 需申请 Apple Developer、配置 Clerk Native，并新建 `enx-ios/`；短期无 Android、无大陆区、无 App Store 公开页。
- 公开页以外，用户须在 WebView 内重新登录；Google OAuth 站点基本不可登。
- Phase 1 App 不能从手机侧新增收藏，完全依赖桌面扩展。
- 桌面与移动查词 UI 两套实现；SiWA / 删号仍会在正式提审前波及 enx-api / enx-ui。
- 抽正文失败时用户在 App 内无法点词（仅 WebView 可读 + 失败提示）。
- TestFlight 外部测试仍可能触发 Beta App Review 摩擦。

### Mitigation

- 抽正文失败：保留 WebView 可读 + 明确失败提示；**不**加选中/粘贴降级；**不**改为服务端存正文。
- Phase 1 优先 **内部** TestFlight，降低 Beta Review 压力；外部测试再视需要开启。
- 设置页提供「清除网站数据」；登出默认清 WebView 数据与正文缓存。
- Android / 大陆区 / 系统分享 / 正式上架在对应 Revisit 或另阶段再开。
- 429 等文案按 Decision 2a 处理，TestFlight 验收时用真机配额打满。

---

## Out of Scope（本次不做）

- Phase 1 提交 App Store 正式审核 / 公开发布。
- Android 工程。
- 中国大陆区上架、ICP 备案、国内版 App 登录（adr-035/036）。
- 系统分享菜单 / Share Extension / App 内收藏写入。
- 抽正文失败后的选中送入阅读视图、粘贴文本等降级。
- 正文抽取库的最终选型细节与「过短」字数阈值（实现期用样本定；**允许**在 iOS 整库引入 Readability 类实现，与 adr-034 扩展侧决定前提不同）。
- SwiftUI / UIKit 分工与设计系统（待定，下一轮再补）；iOS 查词 UI 最终组件命名（不称「查词浮层」）。
- 划词整句翻译、单词高亮档位、生词本复习在 iOS 上的完整对等（Phase 1 以点击查词闭环为必达）。
- StoreKit 内购与 Stripe 权益同步（后续 ADR）。
- enx-ui 无扩展时的 Web 内点词（adr-019 Revisit）。
- iOS 是否展示 adr-022 的 Reader「我的文档」（`/api/reader/documents`）——不做进 Phase 1 主路径。
- App Store 显示名与 Bundle ID 的最终字符串。

---

## Open Questions

**已全部关闭（2026-09-30 用户拍板）**——见 Decision 5 / 2 / 9 / 10 等。本节不再保留待决项。SwiftUI / UIKit 分工明确为**待定**（非开放产品决策，下一轮再补）。

---

## 外部前置清单（须由用户本人执行；非 agent 代办）

下列为人工操作，**不在** Accept 后的编码任务内自动完成；缺项会卡住 TestFlight 或正式上架，但不改变本文 Decision。

1. **Apple Developer Program 账号**（目前还没有）
   - 加入 [Apple Developer Program](https://developer.apple.com/programs/) 后才能签真机 / 上传 TestFlight。
   - **个人账号**：以个人法律实体加入，流程相对快；App 显示销售商为个人姓名；后续若要以公司名义上架通常需迁移或新建公司账号。
   - **公司 / 组织账号**：需合法实体 + **D-U-N-S 编号**（Dun & Bradstreet）；D-U-N-S 申请与 Apple 审核常额外耗时（常见数天到数周），适合要以公司名上架、多人团队的情况。
   - Phase 1 仅 TestFlight 时，个人或公司账号均可；正式上架前再确认销售商身份是否要换成公司。

2. **Clerk 后台（生产实例）**
   - 启用 **Native API**。
   - 登记 iOS App（**Bundle ID** + Apple **Team ID**）。
   - 开启 **Sign in with Apple**（正式提审前必达；需在 Apple Developer 配置 Services ID / Key 等，再填入 Clerk）——网页与 iOS 均提供，见 Decision 3。
   - 在**生产** Clerk 实例上完成上述配置（勿只配开发实例就当上架就绪）；清单细节可对照 `docs/tasks/TASK-SPEC-enx-clerk-production-cutover.md`。
   - **实测**：Clerk iOS SDK `getToken()` 签发的 session JWT **是否带 `azp`**——不带则现有中间件直接放行；若带，把该值加入 `CLERK_AUTHORIZED_PARTIES`。

---

## Revisit Trigger

- **TestFlight 闭环验证完毕、准备正式上架**：完成 Decision 7 提审硬前置（SiWA、账号删除、隐私标签等），另开上架阶段；仍不上中国大陆区除非另议。
- **iOS 主路径已验证且需要 Android 用户**：另阶段立项 Android 原生（仍非 RN），产品流与本文 Decision 2/5 对齐。
- **需要中国大陆区或国内版 IdP**：另立阶段 / ADR（ICP、adr-035/036）；不在本 ADR 内扩范围。
- **需要移动端收藏写入口**（系统分享等）：另议；届时显式修订「对 adr-032 Decision 4 的 Phase 1 收窄」。
- **抽取失败率过高、用户强烈要求降级**：可重开 Options H1/H2，另补 Decision；**不**改为服务端存正文；**不**做 Google `disallowed_useragent` 规避。
- **WebView 打开 / 登录在目标站点上系统性失败**：收窄可读站点预期或另议入口，仍不存正文、不做 UA 规避。
- **人力无法维持单端原生、且移动需求已被证明**：另立 ADR 重开载体选择；默认仍优先「单端原生做深」，而非先引入 RN。
- **App Store / TestFlight Beta 条款变化**或 Clerk 移动登录阻塞：付费面另立 IAP ADR；身份走 adr-015 退出路径（Logto / OIDC），若 adr-036 Accepted 则可复用其认证 seam。
- **平台出现可依赖的通用网页注入扩展能力**：可评估，**当前不作为战略**，需新 ADR 才能改 E2。
- **需要 App 内购买**：走 Options G2，另立 ADR（StoreKit 分成 + 与 Stripe 权益同步）。

---

## 待用户 Accept 时确认

Decision 1–10 与 Options 否决项已按用户拍板写死；原 Open Questions 已关闭。Accept 时请将状态栏改为 Accepted 并注明日期。下列项**不阻塞 Accept**，留到实现期 / 下一轮：

1. `enx-ios/` 内模块切分与 Xcode / CI 骨架；**SwiftUI / UIKit 分工待定**。
2. Readability（或同类）的具体集成方式与「过短」阈值数字。
3. `X-Enx-Client: ios` 与 429 文案分流的精确实现（api 改 message vs 客户端本地文案）。
