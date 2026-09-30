# ADR-042：移动端 Phase 1 —— 仅 iOS 原生；收藏 → WebView → 原生阅读视图本机抽正文 → 原生 UI 点击查词（不用 RN / Capacitor 主路径；不做移动浏览器扩展；服务端不存正文）

| 字段 | 值 |
| --- | --- |
| **状态** | **Proposed — 待用户确认后再标 Accepted。** 文中 Decision 条款已按 2026-09-30 锁定产品决策起草；在用户 Accept 之前，**不以本 ADR 启动编码或改仓库实现**。Accept 后以 Decision 为实现依据（同 adr-012 Decision 10 / adr-034），**不要求**先写 `TASK-SPEC`。 |
| **日期** | 2026-09-30 |
| **关联 Spec** | 无。本 ADR 即 Phase 1 产品与技术边界；编码走 domain-modeling / TDD，不强制配套 TASK-SPEC（见 `docs/agents/domain.md` §ADR vs TASK-SPEC）。 |
| **关联 ADR** | [`adr-032-saved-pages-and-no-passive-reading-history.md`](adr-032-saved-pages-and-no-passive-reading-history.md)（收藏只存 URL+标题；Decision 5 预留「移动端 WebView + 本机抽文本」——本 ADR 把载体锁成 iOS 原生并补全产品流）、[`adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md`](adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md) / [`adr-022-enx-ui-reader-persistence-and-retention.md`](adr-022-enx-ui-reader-persistence-and-retention.md)（桌面 Reader 把查词交给扩展；移动端无扩展，由原生阅读视图承接点击查词）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（Clerk JWT → 本地 `users.Id`；本 ADR 在 iOS 复用同一合同）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（用户查词唯一入口 `dictionary.Service.Resolve`）、[`adr-035-global-and-china-editions-dual-deployment.md`](adr-035-global-and-china-editions-dual-deployment.md) / [`adr-036-china-edition-authentication-logto.md`](adr-036-china-edition-authentication-logto.md)（国内版 IdP 另议；Phase 1 默认海外版 Clerk） |
| **关联代码** | **待实现（Accept 之后）。** 预期落点：新建 `enx-ios/`（与 `enx-chrome` / `enx-ui` / `enx-api` 并列的顶层客户端工程；Swift / SwiftUI 或团队惯用 iOS 栈，本 ADR 不锁 UIKit vs SwiftUI）。依赖已规划 / 已有的 enx-api：`/api/saved-pages*`（adr-032）、`dictionary.Service.Resolve`（adr-018）、Clerk session JWT 验签（adr-015）。桌面收藏入口仍在 `enx-chrome`（工具栏弹窗「Save this page」）；列表管理可继续用 enx-ui Saved 页。**不**新增「上传全文」类 API。 |

---

## Context

### 这个 ADR 是怎么来的

ADR-032 锁定「收藏 = URL + 标题、服务端不存正文」，并把移动端续读写成：App 内 WebView 以用户登录态打开 URL，在设备上抽文本，再走现有查词 / 划词接口。当时「移动端」另行立项。

2026-09-30 产品侧锁死了 Phase 1 的技术载体与交互形状：

1. 不用 React Native；Capacitor / 跨端 Web 壳不作 App 主路径。
2. 长期仍是 iOS + Android **双原生**，但 **Phase 1 只做 iOS**；Android 不进第一阶段。
3. 产品流：桌面 Chrome 扩展收藏（仅 URL+标题）→ iOS 收藏列表 → WebView 打开 → 用户进入原生阅读视图（本机抽正文）→ **原生 UI 点击查词**（不在 WebView 内做点击查词）。
4. 认证：Clerk iOS SDK，复用现有 enx-api JWT 合同。
5. 不做移动浏览器扩展战略；桌面仍以 `enx-chrome` 为主。
6. 服务端不存正文（对齐 adr-032）。

这些决定难以反悔（原生工程与商店身份、与扩展的分工边界、版权边界），且与「先做响应式 / Capacitor 壳」的旧假设相反，需要单独 ADR 写清否决项。

### 现状（以 2026-09-30 的仓库为准）

