# 调研：ADR-010 Phase 2 — 在 x.com 上可靠检测 SPA 内部路由切换

| 字段 | 值 |
| --- | --- |
| **状态** | 调研完成 — 2026-09-01 |
| **对应 ADR** | [`adr-010-x-tweet-page-support.md`](../architecture/adr-010-x-tweet-page-support.md) — 「分阶段路线图」Phase 2「启动前跑」调研项 ① |
| **喂给** | 后续 `/grill-with-docs` → Phase 2 ADR 决策 |
| **调研方法** | WHATWG HTML 规范、MDN、Chrome 扩展官方文档、WICG/WHATWG Navigation API 仓库；辅以 X 工程博客与扩展框架维护者（WXT）的公开说明。**浏览器扩展本次未连接，无法对 x.com 的实时 bundle 做直接观测**（见「无法验证的部分」）。 |
| **位置说明** | 本仓库此前没有 research 笔记的约定，`docs/research/` 目录由本次调研新建。 |

---

## 摘要与建议

**结论：不要从 content script 去 monkey-patch `history.pushState`/`replaceState`。**
content script 默认跑在 *isolated world*，它的 `window.history` 与页面 main world 的是**两个不同的 JS 包装对象**，在 isolated world 里改写 `history.pushState` 无法拦到 X 自己发起的 `pushState` 调用。要在 content script 世界里拦，唯一办法是再注入一段 main-world 脚本去 patch，然后用 `postMessage`/`CustomEvent` 把信号转发回来——这正是本 ADR 想避免的「patch + 反 patch 风险」路径。

**推荐主方案：`chrome.webNavigation.onHistoryStateUpdated`，监听放在 background service worker，命中 `/{handle}/status/{id}` 后 `chrome.tabs.sendMessage` 通知 content script 重跑。**
- 这是第一方 API，专门为「SPA 用 History API 改了 URL」设计，`pushState`/`replaceState`/`history.go`/前进后退都会触发。
- 代价：`manifest.json` 的 `permissions` 需新增 `"webNavigation"`（会带来安装时「读取您的浏览历史记录 / Read your browsing history」警告，这是本方案唯一的用户可见成本）。
- 现有 `src/background/background.ts` 已有 `chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })` 的下发通道（`background.ts:286`），复用即可，新增一个 `action: 'enxRerun'` 之类。

**推荐兜底：content script 内轮询 `location.href`（间隔 ~500–1000ms）+ 一个 `MutationObserver` 观察 `<title>` 或主 `article` 容器做「DOM 就绪」的二次确认。**
纯前端、零权限、零注入，缺点是有延迟、且要自己判抖动。作为「用户没授予 webNavigation 权限」或「webNavigation 事件与 DOM 就绪之间需要补一个稳定信号」时的退路。这也是成熟扩展框架 WXT 目前 `wxt:locationchange` 的默认实现（每秒轮询）。

**不推荐但可选：把 X content script 整体或部分改成 `world: "MAIN"`。**
能直接用页面的 `history` 和 `window.navigation`，但会**丢掉 `chrome.*` API**（`chrome.storage`、`chrome.runtime.sendMessage` 全部不可用），而 ENX 的查词、缓存、消息链路重度依赖这些。真要走注入路线，标准做法是「isolated world content script + 动态注入一个极小的 main-world patch 脚本」，不是把主 content script 搬过去。

**Navigation API（`window.navigation` + `navigate` 事件）**：语义上最干净（一处监听覆盖所有导航类型），Chrome 102+ 已支持，且规范已从 WICG 移入 WHATWG HTML。但**「content script 的 isolated world 里 `navigation` 对象能否收到 `navigate` 事件」没有找到第一方文档确认**（见「无法验证的部分」），在验证前不能当主方案。

---

## 1. `popstate` 语义（WHATWG HTML + MDN）

### 何时触发 / 何时不触发

MDN `Window: popstate event`（<https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event>）明确：

