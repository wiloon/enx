# 实测：ADR-010 Phase 2 — X 切换推文时 `tweetText` 的 DOM 生命周期与就绪信号

| 字段 | 值 |
| --- | --- |
| **状态** | 实测完成 — 2026-09-01 |
| **对应 ADR** | [`adr-010-x-tweet-page-support.md`](../architecture/adr-010-x-tweet-page-support.md) — 「分阶段路线图」Phase 2「启动前跑」调研项 ②③ |
| **配套调研** | [`adr-010-phase2-spa-navigation-detection.md`](adr-010-phase2-spa-navigation-detection.md)（调研项 ①：如何检测 SPA 路由切换） |
| **喂给** | 后续 `/grill-with-docs` → Phase 2 ADR 决策 |
| **调研方法** | Claude in Chrome 驱动真实 x.com（已登录真实账号）。在 MAIN world 注入探针：包裹 `history.pushState`/`replaceState`、监听 Navigation API `navigate`/`navigatesuccess` 与 `popstate`、`MutationObserver` 观察 `<article>` / `[data-testid="tweetText"]` / `[aria-live]` 的增删和 `<title>` 变化，每个事件带 `performance.now()` 相对时间戳。导航前给现存节点打 `data-*` 标记以判断导航后是否存活。 |
| **样本** | 一条带**引用推文**的推文详情页（`/mike_chong_zh/status/…`），跑了 3 次页内导航：(a) home → 推文；(b) **推文 → 推文**（点引用推文，`pushState`）；(c) **浏览器后退**（traverse）。推文正文是中文——DOM 机制与语言无关，但换行/英文分词相关的 ADR §2.3 未在此覆盖。 |

---

## 摘要与建议

**② DOM 生命周期：切推文时主推文 `div[data-testid="tweetText"]` 是「整体卸载 → 新建挂载」，不是原地改文本。** 旧节点被 `remove`、新节点被 `add`，发生在**同一个 MutationObserver 批次、同一时间戳**（route 变化后约 +60ms），中间**没有骨架屏 / 空节点 / loading 占位**。导航前打标记的旧 `tweetText` 和旧 `article` 节点，导航后**无一存活**。

**这对 ENX 是好消息**：切推文时 React 直接丢弃旧推文整棵子树，ENX 塞进旧节点的 `.enx-word` 包裹随子树一起消失，**不会触发「React 要 `removeChild` 我们插入的包裹」的报错**——前提 §2.4 那条最高风险是针对 Show more 展开 / 图片查看这类**原地**交互的，不是导航。

**③ 就绪信号：只有 `article[tabindex="-1"]` 可靠。`document.title` 和 `aria-live` 都不可用。**

| 信号 | 判决 |
| --- | --- |
| `article[tabindex="-1"]` 内出现非空 `[data-testid="tweetText"]` | ✅ **用这个**。主推文 article 恒为 `tabindex="-1"`，评论/祖先为 `"0"` |
| `document.title` | ❌ 导航到新推文后 title 仍是**上一条**推文；首次加载 title 延迟 **~51 秒**。几乎确定 visibility-gated |
| `aria-live` 区域 | ❌ 页面那个 `aria-live="polite"` 全程为空，导航零播报 |
| Navigation API `navigate` 事件 | ✅ 触发可靠、能区分 push/traverse，但见调研项 ① 的 isolated-world 未决问题 |
| `popstate` | ⚠️ 仅后退/前进触发，点推文（push）不触发 |

**建议的就绪探测**（content script 收到「URL 变了」信号后）：

1. `MutationObserver` 观察 `document.body` 子树，命中条件 = 存在 `article[tabindex="-1"] [data-testid="tweetText"]` **且**其 `textContent` 非空；
2. **取 DOM 顺序最后一个** `article[tabindex="-1"]`——过渡期新旧 article 会并存约 750ms；
3. 命中后防抖 ~100ms 再跑，超时 ~2s 兜底（放弃或按当前 DOM 尽力而为）；
4. **不要**读 `document.title` 或 `aria-live`。

