# TASK-SPEC: enx-chrome 整句 AI 翻译侧边栏（Side Panel）

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-07-30（待 Review，Review 通过后开始实施） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 在现有单词查词弹窗基础上新增「整句翻译」入口：点击后在 Chrome 扩展的 Side Panel 中显示当前单词所在句子的英文原文 + 调用 AI 模型（Kimi / MiniMax）翻译出的中文整句译文；用户还可在侧边栏内点击原文中任意单词，在整句译文下方追加显示该词的释义（复用现有查词逻辑） |
| **非目标** | 不改变现有查词弹窗内已有的单词翻译展示；不做侧边栏内的划词/多词选择整句翻译（仅覆盖"点击已高亮单词→查所在句"的路径）；不做翻译结果的本地持久化/历史记录；不在 v1 同时接入 Kimi 与 MiniMax 两个厂商（先实现一个，接口保留可替换点） |
| **触发原因** | 用户反馈：点词查词后，若句子结构复杂，仅看单词释义仍无法理解整句含义；查词弹窗空间有限，无法容纳整句翻译内容，因此需要一个更大的展示区域（Side Panel）|
| **关联背景** | [`docs/adr/0001-integrate-ecdict-dictionary.md`](../adr/0001-integrate-ecdict-dictionary.md) §Consequences 明确写了"句子翻译需后续单独方案；当前仅返回明确提示"——本 Spec 是该后续方案的落地 |

---

## 1. 背景与动机

`enx-chrome` 目前支持网页正文单词高亮 + 点击查词，查词结果显示在一个基于 Popover API 的浮层弹窗中（`content.ts` → `showWordPopup()`）。弹窗空间只够放下单个单词的释义、音标、Youdao 外链和"Mark Known"按钮。

当用户点击的单词所在句子较复杂时，仅看单词释义不足以理解整句，需要看整句的中文翻译。这需要调用外部 AI 模型（示例：Kimi / MiniMax），且展示空间比现有浮层弹窗大得多——Chrome 扩展原生的 **Side Panel**（`chrome.sidePanel` API，MV3）刚好满足"页面侧边常驻、空间更大"的需求。

`enx-api` 侧已有先例：ADR-0001 把有道翻译切换为 ECDICT 时，明确把"句子翻译"列为 Consequences 里的已知缺口，`translate/helpers.go` 的 `respondSentenceUnavailable()` 目前对任何带空格的查询固定返回占位文案 `SentenceTranslationNotice`。本 Spec 是这个缺口的正式实现方案。

---

## 2. 现状调查

### 2.1 查词弹窗不是 React 组件，而是 content script 里手写的 DOM

`src/components/WordPopup.tsx` 是一个基于 Jotai atom 的 React 组件，但 `grep -rn "WordPopup" src` 显示**它没有被任何地方 import**——真正在网页上显示的查词弹窗是 `content.ts` 里 `showWordPopup()` 手写的 `innerHTML` 字符串（约 L41-L173），配合 `setupPopupEventHandlers()`（约 L176-L251）绑定按钮事件。新增"整句翻译"按钮要加在**这份手写 HTML**里，不是 `WordPopup.tsx`（后者是死代码，本次不处理，不在 Spec 范围内）。

### 2.2 `chrome.action.onClicked` 目前是死代码

`manifest.json` 的 `action` 同时设置了 `default_popup: "popup.html"`。Chrome 的既定行为是：**只要 `default_popup` 存在，点击工具栏图标永远直接打开该 popup，`chrome.action.onClicked` 事件根本不会触发**。但 `background.ts` L160-178 确实注册了 `chrome.action.onClicked.addListener(...)`（用于切换页面高亮 `enxRun`），且 L166 注释写着"User not logged in, popup will handle this"——这条注释暗示原开发者的设计意图是"未登录时用 popup 兜底，登录后应该改成图标直接触发某个动作"，但代码里从未出现对应的 `chrome.action.setPopup({popup: ''})` 调用来实际关闭 popup、让 `onClicked` 生效。`grep -rn "setPopup" src` 结果为空，证实这是个从未补完的意图，`onClicked` 处理器目前不可达。

这个发现直接影响本次"点击工具栏图标"触发方案的设计（见 §3.2）。

### 2.3 `chrome.storage.session` 已有先例

`src/lib/cognito.ts` 已经在用 `chrome.storage.session` 存 PKCE verifier（跨 popup 生命周期传递短期状态）。本次"待处理句子上下文"可以复用同一存储机制，模式已被验证过（`cognito.test.ts` 里也有对应 mock）。

### 2.4 enx-api 侧现状