> "Note that just calling `history.pushState()` or `history.replaceState()` won't trigger a `popstate` event. The `popstate` event will be triggered by doing a browser action such as a click on the back or forward button (or calling `history.back()` or `history.forward()` in JavaScript)."

归纳：

| 场景 | `popstate` 是否触发 | 来源 |
| --- | --- | --- |
| `history.pushState()` / `replaceState()` 调用本身 | **否** | MDN popstate；MDN `History.pushState`（<https://developer.mozilla.org/en-US/docs/Web/API/History/pushState>）："the browser won't attempt to load this URL after a call to `pushState()`" |
| 点击浏览器 后退 / 前进 | 是 | MDN popstate |
| `history.back()` / `history.forward()` / `history.go(±n)` | 是（属于 session history 遍历） | MDN popstate（"or calling `history.back()` or `history.forward()`"）；WHATWG「traverse the history by a delta」路径 |
| 同文档 fragment（`#hash`）导航，通过前进/后退回到该条目 | 是（`popstate` 先于 `hashchange`） | WHATWG「update document for history step application」在 `documentsEntryChanged` 时 fire popstate |
| 直接 `location.hash = x` 造成的 fragment 导航 | 触发 `hashchange`，规范层面也会因新建同文档条目而走 popstate 路径（Blink 实测：popstate 同步、hashchange 异步） | whatwg/html issue #1792 |
| 初始页面加载 | **否**（现代 Chrome/Firefox 不在 load 时 fire；Safari 历史上会） | MDN popstate；whatwg/html 历史讨论 |

WHATWG HTML 对 `pushState` 与 fragment 导航在 popstate 上不一致，规范里有一段自嘲式注解（经检索确认出自 HTML Standard 的 History 接口一节，原文因规范单页体积过大未能整段抓取，见「无法验证的部分」）：

> "popstate events fire for fragment navigations, but not for `history.pushState()` calls. This is somewhat of an unfortunate historical accident, and generally leads to web-developer sadness about the inconsistency."
> — HTML Standard, §7.4 Navigation and session history（<https://html.spec.whatwg.org/multipage/browsing-the-web.html>），经 Google 检索片段确认

规范中 `popstate` 的实际触发点在算法 **"update document for history step application"**：当被应用的 history step 使「当前文档对应的 session history entry 发生变化」（`documentsEntryChanged` 为真）时，`fire an event named popstate ... using PopStateEvent`，`state` 取自新条目序列化状态。该算法由 session history 遍历（后退/前进/`go`）和「导致同文档条目变化的导航」触发，但 `pushState`/`replaceState` 走的是另一条「URL and history update steps」，该算法**刻意省略**了 fire popstate 这一步。

### Chrome 特有偏差

- fragment 导航时 Blink（和 Gecko）**同步**派发 `popstate`、**异步**派发 `hashchange`，与规范「二者用同一个 task 异步派发」不符（whatwg/html issue #1792，<https://github.com/whatwg/html/issues/1792>）。对本用例无影响——我们不依赖二者顺序。
- Chrome 不在初始 load 时 fire popstate（与 MDN 描述一致）。

### 对 Phase 2 的意义

X 切换推文是 `pushState` 驱动的**前进方向**导航，`popstate` **不会触发**。`popstate` 只在用户点「后退/前进」回到之前看过的推文时有用。**单靠 `popstate` 覆盖不了 Phase 2 的主场景**，ADR 里「patch history + listen popstate」的表述中，`popstate` 只是补齐「后退」这一半，`pushState` 那一半必须靠别的机制——而这另一半正是下面第 2、4 节的核心。

---

## 2. 从 content script monkey-patch `history.pushState`/`replaceState`

### isolated world 有独立的 `window` / `history` 包装对象

Chrome 官方文档 `Content scripts` →「Work in isolated worlds」（<https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts#isolated-world>）：

> "An **isolated world** is a private execution environment that isn't accessible to the page or other extensions."
> "This means that none of these (web page, content scripts, and any running extensions) can access the context and variables of the others."

