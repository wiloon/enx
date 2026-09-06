# 代码分析：ADR-010 Phase 2 — `wordCache` 跨推文的体积增长与重跑成本

| 字段 | 值 |
| --- | --- |
| **状态** | 代码分析完成 — 2026-09-01 |
| **对应 ADR** | [`adr-010-x-tweet-page-support.md`](../architecture/adr-010-x-tweet-page-support.md) — 「分阶段路线图」Phase 2「启动前跑」调研项 ④ |
| **喂给** | 后续 `/grill-with-docs` → Phase 2 ADR 决策 |
| **调研方法** | 读代码：`enx-chrome/src/content/content.tsx`、`enx-chrome/src/background/background.ts`、`enx-chrome/src/types.ts`；`enx-api/enx-api.go`、`enx-api/paragraph/paragraph.go`、`enx-api/enx/foo.go`。无实测。 |

---

## 摘要与建议

**内存不是问题。** `wordCache`（`content/content.tsx:25`）是模块级、纯内存、从不裁剪、从不持久化的 `Record<string, WordData>`，生命周期 = content script 执行上下文 = 该标签页不刷新的存活时间（F5 / 关标签 / 硬跳转即清空）。Phase 2 每切一条推文按 Decision 7 先 `disableEnx()` 再 `enableEnx()`，`disableEnx` **不清** `wordCache`，所以它随「该标签页这次会话见过的所有 unique 英文词」单调增长——但增长**亚线性**（Heaps 定律，词汇量 ≈ N^0.5），读 200 条推文约 1000–2000 个 key、约 1–2 MB，对照 X 自身几百 MB 的标签页堆是噪声。

**不要按 tweet ID 分桶。** 直接违背 Decision 7 的原意——常用词在推文之间不停复现，跨推文复用正是缓存的价值；分桶增加复杂度换零收益。

**LRU 上限是可选的保险**，且 key 必须是**词**不是推文（例如上限 5000 条、淘汰最早插入）。把最坏情况钉在 ~2–5 MB，命中率几乎无损（被淘汰的都是罕见词）。真实会话没出现过几千条就是 YAGNI。

**两个和内存无关、但值得进 grill 的点**（见 §3）：Phase 2 的自动重跑路径**每切一条推文都会白发一个 `/api/paragraph-init` GET**（无「全命中就跳过网络」的短路）；以及缓存陈旧窗口被从「一篇文章」拉长到「一整段刷推会话」。

---

## 1. 数据链路

- `let wordCache: Record<string, WordData> = {}`（`content/content.tsx:25`），**模块级、纯内存**。与 background 里 `chrome.storage.local` 的 `wordCache` key（`background.ts:228`）是两回事，后者是安装时初始化的空对象，本主题不涉及。
- `WordData`（`src/types.ts:3`）7 个字段：`Key` / `English` / `Pronunciation` / `Chinese` 四个短字符串 + `LoadCount` / `AlreadyAcquainted` / `WordType` 三个小整数。按词的小写形式做 key。
- 写入点：
  - `content.tsx:511` `Object.assign(wordCache, actualWordData)` —— 批量查词（`getWords` → `/api/paragraph-init`）的响应
  - `content.tsx:240` —— 单词弹窗查词（`getOneWord`）的响应
  - `content.tsx:151` —— 标记已掌握后本地更新
- **没有任何删除 / 淘汰 / 上限逻辑。**
- Phase 2：每次页内切推文 → `enxRun` → Decision 7 `if (isEnxEnabled) disableEnx()` → `enableEnx()` → `processArticleContent()` 重跑。`disableEnx`（`content.tsx:931-957`）解包裹 `.enx-word`、移除监听、隐藏弹窗，**不碰 `wordCache`**。

---

## 2. 增长量级

- 一条推文 ≤280 字符 ≈ 40 词，unique 英文词 ~30–40 个；推文之间常用词高度重叠。
- 词汇量随阅读量亚线性增长（Heaps 定律，β≈0.5）：读 200 条推文 ≈ 8000 词次 ≈ 1000–2000 unique。
- 每条 entry 在 V8 里保守估 ~0.5–1 KB（对象壳 + 4 个字符串 header + 上千 key 后 `Record` 进 dictionary mode 的额外开销）。
- **200 条推文 ≈ 1–2 MB；上千条推文一次坐下读完（极端）≈ 5–10 MB。**
- 生命周期只在页面上下文内，刷新 / 关标签 / 硬跳转清零；Phase 2 明确不跨硬导航保持。实际天花板 = 「一个 X 标签页不刷新能连续读多少条不同推文」，现实是几十到低几百条。

**判决：不是内存风险，不值得为它做工程。**

---

## 3. 和内存无关、但要进 grill 的两点

### 3.1 重跑路径没有「全命中就跳过网络」的短路

`processArticleContent`（`content.tsx:484-538`）把当前推文的所有 unique 词**无条件**分块发给 `/api/paragraph-init`——没有 `uniqueWords.filter(w => !wordCache[w.toLowerCase()])`。`content.tsx:979` 的注释「wordCache is module-level and survives, so re-processed words hit the cache and don't re-call the backend」**只对高亮成立，对网络请求不成立**。

后端影响可控：

- `/api/paragraph-init` → `paragraph.ParagraphInit` → `enx.QueryCountInText`（`enx-api/enx/foo.go:9`）是**纯读、幂等**——逐词查 `UserDict` 的 `QueryCount` / `AlreadyAcquainted`，**不写、不自增任何计数**。
- 该路由（`enx-api.go:209` / `227`）**只挂 `cognitoAuth`，没有计费中间件**——Stripe 额度只作用在 `translate/sentence`、`translate/word-in-context` 上（`enx-api.go:187-190`）。

所以**今天无害**。但 Phase 2 变成「每切一条推文自动重跑」后，就是**每次推文浏览 / 每次回看都白发一个 GET**。便宜的优化：`uniqueWords.every(w => wordCache[w.toLowerCase()])` 时整段跳过 `getWords` 循环，直接进高亮。

### 3.2 缓存陈旧窗口被放大

`LoadCount` / `AlreadyAcquainted` 是用户进度字段。同一个 X 标签会话期间，用户在别处（Side Panel、另一标签、手机）改了进度，content script 的 `wordCache` 看不到。静态文章页本来也这样（缓存按页面加载），但 Phase 2 把窗口从「一篇文章」拉长到「一整段刷推会话」。

自愈的部分：每次切推文 `Object.assign(wordCache, actualWordData)`（`content.tsx:511`）用 `paragraph-init` 的新结果覆盖**当前推文里的词**。所以陈旧只残留在「当前推文没有、但会话早期见过」的词上——基本可接受，grill 时确认一句即可。

---

## 4. 对 Phase 2 落地的直接输入

- `wordCache` **保持现状**（模块级、不清、不分桶、不设上限）。
- 若 grill 想要硬上界：加一个按插入顺序淘汰的 LRU，key 是词，上限 ~5000。非必须。
- **建议顺带做**：重跑前判断「当前推文 unique 词是否已全部在 `wordCache`」，是则跳过 `getWords`，省掉 Phase 2 每次导航的那个 `paragraph-init` GET。
- grill 待确认：会话中途在别处改的进度不会反映到当前 `wordCache`（仅影响非当前推文的词），是否可接受。
