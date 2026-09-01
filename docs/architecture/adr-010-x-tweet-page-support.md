# ADR-010：支持 X（Twitter）推文详情页的主推文正文——用原地文本节点包裹替代 innerHTML 重写，并把站点差异收进 SiteAdapter

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-08-29（同日据评审意见把范围从"主推文 + 评论区"收窄为"仅主推文正文"，影响见 Context 边界 2） |
| **日期** | 2026-08-29 |
| **关联 Spec** | 配套 TASK-SPEC 留到编码阶段再写（同 ADR-008 的做法）；本 ADR 只定技术路径与边界 |
| **关联 ADR** | [`adr-007-drag-select-sentence-translation.md`](adr-007-drag-select-sentence-translation.md)（划词整句翻译，本决策不改其分级逻辑，只需确认 `mouseup` 在 X 上不被抢）、[`adr-008-phrase-selection-context-translation.md`](adr-008-phrase-selection-context-translation.md)（短语查询依赖"选区内能找到 `.enx-word` 锚点"这个前提，本决策必须保持该前提成立）、[`adr-002-word-popup-react-shadow-dom.md`](adr-002-word-popup-react-shadow-dom.md)（Shadow DOM + Popover 弹窗，在 X 上无需改动，见 Consequences） |

---

## Context

`enx-chrome` 目前 `manifest.json` 白名单里的 9 个站点（InfoQ、NYTimes、Reuters、claude.com/blog 等）全部是**服务端渲染的静态文章页**：正文是一大块连续文本，DOM 渲染完就不再变，页面自身也不会在正文上抢点击事件。整条 pipeline（`processArticleContent` → `getArticleNodes` → `renderWithHighlights` → `addWordClickListeners`）是建立在这三个隐含前提上的。

需求：用户在读英文推文时也想用 ENX。交互路径与现有站点完全一致——打开一条推文详情页 → 点击扩展图标 → 点 "Enable learning mode"（`Login.tsx:103` 发 `enxRun`）→ 推文正文的单词被下划线标注，点词查词、划词整句翻译照常工作。

**本次范围已与用户确认的四条边界**（不在本 ADR 重新论证；这四条都是**阶段性**排除，不是永久放弃——最终目标与完整路线见下方「分阶段路线图」章节）：

1. **只作用于推文详情页** `https://x.com/{handle}/status/{id}`。首页时间线、搜索结果、个人主页等列表页不处理。
2. **只处理该页的主推文正文**。评论区、祖先推文（当前推文是某个对话的一环时显示在它上方的那些）、作者自己的连续串（self-thread）都不处理。
3. **只处理点击 "Enable learning mode" 那一刻 DOM 里已经存在的内容**，不做 `MutationObserver` 增量处理。
4. **页内切换到另一条推文后，ENX 状态不保持是预期行为**，不做 SPA 路由监听。

边界 2 是本 ADR 定稿前收窄的一次范围调整。收窄换来的：X 的"点击推文跳转详情"只发生在评论/祖先推文上，主推文自身不可点击跳转，因此**点击事件冲突这条风险基本消失**（Options F），虚拟列表回收导致高亮丢失的问题也基本消失。收窄同时**新增**了一个问题：全都处理时不需要判断"哪个是主推文"，只处理主推文就必须有一个判据（Options B 的第二张表）。核心风险（在 React 树上写高亮）不受范围影响，一分没省。

X 是第一个 **React SPA** 目标站点，上面三个隐含前提里**前两条明确不成立**（DOM 被 React 持有、正文是一小块短文本），第三条（页面不抢点击）在收窄到主推文后**大概率成立但仍需实测**（前提 §2.5）。所以这不是"往 selector 列表里加一行"的改动。本 ADR 要决定的是：注入范围、主推文正文节点怎么定位、站点差异如何表达、**高亮怎么写进一棵 React 管理的 DOM 树**（核心风险）。

---

## 分阶段路线图（Roadmap）

**最终目标**：在 X 上让 ENX 辅助阅读推文**正文与评论区**，页内切换推文后正文与评论区都能自动重新渲染。

本 ADR 只对 **Phase 1** 做技术定稿（Decision 1–7）。Phase 2–4 在此只给方向、依赖关系和前期调研项，具体技术决策留到各自启动时另写 ADR 或在本 ADR 追加 Decision。四条边界、Out of Scope、Revisit Trigger 里那些"本次不做"的条目，全部可以映射到下面某个 Phase。

| Phase | 交付 | 触发方式 | 依赖 | 主要新增技术 | 可行性 | 最大风险 |
| --- | --- | --- | --- | --- | --- | --- |
| **1（本次）** | 单条推文详情页的**主推文正文**辅助阅读 | 手点 "Enable learning mode" 一次 | — | 原地文本节点包裹（D2）、`SiteAdapter` 骨架、取词/高亮共用一次遍历（E2） | 高 | 前提 §2.4：原地包裹与 React 是否共存 |
| **2** | 页内切换推文后**主推文正文自动重新渲染** | 监听 SPA 路由，命中 `/status/{id}` 自动重跑 | 1 | `history` API patch + `popstate` 监听；"新推文 DOM 就绪"的时序探测 | 高 | 时序：X 切推文时 `tweetText` 何时稳定；`wordCache` 跨推文只增不减 |
| **3** | **评论区 + 祖先推文 + self-thread** 辅助阅读 | 手点 Enable（未合入 Phase 2 时）/ 自动（已合入时） | 1 | Options F3（document 捕获阶段点击委托）；`MutationObserver` + 防抖批量查词；虚拟列表回收后的重新上色 | 中 | 虚拟滚动：节点被 React 销毁重建后如何稳定地重新上色；评论上的"点击跳转详情" handler |
| **4** | 切换推文后**正文与评论区一起自动渲染**，无限滚动的新评论持续标注 | 全自动 | 2 + 3 | 主要是 2、3 的集成；`SiteAdapter` 加 `incremental: boolean` | 中 | 集成层：路由切换与 `MutationObserver` 生命周期的协调（旧 observer 必须断开） |