- `translate/service.go` 的 `translateWord()`：一旦 `isSentence(raw)`（即包含空格）为真，直接 `respondSentenceUnavailable()` 返回占位文案，**不查词典也不调用任何翻译服务**。
- 密钥管理约定（`config.toml` 注释 + `email/email.go` 用法）：第三方 API Key **只能**通过环境变量注入（如 `RESEND_API_KEY` → `viper.GetString("resend.api-key")`），**不写入** `config.toml` 明文。本次 Kimi/MiniMax 的 API Key 必须遵循同一约定。
- 路由注册集中在根目录 `enx-api.go`（`authGroup` / `apiGroup` 两组，均挂 `/translate`、`/word/:word`），新增整句翻译端点应在此处按同一模式注册。

---

## 3. 目标设计

### 3.1 总体流程

```
网页正文点击单词
  → 查词弹窗展示单词释义（不变）
  → 弹窗新增按钮「🔤 整句翻译」
  → 点击后：
      1. content script 提取该单词所在句子（新逻辑，见 §3.4）
      2. 写入 chrome.storage.session（待处理上下文，见 §3.3）
      3. 尝试直接打开 Side Panel（触发方式 B，见 §3.2，可能失败）
  → Side Panel（若已打开或本次打开成功）：
      1. 读取待处理上下文，展示英文原句
      2. 调用 enx-api 新端点做整句 AI 翻译，展示中文译文
      3. 用户点击原句中任意单词 → 复用现有 getOneWord 逻辑 → 在译文下方追加该词释义
  → 若 Side Panel 未能直接打开（触发方式 B 失败）：
      提示用户"已保存，请点击浏览器工具栏 ENX 图标查看"
      → 用户点击工具栏图标（触发方式 A，见 §3.2，可靠）→ Side Panel 打开并读取到同一份待处理上下文
```

### 3.2 Side Panel 触发方式：两种都实现

Chrome 要求 `chrome.sidePanel.open()` 必须响应"用户手势"，且**该 API 在 content script 里不可用**，必须经 background 中转。两种触发方式按用户要求都实现，互为兜底：

#### 触发方式 A（可靠，推荐主路径）：登录后把工具栏图标行为切到"直接打开 Side Panel"

不使用 `chrome.action.onClicked`（已确认不可达，见 §2.2），改用官方 API `chrome.sidePanel.setPanelBehavior()`：

- 未登录时：`setPanelBehavior({ openPanelOnActionClick: false })`（默认值，点图标继续打开 `popup.html` 走登录流程，不变）
- 登录成功后（`handleCognitoSignIn` 落盘成功、以及 service worker 启动时读到已登录态）：`setPanelBehavior({ openPanelOnActionClick: true })`

  **⚠️ 需在 Review 中确认的取舍**：`openPanelOnActionClick: true` 会让点击图标**始终**打开 Side Panel，`popup.html`（含登出入口）将不再能通过点图标访问。当前 `popup.html` 除登录表单外还有 `DebugPanel`（仅开发环境）。建议登出入口后续迁移到 Side Panel 内的一个小设置区域，或保留 `chrome.action.openPopup()` 之外的入口（如右键扩展图标菜单）。本 Spec 范围内先接受这个取舍，若 Review 认为不可接受，可退回选项：不动态切换，改成始终 `openPanelOnActionClick: true` 且把登录表单也一并迁移进 Side Panel（工作量更大，列为备选，见下表）。

  | 选项 | 说明 | 结论 |
  | --- | --- | --- |
  | A1. 登录后动态切换 `openPanelOnActionClick` | 如上 | **本 Spec 采用**，改动最小 |
  | A2. 始终 `openPanelOnActionClick: true`，登录表单迁入 Side Panel | 彻底放弃 `popup.html` 作为图标入口 | 改动面过大，超出本次范围，列入 §9 后续扩展 |
  | A3. 保留 `chrome.contextMenus`，右键菜单项打开 Side Panel | 也是 Chrome 官方认可的用户手势来源 | 不是用户本次要求的两种方式之一，暂不实现，可作为 A1 之外的第三兜底记录在案 |

#### 触发方式 B（尽力而为，弹窗按钮直连）：查词弹窗按钮点击 → 消息转发 → background 尝试 `sidePanel.open()`