---

## 1. 调研项 ②：`pushState` 后到 `tweetText` 稳定，中间经历什么

### 推文 → 推文（点引用推文触发，`t0` = 点击前一刻）

```
+   0ms   pushState  /onenewbite/status/2094477506116219306
+   1ms   navigation "navigate"      (navigationType: "push", canIntercept: true)
+   2ms   navigation "navigatesuccess"
+  62ms   ── 同一个 mutation 批次 ──
            remove  <div data-testid="tweetText">   旧主推文正文（"在我开发的过程中跟着 Ray…"）
            add     <div data-testid="tweetText">   新主推文正文（"哈哈，感谢！这次首秀…"）
            add     <div data-testid="cellInnerDiv">
+ 808ms   remove  <article tabindex="-1">           旧主推文 article 这时才被摘掉
+ 808ms   add     <div data-testid="tweetText">     第一条评论开始灌入
```

### 浏览器后退（traverse）

```
+   0ms   navigation "navigate"      (navigationType: "traverse")
+   1ms   navigation "navigatesuccess"
+  57ms   ── 同一个 mutation 批次 ──
            remove  <div data-testid="tweetText">   当前推文正文
            add     <div data-testid="tweetText">   回到的上一条推文正文
            add     <div data-testid="cellInnerDiv">
+  60ms   popstate                                  （在 DOM 交换之后才来）
```

### 结论

| 问题 | 实测结果 |
| --- | --- |
| 原地改文本，还是卸载→挂载？ | **完全卸载→挂载。** 旧 `tweetText` 被 `remove`、新建一个 `add`；导航前打标记的旧节点导航后**一个都没活下来**（主推文正文、`article` 均如此） |
| 有骨架屏 / loading 中间态吗？ | **主推文正文没有。** `remove` 与 `add` 在同一 mutation 批次、同一时间戳，React 一次 commit 换掉，中间不存在空节点或占位 |
| 新正文多久稳定？ | **route 变化后 ~60ms** 新 `tweetText` 已挂上且文本完整。整页安定（评论等）~800ms+ |
| 旧 DOM 残留多久？ | 旧 `article[tabindex="-1"]` 在新正文挂上后**又停留 ~750ms** 才被摘除 → 过渡期短暂存在「新旧两个主推文 article」 |
| 对 ENX `.enx-word` 包裹的影响 | 导航时旧子树整体被丢弃，包裹随之消失，无需 ENX 清理、也不会引发 React 报错（未直接在 ENX 运行态下复测，但机制上成立） |

---

## 2. 调研项 ③：有没有比轮询更干净的就绪信号

| 候选信号 | 实测观察 | 可用性 |
| --- | --- | --- |
| **`article[tabindex="-1"]`** | 主推文 article 恒为 `tabindex="-1"`，评论/祖先为 `"0"`。导航前后 `article[tabindex="-1"]` 计数都是 1；过渡期可能短暂为 2（新旧并存 ~750ms） | ✅ **最可靠**。等 `article[tabindex="-1"] [data-testid="tweetText"]` 出现，取 DOM 顺序最后一个 |
| **`document.title`** | 导航到 `/onenewbite/status/…` 后，title **仍是上一条推文**（"迈克 Mike Chong on X…"），探测窗口内**没有 `title` 变化事件**；首次 home→推文那次，title 在导航后 **~51 秒**才更新 | ❌ **不可用**。几乎确定 visibility-gated（标签非前台时 X 不更新 title）——而 content script 后台重跑正是这个场景 |
| **`aria-live` 区域** | 页面有一个 `<div aria-live="polite">`，全程 `textContent` 为空，导航没有任何文本写入 | ❌ **不可用**（至少此流程下） |
| **Navigation API `navigate` / `navigatesuccess`** | 每次导航都触发；`navigationType` 分得清 `"push"`（点链接）/ `"traverse"`（前进后退）；比 `popstate` 早、且不依赖方向 | ✅ 语义最干净的**触发**信号。但本次在 MAIN world 观测——isolated-world content script 能否收到，见调研项 ① 的未决项 |
| **`popstate`** | 点推文（push）时**不触发**；浏览器后退（traverse）触发，但在 `navigatesuccess` 和 DOM 交换**之后** ~60ms | ⚠️ 只覆盖后退/前进一半，且偏晚。与调研项 ① 的规范结论一致 |