文档给的示例：页面和 content script 各自定义同名变量/函数/监听器，互不影响，「completely separate JavaScript environments」。

DOM 是共享的（同一棵 DOM 树、同一个 `document`），但 **JS 层的内建对象和其原型是每个 world 各自一份**。`window.history` 在 isolated world 里是一个独立的包装对象，背后 C++ 的 History 是同一个，但 `history.pushState = fn` 只是在 isolated world 的包装对象上加了个 own property，页面 main world 看不到。

多个独立来源印证「isolated world 里 patch history 拦不到页面的调用」：

- WXT（主流 Web 扩展框架）issue #1567「Improved `wxt:locationchange`」（<https://github.com/wxt-dev/wxt/issues/1567>）：
  > "Monkeypatching history APIs directly in content scripts doesn't work because `history.pushState` in the content script is not the same function as in the main world, so an injected script is needed to monkey-patch these APIs."
  WXT `wxt:locationchange` **当前实现就是每秒轮询 URL**，提案中的改进方案是「注入一段 main-world 脚本去 patch `pushState`/`replaceState`，再 dispatch 自定义事件」。
- Mozilla bugzilla #1418049「Content script interaction with `history.pushState()`」（<https://bugzilla.mozilla.org/show_bug.cgi?id=1418049>）记录了同类隔离问题。

### 要在 content script 世界里拦，就得注入 main world

标准 workaround（多处一致）：
1. isolated world content script 用 `document.createElement('script')` + `src = chrome.runtime.getURL('injected.js')`（或 `world: "MAIN"` 的第二个 content script 声明）注入一段脚本到页面；
2. 该脚本在 main world 里 `const orig = history.pushState; history.pushState = function(...a){ const r = orig.apply(this, a); window.dispatchEvent(new CustomEvent('enx:locationchange')); return r }`（`replaceState` 同理）；
3. content script `window.addEventListener('enx:locationchange', ...)` 或用 `postMessage` 接收。

注入脚本需要列进 `web_accessible_resources`（如果用文件方式）。

### `world: "MAIN"` content script 的权衡

Chrome manifest 文档（<https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts>）：

> `"world"` — `ISOLATED | MAIN`，`"Defaults to \"ISOLATED\""`。
> `"Choosing the \"MAIN\" world means the script will share the execution environment with the host page's JavaScript."`
> `"There are risks involved when using the \"MAIN\" world. The host page can access and interfere with the injected script."`

代价清单：

| 维度 | isolated（现状） | MAIN |
| --- | --- | --- |
| `chrome.*` API | `chrome.storage` / `chrome.runtime.sendMessage` / `chrome.runtime.onMessage` 等可用（content script 白名单：dom、i18n、storage、runtime 的部分成员，见 Chrome content scripts 文档） | **全部不可用**——main world 代码等同页面代码，`chrome.runtime` 为 `undefined` |
| 访问页面 `window.history` / `window.navigation` / 页面变量 | 不能 | 能 |
| 受页面 CSP 约束 | 否（用扩展 CSP） | 是（用页面 CSP，X 的 CSP 较严） |
| 被页面干扰 / 反 patch | 页面碰不到 | 页面能读改注入的脚本 |
| ADR-002 弹窗（Shadow DOM + `<style>` 注入走 isolated world，不受 X CSP） | 保持 | 需重新评估 |

ENX 的 content script 重度依赖 `chrome.storage`（缓存、配置）和 `chrome.runtime` 消息链路。**把主 content script 改成 MAIN 不可行**；只能「isolated 主 + 动态注入的极小 MAIN patch 脚本」，而这就是引入「patch + 可能的反 patch」风险面的做法。

---

## 3. X / Twitter 自己的 web client 是否 patch/wrap `history`，有无反 patch

**可直接验证的**：

