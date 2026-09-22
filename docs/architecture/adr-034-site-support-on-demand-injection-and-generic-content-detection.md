# ADR-034：站点支持范围从「常驻域名白名单」改为「用户触发的按需注入 + 正文结构打分识别」——X / RSSX / enx-ui 三类需要专属常驻行为的站点保留现有白名单机制

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-22，Decision 1-4 均已实现（TDD，seam 见下）。**例外**：起草过程中发现静态 `manifest.json` 的 `host_permissions` 四条（两条通配符 + `www.youdao.com` + `claude.com/blog`）均无人依赖（见 Context 更正），已清空为 `[]`——这一项独立于本决策，随手清理。**实现记录**：Decision 2 落在新文件 `src/lib/enableLearningMode.ts`（`enableLearningModeOnTab`），seam 是这个函数本身，测试见 `src/lib/__tests__/enableLearningMode.test.ts`（3 用例：已注入直接发消息 / 未注入则注入后重试 / 注入被浏览器拒绝返回 `injection-blocked`）；`enableOutcome.ts` 新增 `injection-blocked` reason（不可上报，见 `enableOutcome.test.ts`）；`Popup.tsx:handleEnableLearning` 改为调用 `enableLearningModeOnTab`。Decision 3 落在 `wordProcessor.ts`（新增 `linkDensity()` + `LINK_DENSITY_THRESHOLD = 0.5`，阈值未经真实站点样本调优，是起始值），seam 仍是 `WordProcessor.getArticleNodes()`，新增用例见 `getArticleNode.test.ts`。Decision 1 落在 `manifest.json`，8 个静态站点已从 `content_scripts.matches` 移除，`manifest.test.ts` 全绿，production/homelab 两个 target 构建验证过。合入 main 见 PR #30。**2026-09-22 补丁**：合入后在真实 InfoQ 页面上复现了 "Receiving end does not exist" 直接报给用户的问题——根因是 `chrome.scripting.executeScript` 注入的其实是 CRXJS 的 loader IIFE（`dist/assets/*-loader-*.js`），它异步 `import()` 真正的内容脚本 bundle 后就返回，`executeScript()` 的 Promise resolve 时真正的 `chrome.runtime.onMessage.addListener` 未必已经跑到；Decision 2 原实现在注入后只重发一次 `sendMessage`，输给了这个时序，未捕获的第二次失败直接把原始浏览器错误抛给用户。修复：`sendEnxRunWithRetry()` 改成退避重试（100/250/500/1000ms），仍然失败时给出 `reason: 'error'` 的干净提示，而不是原始错误串。新增 2 个用例（用 `jest.useFakeTimers()` 模拟退避）复现问题再验证修复。**这个补丁本身还不够**：退避重试上限后仍然复现（这次报的是干净的 `reason: 'error'`，不再是原始错误），拿到 InfoQ 页面真实 console 输出后发现是另一个更根本的问题——`chrome.scripting.executeScript` 之后 loader 的 `import()` 被 Chrome 直接拒绝：`"Denying load of chrome-extension://.../content.tsx-BipQx7CG.js. Resources must be listed in the web_accessible_resources manifest key..."`。查 `dist/manifest.json` 确认：CRXJS 把这个动态导入 chunk 的 `web_accessible_resources` 条目**继承了 `content_scripts[0].matches` 的范围**（现在只剩 X/RSSX/enx-ui），而不是给"动态脚本"该有的宽范围——试过 `@crxjs/vite-plugin` 文档里的 `defineDynamicResource()` 逃生舱，实测**不起作用**（loader 自己那条窄范围条目会在内部去重逻辑里"吃掉"动态 chunk，抢先声明覆盖了它）。真正生效的修复：`src/config/manifest.ts:buildManifest()` 手动追加**第二条** `web_accessible_resources` 条目——`{ resources: ['assets/*'], matches: ['http://*/*', 'https://*/*'] }`，用通配符路径 + 宽 matches，不依赖 CRXJS 的自动推导（Chrome 允许一个资源被多条 `web_accessible_resources` 同时覆盖，只要任意一条放行即可）。`manifest.test.ts` 新增用例验证这条宽范围条目存在，红→绿验证过（临时去掉这段代码复现了 `TypeError: Cannot read properties of undefined`，即之前根本没有这个字段）。三个 target（dev/homelab/production）分别构建确认都生成了这条 `web_accessible_resources`。`pnpm test` 253 用例全绿。 |
| **日期** | 2026-09-21 |
| **关联 Spec** | 无独立 TASK-SPEC；Decision 即实现依据（同 adr-012 Decision 10） |
| **关联 ADR** | [`adr-010-x-tweet-page-support.md`](adr-010-x-tweet-page-support.md)（`SiteAdapter` 骨架的来源；其 Options A3「按需注入」当时因为「只为一个站点改动公共链路，性价比低」被放弃——本 ADR 重新评估同一个选项，但目标从「一个站点」变成「注入策略本身」，性价比结论相反，见 Rationale）、[`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（`contentVolatility` 字段，本决策不改）、[`adr-033-rssx-reading-pane-learning-mode.md`](adr-033-rssx-reading-pane-learning-mode.md)（RSSX 常驻注入 + 默认展示安装态，本决策明确保留这类站点的现状） |

---

## Context

`enx-chrome/manifest.json` 的 `content_scripts[0].matches` 目前列出 11 个来源：`rssx-lab.wiloon.com`（自有产品 RSSX，见 adr-033）、`x.com`/`twitter.com`（自有 `SiteAdapter`，见 adr-010）、以及 8 个纯静态文章站点（InfoQ、NYTimes 订阅邮件页、Google Developers Blog、Microsoft Research、Reuters、anthropic.com、Anthropic Skilljar、claude.com/blog）。`enx-ui` 自己的 host（`localhost`/`enx.wiloon.lab`/`catglish.com` 等）由 `src/config/manifest.ts` 在构建时按 target 追加，不算在这 8 个之内。

这 8 个静态站点全部走 `resolveSiteAdapter()` 的 `DEFAULT_ADAPTER`（`enx-chrome/src/lib/siteAdapters.ts:56`），本身没有站点专属逻辑。它们能用，是因为 `wordProcessor.ts:getArticleNodes()`（`enx-chrome/src/lib/wordProcessor.ts:321`）已经有一份**通用 fallback 选择器列表**：命中站点专属 class（`.Article`、`.article__data`、`.blog_post_content_wrap` 等）之外，还兜底 `article`、`.content`、`.entry-content`、`.post-body` 这类跨站点通用的语义/命名模式。也就是说，**正文识别本身已经不是纯粹的「一个站点一条规则」**——真正卡住覆盖范围的是 `content_scripts.matches`：content script 只在列表里的域名上自动注入，不在名单里的站点，用户点扩展图标也没用（脚本根本不存在于那个 tab）。

**（2026-09-21 更正）** 起草本 ADR 时曾以为 `host_permissions` 已经是 `http://*/*`/`https://*/*`，本决策不受影响。查 git 历史发现这不是一个设计决定：2025-11-08 commit `896e2a2`（"add e2e test"）为跑 e2e 测试把 `content_scripts.matches` 临时改成 `<all_urls>` 等价物，同一个 commit 顺手把这两条通配符加进了 `host_permissions`；2026-01-03 commit `947479a`（"chrome extension"，看起来是为了准备上架）把 `content_scripts.matches` 收窄回了显式域名白名单，但**没有同步收窄 `host_permissions`**，两条通配符原样留到了今天——是遗留口子，不是刻意保留。

代码里也确认不到任何东西依赖这两条通配符：`src/__tests__/manifest.test.ts` 的注释写明 `host_permissions` 真正要满足的需求是 enx-api 的 base URL、enx-ui 的 origin、Clerk 的 `syncHost`（"for the Clerk session sync"），这些都由 `src/config/manifest.ts` 的 `buildManifest()` 按 target 精确追加具名域名（`enx-chrome/src/config/manifest.ts:31-36`），不在静态 `manifest.json` 里。静态清单里原本还留着 `www.youdao.com`、`claude.com/blog` 两条——复查后发现这两条同样查不到依赖：`pronunciation.ts` 播放发音用的是 `new Audio()`（域名还对不上，实际请求的是 `dict.youdao.com`），这种用法本来就不受 `host_permissions` 限制；`claude.com/blog` 在 `src` 里没有任何代码引用，是 2026-06-22 commit `049a669` 加文章站点时顺手复制进 `host_permissions` 的，其余 7 个同批加入 `content_scripts.matches` 的静态站点都没有对应条目，是不一致的遗留写法。`src` 里也搜不到任何 `chrome.cookies` 或 `chrome.scripting.executeScript` 调用。**四条都已删除**（`enx-chrome/manifest.json` 的 `host_permissions` 现在是空数组 `[]`，具名域名全部由 `buildManifest()` 按 target 动态追加），不等本 ADR 定稿——这是独立于本决策、随时该做的清理，删除后 Chrome Web Store 今天就能少掉「读取和更改您访问的所有网站的数据」这条广泛权限警告。

这也反过来支持方案 C：`manifest.json:7` 已经声明了 `activeTab` + `scripting` 权限——**配合用户手势（点图标/按快捷键）触发的 `chrome.scripting.executeScript` 只需要 `activeTab`，不需要 `host_permissions`**（`activeTab` 会在触发那一刻临时授予当前 tab 的权限）。方案 C 的「按需注入」不需要为它把 `host_permissions` 重新放开成通配符，二者是正交的：`content_scripts.matches` 决定哪些站点**常驻**自动注入，`host_permissions` 决定后台代码能对哪些具体域名做跨域 fetch / cookies 之类的编程访问，`activeTab` 则单独覆盖「用户手势触发、只作用于当前 tab」这一类操作，三者互不依赖。

需求本身来自用户观察：白名单以外、但正文结构与已支持站点雷同的站点（主流英文新闻、博客）用不了 ENX，且每加一个新站点都要走一次「实测确认结构 → 视需要写 `SiteAdapter` → 回归现有站点」的流程（adr-010 就是这类流程里最重的一次，因为 X 是 SPA）。

**（2026-09-22 更正）** 起草时把 `getArticleNodes()` 的通用识别描述成"一份 selector 列表"，遗漏了代码里其实已经有的第二层。完整读一遍 `enx-chrome/src/lib/wordProcessor.ts:321-387`，实际是两层：

1. **第一层**：按优先级遍历一份 selector 数组（站点专属 class 在前，`article` 标签/`.content`/`.entry-content`/`.post-body` 这类通用规则在后），**逐个试，第一个有命中的 selector 直接返回**，不比较后面的——不是打分，是"谁先命中谁算数"。
2. **第二层（此前遗漏）**：只有 `SiteAdapter` 没有指定专属 `contentSelector`（即走 `DEFAULT_ADAPTER` 的普通站点）、且第一层一个 selector 都没命中时才触发——扫描页面上所有 `div`/`main`/`section`/`article`，取 `textContent.length` 最大、且 `> 500` 字符的那一个当作正文。这已经是一种最原始的"结构识别"：只有一个信号（未归一化的纯文本长度），但方向和 Decision 3 想做的事是同一类。

**实测样本（2026-09-22，`curl` 抓真实站点原始 HTML，不是理论推演）**：为了判断第一层这份 selector 列表对"常规新闻站点详情页"这个场景够不够用，抽查了 4 个当前不在白名单里的真实站点——Ars Technica（命中通用 `article` 标签）、TechCrunch（没有 `<article>` 标签，命中通用 `.entry-content`）、BBC（命中通用 `article`；代码里给它写的专属选择器 `.Article` 已经因改版失效）、`nathan.rs`（个人博客，自定义 class 完全不匹配已知规则，但用了语义化 `<article>` 标签所以被接住）。四个页面**全部在第一层就被现有 selector 列表接住，且每个页面只有一个匹配节点、没有出现需要消歧义的情况**，一次都没触发第二层。这是本次评估的主要依据，样本量小（n=4，且是 `curl` 抓服务端渲染 HTML，Reuters/NYTimes 这两个已在白名单的站点因反爬无法验证），但方向上支持「第一层已经覆盖了相当一部分真实的常规新闻/博客站点，问题更多出在第二层这个粗糙兜底上，不是第一层规则不够」。

---

## Options Considered

### A. 维持纯白名单，持续往 `content_scripts.matches` 里加主流英文站点

| Pros | Cons |
| --- | --- |
| 零架构改动；每个新站点可以针对性验证正文结构，风险最低，延续 adr-010 §2 那套「实测优先」的方法论 | 覆盖率永远滞后于用户实际阅读的站点；域名表线性增长，长期看是纯维护成本；对「结构相同但未收录」的站点，用户没有任何路径能用上——这是本 ADR 想解决的核心问题，A 选项等于不解决 |

### B. `content_scripts.matches` 改为 `<all_urls>`，`getArticleNodes()` 的 fallback 升级为通用结构打分

| Pros | Cons |
| --- | --- |
| 一次性覆盖所有结构匹配的站点，不需要持续维护域名表 | content script 在**所有页面**常驻注入，包括银行、内网、聊天等与「阅读英文文章」无关、甚至敏感的页面；CWS 审核阻力显著上升（见 Context）；结构打分不可能 100% 准确，会在非文章页（列表页、应用界面、SPA 面板）上产生误判，且没有域名白名单兜底「这是已知安全的文章站点」这层信号；一旦脚本对任意站点的 DOM 都有访问面，安全评估（是否读取输入框、是否在登录页跑）会被更严格地审视，即使实现上没有做这些事也要自证 |

### C.（推荐）用户触发的按需注入 + 通用结构打分；X / RSSX / enx-ui 保留现有常驻白名单

| Pros | Cons |
| --- | --- |
| 不需要持续维护域名表；同结构站点自动可用；不常驻扩大注入面到无关站点，安全/隐私姿态和 CWS 审核压力都优于 B；X / RSSX / enx-ui 这三类**需要专属常驻行为**（SPA 路由重跑、默认展示安装态、双向消息通道）的站点不受影响，adr-010 / adr-011 / adr-033 的实现原样保留 | 需要新增一条注入触发路径：现有链路是「popup 按钮 → `chrome.tabs.sendMessage` → **已注入**的 content script」（adr-010 Options A3 讨论过的那条公共链路），要改成「未注入时先 `chrome.scripting.executeScript` 注入，再发消息」，并加重复注入守卫；非白名单站点上无法在页面加载时自动生效，用户必须手动点击/按快捷键——对习惯了「打开常读站点就自动标注」的白名单站点用户是没有变化，但对新覆盖的站点是「不如白名单站点顺手」，需要接受这个体验落差 |

### D. 保留白名单不动，只把 `getArticleNodes()` 的 fallback 升级成结构打分（不改注入范围）

| Pros | Cons |
| --- | --- |
| 改动面最小，只碰识别精度 | 不解决覆盖率问题：content script 根本没有被注入到白名单外的站点，识别逻辑再准也用不上。**只是 C 的一个子集，单独做没有意义**，除非先接受 A（继续维护白名单）作为长期策略——但那正是本 ADR 想避免的 |

---

## Decision（Proposed，待 review 确认）

推荐 **方案 C**：

1. **`content_scripts.matches` 只保留需要专属常驻行为的站点（2026-09-22 review 确认）**：不再把它当「支持站点列表」维护——名单收窄到 X/Twitter（SPA 路由重跑，adr-010）、`rssx-lab.wiloon.com`（默认展示安装态，adr-033）、`enx-ui` 自己的 host（双向消息通道，adr-019）这三类。现有 8 个纯静态站点（InfoQ、NYTimes、Google Developers Blog、Microsoft Research、Reuters、anthropic.com、Anthropic Skilljar、claude.com/blog）**从名单移除**，改走 Decision 2 的按需注入。注意「移除」改变的只是「点 Enable Learning Mode 之后要不要多一步现场注入」——不管在不在名单里，用户都必须点这个按钮才会渲染（Context 上一轮讨论已确认，`content.tsx` 没有任何「进页面自动跑」的路径），所以这不是从「自动生效」退化成「要点按钮」，而是所有站点统一成同一条「点按钮触发」路径，差别只在点击那一刻响应是否多一次注入延迟。**实施顺序**：Decision 2（按需注入）和 Decision 3（结构打分）先落地并验证，再移除这 8 个站点，避免中间状态下这些站点完全不可用。
2. **新增按需注入路径，改动收在一处**：真正的用户触发点不是「点图标」——`manifest.json` 声明了 `default_popup`，点图标/按 `Ctrl+Shift+E`（映射到 `_execute_action`）都只是打开 popup，`background.ts:403` 的 `chrome.action.onClicked` 监听器因此实际不会触发（历史遗留，`default_popup` 存在时这个事件不会 fire）。真正发起 `enxRun` 的是 `Popup.tsx:125-161` 的 `handleEnableLearning`——用户在 popup 里点 "Enable Learning Mode" 那一下。

   **现状**：`handleEnableLearning` 直接 `chrome.tabs.sendMessage(tab.id, { action: 'enxRun' })`，假设 content script 已经在那个 tab 里（靠 `content_scripts.matches` 在页面加载时自动注入）。不存在时 `sendMessage` 抛 `"Receiving end does not exist"`，`:152-159` 的 catch 分支把它翻成静态提示——"reload the extension, then refresh this page"——没有任何程序化补救。

   **改动**：捕获到这个特定错误时，不直接报错，而是 `chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [...] })` 把 content script 注入进去，再重发一次 `enxRun`。这一步能只靠 `activeTab` 成立（不需要放开 `host_permissions`），正是因为这次点击本身是真实的用户手势——`Popup.tsx:163-165` 那条注释（"a click inside the popup is a real, unforwarded user gesture"）描述的就是这个性质，`sidePanel.open()` 靠它成立，`activeTab` 的临时授权同样靠它成立。需要处理的边界：CSP 严格站点上注入失败时的提示、`chrome://`/`chrome-extension://`/Web Store 等 `scripting` API 本身禁止注入的页面（这类失败应该给出比现在更明确的提示，而不是复用"reload the extension"这句针对旧问题写的文案）。
3. **（2026-09-22 改写）不新增一层自研加权打分，改为给现有第二层兜底加一条链接密度过滤**：Context 的更正已经说明 `getArticleNodes()` 其实是两层，第一层（selector 列表）在实测样本里表现良好，真正粗糙的是第二层「页面最大文本块」——它只看纯文本长度，容易被评论区、长导航栏、友情链接列表这类"字数多但不是正文"的区块骗到。

   这类"从任意网页里挑出正文"的问题业界有成熟参照——Mozilla 的 Readability.js（Firefox Reader View、Pocket 用的算法），其中最有效、而现有代码完全没有的一条信号是**链接密度（link density）**：一个候选节点里 `<a>` 标签文本占该节点总文本的比例。导航栏、相关文章列表、评论区的链接密度普遍很高（大段文字本身就是可点击链接，或者链接前后夹杂零星文字），正文段落的链接密度普遍很低（偶尔一两个内链）。这是判断"这是不是正文"比"字数多不多"更可靠的信号。

   **不整体引入 Readability.js 这个库**：它的输出是清洗后重新序列化的 HTML 字符串，用于生成独立的"阅读模式"页面；而 enx 的点击查词、原地高亮（adr-010 Decision 4 的原地包裹策略）依赖的是**正文还留在原页面的真实 DOM 节点上**——Readability 会把整个页面克隆一份去打分清洗，跟这个前提直接冲突。只借用它的信号思路，不搬它的实现方式。

   **具体改动**：第一层 selector 列表不动。第二层「扫描 `div`/`main`/`section`/`article`，取最大文本块」的循环里，给每个候选节点加一次链接密度计算（`候选节点内所有 <a> 标签的 textContent 长度之和 / 候选节点自身 textContent 长度`），链接密度超过阈值的候选直接排除，不再参与"取最大"的比较；`> 500` 字符的下限和现有 `minTextLength` 过滤保留不变。阈值具体定多少（比如 0.3 还是 0.5）留到实现阶段用真实站点样本调，不在本 ADR 定死。
4. **识别失败时复用 adr-010 Decision 8 的 `EnableOutcome` / page report 机制**：`no-article-node` 时用户可以选择上报，这份数据反过来成为「打分规则漏掉了哪类站点结构」的持续输入，取代现在「靠人工发现新站点再手动加白名单」的方式。

**待 review 确认的问题**（不预设答案）：

- 链接密度的具体阈值不在本 ADR 定稿范围内，留到实现阶段用真实站点样本调（类似 adr-010 §2 那种「先列前提、实现前用脚本核对」的方法）。

---

## Rationale

- **不选 A**：域名表的维护成本是线性的，且对「结构相同但未收录」的站点完全不解决——这正是本次讨论的起点。
- **不选 B**：`content_scripts` 常驻注入到所有站点，是把注入面从「11 个已知安全的文章站点」扩大到「用户访问的一切」，这与「支持更多同结构文章站点」这个目标不对等——真正需要的是「能处理更多站点的能力」，不是「在更多站点上常驻」。C 用「按需」拿到了 B 想要的覆盖率，同时没有 B 的常驻代价。
- **重新评估 adr-010 Options A3**：当时否决「按需注入」是因为「只为 X 一个站点改动公共链路，性价比低」——成本固定（新增触发路径 + 重复注入守卫），收益只有一个站点，自然不划算。本 ADR 的收益是「覆盖所有结构匹配的站点」，同一笔固定成本换来的收益量级不同，结论也就相反。这不是推翻 adr-010，是同一个选项在不同范围下的重新计价。
- **D 单独不成立**：识别精度和注入范围是两个独立变量，只改前者对没被注入的站点毫无帮助。
- **放弃「多信号加权打分」，改成给现有兜底加一条链接密度过滤**：最初设想的四信号加权（`<article>`/schema.org/`og:type`/文本密度）经实测样本（4 个真实非白名单站点全部被现有第一层 selector 接住，没有出现需要打分才能消歧义的情况）证明是超前于证据的自研方案——真正薄弱的是现有第二层"最大文本块"兜底，只有一个未归一化的信号（纯文本长度），容易被评论区/导航栏这类"字多不是正文"的区块骗到。链接密度是 Mozilla Readability.js 验证过多年、专门解决这个问题的信号，比自己拍四个权重更有依据。
- **不整体引入 Readability.js**：它按"生成独立阅读页面"设计，输出清洗后重新序列化的 HTML，会把原页面克隆一份处理；enx 的点击查词、原地高亮必须留在原页面真实 DOM 节点上（adr-010 Decision 4），两者的前提直接冲突。只借用链接密度这一个信号，不引入整个库或它的清洗流程。

---

## Consequences

### Positive

- 不再需要为每个新的同结构站点单独走「加白名单」流程；覆盖率取决于识别逻辑的准确度，而不是维护者是否发现并添加了这个域名。
- 不常驻扩大注入面，安全/隐私姿态优于方案 B；方案 C 的按需注入靠 `activeTab` 实现，不需要放开 `host_permissions`——顺带发现并清理了 `host_permissions` 里两条无人依赖的遗留通配符（见 Context 更正），CWS 的广泛权限警告不增反减。
- X / RSSX / enx-ui 三类站点的现有实现（adr-010、adr-011、adr-033）不受影响，风险隔离在新增的按需注入路径里。
- 复用 adr-010 Decision 8 已落地的 `EnableOutcome` / page report 基础设施，不需要新造一套「识别失败上报」机制。

### Negative

- 需要新增并维护一条注入触发路径（探测是否已注入 + `chrome.scripting.executeScript` + 重复注入守卫），这条路径此前被 adr-010 判定为「性价比低」而搁置，现在要正式实现。
- 8 个静态站点移出白名单后，点 Enable Learning Mode 那一下会多一次现场注入的延迟（此前是「脚本已就位，点了立即处理」，之后是「点了先注入再处理」）——不是「从自动生效退化成要点按钮」（两种情况都要点按钮，见 Decision 1），但响应速度上是一个可感知的变化，需要在实现时衡量注入耗时是否明显。
- 链接密度过滤不可能对所有站点都准确：正文里嵌了大量内链的技术文章（比如密集引用其它文章的博客）可能被误判成"不是正文"而漏掉；结构特殊的真实文章页也可能两层都识别不到。需要 page report 机制作为持续反馈渠道，而不是追求一次性做对。

---

## Out of Scope（本次不做）

- 链接密度的具体阈值——留到实现阶段用真实站点样本决定。
- **整体引入 Mozilla Readability.js（或同类第三方正文提取库）**——理由见 Rationale：它的输出模型（清洗后重新序列化 HTML）跟 enx 必须留在原页面真实 DOM 节点上这个前提冲突。只借用链接密度这一个信号，不引入库本身。
- 「用户手动框选正文区域」这类兜底交互——现有白名单机制也没有这层，不因本决策而新增。
- X / RSSX 这类需要 `MutationObserver`/SPA 路由监听的动态页面，继续逐站点走专属 `SiteAdapter`，不受本决策影响。

---

## Revisit Trigger

- **按需注入路径的实现成本远超预期**（例如与现有 popup → `sendMessage` 链路耦合过深、CSP 导致大量站点注入失败）：可以先退回方案 A 应急（继续维护白名单），同时保留本 ADR 作为长期方向，不必推翻。
- **链接密度过滤在实测中误判率过高**（例如相当比例的主流新闻站点识别不到正文，或非文章页大量误触发）：重新评估是否要引入 Readability.js 的更完整信号集（关键词匹配、段落密度等），而不是止步于单一的链接密度过滤——引入方式仍是「借用信号，不借用它的 HTML 清洗输出」，见 Rationale 对整体引入该库的排除理由。
- **8 个静态站点移出白名单后，现场注入的延迟成为明显投诉来源**（例如注入 + 处理耗时肉眼可感知的卡顿）：重新评估是否要为「用户常读的几个站点」提供某种可选的预注入机制（例如按用户自己维护的一份本地列表，而非集中维护的产品白名单），把延迟换回去。