Phase 3 落地后 `focusedNodeResolver`（B'1）可以删掉——那时全页 `tweetText` 都处理，不再需要"哪个是主推文"的判据。

### 各 Phase 的前期技术调研

**Phase 1**：§2 的五条前提 + 附录脚本，已列全，是动手的前置条件。

**Phase 2**（启动前跑）：

1. patch `history.pushState`/`replaceState` 是否可靠——X 自身是否也 patch 了、有无反 patch 检测；`popstate` 在前进/后退上是否都触发。
2. `pushState` 触发后到新推文 `div[data-testid="tweetText"]` 内容稳定，中间经历哪些状态：是"旧节点原地改文本"还是"旧节点卸载 → 新节点挂载"？有没有骨架屏 / loading 中间态会误触发重跑？
3. 有没有比轮询更干净的就绪信号：`article[tabindex="-1"]` 的出现、某个 `aria-live` 区域的更新、`document.title` 变化。
4. `wordCache` 在多次切换后的体积增长实测——是否需要按推文 ID 分桶或设 LRU 上限。

**Phase 3**（启动前跑，工作量最大的一次调研）：

1. 评论区容器结构：虚拟列表的滚动容器是谁、每条评论的 `article` 如何进出 DOM、`data-testid` 在评论上是否同样是 `tweet` / `tweetText`。
2. 回收机制：划出视口的评论 `article` 是被 `display:none` 还是真的从 DOM 移除？滑回来时是同一个节点还是新建？——决定"重新上色"是"补挂监听"还是"整段重跑"。
3. 评论 / 祖先推文上的导航 handler：挂在哪个元素、冒泡还是捕获、`click` 还是 `pointerdown` / `mousedown`——验证 Options F3 的捕获委托能拦住。
4. 祖先推文与 self-thread 的判别：Phase 1 的 `focusedNodeResolver` 反过来——如何排除"不该处理的 UI 文本"但保留所有真实推文正文。
5. `MutationObserver` 挂在哪一层、防抖窗口多大：既要覆盖无限滚动新增，又不能每次微小 DOM 变动都触发全量查词。

**Phase 4**：主要是集成验证，无独立调研——确认路由切换时旧的 `MutationObserver` / document 监听被正确清理，不泄漏、不重复触发。

### 可行性总评

- **Phase 1、2 可行性高**：核心算法（原地包裹、重新武装）Phase 1 就落地；Phase 2 只是加一个触发器，真正的不确定性是"新推文何时渲染完"这个可探测的时序问题，不是能力缺口。
- **Phase 3 是整条路线的技术分水岭**：虚拟列表回收后的重新上色没有现成方案，且 §2.4（原地包裹 vs React）的风险在评论这种高频重渲染场景下被放大。如果 Phase 1 手测就发现 React 频繁报错，Phase 3 大概率要整体改走 Options D3（CSS Custom Highlight API），并连带重写 ADR-008 的短语锚点定位——那是一次独立的大 ADR。
- **建议节奏**：Phase 1 上线后**先观察一段真实使用**，用 Revisit Trigger 里"主推文能用但评论区读不了成为主要痛点"这条来决定先做 Phase 2 还是直接跳 Phase 3，而不是死按编号推进。

---

## 1. 现有实现与 X 的四处冲突

### 1.1 `articleNode.innerHTML = highlightedHtml`（`content.tsx:559`）

现在的高亮是"读出整块 innerHTML → 在游离的 `tempDiv` 里包裹 → 整体写回"（`wordProcessor.ts:51-190`）。写回这一步会把正文容器下**所有真实 DOM 节点销毁重建**。在静态页面上没有代价，在 X 上：

- 新节点上没有 React 的 `__reactFiber$` 属性，React 事件系统找不到对应的 fiber，推文内部的交互（展开长文、图片查看、内联链接）失效；
- React 后续对这棵子树做 reconciliation 时，持有的是已被销毁的旧节点引用，轻则更新静默丢失，重则在页面里抛 `NotFoundError: Failed to execute 'removeChild' on 'Node'`。

主推文虽然不像评论那样被虚拟列表回收，但它同样是 React 渲染并持有引用的节点（"Show more" 展开、图片查看、内联链接都挂在这棵子树上），`innerHTML` 整体替换对它一样是破坏性的。**范围收窄不能免掉这条改造。**

### 1.2 `>100` 字符阈值（`wordProcessor.ts:221`）

`getArticleNodes()` 对每个 selector 的匹配统一要求 `textContent.trim().length > 100`。推文正文上限 280 字符，短推文（"That's only the first step." 这类）远低于 100 字符——按现有阈值会被整体过滤掉，只剩长推文能用。

### 1.3 取词文本来自 `cleanArticleText()` 的 `textContent`（`content.tsx:459` → `wordProcessor.ts:257`）

两个问题在 X 上被显著放大：

- **`<a>` 内文本没被排除**。`cleanArticleText` 只剥 `script/style/noscript`，而高亮阶段的 TreeWalker 排除了 `a/button/code/pre` 等（`wordProcessor.ts:87-104`）。结果是 `@teslaownersSV`、`#hashtag`、外链锚文本会被送去后端查词、计入 `LoadCount` 统计，却永远不会被高亮。X 上这类 token 密度极高。
- **`textContent` 会把换行处的两个词粘连**。`textContent` 不产出任何换行分隔符，如果 X 的推文换行是 `<br>` 或相邻块级元素，"...THE REAL ENDGAME" + "Most people..." 会被拼成 `ENDGAMEMost`，`extractWords` 的 `\b` 正则把它当成一个词——`endgame` 和 `most` 都不会进 `wordCache`，因此**每一行的行尾词和下一行的行首词都不会被高亮**。这是 X 上肉眼可见的缺陷，静态文章页因为正文都在 `<p>` 里、`textContent` 拼接处本来就带空白，所以从没暴露过。

