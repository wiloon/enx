# ADR-019：enx-ui 加「粘贴文本阅读器」（`/reader`）——用户粘一段英文纯文本、提交后渲染成普通文章页，查词等阅读辅助**全部复用 enx-chrome**（跟 InfoQ 一样，enx-ui 侧不写查词代码）；为此开 enx-chrome 第一条「网页→扩展」通道：`externally_connectable` + `onMessageExternal`，enx-ui 渲染完主动通知扩展在本 tab 启用学习模式

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-06。已按 TDD 分 14 片实现：enx-chrome `READER_ADAPTER` + `onMessageExternal`（`enx:ping` / `enx:enable-reader`，origin 白名单 + 登录门禁）+ `stampExtensionPresence` + manifest `externally_connectable` / content-script 白名单 + 漂移守卫测试；enx-ui `/reader` 页 + `useExtensionStatus` hook + `enxExtension.ts` + `app-nav.ts` 加 `Reader`。两仓 jest 全绿（enx-chrome 既有 `pronunciation.test.ts` 3 失败为历史遗留、与本次无关）、`tsc` 生产代码干净、`next build` / `vite build` 通过。待回填：prod 品牌域、`NEXT_PUBLIC_ENX_EXTENSION_ID`、Web Store URL。 |
| **日期** | 2026-09-06 |
| **关联 ADR** | [`adr-016-enx-ui-app-shell-navigation.md`](adr-016-enx-ui-app-shell-navigation.md)（`(app)` route group + 配置化导航 `app-nav.ts`——本 ADR「加一个分区 = 加一行」）、[`adr-010-x-tweet-page-support.md`](adr-010-x-tweet-page-support.md) / [`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（`SiteAdapter` 机制——本 ADR 新增 `READER_ADAPTER`）、[`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（Clerk 会话同步：网站登录 → 扩展即登录态，本 ADR 的 `onMessageExternal` 依赖它判断登录）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（查词配额：reader 页的每次点词都会经 `GET /api/word/:word` 计入每日配额）、[`adr-006-page-word-lookup-in-sidepanel.md`](adr-006-page-word-lookup-in-sidepanel.md) / [`adr-014-sidepanel-clicked-word-and-token-billing.md`](adr-014-sidepanel-clicked-word-and-token-billing.md)（查词浮层 / Side Panel / token 计费——reader 页原样复用，不动） |
| **关联清单** | [`../tasks/LAUNCH-CHECKLIST.md`](../tasks/LAUNCH-CHECKLIST.md) §0.1（生产品牌域未定——本 ADR 的 manifest `matches` / `externally_connectable` / 扩展 ID 的 prod 值都要等域名定了回填；homelab `enx.wiloon.lab` 可先跑通） |

---

## 已确认的决策（2026-09-06，用户确认）

1. **一次性，不持久化**。提交后纯客户端渲染，不落库、不加 enx-api 端点、URL 不带正文。刷新 / 离开即丢。「我的文档」式回看留作后续。
2. **enx-ui 侧不做任何查词交互**。渲染出的正文就是一个普通文章页，点词查词、单词高亮、划词整句翻译、短语查询全部由 enx-chrome 现有机制处理，**跟用户在 InfoQ 上阅读一模一样，这个页面没有任何特别处理**。
3. **纯文本输入**。textarea 纯文本，按空行分段。忽略任何富文本 / 粘贴过来的 HTML。
4. **学习模式由 enx-ui 主动通知扩展启用**。不是让用户提交后自己去点扩展图标（InfoQ 那样），而是 reader 页渲染完发消息给扩展、自动跑学习模式。
5. **没装扩展的用户**：enx-ui 能探测到（`externally_connectable` 一旦配上，`chrome.runtime` 只在装了扩展时才注入进 enx-ui 页），探测不到时在 reader 页显示一个可关闭的引导 banner，指向 Chrome Web Store 安装。正文本身仍是一个能读的静态英文页，只是不能点词。（2026-09-06 追加确认，替代此前的「不做处理」。）

---

## Context

### enx-ui 与 enx-chrome 至今互不相通

- **enx-ui**（ADR-016 后）：`(app)` 子树下 Home / Word Lookup / Rephrase / Reading Stats / Billing，清一色「表单 → 调 `enx-api` → 卡片展示」。它只跟 `enx-api` 说话。
- **enx-chrome**：学习模式、点击查词、查词浮层、单词高亮、划词翻译整套阅读辅助都在 content script 里，跑在 `manifest.json` `content_scripts.matches` 的写死白名单上（`infoq.com`、`reuters.com`、`anthropic.com`、`x.com`……）。
- **enx-ui 自己的域名不在那张白名单里**——`enx.wiloon.lab` / `enx.wiloon.com` / `localhost:3000` 都没有，扩展在 enx-ui 上**完全不运行**。
- manifest 没有 `externally_connectable`，background 没有 `chrome.runtime.onMessageExternal` 处理器——**网页无法给扩展发任何消息**。学习模式今天只能由用户手动触发：popup 里的按钮（`Login.tsx` 发 `enxRun`）、点工具栏图标（`background.ts` `chrome.action.onClicked`）、或 `Ctrl+Shift+E`。

### 需求

用户复制一段英文 → 粘贴进 enx-ui 的一个文本框 → 提交 → enx-ui 渲染成一个正文页 → 在这个页面上点击查词，跟在 InfoQ 上一样。要一个新菜单项。

### 为什么值得写 ADR（三个判据都成立）

- **难以反悔**：`externally_connectable` 是 enx-chrome 第一条「网页可以驱动扩展」的入口。一旦开：(a) 这个消息协议就成了 enx-ui ↔ 扩展的公共契约；(b) 扩展 content script 首次跑在 enx-ui 自己的域名上，两个 surface 之间「谁在哪运行」的边界被打破；(c) 后续 enx-ui 功能很可能都会想搭这条通道。这是新的信任边界，收回来很贵。
- **反直觉**：至今 enx-ui 每个功能都是「调 `enx-api`」。这个功能的核心价值（查词）却由一个**独立的、可能根本没安装的**浏览器扩展提供，enx-ui 侧几乎不写查词代码。后来者打开 `reader/page.tsx` 会困惑「查词逻辑在哪」。
- **真实取舍**：查词能力从哪来（复用扩展 / enx-ui 自带 / 手动）、怎么触发启用（`externally_connectable` / adapter 自动 / 纯手动）、消息协议（复用 `enxRun` / 新建外部动作）、正文抓取（`DEFAULT_ADAPTER` / 专用 adapter）、要不要持久化——每个都有多个合理选项，且选错了以后要返工。

---

## Options Considered

### A. reader 页的查词能力从哪来

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **A1.（采用）完全复用 enx-chrome**：enx-ui 只产出干净的 `<article>`，扩展像处理 InfoQ 一样处理它 | 点词浮层 / 高亮 / 划词翻译 / token 计费 / 查词配额，全部自动跟随扩展演进，零重复 | 代价：**没装扩展 = 不能查词**（用户已确认可接受）。这正是「跟 InfoQ 一样、没有特别处理」的直接落地 |
| A2. enx-ui 自带轻量 click-to-lookup（复用 `WordData` 类型 + `GET /api/word/:word`）| reader 页脱离扩展也能点词 | 要在 enx-ui 重写一遍 Range 展开、浮层渲染、Floating UI 定位、mark-acquainted……是 `content.tsx` 里约 500 行逻辑的第二实现，且必然跟扩展那份漂移。**用户明确否决** |
| A3. 手动启用（InfoQ 那样）+ A1 | 用户提交后自己点扩展图标 | 少一条 `externally_connectable`，但「粘完还要跳去点扩展」是体验断点。**用户选了主动通知**（决策 4）|

### B. enx-ui 怎么让扩展在 reader 页启用学习模式

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **B1.（采用）`externally_connectable` + `onMessageExternal`**：reader 页渲染完发 `chrome.runtime.sendMessage(EXT_ID, {type:'enx:enable-reader'})`；background 校验 `sender.origin` 后对该 tab 跑 `enxRun` | 标准 MV3 网页↔扩展做法，origin 白名单收紧 | origin 限定在 enx-ui 的确切域；扩展 ID 因 manifest 有固定 `key` 而稳定，可硬编码进 enx-ui 配置 |
| B2. 给 reader host 配 `SiteAdapter { autoEnable: true }`，content script 一识别是 reader 页就自动进学习模式 | 无需网页↔扩展消息 | 打破 CONTEXT.md「学习模式 = 用户在某页显式启用」的处处 opt-in 一致性；且 content script 在客户端渲染前的 `document_end` 就注入，「识别是 reader 页」还得等 SPA 内容出现，时序更绕。**否决** |
| B3. 纯手动 | 见 A3 | **否决** |

### C. 消息协议：复用 `enxRun` 还是新建外部专用动作

| 方案 | 结论 |
| --- | --- |
| **C1.（采用）新建外部专用类型 `enx:enable-reader`**，background 收到后**映射**成对 sender tab 的 `enxRun` | 外部协议与内部 content-script 消息面解耦：白名单网页只能表达「在我这个 reader tab 上启用」，不能任意驱动内部动作（`getOneWord`、`markAcquainted`、`openSentencePanel`……）。将来收紧 / 审计范围最小 |
| C2. 直接让网页发 `{action:'enxRun'}` | `onMessageExternal` 与 `onMessage` 共用一套动作字典，等于把整个内部消息面暴露给白名单网页。**否决** |

### D. reader 正文抓取：`DEFAULT_ADAPTER` 还是专用 `SiteAdapter`

| 方案 | 结论 |
| --- | --- |
| **D1.（采用）新增 `READER_ADAPTER`**：`contentSelector: '#enx-reader-article'`、`minTextLength: 1`、`contentVolatility: 'static'`、`pageSupport` 限定 `/reader` 路由 | reader 页带 app shell（侧栏、顶栏、卡片），`DEFAULT_ADAPTER` 的选择器启发式可能抓错节点；显式容器 id + 低阈值（用户可能只粘一小段）最稳。我们自己控制这个 DOM，没理由让扩展去猜 |
| D2. 复用 `DEFAULT_ADAPTER` | 在一个自己控制 DOM 的页面上依赖正文启发式。**否决** |

### E. 持久化

| 方案 | 结论 |
| --- | --- |
| **E1.（采用）一次性**：组件内 state，不落库、不加端点、URL 不带正文 | 范围最小；隐私上也不该把用户粘贴的文本塞进 URL 或后端 |
| E2. 存成「我的文档」可回看 / 重开 | 要 enx-api 端点 + 表 + UI 列表 / 删除。**用户明确推迟**（决策 1）|

### F. 菜单项

放 `NAV_MAIN`（ADR-016 `src/components/app/app-nav.ts`），`label: 'Reader'`、`icon: BookOpen`（lucide）、`href: '/reader'`。ADR-016 决策 5：加一个分区 = 加一行。

### G. 怎么探测扩展是否安装

| 方案 | 说明 | 结论 |
| --- | --- | --- |
| **G1.（采用）`externally_connectable` + 只读 ping**：enx-ui 发 `{type:'enx:ping'}`，`lastError` / 超时 → 未安装，`{ok:true,version}` → 已安装 | 配了 `externally_connectable` 后，Chrome 只在装了扩展时才把 `chrome.runtime` 注入 enx-ui 页——`!chrome.runtime?.sendMessage` 本身就是强信号，ping 再确认一次并拿到版本号 | 标准做法，零额外权限；跟本 ADR 已有的通道同源 |
| G2. content script 打 DOM 标记：`<html data-enx-extension="<version>">`，enx-ui 轮询读取 | content script 已经会跑在 enx-ui 页上（决策 3） | **作为 G1 的兜底**：覆盖 ping 往返慢于首屏渲染的竞态。不单独用——依赖 `document_end` 注入时序，React 侧要 poll / MutationObserver，比 ping 脆 |
| G3. 不探测（ADR 初稿） | 静默失败 | 用户 2026-09-06 明确要引导提示，否决 |

---

## Decision

### 1. enx-ui：新增 `/reader` 页

`src/app/(app)/reader/page.tsx`，`'use client'`：

- **输入态**：一个纯文本 `<textarea>` + `Submit` 按钮。
- **提交** → 同一路由内客户端切到**阅读态**：把文本按空行（`\n\s*\n`）拆段，每段渲染成一个 `<p>`（`white-space: pre-wrap` 保留段内换行），全部包在 `<article id="enx-reader-article">` 里。**不导航、URL 不变、不带正文参数。**
- 阅读态渲染后（`useEffect`，依赖「已渲染」）尝试：
  ```ts
  chrome?.runtime?.sendMessage(EXT_ID, { type: 'enx:enable-reader' }, () => void chrome.runtime.lastError)
  ```
  `chrome.runtime` 不存在、或回调带 `lastError`（没装扩展 / 扩展没白名单本域）→ **静默**（决策 5：没装扩展就是个静态英文阅读页，不做额外处理）。
- 提供「Edit」按钮回到输入态；再次提交再发一次消息（用户改了文本要重扫）。
- `EXT_ID` 来自 enx-ui 配置 `NEXT_PUBLIC_ENX_EXTENSION_ID`。**扩展 ID 是确定的**——`enx-chrome/manifest.json` 带固定 `key`，任何未打包加载 / homelab 构建都得到同一个 ID `omcdpipnjffmblbhiphddcmoldceapam`（= `SHA256(DER(key))` 前 16 字节按 a–p 映射）。所以 `enx-ui/Containerfile` 直接把它作为 `ARG` 默认值写死，homelab Tekton 流水线**不需要**为它加 `--build-arg`；未来上 Web Store 换 ID 时覆盖这个 build-arg 即可。`NEXT_PUBLIC_ENX_EXTENSION_WEB_STORE_URL` 留空 → 引导 banner 只显示文字、不带链接（扩展尚未上架，见 LAUNCH-CHECKLIST）。

**扩展探测 + 引导（`useExtensionStatus` hook）**：

- 状态机 `unknown → installed | not-installed`。
- `!chrome?.runtime?.sendMessage`（没注入 = 没装，或非 Chromium）→ `not-installed`。
- 否则发 `chrome.runtime.sendMessage(EXT_ID, { type: 'enx:ping' }, cb)`，~2s 超时：`lastError` / 超时 → `not-installed`；`{ok:true, version}` → `installed`。
- 兜底：轮询 `document.documentElement.dataset.enxExtension`（content script 打的标记，见 Option G2），覆盖 ping 慢于首屏的竞态。
- `not-installed` 时，reader 阅读态在正文上方显示一个**可关闭**的引导 banner（`sessionStorage` 记住本会话已关），文案指向 Chrome Web Store 的 ENX 上架页（URL 待扩展上架后回填，见 LAUNCH-CHECKLIST）。`installed` / `unknown` 时不显示。
- 这个 hook 独立于 reader 页，将来别的 enx-ui 页要「装了扩展才有的功能」可复用。

### 2. enx-ui：`app-nav.ts` 加一行

`NAV_MAIN` 加 `{ label: 'Reader', href: '/reader', icon: BookOpen }`。侧栏、抽屉、顶栏标题自动带上（ADR-016 决策 5）。

### 3. enx-chrome：manifest

- `content_scripts.matches` 增加 enx-ui 的 origin：`http://localhost:3000/*`、`https://enx.wiloon.lab/*`、`https://enx.wiloon.com/*`（最终品牌域待 LAUNCH-CHECKLIST §0.1 敲定后补）。
- 新增顶层 `externally_connectable`，`matches` **只**列上面这几个确切 origin——**不用** `*://*/*`。

### 4. enx-chrome：background 新增 `chrome.runtime.onMessageExternal` 处理器

外部协议是一个**固定的小词表**，两个类型都无副作用（不透传内部 `action` 字典）：

```
onMessageExternal(message, sender, sendResponse):
  0. 校验 sender.origin ∈ ENX_UI_ORIGINS（白名单常量；不信任 message 里的任何 URL / 身份声明）
  case message.type:
    'enx:ping':
      sendResponse({ ok:true, version: manifest.version })          # 只读，用于安装探测
    'enx:enable-reader':
      若 !(await isSignedIn()) → sendResponse({ ok:false, reason:'signed-out' })
      否则 chrome.tabs.sendMessage(sender.tab.id, { action: 'enxRun' })
           sendResponse({ ok:true })
    default:
      sendResponse({ ok:false, reason:'unknown-type' })
```

- 登录判断复用 ADR-015 的 Clerk 会话同步：用户在 enx-ui 已登录 → 扩展侧 `isSignedIn()` 为真。
- `enx:enable-reader` 唯一的「动作」是对 **sender 自己的 tab** 跑 `enxRun`——白名单网页不能驱动任何别的内部消息。
- content script 另外在 enx-ui 页面给 `<html>` 打 `data-enx-extension="<version>"`（探测兜底，见 Option G2）。

### 5. enx-chrome：新增 `READER_ADAPTER`

`src/lib/siteAdapters.ts` 的 `ADAPTERS` 数组（在 `X_ADAPTER` 旁）：

- `matches`: `location.hostname` ∈ enx-ui host 集合。
- `pageSupport`: `location.pathname` 以 `/reader` 开头 → `null`（支持）；否则返回英文提示串（enx-ui 的 `/lookup`、`/rephrase`、`/billing` 等页不是给扩展读的，content script 会注入但 `enxRun` 到这里被挡下）。
- `contentSelector: '#enx-reader-article'`、`minTextLength: 1`、`contentVolatility: 'static'`、`showProcessingIndicator: false`、`clickBinding: 'bubble'`。

### 6. 不做

持久化 / enx-api 端点 / enx-ui 自带查词 / 富文本 / 结构保留 / 让 `/reader` 之外的 enx-ui 页也能被扩展处理 / 在 reader 之外的页面显示引导 banner（`useExtensionStatus` hook 留着可复用，但本次只在 reader 页用）。

---

## Consequences

### Positive

- reader 页零查词代码。查词浮层、单词高亮、划词整句翻译、短语查询、按 token 计费、每日查词配额——全部自动复用 enx-chrome，且随它一起演进。
- enx-ui ↔ 扩展有了一条**明确、origin 收紧、单一动作、不透传内部消息**的通道，为将来可能的扩展（如「把 enx-ui 里选中的词发进 Side Panel」）立了先例和位置。
- 菜单项加一行，符合 ADR-016 配置化导航。
- 隐私：粘贴的文本只存在于当前标签页的内存里，不进 URL、不进后端、不落库。
- `useExtensionStatus` 顺带给 enx-ui 一个可复用的「扩展装没装 + 版本」探测能力，是把「web 用户转化成扩展用户」的一个自然入口（LAUNCH-CHECKLIST 的推广目标）。

### Negative / 风险

| 风险 | 缓解 |
| --- | --- |
| **`externally_connectable` 是新的信任边界** | `matches` 是确切 origin（非通配）；`onMessageExternal` 只认一个不透传的类型；background 只信 `sender.origin`，不信 message 内容；动作被映射成「仅对 sender tab 跑 enxRun」，不接受任意 `action` |
| **扩展 content script 首次跑在 enx-ui 自己的域名上**（含 `/lookup` 等非 reader 页） | `READER_ADAPTER.pageSupport` 把 `enxRun` 限死在 `/reader`；其它路由注入了脚本但不激活。本 ADR 显式记下这个边界 |
| **功能对没装扩展的用户是空的**——菜单项「点了没反应」 | `useExtensionStatus` 探测（Option G），`not-installed` 时 reader 页显示可关闭的 Chrome Web Store 引导 banner（决策 1 / 5）。Web Store 上架 URL 待回填 |
| **外部协议从 1 个类型变成 2 个**（`enx:ping` + `enx:enable-reader`） | 两个都无副作用、不透传内部 `action`；仍是固定小词表，不是通用 RPC。加第 3 个仍要回 Option C 评估 |
| **生产品牌域未定**（LAUNCH-CHECKLIST §0.1） | manifest `matches` / `externally_connectable` / `NEXT_PUBLIC_ENX_EXTENSION_ID` 的 prod 值等域名定了回填；homelab `enx.wiloon.lab` + dev `localhost:3000` 先跑通 |
| **扩展 ID 要在两处保持同步**（manifest `key` 决定的 ID ↔ enx-ui 配置） | manifest 有固定 `key` → ID 稳定；在 `env.ts` 和 enx-ui 配置各写一条注释互指 |
| **时序**：enx-ui 必须在 `<article>` 真正进 DOM 之后再发消息 | content script 早在 `document_end` 注入好，`enxRun` 收到时才扫描 DOM；只要 enx-ui 的 `sendMessage` 在阅读态渲染后的 `useEffect` 里发即可 |
| **reader 页会消耗每日查词配额**（ADR-018）——一次长文阅读会话点词量可观 | ADR-018 决策 8：免费上限设得「明显高于一次正常长阅读会话的点词总量的数倍」，正常用户碰不到；reader 页不引入新的配额口径 |

### Revisit Trigger

- **要加第二个「网页→扩展」动作**：重新评估要不要把 `enx:enable-reader` 泛化成带能力清单的协议，而不是一串单点类型。
- **需要 reader 页脱离扩展也能查词**（移动端 / 想给 web-only 用户价值 / 扩展未上架期间）：回到 Option A2，在 enx-ui 实现查词——那时 `content.tsx` 的浮层 + Range 展开逻辑值得先抽成跨 surface 共享包。
- **要持久化 / 多篇文档**：Option E2，加 enx-api 端点 + 表 + UI。
- **生产品牌域敲定**（LAUNCH-CHECKLIST §0.1）：回填所有硬编码域名。
- **Chrome 扩展上架 Web Store**：回填引导 banner 的安装 URL；在此之前 banner 可先隐藏或指向一个「即将上架」说明页。
- **引导转化率低 / 用户装了旧版**：把两态探测细化成「未装 / 已装 / 需升级」，banner 分级。
- **`externally_connectable` 被证明会被滥用**（有人在白名单 origin 上 XSS 后驱动扩展）：考虑加一次性 nonce / 用户在 popup 里显式授权某个 enx-ui 标签页。

---

## Out of Scope（本次不做）

- **持久化 / 「我的文档」列表**（Option E2）。
- **enx-ui 自带 click-to-lookup / fallback 查词**（Option A2）。
- **富文本 / HTML 结构保留**（标题、列表、链接）。
- **让 `/reader` 之外的 enx-ui 页也能被扩展处理**。
- **在 reader 之外的页面显示扩展引导 banner**（hook 可复用，本次只在 reader 用）。
- **深链探测 / 精确到「装了但被禁用」「装了旧版本要升级」的分级引导**——本次只分「装了 / 没装」两态。
- **`content.tsx` 浮层逻辑抽共享包**——只有真要做 A2 时才值得。
- **生产品牌域名决策**（LAUNCH-CHECKLIST §0.1，独立阻塞项）。