- Twitter 2012 年工程博客「Implementing pushState for twitter.com」（<https://blog.x.com/engineering/en_us/a/2012/implementing-pushstate-for-twittercom>）确认 twitter.com 很早就用 History API 做客户端路由，初始加载用 `replaceState` 设置初始视图状态。
- 现在的 x.com 是 React SPA，`history.state` 里能观察到 `{ userId, fromApp, previousPath }` 之类的自定义字段（多个近年 SPA 分析文章的一致描述，非第一方）。这说明 X 的路由层会**写入结构化的 `history.state`**，其 router 直接调 `pushState`/`replaceState`（无论是自研还是某版 history 库封装）。
- 这类基于 History API 的 router，`chrome.webNavigation.onHistoryStateUpdated` 都能观察到——因为该事件是浏览器在 History API 改 URL 时由 C++ 层触发的，**与页面是否 wrap 了 `pushState` 无关**。

**无法验证的**：

- X 当前 bundle 是否**自己也 wrap 了** `history.pushState`（React Router / 自研 history 封装通常会保留对原生方法的引用并在内部调用，属于「wrap」而非「防篡改」）。
- 有无**针对扩展 monkey-patch 的主动检测 / 反篡改**（例如检查 `history.pushState.toString()` 是否为 native code、`Object.freeze(history)`、用 `Object.defineProperty` 锁死）。**没有找到任何公开证据表明 X 这么做**，但 X bundle 高度压缩、变动频繁，**不能排除**。
- 由于本次浏览器扩展未连接，**没有对 x.com 实时 bundle 做 `history.pushState.toString()` / `window.navigation` 存在性 / `navigate` 事件是否触发的直接观测**。

**给 Phase 2 的实测项**（启动时在真实 x.com 控制台跑）：

```js
// a) X 是否 wrap 了 pushState（native code 说明没 wrap；函数体是 JS 说明 wrap 了）
history.pushState.toString();
history.replaceState.toString();

// b) history 对象是否被冻结 / 属性是否可改写
Object.getOwnPropertyDescriptor(History.prototype, 'pushState');
Object.isFrozen(history);

// c) Navigation API 是否存在，navigate 事件能否收到（先在页面 console 直接跑）
!!window.navigation;
navigation && navigation.addEventListener('navigate', e => console.log('navigate', e.destination.url));
// 然后点一条推文，看有没有打印

// d) webNavigation 路线不需要在页面里验证——在 background 里加监听即可
```

**关键点**：推荐主方案（`chrome.webNavigation`）**完全不碰页面的 `history` 对象**，因此 X 是否 wrap、是否反篡改，对主方案都无影响。这条不确定性只影响「注入 patch」这条备选路线。

---

## 4. 不做 patch 的第一方替代方案

### 4.1 `chrome.webNavigation.onHistoryStateUpdated` / `onReferenceFragmentUpdated`

Chrome 官方文档 `chrome.webNavigation`（<https://developer.chrome.com/docs/extensions/reference/api/webNavigation>）：