### 1.4 白色下划线在深色背景上现形（`wordProcessor.ts` 高亮标记 / `content.tsx` `updateWordHighlighting`）

`getColorCode()` 对"不该高亮"的词（已掌握 / 已知词性 / `LoadCount === 0`，即绝大多数常见词）返回 `#FFFFFF` 作为哨兵值，但高亮标记仍然照写 `text-decoration: #FFFFFF underline`——是一条**白色**下划线，而不是**没有**下划线。9 个现有站点正文背景都是白的，白线不可见，从没人发现；X（尤其深色模式）背景不白，于是**每一个词底下都有一条白线**。`updateWordHighlighting` 在查词 / 标记掌握后也有同样的问题：本该去掉下划线，实际设成白线。

修复：新增 `WordProcessor.getTextDecoration(wordData)`，`#FFFFFF` 时返回 `'none'`，否则返回 `'<hsl> underline'`；高亮标记和 `updateWordHighlighting` 都改用它。`<u class="enx-word">` 包裹照旧（保证任何查过的词都可点击），只是默认不画线。这是**跨站点**行为修正，但对现有站点是"白线→无线"，视觉上等价（白底上本来就看不见）。

---

## 2. 待实测确认的前提

本 ADR 的 DOM 层面判断来自对 X 结构的已有认知，**尚未在真实页面上验证过**（调研时浏览器扩展未连接）。以下五条必须在动手前用附录的控制台脚本确认，其中第 2、3 条会直接改变 Decision 的分支选择。ADR-007/TASK-SPEC-claude-blog 的经验（§4.4.2/§4.4.3 两轮返工）已经说明：selector 与页面行为光靠读源码调研容易出错。

验证要用**两种页面**各跑一遍：(a) 一条独立推文（无祖先、无 self-thread），(b) 一条身处对话中的推文（上方有祖先推文、下方有作者连续串）。前提 2 只在 (b) 上才能真正被证伪。

| # | 假设 | 为什么重要 | 若不成立 |
| --- | --- | --- | --- |
| 1 | 主推文正文容器是 `div[data-testid="tweetText"]` | Decision 2 的选择器基础 | 退回 `article[data-testid="tweet"]` + 在适配器里额外排除 UI 文本 |
| 2 | 主推文所在的 `article` 能被稳定识别（候选判据：`article[tabindex="-1"]` / 正文字号显著大于其它推文 / `article` 内没有指向自身 status 的链接） | 范围收窄到"只处理主推文"后新增的前提，决定 Decision 2 的 `focusedNodeResolver` 怎么实现 | 退回"取 DOM 顺序第一个 `tweetText`"，并接受在对话串页面上可能选中祖先推文（见 Consequences） |
| 3 | 推文内换行由 `<br>` 表达（而非各行独立块级元素） | 决定 Decision 5 的换行修复用哪种实现 | 若是块级元素，边界判定条件从"遇到 BR"改为"遇到块级元素边界"，算法本身不变 |
| 4 | 原地文本节点包裹后，"Show more" 展开、图片查看、滚动不会让 React 报错 | Decision 4 的可行性前提，**风险最高的一条** | 退回 Options D3（CSS Custom Highlight API），本 ADR 需重写 |
| 5 | 主推文正文上点击时，X 不会跳转/不会吞掉 `click`（详情页的主推文本身不是"点击跳转详情"的目标） | 决定 Decision 6 能不能沿用现状（零改动） | 升级到 Options F3（document 捕获委托），实现已在 F3 里写好，只是本次不做 |

---

## Options Considered

**A. content script 的注入范围**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1.（采用）manifest 匹配整个 `x.com`/`twitter.com`，在 `enxRun` 处理时按 `location.pathname` 判断是否推文详情页 | `matches` 加 `https://x.com/*`、`https://twitter.com/*`；content script 常驻但默认什么都不做，只有收到 `enxRun` 才动作 | 用户从首页点进推文是 SPA 内部跳转、**不会重新注入 content script**，只有整域注入才能保证进到推文页时脚本已在；判断逻辑放运行时也便于给列表页返回明确提示 | content script 在 X 全站加载（含首页/私信）。代价可控：脚本顶层只注册一个消息监听 + 注入一段 CSS（`content.tsx:986`），不触碰 DOM |
| A2. 用窄 match pattern `https://x.com/*/status/*` | 只在推文页注入 | 注入面最小 | **不可行**：SPA 跳转不触发注入，用户从首页点进推文时脚本根本不存在，点 Enable 会报 "Receiving end does not exist"（`Login.tsx:127` 已有的兜底文案），必须刷新页面才能用 |
| A3. 不声明 content script，由 background 在图标点击时 `chrome.scripting.executeScript` 按需注入 | 零常驻 | 注入面最小且无 SPA 时序问题 | 现有触发链路是"popup 按钮 → `chrome.tabs.sendMessage` → 已注入的 content script"，改成按需注入要新增一条独立的触发路径 + 重复注入守卫，为了一个站点改动公共链路，性价比低。留作 Revisit |

**B. 正文节点怎么选**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. `article[data-testid="tweet"]` | 一条推文一个，彼此不嵌套，现有 `selectors` 里的 `'article'` 其实已经能命中 | 改动最小 | 会把用户名、`@handle`、时间戳、转发/浏览数、按钮文案一起当正文；这些噪声进不了高亮（TreeWalker 排除了 `a`/`button`），但会进查词请求，污染 `LoadCount` 统计 |
| B2.（采用）`div[data-testid="tweetText"]` | 精确命中推文正文本身 | 正文范围精确；`@handle`/`#hashtag`/外链是 `<a>`，已被 TreeWalker 排除；emoji 是 `<img>`，不受影响 | 依赖 X 的 `data-testid`（前提 §2.1）。X 改版会失效，但失效表现是"没有节点被处理"，属于功能降级不是报错 |
| B3. 让用户手动框选要处理的区域 | 新增一层交互 | 最灵活 | 与现有"点一下就用"的交互模型不一致，且本次目标是"和其它站点一样"，不引入新概念 |