- `content.ts` 新增按钮点击处理：`sendToBackground({ type: 'openSentencePanel', tabId, sentence, word, sourceUrl })`。
- `background.ts` 消息处理新增 `case 'openSentencePanel'`：写入 `chrome.storage.session`（见 §3.3），然后 `try { await chrome.sidePanel.open({ tabId }) } catch (e) { /* 记录，不抛出 */ }`。
- **已知风险**：content script 触发的用户手势通常无法通过 `runtime.sendMessage` 传递到 background，Chrome 可能报 `may only be called in response to a user gesture` 并 reject。**这属于预期内的失败**，不算 bug——`openSentencePanel` 处理器无论 `sidePanel.open()` 成功与否都必须返回 `{ success: true, panelOpened: boolean }`，content script 据此决定是否显示"请点击工具栏图标"的提示。
- 因为待处理上下文已经落盘（无论 A/B 哪个先执行成功），两种触发方式不是互斥的"二选一"，而是"B 失败时 A 兜底，且内容一致"。

### 3.3 待处理句子上下文（Side Panel 与弹窗之间的数据契约）

```ts
// chrome.storage.session, key: 'enx-pending-sentence'
interface PendingSentenceContext {
  sentence: string       // 英文原句
  word: string            // 触发查询的单词（用于高亮/定位）
  sourceUrl: string       // 来源页面 URL（展示用，非必需但利于用户回忆上下文）
  createdAt: number       // Date.now()，用于 Side Panel 判断"是不是最新一次点击"
}
```

Side Panel 组件：挂载时读一次，同时用 `chrome.storage.onChanged` 监听该 key 的变化——面板已打开时，用户在网页里再点另一个词的"整句翻译"，面板内容原地刷新，不需要重新触发打开（不受 §3.2 的用户手势限制，因为这只是普通的 storage 更新+消息通知，不是 `sidePanel.open()` 调用）。

### 3.4 句子提取逻辑（新增，`src/lib/wordProcessor.ts`）

现有 `WordProcessor`（`enx-chrome/src/lib/wordProcessor.ts`，§见 claude-blog Spec 合并后的唯一来源）已经是 DOM 遍历/高亮渲染的唯一实现，句子提取逻辑按同样原则加进这里，不再在 `content.ts` 里另起一份。

新增函数：

```ts
// 从被点击的高亮单词元素出发，定位其所在句子
static extractSentenceContext(
  wordElement: HTMLElement,
  word: string
): { sentence: string; sentenceIndex: number } | null
```

实现要点：
1. 从 `wordElement` 向上找最近的块级文本容器（复用 `getArticleNodes()` 相同的"够大的文本容器"判断思路，或简单地取 `wordElement.closest('p, li, blockquote, td, div')` 里第一个 `textContent.length > 20` 的祖先）。
2. 用 `Intl.Segmenter(undefined, { granularity: 'sentence' })`（Chrome 已长期原生支持，无需 polyfill）对容器 `textContent` 切句，比正则更能正确处理缩写（"Mr.", "e.g." 等）导致的误切。
3. 用 `document.createRange()` 定位 `wordElement` 在容器内的字符偏移，映射到落在哪个句子分段内，而不是简单 `indexOf(word)`（同一单词在段落中可能出现多次，见 claude-blog Spec §2.4.1 里"同一 class 出现两次导致误命中"的前车之鉴）。
4. 找不到句子边界（如容器内只有一句、或 `Intl.Segmenter` 不可用）时，直接返回整个容器的 `textContent.trim()` 作为兜底，不返回 `null`——功能优雅降级，不应直接不可用。

**必须新增单测**（`src/content/__tests__/`，jsdom）：多句段落中点击不同句子的词、单词在段落中重复出现两次、容器只有一句、缩写词（"Dr. Smith works..."）不被误切。

### 3.5 enx-api 新增整句翻译端点

- 路由：`POST /api/translate/sentence`（挂在现有 `apiGroup`，复用既有 auth middleware；`authGroup` 是否也需要视前端调用路径而定，按现有 `/translate` 与 `/api/translate` 均注册的先例，两处都加）。
- Request: `{ "sentence": "..." }`；Response 成功：`{ "success": true, "chinese": "..." }`；失败（AI 服务不可用/超时）：HTTP 502，`{ "success": false, "message": "..." }`（沿用 ECDICT 集成时"不可用要显式报错，不能静默返回空"的约定，见 ADR-0001）。
- 新增 `enx-api/aitranslate/` 包（DDD 分层：这是新的领域能力，不塞进现有 `translate/` 包，避免把"词典查询"与"AI 整句翻译"两种完全不同的数据源耦合在一起）：
  - `Translator` 接口：`TranslateSentence(ctx, sentence string) (string, error)`，方便 v1 只接一家但保留替换点（对应 ADR §Options Considered 里"provider 可插拔"的决定，见 §3.6）。
  - 一个具体实现（Kimi 或 MiniMax，见 §3.6 决策）。