- **`onHistoryStateUpdated`**：`"Fired when the frame's history was updated to a new URL. All future events for that frame will use the updated URL."` MDN 补充（<https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onHistoryStateUpdated>）：`"fired when a page uses the History API to update the URL displayed in the browser's location bar"`，即 `history.pushState()` / `history.replaceState()` 都会触发。
- **`onReferenceFragmentUpdated`**：`"Fired when the reference fragment of a frame was updated."`（`#fragment` 变化）。X 切推文改的是 path 不是 fragment，主要靠 `onHistoryStateUpdated`；`onReferenceFragmentUpdated` 对本用例基本用不上。
- **触发时机**：`"can fire any time after onDOMContentLoaded"`，包括页面加载完成之后——正是 SPA 场景。
- **事件 payload**（`details` 对象）：`url`、`tabId`、`frameId`（0=顶层）、`frameType`、`transitionType`（如 `"link"`）、`transitionQualifiers`、`timeStamp`、`documentId`、`documentLifecycle`、`parentFrameId`、`parentDocumentId`。**给了新 URL**，可以直接对 `url` 跑 `/^https:\/\/x\.com\/[^/]+\/status\/\d+/` 判断。
- **权限**：`"All chrome.webNavigation methods and events require you to declare the \"webNavigation\" permission in the extension manifest."` → `manifest.json` `permissions` 数组加 `"webNavigation"`。这会在安装/更新时触发「读取您的浏览历史记录」权限提示（Chrome 对 webNavigation 权限的标准文案）。**不需要新增 host_permissions**（现有 `https://*/*` 已覆盖）。
- **只能在 background/service worker 里监听**：content script 能用的 `chrome.*` 仅 dom / i18n / storage / runtime 的子集（Chrome `Content scripts` 文档「extension APIs」一节）——`chrome.webNavigation` **不在其中**。因此监听必须放 `src/background/background.ts`，命中后用 `chrome.tabs.sendMessage(tabId, { action: 'enxRerun' })` 通知 content script（现有 `background.ts:286` 已有同款调用可复用）。
- **可加 filter**：`onHistoryStateUpdated.addListener(cb, { url: [{ hostEquals: 'x.com', pathContains: '/status/' }] })` 减少无关回调。
- **可靠性**：这是「SPA 用 History API」场景的第一方标准手段，`pushState`/`replaceState`/前进后退/`go` 全覆盖。已知局限：它只告诉你「URL 变了」，不保证新推文 DOM 就绪——ADR Phase 2 调研项 ②③（`tweetText` 何时稳定）仍需 content script 侧用 `MutationObserver` / 轮询探测补齐。

### 4.2 Navigation API（`window.navigation` + `navigate` 事件）

- **规范状态**：原 WICG「App History API」→ 更名「Navigation API」→ **已归档 WICG，迁入 WHATWG HTML 规范开发**（<https://github.com/WICG/navigation-api> README：`"Status: Archived! This is now developed under https://github.com/whatwg/html/"`）。MDN 标注该特性自 2026-01 起达到 **Baseline 2026**（Chrome/Edge 102+ 早已支持，Firefox/Safari 较晚跟进）。
- **`navigate` 事件**：`"fires for all types of navigations"`——链接点击、表单提交、`navigation.navigate()`、`history.pushState`/`replaceState`（会触发 `navigate` 且 `navigationType` 为 `"push"`/`"replace"`）、前进后退、fragment、reload。Chrome 官方文（<https://developer.chrome.com/docs/web-platform/navigation-api/>）：`"it will fire for all types of navigations"`。
- **要「知道 URL 变了并重跑」用哪个事件**：`navigate`（导航开始）或 `currententrychange`（已 commit）。不需要 `intercept()`。
- **content script 能否用**：`window.navigation` 是 Window 上的 Web IDL 接口，isolated world 里**应当存在**（content script 能用 `fetch`/`URL` 等 Window 接口）。但**「isolated world 的 `navigation` 对象是否会收到该文档的 `navigate` 事件」没有第一方文档说明**，且存在与 `history` patch 同类的「每个 world 各自一份对象」的隐忧。Chrome 官方文档、WHATWG 规范、WICG README **均未提及扩展/content script/isolated world**。**必须在 Phase 2 启动时实测**（用上面 §3 的脚本 c，分别在页面 console 和 content script 里试）。
- 若实测「isolated world 收得到 `navigate`」，它是**语义最优**方案：一处监听、零权限、零注入、覆盖所有导航类型，且直接在 content script 里、天然贴近「重跑」这个动作。若收不到，则回落到 §4.1。

### 4.3 轮询 `location.href` / `MutationObserver`（仅作兜底）