**B'. 从多个 `tweetText` 里怎么认出主推文**（范围收窄到只处理主推文后新增的问题；详情页上除评论外，还可能有祖先推文和作者 self-thread，所以"第一个"不等于"主推文"）

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B'1.（采用，待实测选定具体判据）适配器提供一个 `focusedNodeResolver(nodes)`，从 selector 命中的全部节点里挑出主推文那一个 | 判据三选一，按实测可靠性排序：① 主推文所在 `article` 的 `tabindex="-1"`（其余为 `0`）；② 主推文正文字号显著更大（`getComputedStyle(el).fontSize`，约 23px vs 15px）；③ 该 `article` 内不含指向自身 `/status/{id}` 的链接 | 判据集中在适配器里一处；返回 `Element[]`（长度 1）即可复用现有的多节点处理循环，`content.tsx` 的主流程不用改 | 三条判据都依赖 X 当前的实现细节，改版可能失效；失效表现是"选中了错误的推文"而不是报错，比 selector 失效更隐蔽 |
| B'2. 取 DOM 顺序第一个 `tweetText` | `querySelectorAll(...)[0]` | 最简单 | **在对话串页面上会选错**：祖先推文排在主推文前面，用户点开的那条反而不会被处理。作为 B'1 全部判据都失败时的兜底 |
| B'3. 干脆处理页面上全部 `tweetText`（即原方案） | 不做判别 | 不需要任何判据，代码更少 | 与已确认的边界 2 冲突；且会把点击冲突（Options F）和虚拟化高亮丢失重新引进来 |

**C. 站点差异怎么表达**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 继续往 `getArticleNodes()` 的 `selectors` 数组里加一行 | 加 `'[data-testid="tweetText"]'` | 零结构改动。且该 selector 在其它站点不命中，无副作用 | **表达不了 X 需要的其余差异**：`>100` 阈值要放宽、要从多个匹配里挑出主推文、高亮策略要换、完成提示条要关掉。这些没有一个能塞进一个扁平字符串数组 |
| C2.（采用）引入 `SiteAdapter`：按 host 匹配，携带 selector、最小文本长度、主推文判别、高亮策略、是否显示提示条等字段 | 新增 `src/lib/siteAdapters.ts`，导出 `resolveSiteAdapter(location)`；未命中时返回一个"默认适配器"，其字段值就是今天的行为 | 站点差异集中一处，X 之后如果再接 Reddit/HN 这类 SPA 有现成挂点；默认适配器保证 9 个现有站点行为逐字节不变 | 新增一层间接。可接受——这层间接正是为了避免把 4 个 X 专用的 `if (isX)` 散进 `content.tsx` |

**D. 高亮怎么写进 DOM（核心决策）**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1. 维持 `innerHTML` 整体替换 | 现状 | 零改动 | 见 §1.1，在 X 上直接破坏 React。**排除** |
| D2.（采用）原地文本节点包裹：TreeWalker 遍历**真实 DOM** 的文本节点，对命中的节点执行 `parent.replaceChild(fragment, textNode)` | `renderWithHighlights` 内部**已经是**这个算法（`wordProcessor.ts:81-179`），只是它跑在游离的 `tempDiv` 上再序列化回去。把核心抽成 `applyHighlightsToDom(root, wordDict)`，`root` 传 `tempDiv` 就是现有行为，传真实节点就是原地包裹 | 只替换我们自己命中的文本节点，React 拥有的**元素**结构一动不动；即使 React 后来要更新那个文本节点，它持有的引用已指向游离节点，是静默失效而非崩溃；**几乎零新增算法**，现有的 flex 修复、空白保留等既有行为全部保留 | 仍然是在动 React 管理的树，理论上存在 React 恰好要 `removeChild` 我们替换掉的那个文本节点从而抛错的路径（推文正文是静态文本，实际概率低，但必须实测——前提 §2.4） |
| D3. CSS Custom Highlight API（`Range` + `::highlight()`） | 完全不改 DOM，用 Range 标注 + CSS 伪元素上色 | 零 DOM 改动，天生免疫 React 重渲染，是理论最优解 | 改动面大得多：点击命中要用 `caretPositionFromPoint` 自己算词边界；30 档颜色要注册多个 `Highlight` 对象；**并且会破坏 ADR-008 的前提**——短语查询依赖"选区内能找到 `.enx-word` 元素"来定位句子，没有真实元素这条路径要重写。作为 D2 实测失败后的退路，见 Revisit Trigger |

**E. 取词文本从哪来**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| E1. 维持 `cleanArticleText()` + `extractWords()` | 现状 | 零改动 | 见 §1.3 的两个问题（`<a>` 未排除、换行粘连），在 X 上都是可见缺陷 |
| E2.（采用）取词复用高亮的同一次 TreeWalker 遍历：`collectTextNodes(root)` 返回过滤后的文本节点数组，取词阶段把它们用空格连接后交给 `extractWords`，高亮阶段直接对同一批节点做替换 | 一次遍历、一套过滤规则同时服务取词和高亮 | 两个阶段的过滤规则**天然不可能再漂移**（这正是 §1.3 第一个问题的成因）；用空格连接顺手解决了换行粘连中"取词"那一半；`<a>` 排除免费获得 | 只对走原地包裹策略（即 X）的路径生效。9 个现有站点仍走 `cleanArticleText`，§1.3 的问题在它们身上还在——本次不动，避免同时改 10 个站点的行为（见 Out of Scope） |