- 客户端只有 `enx-chrome`（桌面 Chromium 扩展）与 `enx-ui`（Web）；**无** `enx-ios` / Android / Capacitor / RN 工程。
- 桌面核心价值是「在别人的网页上」学习模式 + 点击查词（content script）。移动端无法对等复制这条注入路径，也不追求系统浏览器扩展。
- enx-ui Reader（adr-019）刻意把查词交给扩展；无扩展时没有完整点词体验——移动 App 必须自建查词 UI。
- 认证：Clerk JWT → 本地 `users.Id`（UUID）。CORS / `azp` 今天主要为网站与扩展配置；原生 App 需补客户端与允许源。
- `enx-sync` 已暂停维护；移动设计忽略 P2P。

### 术语（本 ADR 行文）

- 中文统一称「**收藏**」，英文 `saved` / `saved-pages`（见 `CONTEXT.md`、adr-032）。
- 桌面扩展交互仍叫 **学习模式** / **点击查词**；**不要**把移动端原生阅读视图叫成学习模式。
- 移动端抽取正文后的原生界面叫 **原生阅读视图**（见 `CONTEXT.md` 增补）。口头「进阅读模式」在本 ADR 里即指进入该视图并完成本机抽正文，**不是**桌面学习模式，也不是要求绑定某一家浏览器的 Reader View 产品。

---

## Options Considered

### A. App 技术载体

| 方案 | 结论 |
| --- | --- |
| A1. React Native / Flutter 跨端 | **否决。** 点击查词与正文排版是强原生交互；跨端既要大量原生桥接 WebView / 文本选区，又摊薄 iOS 打磨时间；与「长期双原生」目标最终仍要写两套原生能力，中间多一层抽象。 |
| A2. Capacitor / Cordova 包装 enx-ui（或假想的移动 Web 阅读页）作主路径 | **否决作主路径。** 壳只解决「能上架」，不解决「在 WebView 里做点词体验差、与桌面扩展模型错位」；ADR-032 要的本机抽正文 + 查词 UI 最终仍要落到原生层。允许将来用 Web 技术做**非阅读主路径**的辅助页（账户、定价），但不作为阅读助手载体。 |
| A3. 响应式 enx-ui / PWA 当移动 MVP | **否决作阅读主路径。** 可作账户 / Lookup / Billing 的触控验证面（低成本），但不能替代「WebView 打开第三方页 → 抽正文 → 原生点击查词」。 |
| **A4.（采用）原生 App；Phase 1 仅 iOS** | 与锁定产品流同构；Android 留作长期双原生的下一阶段，不并行进 Phase 1。 |

### B. Phase 1 是否含 Android

| 方案 | 结论 |
| --- | --- |
| B1. Phase 1 同步开 iOS + Android 双原生 | **否决。** 双端并行会把「验证阅读闭环」稀释成「两套工程脚手架」；第一阶段目标是证明收藏续读 + 本机抽正文 + 原生点击查词是否成立。 |
| B2. Phase 1 用 RN「先双端再换原生」 | **否决**（同 A1）；且与「不用 RN」锁定冲突。 |
| **B3.（采用）Phase 1 = iOS only；Android 另阶段再开** | 长期目标仍是双原生，不在本文改口为「永远不做 Android」。 |

### C. 点击查词发生在哪里

| 方案 | 结论 |
| --- | --- |
| C1. 在 WebView 内注入 JS / 模拟 content script 做点击查词 | **否决。** 第三方页 DOM 不可控、登录墙与 CSP 摩擦大，且会把移动端拖回「扩展注入」模型——正是移动端做不到、也不该做的战略。 |
| C2. WebView 内叠加原生透明命中层，仍对着网页排版点词 | **否决。** 实现复杂（坐标映射、重排、缩放），失败模式多；收益只是「看起来还在原页上点」，不如抽到稳定排版的原生视图。 |
| **C3.（采用）WebView 只负责打开页与供抽取；进入原生阅读视图后在原生 UI 内点击查词** | 与 adr-032 Decision 5「设备上抽取文本」一致，并明确 **查词 UI 必须原生**。 |

### D. Phase 1 的 URL 入口范围