---

## 3. 顺带验证的结论（喂给 grill，主要关于 `focusedNodeResolver` / Phase 1）

- **`pushState` 在 MAIN world 能拦到 X 的调用**（探针的包裹函数确实被触发）——反证调研项 ① 的结论：isolated world 的 content script 拦不到。
- **ADR §2.2 判据 ③（主推文 article 内无指向自身 status 的链接）实测为假**：主推文 article 里有 `/status/` 链接（时间戳永久链接 + 引用推文链接）。**判据 ① `tabindex="-1"` 是唯一靠谱的**。
- **ADR §2.2 判据 ②（字号）不可靠**：这条较长推文的 `tweetText` 计算字号是 `17px`，不是 ADR 猜测的 23px——X 按推文长度缩放字号，阈值不稳。
- **引用推文的坑**：带 quote tweet 的推文，`div[data-testid="tweetText"]` 命中 **2 个**，且**都在同一个 `article[tabindex="-1"]` 内**（主正文 + 被引用推文正文）。`pickFocusedTweet` 光靠 article 判据不够，还要在 focused article 内**取第一个 `tweetText`** 或排除嵌套的 quote 容器（ADR Out of Scope 已把 quote tweet 列为不处理）。

---

## 4. 边界与未验证项（flag）

1. **推文正文是中文**：DOM 生命周期、就绪信号与语言无关，结论适用。但换行由 `<br>` 还是块级元素表达（ADR §2.3 / 前提 §2.3）**未在此测**——需要英文推文单独验证。
2. **标签页在自动化期间大概率非前台**：`document.title` 的滞后可能与「用户真的在看」时不同。但「非前台」正是 content script 后台重跑的场景，所以「title 不可用」这条结论对目标场景是成立且偏保守的。
3. **只测了「点引用推文」和「浏览器后退」两种切换**。未测：点某条评论跳转、点祖先推文、点 @mention/主页再返回。这些的 route 类型（push/traverse）和 DOM 交换机制预计一致，但未证实。
4. **未在 ENX content script 运行态下复测**：即「旧 `tweetText` 里已有 `.enx-word` 包裹时，节点被卸载会不会让 React 报错」没有直接观测。机制上 React 丢弃整棵子树不涉及对包裹节点的单独操作，应无报错，但 Phase 2 落地后应在真实运行态确认一次。
5. **单次会话、单一 X 版本（2026-09-01）**。`data-testid` 命名、`tabindex` 约定、Navigation API 行为均可能随 X 改版变化。
6. **Navigation API 在 MAIN world 观测到**；isolated-world content script 能否收到 `navigate` 事件仍是调研项 ① 的未决实测项。

---

## 5. 对 Phase 2 落地的直接输入

- **触发层**：按调研项 ① 的建议——`chrome.webNavigation.onHistoryStateUpdated`（background 监听）或实测通过后的 Navigation API。
- **就绪层**（本文定死）：content script 收到「URL 变了」后，`MutationObserver` 等 `article[tabindex="-1"] [data-testid="tweetText"]` 非空出现，取 DOM 顺序最后一个，防抖 ~100ms，超时 ~2s 兜底。典型延迟 < 200ms，**不需要长轮询**。
- **重新武装**：命中就绪后复用 Decision 7 的「先 `disableEnx()` 再 `enableEnx()`」。旧包裹已随旧子树消失，`disableEnx` 的解包裹逻辑在新 DOM 上是 no-op，无害。
- **不要**依赖 `document.title` / `aria-live` 做任何判断。