**F. 点击事件怎么和 X 的跳转共存**（范围收窄后这条风险大幅下降：会"点击跳转详情"的是评论和祖先推文，主推文在自己的详情页上不是跳转目标）

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| F1.（采用）维持每个 `.enx-word` 元素上挂冒泡阶段监听（`content.tsx:605-618`，已有 `preventDefault + stopPropagation`） | 现状，零改动 | 范围收窄后主推文正文上没有需要抢的跳转 handler（前提 §2.5）；一行代码都不用改，也不用给适配器加 `clickBinding` 字段 | 若前提 §2.5 被证伪（主推文上仍有 handler，或它挂在捕获阶段/`pointerdown` 上），需要升级到 F3。最坏情况是点词跳转到当前页自身，页面重渲染、高亮丢失——影响可感知但不致命 |
| F2. 每个 `.enx-word` 元素上挂捕获阶段监听 | 改一个参数 | 能拦元素自身的捕获阶段 | 元素自身的捕获阶段仍晚于祖先的捕获阶段，拦不住注册在祖先上的捕获 handler。**不解决问题**，排除 |
| F3. 在 `document` 上挂**捕获阶段**的委托监听，`event.target.closest('.enx-word')` 命中就 `preventDefault + stopPropagation` | 一个监听替代 N 个 | `document` 是捕获链的起点，早于 X 注册在任何祖先元素上的 handler；监听数量与词数解耦；节点被 React 重建后依然有效 | 本次范围下用不上，且会额外引入一条与现有站点不同的路径。**留作 F1 实测失败时的升级方案，以及将来扩展到评论区时的必选项**（那时评论确实会跳转） |

**G. 重复点击 "Enable learning mode"**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| G1. 维持 `enableEnx` 的早返回（`content.tsx:871-874`，已启用则直接 `return false`） | 现状 | 零改动 | **在 X 上是 bug**：SPA 跳到另一条推文后 `isEnxEnabled` 仍为 `true`，但页面 DOM 已经换掉，此时点 Enable 完全没反应，用户只能刷新页面。这与已确认的边界 4（"状态不保持是预期"）不冲突——状态可以不保持，但按钮必须能重新点 |
| G2.（采用）`enxRun` 收到时若已启用，先 `disableEnx()` 再走完整的 `enableEnx()` | 语义从"启用一次"变成"重新武装" | 三行改动；`disableEnx` 已有完整的解包裹逻辑（`content.tsx:918-923`）；`wordCache` 保留，重复的词不会再打后端 | 对现有站点也是行为变化：以前在已启用页面上再点一次是 no-op，之后会重新处理一遍。这是改善（现在的 no-op 没有任何用户价值），但属于跨站点行为变更，需要 review 确认 |

**H. 非英文推文**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| H1.（采用）不做语言过滤 | `extractWords` 本来就只挑 `[a-zA-Z]` token（`wordProcessor.ts:9`），中文/日文推文自然产出零个词 | 零改动，零误伤 | 中英混排推文里的英文词仍会被处理——这其实是想要的 |
| H2. 按 `tweetText` 的 `lang` 属性过滤，只处理 `lang^="en"` | 少发一些查词请求 | 省一点后端调用 | `lang` 由 X 自动检测，短文本/中英混排上不可靠；误判会让整条推文查不了词，代价大于收益 |

---

## Decision

### 1. 注入范围（采用 A1）

`manifest.json` 的 `content_scripts[0].matches` 新增 `https://x.com/*` 与 `https://twitter.com/*`（后者会 302 到前者，但重定向前 content script 已注入，保留以防历史链接）。**`host_permissions` 无需改动**——现有配置已含 `http://*/*` 与 `https://*/*`。

`enxRun` 的处理增加前置判断：适配器命中 X 但 `location.pathname` 不匹配 `/^\/[^/]+\/status\/\d+/` 时，不做任何处理，返回 `{ success: false, error: 'ENX 目前只支持 X 的推文详情页，请先点开一条推文' }`，由 `Login.tsx:130` 现有的错误展示路径显示给用户。

### 2. 站点适配器（采用 C2 + B2 + B'1 + H1）

新增 `src/lib/siteAdapters.ts`：

```ts
export interface SiteAdapter {
  name: string
  matches: (location: Location) => boolean
  /** 覆盖 getArticleNodes 的选择器；未提供则走现有的 selectors 列表 */
  contentSelector?: string
  /** getArticleNodes 的最小文本长度阈值 */
  minTextLength: number
  /** 从 selector 命中的全部节点里挑出真正要处理的那些；未提供则全部返回（现状） */
  focusedNodeResolver?: (nodes: Element[]) => Element[]
  /** 'innerHTML'（现状）| 'inPlace'（原地包裹） */
  highlightStrategy: 'innerHTML' | 'inPlace'
  showProcessingIndicator: boolean
}
```

默认适配器（所有现有站点）：`{ minTextLength: 100, highlightStrategy: 'innerHTML', showProcessingIndicator: true }`，`focusedNodeResolver` 不提供——**逐字段等于今天的行为**，现有 9 个站点不应有任何可观察的变化。

X 适配器：`{ contentSelector: 'div[data-testid="tweetText"]', minTextLength: 1, focusedNodeResolver: pickFocusedTweet, highlightStrategy: 'inPlace', showProcessingIndicator: false }`。

**没有 `clickBinding` 字段**：范围收窄到主推文后 Options F 选择了 F1（维持现状），不需要这个维度。扩展到评论区时再加（见 Revisit Trigger）。

`pickFocusedTweet` 按前提 §2.2 实测选定的判据实现，找不到时退回 `nodes[0]`（Options B'2 的兜底），并打一条 `console.warn` 便于事后定位。返回值恒为长度 0 或 1 的数组，`content.tsx` 现有的"对每个节点分别处理"循环原样复用。