| 方案 | 结论 |
| --- | --- |
| D1. 任意系统浏览器分享 / 剪贴板 / 精选库 / 收藏列表一起做满 | **否决作 Phase 1 必达。** 入口过多会拖住「主闭环」验证。 |
| D2. 仅系统分享进 App，不做收藏列表 | **否决作 Phase 1 主路径。** 跨设备续读的数据面是 adr-032 的 `saved-pages`；桌面已收藏、手机打开，才是锁定叙事。 |
| **D3.（采用）Phase 1 主路径 = 桌面扩展收藏 → iOS 收藏列表 → 打开** | 系统分享菜单进 App（adr-032 Decision 4 已预留）可作为同阶段增强，**不**替代收藏列表主路径；精选库 / 粘贴纯文本等另议。 |

### E. 移动浏览器扩展战略

| 方案 | 结论 |
| --- | --- |
| E1. 以 Safari / Android Chrome 扩展对等桌面「任意网页点词」 | **否决。** 能力与分发均不构成可依赖主战略；桌面继续 `enx-chrome`。 |
| **E2.（采用）不做移动浏览器扩展战略** | 移动阅读助手 = 原生 App；桌面阅读助手 = 扩展。 |

### F. 正文存哪里

| 方案 | 结论 |
| --- | --- |
| F1. 服务端存正文或译文供 App 拉取 | **否决。** 对齐 adr-032 Options B2/B3；版权与站点条款风险面不可接受。 |
| F2. 服务端代抓 URL 取正文 | **否决。** adr-032 已禁止服务端主动抓 URL。 |
| **F3.（采用）只在本机抽正文；服务端仅 URL+标题** | 可选本机离线缓存（adr-032 B4），永不上传正文。 |

---

## Decision

### 1. Phase 1 载体：仅 iOS 原生；不用 RN；Capacitor 不作主路径

- 新建顶层工程 **`enx-ios/`**（名称与现有 `enx-*` 并列；Accept 后立项时若需微调目录名，以仓库惯例小改，不另开 ADR）。
- **不做** React Native / Flutter 客户端。
- **不做** 以 Capacitor / Cordova 包装 Web 作为阅读助手主路径。
- **长期**仍计划 Android 原生（Kotlin 等），**不进入 Phase 1**；开 Android 时另立阶段 / ADR，默认仍原生而非回头选 RN。

### 2. Phase 1 产品流（主路径）

1. 用户在桌面用 `enx-chrome` **收藏**当前页（adr-032：仅规范化 URL + 标题）。
2. iOS App 拉取同一用户的 **收藏列表**（`GET /api/saved-pages`）。
3. 用户点开一条：App 内 **WebView** 以用户自己的站点登录态加载该 URL。
4. 用户进入 **原生阅读视图**：App **本机抽取**正文（服务端不持有、不接收全文）。
5. 在 **原生 UI** 上做 **点击查词**（及后续若做的划词等）；**不在 WebView 内**做点击查词。
6. 查词请求走现有 enx-api 合同：`dictionary.Service.Resolve`（adr-018）及既有翻译 / 计费口径；只上传词或用户选中的片段，不上传文章全文。

### 3. 认证

- Phase 1（默认海外版部署）使用 **Clerk iOS SDK** 登录。
- enx-api 继续验 Clerk session JWT，映射到本地用户身份（`users.Id`）；**不**为移动端另发明一套 session。
- 实现时补齐 iOS 客户端的 `azp` / 允许源 / CORS（勿用 `*`）；国内版若启用，跟 adr-035/036 的部署侧 IdP，不在 Phase 1 另造第三套用户模型。

### 4. 桌面与移动的分工

- **桌面**阅读助手主路径仍是 `enx-chrome`（学习模式 + 点击查词）。
- **移动**不做浏览器扩展战略，不对外承诺与桌面「任意网页注入点词」对等。
- enx-ui 可继续承担账户、Saved 管理、Billing 等；**不是** Phase 1 移动阅读主路径。

### 5. 服务端与收藏边界（继承 adr-032）

- 服务端**不存**正文、**不存**译文、**不**代抓 URL。
- 收藏数据与桌面共用 `saved-pages`；App **依赖**扩展（或嗣后其它显式入口）写入收藏，以及 api 侧 adr-032 端点可用。
- 本机可按 adr-032 Options B4 做离线正文缓存；缓存不得上传。

### 6. 明确不做（Phase 1 / 本 ADR 范围）

- React Native / Flutter；Capacitor 主壳。
- Phase 1 内的 Android 工程与上架。
- 移动浏览器扩展战略。
- WebView 内点击查词。
- 服务端全文 / 译文存储；「上传正文」API。
- 为移动端复活 `enx-sync` / P2P。
- 以本 ADR 为由要求先写 `TASK-SPEC`（不需要）。