- content script 里 `setInterval(() => { if (location.href !== last) { last = location.href; onChange() } }, 500)`。零权限、零注入、跨 world 无障碍（`location` 是共享 DOM 对象）。缺点：轮询延迟、切换瞬间 URL 可能已变但 DOM 未就绪。
- `MutationObserver` 观察 `document.querySelector('title')` 或主推文容器 `article` 的子树变化，作为「URL 变了之后 DOM 稳定了」的二次确认信号（对应 ADR 调研项 ③）。
- WXT 的 `wxt:locationchange` 目前默认就是「每秒轮询」（issue #1567），可见这是被主流框架接受的兜底下限。
- 建议：即使主方案是 webNavigation，DOM 就绪探测这一层（`MutationObserver` + 短轮询 + 防抖）在 content script 里**都要有**——webNavigation 只解决「URL 变了」，不解决「新 `tweetText` 稳定了」。

---

## 5. 推荐（含 manifest 影响）

| 方案 | 角色 | manifest 改动 | 关键风险 / 前提 |
| --- | --- | --- | --- |
| **`chrome.webNavigation.onHistoryStateUpdated`（background 监听 → sendMessage 通知 content script）** | **主方案** | `permissions` 加 `"webNavigation"`（触发「读取浏览历史」安装提示）；`host_permissions` 不变 | 事件只给「URL 变了」；DOM 就绪要 content script 侧补探测。逻辑要放 background，不能放 content script |
| **content script 内轮询 `location.href`（~500–1000ms）+ `MutationObserver` 观察 `<title>`/`article` 容器** | **兜底 + DOM 就绪层**（无论主方案是谁都需要 DOM 就绪层） | 无 | 延迟；需防抖、需过滤 loading/骨架屏中间态（ADR 调研项 ②） |
| Navigation API `navigate` 事件（content script 内直接监听 `window.navigation`） | **候选主方案，待实测** | 无（Chrome 102+ 原生） | isolated world 能否收到 `navigate` 事件——无第一方文档，必须实测；X 可能不在 Baseline 目标之外的环境 |
| monkey-patch `history.pushState`/`replaceState` | **不推荐** | 若走注入文件：`web_accessible_resources` | isolated world patch 无效；必须注入 main world；引入 X 反篡改风险面（§3 未能排除） |
| `world: "MAIN"` content script（整体或主体） | **否决** | `content_scripts[].world: "MAIN"` | 丢失 `chrome.storage` / `chrome.runtime`，ENX 链路不可用 |

**落地形态建议**：

1. background（`src/background/background.ts`）新增
   `chrome.webNavigation.onHistoryStateUpdated.addListener(handler, { url: [{ hostEquals: 'x.com', pathContains: '/status/' }] })`；
   `handler` 里对 `details.url` 跑推文详情页正则，命中就 `chrome.tabs.sendMessage(details.tabId, { action: 'enxRerun', url: details.url })`。
2. content script 收到 `enxRerun` 后：先确认 `isEnxEnabled`（用户从没在这个 tab 开过就忽略）→ 启动一个「等新 `div[data-testid="tweetText"]` 稳定」的探测（`MutationObserver` + 短防抖，超时回退）→ 复用 Decision 7 的「先 `disableEnx()` 再 `enableEnx()`」重新武装。
3. `manifest.json` `permissions` 加 `"webNavigation"`；准备好该权限的商店描述/更新说明（用户会看到新的历史记录权限提示）。
4. 兜底：若用户环境或策略导致 webNavigation 不可用，content script 内退回 `location.href` 轮询。
5. 如果 Phase 2 启动时实测确认「isolated world content script 能收到 `window.navigation` 的 `navigate` 事件」，优先用它替换步骤 1–2 的 background 往返，**并可免掉 `webNavigation` 权限**。

---

## 无法验证的部分（flag）