`getArticleNodes()` 签名改为接收适配器（或接收 `{ selectors, minTextLength }`），内部现有的"排除嵌套匹配"逻辑（`wordProcessor.ts:222-225`）保留——`tweetText` 之间本来就不嵌套，逻辑空转，无害。

`minTextLength: 1` 而非 0：过滤掉纯 emoji / 纯链接的空正文节点。纯图片、纯视频的主推文因此会得到零个节点，此时沿用 `processArticleContent` 现有的 `No article node found` 分支，用户看到的是"这一页没有可处理的内容"，不是报错。

### 3. 取词与高亮共用一次遍历（采用 E2）

把 `renderWithHighlights` 里的 TreeWalker 过滤（`wordProcessor.ts:81-110`）抽成 `collectTextNodes(root: Node): Text[]`，过滤规则原样不动。`inPlace` 策略下：

```ts
const textNodes = WordProcessor.collectTextNodes(node)
const words = WordProcessor.extractWords(textNodes.map(n => n.textContent).join(' '))
// …查词填 wordCache…
WordProcessor.applyHighlightsToNodes(textNodes, wordCache)
```

`innerHTML` 策略下取词仍走 `cleanArticleText`，行为不变。

### 4. 原地高亮（采用 D2）

`renderWithHighlights(originalHtml, wordDict)` 保留为公开 API，内部改为：建 `tempDiv` → `applyHighlightsToDom(tempDiv, wordDict)` → 返回 `tempDiv.innerHTML`。`applyHighlightsToDom` 就是今天 `wordProcessor.ts:81-179` 的全部逻辑（收集文本节点 → 占位符替换 → `DocumentFragment` 批量替换），只是 `root` 变成参数。

`content.tsx:547-582` 的循环按策略分叉：

- `innerHTML`：读 `innerHTML` → `renderWithHighlights` → 写回（完全不变）；
- `inPlace`：直接 `applyHighlightsToNodes(textNodes, wordCache)`，**不读也不写 `innerHTML`**。

`inPlace` 分支跳过 `wordProcessor.ts:180-190` 的标签配对自检（那是给 HTML 字符串序列化路径做的诊断，原地路径没有序列化步骤）。

flex 容器修复（`content.tsx:563-577`）在 `inPlace` 分支保留：它只写 `style` 属性、不改 DOM 结构，X 的 `tweetText` 内部大量使用 `span`，同样需要防止 `inline-flex` 吞掉词间空白。React 重渲染可能覆盖这个内联 style，届时表现是空白显示异常而非报错，可接受。

`addProcessingCompleteIndicator`（`content.tsx:622`，会 `insertBefore` 进正文容器）在 `showProcessingIndicator: false` 时整个跳过——它是本次唯一一处**结构性**插入，留着必然与 React 冲突。X 上用户看到下划线出现即可确认生效。

下划线颜色经 `getTextDecoration()`（§1.4）：`#FFFFFF` 哨兵 → `text-decoration: none`，只有需要复习的词才画彩色线。`innerHTML` 与 `inPlace` 两条路径统一走这个函数。

### 5. 换行导致的词粘连（依赖前提 §2.3）

取词侧已由 Decision 3 解决（文本节点用空格连接）。切句侧（`extractSentenceContext`，`wordProcessor.ts:306`）需要额外处理：`findSentenceContainer` 会走到 `tweetText`（它是 `div`，命中 `wordProcessor.ts:276` 的块级选择器），而它取的 `container.textContent` 和算偏移量用的 `Range.toString()` **都会忽略 `<br>`**，两者一致，所以偏移量不会错位，但 `Intl.Segmenter` 会把跨行的两句合并成一句。

处理方式（`inPlace` 策略下启用，其它站点不变）：

1. 用 `range.setEndBefore(br)` 逐个求出容器内每个 `<br>`（或块级边界，取决于前提 §2.3 的实测结果）在扁平文本里的字符偏移；
2. 按这些偏移把 `'\n'` 插进 `textToSegment`，同时把点击词的 `baseOffset` 按"它前面插入了几个 `\n`"整体后移，保持两者一致；
3. 其余（`MAX_SEGMENT_LENGTH` 窗口截断、`Intl.Segmenter` 切句、找不到时退回整段文本）全部不变。

这样 "KARDASHEV 2 IS THE REAL ENDGAME"（无句末标点）不会和下一行粘成一句，送给 AI 的上下文是用户实际看到的那一行/那一句。

> **实现状态（2026-08-31）**：取词侧已随首批实现落地。切句侧改动**留到 §2 前提验证之后**再做——它要改的是 `extractSentenceContext` 这条 9 个站点共用的路径，在没有前提 §2.3（`<br>` vs 块级）实测结果前动它风险偏高。在此之前，X 上跨行且无标点的两句会被合并送给 AI（质量降级，非功能损坏）。

### 6. 点击冲突（采用 F1：维持现状，依赖前提 §2.5）

不做任何改动。现有的 `addWordClickListeners`（`content.tsx:605-618`）在每个 `.enx-word` 上挂冒泡阶段监听并 `preventDefault + stopPropagation`，范围收窄到主推文后这已经够用——详情页的主推文正文不是"点击跳转详情"的目标。

实测（前提 §2.5）若证伪，升级到 Options F3：在 `document` 上挂捕获阶段的委托监听，`(event.target as HTMLElement).closest('.enx-word')` 命中则 `preventDefault + stopPropagation`，再走现有的 `showWordPopup`；若 X 是在 `pointerdown`/`mousedown` 上跳转，同样在 document 捕获阶段拦这两个事件（命中时只 `stopPropagation`，**不** `preventDefault`——否则会破坏划词选择的起始）。届时给 `SiteAdapter` 补一个 `clickBinding` 字段。