---

## Rationale

- **原生而非壳 / RN**：Phase 1 要验证的是「抽正文 + 原生点击查词」闭环，不是「把现有 Web 塞进商店」。壳与 RN 都会把关键推到「半套原生桥 + 半套 Web」，却仍然无法复用 `enx-chrome` 的 content script 资产。
- **先 iOS 后 Android**：双端并行会让第一阶段交付变成脚手架竞赛；iOS 先跑通收藏续读，再复制产品流到 Android，比同时维护两套未验证交互更便宜。
- **查词离开 WebView**：与桌面「在原页 DOM 上点词」不同，移动端稳定排版、选词、浮层和系统字体都在原生侧更可控；WebView 保留「用户登录态打开原站」这一个职责（付费墙、个人页），与 adr-032 Decision 5 一致。
- **入口以收藏列表为主**：跨设备叙事依赖 adr-032 已定的数据面；分享菜单是同一 URL 的另一显式入口，不是另一套存储。
- **认证复用 Clerk JWT**：避免移动端成为第二个 IdP；业务数据继续键在本地 UUID（adr-015）。
- **不要求 TASK-SPEC**：决策面已经收束到可编码的边界；细节用 TDD 与实现期 issue 即可（`docs/agents/domain.md`）。

---

## Consequences

### Positive

- 移动与桌面分工清晰：扩展管桌面原页点词，App 管移动端原生阅读视图点词。
- 版权与隐私边界与 adr-032 一致，服务端攻击面不因移动端扩大到「持有第三方全文」。
- Phase 1 范围可交付：一条主路径，一个平台，一套认证。

### Negative

- 需从零建 `enx-ios/`、商店账号与 CI；短期没有 Android 用户可装的客户端。
- WebView 打开原站仍受登录墙、Cookie、站点条款约束；抽正文对部分站点会失败。
- 桌面与移动查词 UI 两套实现，交互需靠产品规范对齐，不能共享 React 组件树。

### Mitigation

- 抽正文失败时保留 WebView 可读，并给出明确「无法进入原生阅读视图」的提示；可后续接页面上报类信号（另议），但不改「服务端不存正文」。
- 付费墙站点依赖用户在 WebView 内自己的订阅态（adr-032 Decision 5）。
- Android 在 iOS 主路径验证后再立项，避免过早双倍成本。

---

## Out of Scope（本次不做）

- Android 工程、上架与 CI。
- 正文抽取算法的具体库选型与阈值（实现阶段用真实站点样本定；可借鉴 Readability 类信号，但是否链入某库不在本 ADR 锁死）。
- UIKit vs SwiftUI、导航与设计系统细节。
- 划词整句翻译、单词高亮、生词本复习在 iOS 上的完整对等（Phase 1 以点击查词闭环为必达；其余按优先级另排）。
- 国内版 App 登录（跟 adr-035/036；Phase 1 默认 Clerk）。
- enx-ui 无扩展时的 Web 内点词（adr-019 Revisit）——不阻塞本 ADR。

---

## Revisit Trigger

- **iOS 主路径已验证且需要 Android 用户**：另阶段立项 Android 原生（仍非 RN），产品流与本文 Decision 2/5 对齐。
- **WebView + 原站登录在目标站点上系统性失败**：收窄入口（例如更多依赖用户粘贴文本 / 精选库），**不**改为服务端存正文。
- **人力无法维持单端原生、且移动需求已被证明**：另立 ADR 重开载体选择；默认仍优先「单端原生做深」，而非先引入 RN。
- **Clerk 移动登录或商店政策阻塞**：走 adr-015 的迁出缝（标准 OIDC / 部署侧 IdP）。
- **平台出现可依赖的通用网页注入扩展能力**：可评估，**当前不作为战略**，需新 ADR 才能改 E2。

---

## 待用户 Accept 时确认

Decision 1–6 已按锁定项写死。Accept 时请确认状态栏改为 Accepted 并注明日期即可。下列项**不阻塞 Accept**，留到实现期：

1. `enx-ios/` 内模块切分与 Xcode / CI 骨架。
2. 本机正文抽取的具体库或自研范围。
3. Phase 1 是否同船交付「系统分享 → App」入口（主路径仍是收藏列表）。