1. **WHATWG HTML 规范里 `popstate` 触发步骤的逐字原文**：规范单页体积过大，`WebFetch` 多次在到达 History 接口一节前被截断。「unfortunate historical accident」那段注解经 Google 检索片段确认出自 HTML Standard §7.4，但未能整段原样抓取核对。触发点位于算法「update document for history step application」中 `documentsEntryChanged` 分支——描述基于对规范结构的既有认知，未逐字复核。
2. **isolated world 的 `window.navigation` 是否会派发 `navigate` 事件**：Chrome 官方文档、WHATWG 规范、WICG README 均无涉及 content script / isolated world。这是 §4.2 能否升为主方案的决定性未知项，**必须在 Phase 2 启动时实测**。
3. **X 当前 client 是否 wrap `history.pushState`/`replaceState`，以及有无反 monkey-patch / `Object.freeze(history)` / native-code 校验**：没有找到任何公开证据表明 X 做主动反篡改，但 bundle 压缩且频繁变动，无法排除。本次浏览器扩展未连接，**未对 x.com 实时页面做任何直接观测**（`history.pushState.toString()`、`window.navigation` 存在性、`navigate` 事件、`history.state` 结构均未实测）。§3 给出的控制台脚本用于启动时补做。
4. **`chrome.webNavigation.onHistoryStateUpdated` 在 x.com 上对每一次推文切换是否 100% 触发、有无漏报/多报**：基于 API 语义（浏览器 C++ 层在 History API 改 URL 时触发，与页面是否 wrap 无关）判断应当可靠，但未在 x.com 实测。
5. **`"webNavigation"` 权限触发的确切 Chrome 安装提示文案**（"Read your browsing history" / 中文「读取您的浏览历史记录」）来自对 Chrome 权限警告的既有认知，未逐字核对当前 Chrome 版本的实际弹窗。
6. **X 切推文时 `div[data-testid="tweetText"]` 的 DOM 生命周期**（原地改文本 vs 卸载重挂、有无骨架屏中间态）——这是 ADR Phase 2 调研项 ②，属 DOM 时序，本次纯 API/规范调研未覆盖，需真实页面实测。

---

## 来源清单

**规范 / 标准**
- HTML Standard §7.4 Navigation and session history — <https://html.spec.whatwg.org/multipage/browsing-the-web.html>
- whatwg/html issue #1792（popstate/hashchange 派发时序与浏览器实现不一致）— <https://github.com/whatwg/html/issues/1792>
- Navigation API 规范迁移（WICG → WHATWG）— <https://github.com/WICG/navigation-api>（README 顶部 Status: Archived）

**MDN（官方文档）**
- Window: popstate event — <https://developer.mozilla.org/en-US/docs/Web/API/Window/popstate_event>
- History: pushState() method — <https://developer.mozilla.org/en-US/docs/Web/API/History/pushState>
- Working with the History API — <https://developer.mozilla.org/en-US/docs/Web/API/History_API/Working_with_the_History_API>
- webNavigation.onHistoryStateUpdated — <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/webNavigation/onHistoryStateUpdated>
- Navigation API — <https://developer.mozilla.org/en-US/docs/Web/API/Navigation_API>
- NavigateEvent — <https://developer.mozilla.org/en-US/docs/Web/API/NavigateEvent>

**Chrome 扩展官方文档**
- Content scripts（含「Work in isolated worlds」）— <https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts>
- Manifest — content scripts（`world` 属性）— <https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts>
- chrome.webNavigation API 参考 — <https://developer.chrome.com/docs/extensions/reference/api/webNavigation>
- Modern client-side routing: the Navigation API — <https://developer.chrome.com/docs/web-platform/navigation-api/>

**第一方（X）**
- Implementing pushState for twitter.com（Twitter Engineering, 2012）— <https://blog.x.com/engineering/en_us/a/2012/implementing-pushstate-for-twittercom>

**第三方（框架维护者 / bug 追踪，用于佐证 isolated world patch 无效）**
- WXT issue #1567「Improved `wxt:locationchange`」— <https://github.com/wxt-dev/wxt/issues/1567>
- Mozilla bugzilla #1418049「Content script interaction with history.pushState()」— <https://bugzilla.mozilla.org/show_bug.cgi?id=1418049>
- w3c/webextensions issue #241（isolated/MAIN world 事件与通信）— <https://github.com/w3c/webextensions/issues/241>