ADR-007 的划词整句翻译挂在 `document` 的 `mouseup` 冒泡阶段（`content.tsx:879`），本次不改；需实测确认 X 不会在 `mouseup` 前吞掉事件。

### 7. 重复触发（采用 G2）

`content.tsx:931` 的 `case 'enxRun'` 改为：已启用则先 `disableEnx()`，再执行完整的 `enableEnx()`。`wordCache` 是模块级变量、`disableEnx` 不清空它，所以重新处理时同一批词直接命中缓存，不产生额外后端请求。

---

## Rationale

- **选 D2 而不是 D3**：D2 的代码今天就已经存在并且在 9 个站点上跑了很久，只是被包在"序列化 → 反序列化"的外壳里；把 `root` 提成参数就同时得到两条策略，新增算法接近于零，而 D3 要重写点击命中、颜色分桶，还会推翻 ADR-008 依赖的 `.enx-word` 锚点前提——为一个尚未证伪的风险付这个代价不划算。D3 作为实测失败后的明确退路记在 Revisit Trigger 里。
- **选 C2 而不是 C1**：C1 能解决的只有 selector 一项，X 需要的另外四项差异（阈值、高亮策略、点击绑定、提示条）在扁平数组里无处安放，硬做就是四个散落的 `if (location.host === 'x.com')`。适配器的默认值逐字段等于现状，这是"引入抽象但不改变现有行为"的最低风险做法。
- **选 E2 而不是 E1**：§1.3 的第一个问题（取词和高亮用了两套过滤规则）本质就是同一份逻辑存在两处副本导致的漂移——这与 TASK-SPEC-enx-chrome-claude-blog §2.2 修掉的那个"三处重复实现"是同一类问题。让两个阶段共用同一次遍历，是从结构上消除漂移，不是打补丁。
- **选 F1（维持现状）而不是 F3**：范围收窄到主推文之后，F3 要解决的问题（评论上的点击跳转）在本次范围里不存在了。为一个当前不存在的冲突提前引入第二条点击绑定路径，是把成本花在猜测上；F3 的实现细节已经写在 Options 表里，实测证伪时照着做即可，不会因为"当时没想到"而返工。
- **选 B'1 而不是 B'2**：范围收窄的代价就是必须回答"哪个是主推文"。`B'2`（取第一个）在最常见的独立推文页上恰好正确，正因如此它的错误只会在对话串页面上出现——这种"平时都对、特定场景静默出错"的兜底不适合当主方案，只适合当判据全失效时的最后一道。
- **不做语言过滤（H1）**：`extractWords` 的字符类过滤已经天然做到了想要的效果，再加一层 `lang` 判断只会引入误伤。

---

## Consequences

### Positive

- X 推文详情页的主推文正文能点词查词，划词整句翻译（ADR-007）与短语查询（ADR-008）无需任何改动即可工作——只要 `.enx-word` 元素真实存在，这两条路径的前提就成立，这也是选 D2 而非 D3 的直接收益。
- 范围收窄让本次改动**只剩一个真正的未知数**（原地包裹与 React 是否共存，前提 §2.4）。点击冲突、虚拟化回收、增量加载三块都被排除在外，一旦手测通过，功能就是完整可用的，不存在"能用但一滚动就坏"的中间状态。
- Shadow DOM + Popover 弹窗（ADR-002，`content.tsx:66-113`）在 X 上无需改动：popover 渲染在 top layer，不受 X 的 z-index/stacking context 影响；样式在 Shadow DOM 内，不被 X 的全局样式污染；content script 注入的 `<style>` 走 isolated world，不受 X 的 CSP 约束。
- `SiteAdapter` 给后续接入其它 SPA 站点（Reddit、HN、Substack 评论区）留好了挂点。
- Decision 7 顺带修掉了"在已启用的页面上再点一次 Enable 没反应"这个所有站点共有的小坑。
- §1.4 顺带修掉了"不该高亮的词底下有一条白色下划线"这个所有站点共有的坑（白底上一直看不见，X 深色模式下现形）。

### Negative

- **仍在 React 管理的 DOM 上做替换**，只是把破坏面从"整棵子树"缩到"我们命中的文本节点"。存在 React 恰好要操作被替换文本节点从而抛错的理论路径，必须靠前提 §2.4 的实测把关。
- **评论区完全不支持**（已确认的边界 2）。用户在评论里读到生词只能手动复制或划词——而评论区往往是推文页阅读量最大的部分，这是本次范围收窄最直接的用户体验代价，需要在真实使用中检验是否可接受（见 Revisit Trigger）。
- **主推文判据可能选错**：X 改版导致 `focusedNodeResolver` 的判据失效时，会退回"取第一个 `tweetText`"，在对话串页面上处理的是祖先推文而不是用户点开的那条。失效**表现为静默的行为错误**，不是报错——比 selector 失效更难被发现。缓解：判据失效时打 `console.warn`。
- **依赖 X 的 `data-testid`**，X 改版会导致选择器失效。失效表现是"没有节点被处理 + 控制台无匹配日志"，是功能降级不是页面报错。
- **代码里出现两条高亮策略路径**（`innerHTML` / `inPlace`）。这是刻意的过渡状态：不在同一次改动里动 9 个已验证站点的行为。统一留给后续（见 Revisit Trigger）。
- **§1.3 的取词噪声问题只在 X 上被修掉**，现有站点仍会把 `<a>` 内文本送去查词。
- **Decision 7 是跨站点行为变更**：所有站点上重复点 Enable 从 no-op 变成重新处理一遍。
- **§1.4 的下划线修正是跨站点行为变更**：所有站点上"不该高亮的词"从"白色下划线"变成"无下划线"。白底上视觉等价，但属于跨站点改动，需要 review 确认。

### Mitigation

