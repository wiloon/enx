# ADR-006: 主页面查词结果同步显示到侧边栏——复用单词卡片列表，不触发整句翻译

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-08-09 |
| **日期** | 2026-08-09 |
| **关联 Spec** | [`TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](../tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md)（本决策直接改动该 spec §3.7–§3.9 描述的侧边栏单词卡片机制，实现前应同步更新该 spec 或在其后追加变更记录） |
| **关联 ADR** | [`adr-002-word-popup-react-shadow-dom.md`](adr-002-word-popup-react-shadow-dom.md)（主页面弹窗查词的触发与渲染方式，是本决策的输入来源，未改动） |

---

## Context

当前查词有两条独立路径，共享同一个后端查询（`getOneWord` → `background.ts:465`），但结果互不可见：

1. **主页面弹窗查词**：用户点击网页正文单词 → `content.tsx:53 showWordPopup()` 挂载 `WordPopup.tsx`，展示词典释义（`WordData`）。用户可点弹窗里的「🔤 整句翻译」按钮，才会把句子写入 `chrome.storage.session`（`PENDING_SENTENCE_STORAGE_KEY`）并尝试 `chrome.sidePanel.open()`。不点这个按钮，侧边栏完全不知道刚才查过什么词。
2. **侧边栏内查词**：仅当 `pendingContext`（即上面那个整句上下文）存在时才可能发生——用户点击侧边栏里句子中的某个词，`handleWordClick`（`SidePanel.tsx:139`）同时发起 `getOneWord`（词典释义）和 `translateWordInContext`（该词在这句话语境下的 AI 释义），结果合并成一张卡片，追加进 `definitions` 数组（`SidePanel.tsx:66`），渲染成卡片列表（`SidePanel.tsx:273-343`）。

需求：主页面弹窗查词时，如果侧边栏是打开的，也把这次查词结果显示进侧边栏的单词卡片列表里，方便回顾最近查过的词；但**不能**触发整句翻译（即不能像点「整句翻译」按钮那样发起 `translateSentence`）。

实现这个需求会撞上两个现有结构性约束：

- **渲染被 `pendingContext` 整体门控**：`SidePanelContent` 在 `pendingContext` 为 `null` 时直接 `return` 一段提示文案（`SidePanel.tsx:214-220`），`definitions` 列表所在的 JSX 根本不会渲染。而主页面查词不应该产生 `pendingContext`（那意味着触发整句翻译），所以按现状，卡片会因为门控直接不可见。
- **没有"侧边栏是否打开"的检测机制**：项目里没有 `chrome.runtime.connect` 长连接或心跳，只有对 `chrome.sidePanel.open()` 的 best-effort 调用。新增检测机制成本不低。

---

## Options Considered

**A. 卡片放置位置**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1. 独立固定区域 | 侧边栏另开一块"最近查词"区域，只放 1 张卡片，和整句翻译的单词列表完全分开 | 结构简单，互不干扰，不用改动现有 `pendingContext` 门控逻辑 | 用户明确否决——认为拆开两个列表反而增加认知负担 |
| A2.（采用）插入现有单词列表 | 主页面查词产生的卡片，和点击句子里单词产生的卡片，用同一个 `definitions` 列表 + 同一套卡片 UI，新卡片插入列表最前面；同时清空当前整句翻译的英文原文和中文译文显示 | 只有一套列表和一套卡片 UI，视觉上"最近查过的词"是一条统一时间线 | 单词列表原本隐含"这些词都属于同一句话"的语义，插入一个不相关的词会打破这个隐含假设，必须显式清空整句翻译区域来消除歧义（已按用户要求处理） |

**B. 侧边栏感知"主页面查了新词"的机制**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1. 新增 `chrome.runtime.connect` 长连接检测面板是否打开，仅在打开时 `sendMessage` 推送 | 精确知道面板开关状态 | 全新基础设施，且用户已明确"面板未打开时不需要补历史，只要下次打开显示最新一条"——这个需求本身就不需要"是否打开"这个信号 | 
| B2.（采用）复用 `chrome.storage.session` + `chrome.storage.onChanged`，新增 key（如 `LATEST_PAGE_WORD_STORAGE_KEY`），语义为"覆盖式"存最新一次主页面查词结果 | 和现有 `PENDING_SENTENCE_STORAGE_KEY` 完全同构，`content.tsx` 在 `getOneWord` 成功后多写一次 storage 即可；面板打开时通过 `onChanged` 实时收到；面板关闭时下次打开自然读到最新值，天然满足"只显示最新一条"，不需要单独判断面板开关状态 | 面板打开时收到的是"最新一次"事件，如果同一时刻主页面连续查了多个词（如用户快速连续点击），中间的词不会被侧边栏感知——但这正是用户要的行为（不做历史） |

**C. 复用已查到的结果 vs 侧边栏重新查一次**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 侧边栏收到通知后自己再发一次 `getOneWord` | 实现简单，storage 里只需要传 `word` 字符串 | 同一个词请求两次后端，且如果两次结果不一致（如 `LoadCount` 计数器）会产生用户可见的闪烁 | 
| C2.（采用）`content.tsx` 直接把 `getOneWord` 的响应（`WordData`）连同 `word` 一起写入 storage | 零重复请求；侧边栏卡片可以直接用已有数据渲染，无需经历 loading 态 | storage 里存的数据结构需要和 `WordData` 保持同步，多一层耦合（可接受，两边本来就共享同一个类型定义） |

---

## Decision

1. **触发与传输**：`content.tsx` 在 `getOneWord` 请求成功后（约 `content.tsx:220` 附近，写入 `currentWordAtom` 的同时），发一条新的 `recordPageWordLookup` 消息给 background（携带 `word` + `ecp: WordData`），由 `background.ts` 里的 `handleRecordPageWordLookup` 代为把 `{ word, ecp, createdAt }` 写入 `chrome.storage.session` 的新 key（`LATEST_PAGE_WORD_STORAGE_KEY`），覆盖写入，不保留历史。**实现时发现**：content script 默认没有 `chrome.storage.session` 的写权限（Chrome 把 session storage 限定在"可信上下文"——background/扩展页面——除非 background 显式调用 `chrome.storage.session.setAccessLevel({accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS'})`），而调用这个 API 会让*所有* session key（包括 `enx-oauth-verifier`）对运行在任意第三方网页上的 content script 可读，代价过大；因此改为和 `handleOpenSentencePanel`/`PENDING_SENTENCE_STORAGE_KEY` 完全同构的写法——由 background 代写，content script 不直接碰 `chrome.storage.session`。这一步**不**调用 `chrome.sidePanel.open()`，也**不**写入 `PENDING_SENTENCE_STORAGE_KEY`，因此不会触发整句翻译。

2. **侧边栏订阅**：`SidePanel.tsx` 新增一个独立于 `pendingContext` 的 `useEffect`，通过 `chrome.storage.onChanged` 监听这个新 key。收到事件后：
   - 若该词已在 `definitions` 里，复用 `handleWordClick` 现有的"移到最前"逻辑；否则插入一张新卡片到 `definitions` 最前面，`dictionaryStatus` 直接置为 `'loaded'` 并填入传来的 `WordData` 字段（不再发起任何请求），`contextStatus` 置为一个新增的 `'none'` 状态（区别于 `'loading'`/`'loaded'`/`'error'`），卡片渲染时 `contextStatus === 'none'` 则完全不渲染语境释义那部分 UI，而不是像现在这样必然显示"翻译中..."或一段文本。
   - 同时清空当前整句翻译显示：`setChinese('')`、`setStatus('idle')`。

3. **解除 `pendingContext` 对列表渲染的门控**：`SidePanel.tsx:214-220` 的整体 `return` 改为只影响"整句原文 + 翻译"这一块（`SidePanel.tsx:224-271`），改成当 `pendingContext` 为空但 `definitions.length > 0` 时，仍渲染卡片列表，只是不渲染句子原文/译文那一段；只有当 `pendingContext` 为空**且** `definitions` 也为空时，才显示原有的引导提示文案。

4. **反方向也不清空**（**实现后追加**，2026-08-10）：`definitions` 一旦变成"整个面板会话的运行列表"（Decision 第 2 点），就应该在两个方向上都保持一致——不仅"新查一个词"不该清掉已有的整句上下文（第 2 点已覆盖），"新触发一次整句翻译"也不该清掉已有的单词卡片。原实现里，`useEffect(() => { ...; setDefinitions([]) }, [pendingContext?.createdAt])`（即每次 `pendingContext` 变化都清空单词卡片列表）是 ADR-006 之前就存在的旧行为，专门针对"单词卡片只属于当前这句话"的旧语义设计的；ADR-006 已经在 Negative 里承认把这个语义改成了跨会话列表，但当时遗漏了同步删除这一行反向清空逻辑。现已删除 `setDefinitions([])` 这一行：触发新的整句翻译只重置 `status`/`errorMessage`（因为翻译请求确实是新的），不再连带清空 `definitions`。

5. **点击已存在但 `contextStatus: 'none'` 的卡片时补齐语境释义**（**实现后追加**，2026-08-10）：`handleWordClick`（`SidePanel.tsx:207` 起）原本对"词已经在 `definitions` 里"的情况，一律只做"移到列表最前"，不发起任何请求——这是给"同一句话里重复点同一个词"设计的，因为那种情况下已经有语境释义了，重新请求没有意义。但 ADR-006 让 `contextStatus: 'none'` 的卡片（来自主页面查词，从未请求过语境释义）也会进入这个"已存在"分支，于是点击这种卡片对应的句中单词时，什么都不会发生——用户看不到任何反馈，语境释义永远补不上。修复：把"已存在"分支拆开——移到最前的动作总是执行；额外判断，若该卡片 `contextStatus === 'none'`，则只发起 `translateWordInContext` 请求（不重新请求 `getOneWord`，词典部分复用已有数据），并把 `contextStatus` 先置为 `'loading'`。两个分支共用的 `translateWordInContext` 发起+回填逻辑被提炼成 `fetchContextTranslation(word, sentence)`，避免和"全新单词"分支重复代码。

---

## Rationale

- 选 A2（插入统一列表）而不是 A1（独立区域），是产品决策而非技术限制——用户明确认为"最近查过的词"应该是一条统一时间线，拆分成两块列表增加认知负担。清空整句翻译区域是消除"列表里的词到底属不属于当前这句话"歧义的必要代价，而不是可选的润色。
- 选 B2（`chrome.storage.session` 覆盖写入）而不是新建长连接检测面板开关，是因为需求本身（"只显示最新一条，未打开时不用补历史"）和这个存储模式的语义完全吻合，属于"需求恰好绕开了原本以为必须解决的技术难题"，没有必要为了一个不需要的能力（精确的开关检测）引入新基础设施。这也和项目现有的 `PENDING_SENTENCE_STORAGE_KEY` 模式保持一致，降低认知成本。
- 选 C2（直接传结果）而不是让侧边栏重新查询，是纯粹的正确性收益（避免同一个词两次请求可能产生的计数器不一致或闪烁），没有明显的 Cons，唯一代价是数据结构耦合，但两边本来就共享 `WordData` 类型定义，耦合是既有事实，不是新增的。

---

## Consequences

### Positive

- 用户可以在不点「整句翻译」的情况下，把随手查过的词留在侧边栏里回顾，符合"方便查看最近查过的单词"的原始诉求。
- 零重复请求，不引入新的后端调用路径。
- 不需要新建面板开关检测机制。

### Negative

- `definitions` 列表的语义从"当前这句话里点过的词"变成了"当前面板会话里查过的词（可能来自不同句子/不同页面）"，这是一个隐性的语义扩大，未来如果要做"按句子分组"之类的功能，需要重新考虑数据结构（目前 `WordCardData` 没有记录"这个词来自哪个句子/页面"）。
- `pendingContext` 门控解除后，空状态提示文案的触发条件变复杂（需要同时判断 `pendingContext` 和 `definitions`），后续改动这块渲染逻辑时容易漏掉其中一个条件，需要在实现时补充测试覆盖这两个状态的四种组合。
- `contextStatus: 'none'` 是给 `WordCardData` 新增的一个状态分支，实现时要检查是否所有消费该字段的地方（目前只有 `SidePanel.tsx:311-318`）都正确处理了这个新分支，避免遗漏导致意外渲染"翻译中..."或空字符串。

### Mitigation

- 实现时应为"主页面查词 → 侧边栏已打开 → 插入列表并清空整句翻译"这条路径,以及"主页面查词 → 侧边栏未打开 → 之后打开 → 只看到这一条"这条路径，各补一个集成测试，覆盖 Negative 里提到的状态组合问题。
- 如果后续确实需要"按句子分组回顾"，再回来修订本 ADR，评估是否要给 `WordCardData` 加一个可选的来源字段（如 `sourceSentence?: string`），而不是现在就为一个尚不存在的需求预留字段。

---

## Revisit Trigger

- 用户反馈"最近查过的词"列表和"当前句子的单词分析"混在一起反而造成困惑，需要重新评估 A1（独立区域）方案。
- 需要支持真正的查词历史（跨会话持久化、可回溯多条），届时 `chrome.storage.session` 覆盖写入的"只留最新一条"语义不再够用，需要改用 `chrome.storage.local` 加列表结构。
- 需要精确判断侧边栏开关状态用于其他功能（如"面板未打开时用 `chrome.action.setBadgeText` 提示未读查词数"），届时可以重新评估是否值得引入 B1 的长连接机制。