- 配置：`config.toml` 新增 `[sentence-translate]` 段（`provider`、`model`、`base-url`，均非密钥），API Key 通过环境变量注入（如 `KIMI_API_KEY` / `MINIMAX_API_KEY`，对应 `viper.GetString("sentence-translate.api-key")`），**绝不写入 `config.toml`**，与 `resend.api-key` 先例一致。
- **必须新增测试**：`aitranslate` 包单测（mock HTTP client，覆盖成功/超时/非 200 响应）；`translate` 或新 handler 的集成测试覆盖 502 路径。

### 3.6 AI Provider 选型：Kimi vs MiniMax（待 Review 确认）

| 选项 | 说明 | 备注 |
| --- | --- | --- |
| **Kimi（Moonshot AI）** | Chat Completions 接口与 OpenAI 格式兼容，集成成本低，国内访问稳定 | **本 Spec 推荐**，v1 优先实现 |
| **MiniMax** | 同样是国内可用的 Chat/Completion API | 接口细节需另外确认；作为 `Translator` 接口的第二实现，留待需要时再补，不在 v1 一起做（避免为一个尚未验证需求的"多 provider"预先做两套集成） |

请在 Review 时确认：v1 先接 Kimi 是否可接受；`Translator` 接口设计是否足以支撑未来切换/新增 provider。

### 3.7 Side Panel 页面（`enx-chrome`）

- 新增 `sidepanel.html` + `src/sidepanel/SidePanel.tsx`，参照 `popup.html` / `src/popup/Popup.tsx` 的既有入口模式（Jotai `Provider` 包裹，`initSentry()`）。
- `manifest.json` 新增：
  ```json
  "permissions": [..., "sidePanel"],
  "side_panel": { "default_path": "sidepanel.html" }
  ```
- 组件状态机：`idle`（无 pending context）→ `loading`（正在请求整句翻译）→ `loaded`（展示英文原句 + 中文译文，原句内每个 token 可点击）→ 点击 token 后在下方追加一条 `{英文词: 中文释义}`（复用 `getOneWord` background action，与现有查词弹窗数据源一致，不新增查词逻辑）。
- `vite.config.ts` 目前没有手写 `rollupOptions.input`，`@crxjs/vite-plugin` 是通过读 `manifest.json` 里的 HTML 入口（`default_popup`、`options_page`）自动接入构建的；`side_panel.default_path` 是该插件明确支持的 MV3 字段，预期无需额外改 `vite.config.ts`，但实施时需要用 `pnpm build` 实测确认 `dist/sidepanel.html` 确实产出。

---

## 4. 验收标准

### 4.1 触发方式 A（工具栏图标）

- [ ] 未登录状态下点击工具栏图标，行为不变（打开 `popup.html` 登录表单）
- [ ] 登录成功后（新开窗口或刷新 service worker 后）点击工具栏图标，直接打开 Side Panel，而不是 `popup.html`
- [ ] Side Panel 打开时若无 pending context，显示空状态提示文案（而非空白/报错）

### 4.2 触发方式 B（查词弹窗按钮）

- [ ] 查词弹窗新增「🔤 整句翻译」按钮，不影响原有单词释义/发音/Mark Known 展示
- [ ] 点击按钮后，无论 `sidePanel.open()` 是否成功，`chrome.storage.session` 里都能读到最新 `enx-pending-sentence`
- [ ] 若 `sidePanel.open()` 因用户手势限制失败，弹窗内出现"请点击工具栏图标查看"提示，不报未捕获异常（控制台无红色 Error）
- [ ] 若 `sidePanel.open()` 成功，Side Panel 直接弹出并展示对应句子

### 4.3 句子提取

- [ ] 单测覆盖：多句段落按点击词定位到正确句子；单词在段落中重复出现两次时不误定位到第一次出现的句子；容器内只有一句时返回整句；含缩写（"Dr." / "e.g."）不被误切成多句

### 4.4 整句 AI 翻译（enx-api）

- [ ] `POST /api/translate/sentence` 对合法句子返回 `{success:true, chinese:"..."}`
- [ ] Provider 超时/非 200 时返回 HTTP 502 + `success:false`，不返回 200 空译文
- [ ] `KIMI_API_KEY`（或所选 provider 对应 env var）未设置时，启动或首次调用时有明确日志/报错，不静默失败
- [ ] `aitranslate` 包单测、handler 集成测试均通过

### 4.5 Side Panel 内单词点击

- [ ] 原句内每个单词可点击，点击后在译文下方追加该词释义
- [ ] 该释义内容与查词弹窗里的释义一致（同一 `getOneWord` 数据源，非另起一套）
- [ ] 连续点击多个不同单词，释义追加而非互相覆盖（或明确只保留最近一次，需在实现时与产品预期二次确认——本 Spec 默认"追加"，如需"仅保留最近一条"请在 Review 时提出）