- 五条 DOM 假设在 §2 里显式列出并配了可直接粘贴的验证脚本（附录），实现前用独立推文页和对话串页各跑一遍，避免 claude-blog 那种"读源码得出错误结论 → 两轮手测返工"。
- 适配器默认值逐字段对齐现状 + 现有 70 个单测全绿，作为"现有站点零回归"的守门。
- 建议实施顺序：先做纯重构（`applyHighlightsToDom` / `collectTextNodes` 抽取，跑测试确认现有行为不变）→ 再加适配器骨架（默认适配器，跑测试）→ 最后接 X（真实页面手测）。三步各自可独立验证，出问题好定位。
- `focusedNodeResolver` 的判据用 fixture 单测覆盖（构造"祖先推文 + 主推文 + 评论"三节点结构，断言只返回主推文那一个），这样 X 改版导致判据失效时至少在改代码时有一层保护。

---

## Out of Scope（本次不做，供未来 Spec 引用；各条对应的后续 Phase 见「分阶段路线图」）

- **评论区、祖先推文、作者 self-thread**（边界 2，→ Phase 3）。扩展到这些区域时必须同时做 Options F3（点击捕获委托）——评论确实会"点击跳转详情"——并重新评估虚拟列表回收导致的高亮丢失。
- `MutationObserver` 增量处理（无限滚动新评论、被虚拟化重建的节点）（→ Phase 3 / 4）。
- X 首页时间线、搜索结果、个人主页等列表页（最终目标之外，暂无 Phase）。
- SPA 路由监听（页内切换推文后自动重新处理）（→ Phase 2）。
- 把 9 个现有站点也切到 `inPlace` 策略 / `collectTextNodes` 取词。
- 引用推文（quote tweet）、长推文"Show more"折叠后的内容、推文内图片的 alt 文本。

---

## Revisit Trigger

- **前提 §2.4 实测失败**（原地包裹仍让 React 报错）：本 ADR 的 Decision 4 作废，改走 Options D3（CSS Custom Highlight API），并需要一并重新设计 ADR-008 的短语锚点定位——那将是一次比本次大得多的改动，需要新的 ADR。
- **主推文用起来没问题、但评论区读不了成为主要痛点**（预计这是最先触发的一条）：扩展范围到评论区，一次性做三件事——Options F3 的点击捕获委托、`MutationObserver` + 防抖批量查词（`SiteAdapter` 加 `incremental: boolean`）、虚拟列表回收后的重新上色。届时 `focusedNodeResolver` 反而可以去掉。
- **前提 §2.5 实测证伪**（主推文正文上 X 仍抢点击）：按 Decision 6 里写好的方案升级到 Options F3，给 `SiteAdapter` 补 `clickBinding` 字段。这是实现阶段的既定分支，不需要新 ADR。
- **接入第三个 SPA 站点时**：如果 `inPlace` 在 X 上跑了一段时间没有问题，应该考虑把它提升为默认策略，删掉 `innerHTML` 分支——两条路径长期并存是债，不是终态。
- **现有站点的取词噪声**（`cleanArticleText` 不排除 `<a>`）如果在统计功能上造成可见问题（生词本里出现大量人名/域名），把 Decision 3 的 `collectTextNodes` 取词方式推广到所有站点。
- **X 改版导致 `data-testid` 失效**：更新适配器的 `contentSelector`；如果 X 开始高频改版，考虑改用结构特征（如 `[dir="auto"]` + 文本长度）而非 `data-testid` 定位。

---

## 附录：实现前的 DOM 验证脚本

在推文详情页的 DevTools Console 里执行，逐条核对 §2 的五个前提。**两种页面各跑一遍**：(a) 一条独立推文，(b) 一条身处对话中的推文（上方有祖先推文、下方有作者连续串）——前提 2 只有在 (b) 上才能真正被证伪。

```js
// 前提 1：正文容器
const tt = [...document.querySelectorAll('div[data-testid="tweetText"]')];
console.log('tweetText 节点数:', tt.length);

// 前提 2：三条主推文判据分别是否成立
console.table(tt.map((el, i) => {
  const art = el.closest('article');
  return {
    i,
    text: el.textContent.slice(0, 30),
    tabindex: art?.getAttribute('tabindex'),          // 判据①：主推文应为 "-1"
    fontSize: getComputedStyle(el).fontSize,          // 判据②：主推文应显著更大
    selfLink: !!art?.querySelector(`a[href*="/status/"]`), // 判据③：主推文应为 false
  };
}));
// 人工核对：哪一行才是你点开的那条推文，三条判据各自选对了没有

const main = tt[0]; // ← 按上表把下标改成真正的主推文

// 前提 3：换行怎么标记
console.log('BR 数量:', main.querySelectorAll('br').length);
console.log('textContent 是否粘连:', JSON.stringify(main.textContent.slice(0, 160)));
console.log('子元素:', [...main.children].map(e =>
  `${e.tagName}[${getComputedStyle(e).display}]`).join(' '));

// 前提 5：主推文正文上点击时有没有别的 handler 抢（点一下正文里的普通文字）
['pointerdown','mousedown','click','mouseup'].forEach(t =>
  document.addEventListener(t, e => console.log('capture:', t, e.target), true));
// 点完看：URL 有没有变，Console 里事件顺序如何

// 前提 4：原地包裹后 React 是否报错
const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT);
let n, count = 0;
while ((n = walker.nextNode())) {
  if (n.parentElement.closest('a, button')) continue;
  const span = document.createElement('span');
  span.innerHTML = n.textContent.replace(/\b([a-zA-Z]{4,})\b/g,
    '<u class="enx-word" style="text-decoration:red underline">$1</u>');
  n.parentNode.replaceChild(span, n); count++;
}
console.log('替换文本节点数:', count);
// 然后手动：点 Show more 展开、点开图片、上下滚动、点赞 —— Console 不应出现 React 报错，
// 高亮也不应消失
```