### 4.6 已开面板的实时更新

- [ ] Side Panel 已打开时，在网页里点另一个词的"整句翻译"，面板内容原地刷新为新句子，不需要重新触发打开

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| `openPanelOnActionClick: true` 让 `popup.html` 图标入口失效，登出等功能暂时没有图标入口 | §3.2 A1 已标注为待 Review 确认项；短期可接受，登出可临时保留在 Side Panel 内一个小设置区 |
| 触发方式 B 在当前/未来 Chrome 版本上是否真的会因用户手势限制失败，行为不确定 | 按"两种都实现，互为兜底"设计，无论 B 是否失败功能都可用；不依赖 B 一定成功 |
| `Intl.Segmenter` 句子切分对口语化/无标点文本效果有限 | 兜底返回整个容器文本，不因切句失败导致功能不可用 |
| AI Provider（Kimi/MiniMax）响应慢，Side Panel 长时间 loading | 需设置合理超时（建议 10s）+ loading 态明确提示，超时按 502 处理 |
| API Key 若误写入 `config.toml` 或提交到仓库 | 严格遵循 `resend.api-key` 先例，仅走环境变量；提交前 review 确认 `config.toml` 无明文 key |
| Side Panel 与查词弹窗分别维护单词点击逻辑，未来可能出现重复实现（与 claude-blog Spec §2.2 类似的教训） | Side Panel 内单词点击复用 `sendToBackground({type:'getOneWord'})`，不新写查词逻辑；仅展示层各自实现 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/manifest.json` | 新增 `sidePanel` permission、`side_panel.default_path` |
| `enx-chrome/sidepanel.html` | 新增，Side Panel 入口 HTML |
| `enx-chrome/src/sidepanel/SidePanel.tsx` | 新增，Side Panel React 组件（英文原句 + AI 译文 + 单词点击释义） |
| `enx-chrome/src/lib/wordProcessor.ts` | 新增 `extractSentenceContext()` |
| `enx-chrome/src/content/content.ts` | 查词弹窗新增「整句翻译」按钮与点击处理（触发方式 B） |
| `enx-chrome/src/content/__tests__/` | 新增句子提取单测 |
| `enx-chrome/src/background/background.ts` | 新增 `openSentencePanel` / `translateSentence` message handler；登录状态变化时调用 `setPanelBehavior`（触发方式 A） |
| `enx-api/aitranslate/` | 新增，`Translator` 接口 + Kimi（或 MiniMax）实现 |
| `enx-api/translate/service.go` / `helpers.go` | 视最终路由挂载位置决定是否调整；`respondSentenceUnavailable` 的占位文案不再是唯一出路 |
| `enx-api.go` | 注册 `POST /api/translate/sentence` |
| `enx-api/config.toml` | 新增 `[sentence-translate]` 非密钥配置段 |
| `docs/adr/0001-integrate-ecdict-dictionary.md` | 背景引用，句子翻译缺口的原始记录 |

---

## 7. 实施顺序（建议）

```text
1. [ ] enx-api: 新增 aitranslate 包 + /api/translate/sentence 端点 + 单测/集成测试
       （先把后端能力做完并可用 curl 独立验证，不依赖前端）
2. [ ] enx-chrome: WordProcessor.extractSentenceContext() + 单测
       （纯逻辑，先用现有测试基础设施验证，不依赖 UI）
3. [ ] enx-chrome: 查词弹窗新增「整句翻译」按钮 + storage.session 写入 + 触发方式 B
4. [ ] enx-chrome: Side Panel 页面（读取 pending context → 调整句翻译 → 单词点击释义）
5. [ ] enx-chrome: 触发方式 A（登录状态联动 setPanelBehavior）
6. [ ] 本地 unpacked 加载，手工验证 §4 全部验收项（尤其触发方式 A/B 的真实 Chrome 行为，无法用单测替代）
7. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；§3.2/§3.6 标注的"待 Review 确认"项必须先拿到明确答复再动手，不要自行决定后直接实现。
2. **实现中**：严格按 §7 分步提交，每步跑一次对应测试；enx-api 与 enx-chrome 改动建议分开提交，便于 review。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- §3.2 A2：彻底放弃 `popup.html` 图标入口，登录表单迁入 Side Panel
- §3.6：MiniMax 作为 `Translator` 接口的第二实现，或按用户配置切换 provider
- 整句翻译结果本地缓存/历史记录
- Side Panel 内支持划词（选中多个词）触发整句翻译，而不仅限于点击已高亮单词
