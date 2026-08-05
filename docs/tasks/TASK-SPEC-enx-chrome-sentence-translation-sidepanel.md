# TASK-SPEC: enx-chrome 整句 AI 翻译侧边栏（Side Panel）

| 字段 | 值 |
| --- | --- |
| **状态** | 2026-08-03 变更 Implemented；**2026-08-04 新变更 Implemented**（§3.9：Side Panel 单词点击展示从单行列表改为卡片，随后又经两次修订：合并为单行布局、移除 Youdao 外链、Query Count 改图标；`tsc --noEmit`、`jest`（96 项全过，SidePanel 10 项）、`vite build`（产出 `dist/sidepanel.html`）均通过；真实 Chrome 手工验证——分阶段渲染的视觉效果、卡片样式——尚待用户执行） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 在现有单词查词弹窗基础上新增「整句翻译」入口：点击后在 Chrome 扩展的 Side Panel 中显示当前单词所在句子的英文原文 + 调用 AI 模型（Kimi / AWS Bedrock / MiniMax，按配置切换）翻译出的中文整句译文；用户还可在侧边栏内点击原文中任意单词，在整句译文下方追加显示该词**在当前句子上下文中的中文含义**（2026-08-03 变更：改为调用 AI 模型按句子上下文翻译该词，不再复用 ECDICT 查词逻辑；音标字段单独并行查询 ECDICT/`getOneWord` 获取，见 §3.7）。**2026-08-04 变更**：单词点击后的展示形式从单行文字改为卡片，卡片内同时展示 AI 上下文中文含义（突出显示）与词典原始中文释义（沿用 `getOneWord` 已查到但此前被丢弃的 `ecp.Chinese`/`ecp.LoadCount` 字段），并列出音标、Query Count、有道词典外链；卡片列表按点击时间倒序排列，重复点击已存在的词只置顶、不重新请求（见 §3.9） |
| **非目标** | 不改变现有查词弹窗内已有的单词翻译展示；不做侧边栏内的划词/多词选择整句翻译（仅覆盖"点击已高亮单词→查所在句"的路径）；不做翻译结果的本地持久化/历史记录 |
| **触发原因** | 用户反馈：点词查词后，若句子结构复杂，仅看单词释义仍无法理解整句含义；查词弹窗空间有限，无法容纳整句翻译内容，因此需要一个更大的展示区域（Side Panel）|
| **关联背景** | [`docs/adr/0001-integrate-ecdict-dictionary.md`](../adr/0001-integrate-ecdict-dictionary.md) §Consequences 明确写了"句子翻译需后续单独方案；当前仅返回明确提示"——本 Spec 是该后续方案的落地 |

---

## 1. 背景与动机

`enx-chrome` 目前支持网页正文单词高亮 + 点击查词，查词结果显示在一个基于 Popover API 的浮层弹窗中（`content.ts` → `showWordPopup()`）。弹窗空间只够放下单个单词的释义、音标、Youdao 外链和"Mark Known"按钮。

当用户点击的单词所在句子较复杂时，仅看单词释义不足以理解整句，需要看整句的中文翻译。这需要调用外部 AI 模型（示例：Kimi / MiniMax），且展示空间比现有浮层弹窗大得多——Chrome 扩展原生的 **Side Panel**（`chrome.sidePanel` API，MV3）刚好满足"页面侧边常驻、空间更大"的需求。

`enx-api` 侧已有先例：ADR-0001 把有道翻译切换为 ECDICT 时，明确把"句子翻译"列为 Consequences 里的已知缺口，`translate/helpers.go` 的 `respondSentenceUnavailable()` 目前对任何带空格的查询固定返回占位文案 `SentenceTranslationNotice`。本 Spec 是这个缺口的正式实现方案。

---

## 2. 现状调查

### 2.1 查词弹窗已是 React 组件（本节内容为 2026-07-31 Review 时更正，原 Draft 版本描述已过时）

Draft 版本（2026-07-30）曾调查得出"`src/components/WordPopup.tsx` 是死代码、没有任何地方 import，真正显示的弹窗是 `content.ts` 里手写的 innerHTML 字符串"的结论。Review 时重新核实代码，发现该结论已不成立：与本 Spec 撰写同期，仓库另有一条改造线（提交 `9adc7e8 popwindow react` → `f27380f popup react` → `0619faa fix enx chrome`）已经把查词弹窗切换成了真正的 React 渲染：

- 文件已从 `content.ts` 重命名为 `content.tsx`。
- `showWordPopup()`（`content.tsx` L48-160 附近）现在通过 `createRoot()` 在 Shadow DOM 内挂载 `<Provider store={contentScriptStore}><WordPopup ... /></Provider>`（`content.tsx:108-148`），`WordPopup.tsx` 是实际渲染内容的组件，并非死代码。
- `setupPopupEventHandlers()` / `hideWordPopup()` 现在只负责 Popover 生命周期（`toggle` 事件、ESC、click-outside）与 React root 的 mount/unmount 配对，不再手写内容 HTML。

**对实施的影响**：新增"🔤 整句翻译"按钮应作为 `WordPopup.tsx` 里的一个普通 React 按钮（放在现有"📚 Youdao / ✓ Know It"那一组 action buttons 旁边，`WordPopup.tsx` L129-153），通过 props 把点击回调传下去（参照 `onMarkAcquainted` 的传递方式），在 `content.tsx` 的 `showWordPopup()` 里实现该回调（调用 `WordProcessor.extractSentenceContext()` 取句 → `sendToBackground({type:'openSentencePanel', ...})`）。**不需要**、也不应该去找一份手写 HTML 字符串——那份代码已经不存在了。相应地，§6 文件索引里的 `content.ts` 改为 `content.tsx`，并新增 `WordPopup.tsx` 为需修改文件。

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
      3. 尝试直接打开 Side Panel（触发路径③，见 §3.2，可能失败）
  → Side Panel（若已打开或本次打开成功）：
      1. 读取待处理上下文，展示英文原句
      2. 调用 enx-api 新端点做整句 AI 翻译，展示中文译文
      3. 用户点击原句中任意单词 → 并行发起两个请求（2026-08-03 变更，见 §3.7）：
         a. 新端点 `/api/translate/word-in-context`：AI 按当前整句上下文翻译该词 → 中文含义
         b. 现有 getOneWord 逻辑：只取音标字段，中文释义字段丢弃不用
         → 在译文下方追加「单词 + 上下文中文含义 + 音标」
  → 若 Side Panel 未能直接打开（触发路径③失败）：
      提示用户"已保存，请点击工具栏 ENX 图标打开面板，或右键图标选择「打开整句翻译面板」"
      → 用户走触发路径①或②（见 §3.2，均可靠）→ Side Panel 打开并读取到同一份待处理上下文
```

### 3.2 Side Panel 触发方式（2026-07-31 Review 确认，替换 Draft 版 A1 方案）

Chrome 要求 `chrome.sidePanel.open()` 必须响应"用户手势"，且**该 API 在 content script 里不可用**，必须经 background 中转；但在扩展自己的页面（`popup.html`）里点击按钮、或在 `chrome.contextMenus.onClicked` 回调里调用，都是被 Chrome 认可的、未经转发的真实用户手势，可靠性明显高于"content script → `runtime.sendMessage` → background"这条转发链路。

**Draft 版 A1 方案（登录后动态切换 `chrome.sidePanel.setPanelBehavior({openPanelOnActionClick: true})`）已废弃**：该方案会让 `popup.html`（含登出入口）在登录后无法再通过点图标访问，Review 认为这个取舍不必要——下面四条路径叠加即可覆盖所有场景，且不需要牺牲 `popup.html` 的图标入口。

四条触发路径（不互斥，任意一条成功即可，待处理上下文见 §3.3 始终先落盘）：

| 路径 | 触发方式 | 可靠性 | 说明 |
| --- | --- | --- | --- |
| ① `popup.html` 内按钮 | 左键点图标打开 `popup.html`（不变）→ 点击其中新增的"打开整句翻译面板"按钮 → 直接调用 `chrome.sidePanel.open({ windowId })` | 可靠 | popup 页面上下文里的点击是真实用户手势，未经转发。`popup.html` 默认图标目标不变，登录/登出流程完全不受影响 |
| ② 右键图标 → 上下文菜单 | `background.ts` 用 `chrome.contextMenus.create({ id: 'enx-open-sentence-panel', title: '打开整句翻译面板', contexts: ['action'] })` 注册菜单项，`chrome.contextMenus.onClicked` 回调里调用 `chrome.sidePanel.open({ windowId: tab.windowId })` | 可靠 | 与左键点击互不冲突，右键菜单点击同样是 Chrome 认可的用户手势来源 |
| ③ 查词弹窗按钮（原"触发方式 B"） | `content.tsx` 新增按钮点击处理：`sendToBackground({ type: 'openSentencePanel', tabId, sentence, word, sourceUrl })`；`background.ts` 消息处理新增 `case 'openSentencePanel'`：写入 `chrome.storage.session`（见 §3.3），然后 `try { await chrome.sidePanel.open({ tabId }) } catch (e) { /* 记录，不抛出 */ }` | 尽力而为 | **已知风险**：content script 触发的用户手势通常无法通过 `runtime.sendMessage` 传递到 background，Chrome 可能报 `may only be called in response to a user gesture` 并 reject。这属于预期内的失败，不算 bug——处理器无论 `sidePanel.open()` 成功与否都必须返回 `{ success: true, panelOpened: boolean }`，content script 据此决定是否显示"请点击/右键工具栏图标"的提示 |
| ④（无需实现）关闭面板 | 无 | 不可行 | `chrome.sidePanel` API 只有 `open()` / `setOptions()` / `setPanelBehavior()` / `getOptions()` / `getPanelBehavior()`，**没有 `close()`**——这是 Chrome 的既定设计，扩展没有编程关闭 Side Panel 的能力。关闭一律交给 Chrome 面板自带的关闭控件，本 Spec 不做任何"关闭"按钮 |

因为待处理上下文已经落盘（无论①②③哪条先触发成功），四条路径不是互斥的"选一个"，而是互为兜底、内容一致。

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
1. 从 `wordElement` 向上找最近的块级文本容器（复用 `getArticleNodes()` 相同的"够大的文本容器"判断思路，或简单地取 `wordElement.closest('p, li, blockquote, td, div')` 里第一个 `textContent.length > 20` 的祖先）。**容器长度需要设上限**（2026-07-31 Review 补充，见下方"补强 2"），不能只卡下限。
2. 用 `Intl.Segmenter('en', { granularity: 'sentence' })`（Chrome 已长期原生支持，无需 polyfill）对容器 `textContent` 切句，比正则更能正确处理缩写（"Mr.", "e.g." 等）导致的误切。**locale 必须显式传 `'en'`，不要传 `undefined`**（2026-07-31 Review 补充，见下方"补强 1"）。
3. 用 `document.createRange()` 定位 `wordElement` 在容器内的字符偏移，映射到落在哪个句子分段内，而不是简单 `indexOf(word)`（同一单词在段落中可能出现多次，见 claude-blog Spec §2.4.1 里"同一 class 出现两次导致误命中"的前车之鉴）。
4. 找不到句子边界（如容器内只有一句、或 `Intl.Segmenter` 不可用）时，直接返回整个容器的 `textContent.trim()` 作为兜底，不返回 `null`——功能优雅降级，不应直接不可用。

**补强 1（2026-07-31 Review 网络调研补充）：locale 显式指定为 `'en'`**

`new Intl.Segmenter(undefined, {...})` 会使用浏览器/系统当前 locale 的断句规则；如果用户 Chrome 界面语言不是英语，断句规则可能不是针对英文缩写优化的那一套。本功能只处理英文网页正文，第 2 步必须显式传 `'en'`：`new Intl.Segmenter('en', { granularity: 'sentence' })`，不要依赖 `undefined` 走当前 locale。

**补强 2（2026-07-31 Review 网络调研补充）：容器文本长度需要上限保护**

`Intl.Segmenter` 在字符串超过约 40-50k 字符时有已知的"Maximum call stack exceeded"问题，且非 ASCII 字符越多性能退化越明显（见下方 GitHub issue/wrapper 库）。第 1 步目前只有下限判断（`textContent.length > 20`），没有上限——如果 `closest('p, li, blockquote, td, div')` 意外匹配到一个包住整篇文章的大 `div`（而非单个段落），理论上可能触发这个问题。实现时需加上限（建议 5000 字符）：超过阈值时不对整个容器切句，退化为"以 `wordElement` 为中心截取前后一段固定长度文本（如各 500 字符）再切句"，避免把过大的文本一次性喂给 `Intl.Segmenter`。

**参考资料**：
- [Intl.Segmenter - JavaScript - MDN Web Docs](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Intl/Segmenter) — API 用法与 locale 参数说明
- [GitHub - jonschlinkert/intl-segmenter](https://github.com/jonschlinkert/intl-segmenter) — 记录了 40-50k 字符触发 "Maximum call stack exceeded" 的已知问题及绕过方案
- [Accurate text lengths with `Intl.Segmenter` API | Automagic](https://blog.sangeeth.dev/posts/accurate-text-lengths-with-intl-segmenter-api/) — 性能特征补充说明
- [Window.getSelection() and Range in Javascript](https://medium.com/@alexandrawilll/window-getselection-and-range-in-javascript-5a13453d22) — 验证 Range API 计算 DOM 位置字符偏移是选区/富文本编辑场景下的标准做法，非本 Spec 特有 hack

**必须新增单测**（`src/content/__tests__/`，jsdom）：多句段落中点击不同句子的词、单词在段落中重复出现两次、容器只有一句、缩写词（"Dr. Smith works..."）不被误切、容器文本超过上限时退化为截取前后文本再切句。

### 3.5 enx-api 新增整句翻译端点

- 路由：`POST /api/translate/sentence`（挂在现有 `apiGroup`，复用既有 auth middleware；`authGroup` 是否也需要视前端调用路径而定，按现有 `/translate` 与 `/api/translate` 均注册的先例，两处都加）。
- Request: `{ "sentence": "..." }`；Response 成功：`{ "success": true, "chinese": "..." }`；失败（AI 服务不可用/超时）：HTTP 502，`{ "success": false, "message": "..." }`（沿用 ECDICT 集成时"不可用要显式报错，不能静默返回空"的约定，见 ADR-0001）。
- 新增 `enx-api/aitranslate/` 包（DDD 分层：这是新的领域能力，不塞进现有 `translate/` 包，避免把"词典查询"与"AI 整句翻译"两种完全不同的数据源耦合在一起）：
  - `Translator` 接口：`TranslateSentence(ctx, sentence string) (string, error)`。
  - **三个具体实现**（见 §3.6 决策，v1 就要求三者都在）：`aitranslate/kimi`（Chat Completions，OpenAI 兼容格式）、`aitranslate/bedrock`（AWS Bedrock Runtime，默认走 Anthropic Claude 模型）、`aitranslate/minimax`（Chat/Completion API，请求/响应字段需在实现时对照 MiniMax 官方文档确认，与 Kimi 的 OpenAI 兼容格式不完全相同）。
  - 一个 `New(ctx context.Context) (Translator, error)` 工厂函数，按配置的 `provider` 字段选择实例化哪个实现；若配置的 provider 缺少必需的凭证/配置项，**启动时立即返回 error**（fail fast，不要等到第一次请求才发现，见 §4.4）。
  - **已实现的区分**（2026-07-31）：`provider` 留空（未配置）与`provider` 已指定但初始化失败，两种情况处理不同——前者视为"功能未启用"（与 ECDICT 在 `ecdict.db_path` 为空时的降级模式一致），进程正常启动，`/translate/sentence` 对任何请求响应 502 `"sentence translation is not configured"`；后者视为部署方明确选择了某个 provider 但配置/凭证有问题，`enx-api.go` 的 `setupRouter()` 里 `os.Exit(1)` 立即终止进程，不会带着一个不可用的 handler 继续跑。
- 配置：`config.toml` 新增 `[sentence-translate]` 段，`provider` 在仓库里签入的模板值留空（各部署环境自行设置，见下方"实施落地"更新）：
  ```toml
  [sentence-translate]
  provider = ""              # "kimi" | "bedrock" | "minimax"，各部署环境自行设置，留空则功能禁用（502）

  [sentence-translate.kimi]
  model = "moonshot-v1-8k"
  base-url = "https://api.moonshot.cn/v1"

  [sentence-translate.bedrock]
  region = "us-east-1"
  model-id = "anthropic.claude-3-5-haiku-20241022-v1:0"   # 默认建议，可调整

  [sentence-translate.minimax]
  model = "MiniMax-Text-01"                # 2026-07-31 实现时查证：MiniMax 现有 OpenAI 兼容端点下的模型命名，替换了草稿版猜测的 "abab6.5s-chat"
  base-url = "https://api.minimax.io/v1"   # 注意域名是 minimax.io（新的 OpenAI 兼容端点），不是草稿版猜测的 minimax.chat；该端点下不需要 group_id
  ```
  三个子段均为**非密钥**配置，且三者都常驻 `config.toml`（不是只写当前激活的那个）——这样同一份 `config.toml` 可以在不同环境间复用，只改 `provider` 一行即可切换。
- 密钥注入方式三家不同，均通过环境变量，**绝不写入 `config.toml`**，与 `resend.api-key` 先例一致：
  - Kimi：`KIMI_API_KEY`（对应 `viper.GetString("sentence-translate.kimi.api-key")` 的等价环境变量绑定，或直接 `os.Getenv`，与 `email/email.go` 现有模式二选一，实现时保持与该文件一致的读取方式）。
  - MiniMax：`MINIMAX_API_KEY`，同上模式；MiniMax 部分版本 API 还需要 `group_id`，实现时确认所选 API 版本是否需要，若需要则作为非密钥配置放进 `[sentence-translate.minimax]`（`group_id` 本身不是密钥）。
  - Bedrock：**不是**单个 API Key，而是 AWS 凭证。2026-07-31 确认 `enx-api` 的部署目标是 **AWS EC2**（此前 §3.5 草稿误判为自管 VPS，已更正）——因此走 **IAM 实例角色**（instance profile），不使用静态 access key/secret：给该 EC2 实例挂一个仅授权 `bedrock:InvokeModel`（建议限定到 `model-id` 对应 ARN）的 IAM Role，AWS SDK for Go v2 的默认凭证链会自动从实例元数据服务（IMDSv2）取到临时凭证，代码和环境变量里都不需要出现任何密钥。若本地开发或非 EC2 环境需要联调 Bedrock，SDK 凭证链会退回读取 `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` 环境变量，作为 fallback，同样不写入 `config.toml`。
- **必须新增测试**：`aitranslate/kimi`、`aitranslate/bedrock`、`aitranslate/minimax` 各自单测（Kimi/MiniMax mock HTTP client；Bedrock 通过给 `bedrockruntime.Client` 包一层最小接口再 mock，覆盖成功/超时/非 200 响应）；`New()` 工厂函数测试覆盖"provider 配置值非法"和"必需凭证缺失"场景（三家各一次）；`translate` 或新 handler 的集成测试覆盖 502 路径。

### 3.6 AI Provider 选型：Kimi + AWS Bedrock + MiniMax 三实现，按配置切换（2026-07-31 Review 已确认）

- **Kimi 与 Bedrock**：由具体部署拓扑驱动——homelab k8s 集群适合走 Kimi（国内可用、无需额外走 AWS 出口），AWS EC2 适合走 Bedrock（同云内调用，走 IAM 实例角色，无需额外密钥）。
- **MiniMax**：无特定部署场景驱动，用户明确表示"单纯想多一个可选项"——即 `Translator` 接口本身设计成可插拔，多接一家的边际成本低，不要求每个 provider 都要有部署拓扑上的理由。

三者都属于 v1 范围（不是"先一后二"）：

| 选项 | 说明 | 结论 |
| --- | --- | --- |
| **Kimi（Moonshot AI）** | Chat Completions 接口与 OpenAI 格式兼容，集成成本低，国内（homelab k8s 部署场景）访问稳定 | **v1 实现**，`provider = "kimi"` |
| **AWS Bedrock（Anthropic Claude）** | 走 AWS SigV4 签名 + `bedrockruntime.InvokeModel`；EC2 部署场景下走 IAM 实例角色，同云调用 | **v1 实现**，`provider = "bedrock"`；需提前在目标 region 的 Bedrock 控制台为选定的 `model-id` 申请 model access（默认不开通） |
| **MiniMax** | 国内可用的 Chat/Completion API；接口细节（是否需要 `group_id`、具体 endpoint 路径）需实现时对照官方文档确认 | **v1 实现**，`provider = "minimax"`，无特定部署驱动，纯粹作为第三个可选项 |

`Translator` 接口设计（`TranslateSentence(ctx, sentence string) (string, error)`）足以支撑三个实现共存：签名完全一致，工厂函数按配置切换，调用方（handler）不感知具体是哪一家。

### 3.7 Side Panel 页面（`enx-chrome`）

- 新增 `sidepanel.html` + `src/sidepanel/SidePanel.tsx`，参照 `popup.html` / `src/popup/Popup.tsx` 的既有入口模式（Jotai `Provider` 包裹，`initSentry()`）。
- `manifest.json` 新增：
  ```json
  "permissions": [..., "sidePanel"],
  "side_panel": { "default_path": "sidepanel.html" }
  ```
- 组件状态机：`idle`（无 pending context）→ `loading`（正在请求整句翻译）→ `loaded`（展示英文原句 + 中文译文，原句内每个 token 可点击）→ 点击 token 后在下方追加一条释义。

**2026-08-03 变更：单词点击的释义来源改为 AI 上下文翻译，音标改为单独并行查询**（原方案是完全复用 `getOneWord`，同一份 ECDICT 数据源出中文释义+音标；触发原因见 §3.8 前的说明）：

- 点击 token 后并行发起两个请求，不互相阻塞：
  1. `sendMessageToBackground({ type: 'translateWordInContext', word, sentence: pendingContext.sentence })` → 新 background handler → `POST /api/translate/word-in-context`（见 §3.8）→ 拿到该词在**当前句子上下文**中的中文含义
  2. `sendMessageToBackground({ type: 'getOneWord', word })`（不变，仍是现有逻辑）→ 只取返回值里的**音标字段**，中文释义字段直接丢弃不展示
- 两个请求都返回后再一起追加一条记录 `{ word, contextChinese, pronunciation }`；任一请求失败不阻塞另一个（音标查不到就留空，上下文翻译失败则该词条显示"翻译失败"提示，不影响音标展示）。
- 原因：ECDICT 返回的是该词**脱离上下文的通用释义**（多义词时可能与当前句意不符）；Side Panel 已经有整句翻译作为上下文，用户想看的是这个词**在这句话里**具体是什么意思，因此中文含义必须走 AI 按句子上下文翻译，不能再用 ECDICT。音标是纯发音信息、与上下文无关，继续用 ECDICT 更快更省 token，没有理由跟着一起换成 AI。
- 网页正文的查词弹窗（`WordPopup.tsx`）**不受影响**，仍然全量复用 `getOneWord`/ECDICT（中文释义+音标一起来），因为那里没有整句上下文可依托，ADR-0001 的决策在那个场景下继续成立。
- `vite.config.ts` 目前没有手写 `rollupOptions.input`，`@crxjs/vite-plugin` 是通过读 `manifest.json` 里的 HTML 入口（`default_popup`、`options_page`）自动接入构建的；`side_panel.default_path` 是该插件明确支持的 MV3 字段，预期无需额外改 `vite.config.ts`，但实施时需要用 `pnpm build` 实测确认 `dist/sidepanel.html` 确实产出。

### 3.8 enx-api 新增「上下文中单词翻译」端点（2026-08-03 新增）

- 路由：`POST /api/translate/word-in-context`（与 `/api/translate/sentence` 同一 `authGroup`，同一 auth middleware，同一 provider 配置/切换机制，不新增配置段）。
- Request: `{ "sentence": "...", "word": "..." }`；Response 成功：`{ "success": true, "chinese": "..." }`；失败：HTTP 502，`{ "success": false, "message": "..." }`（与 `/api/translate/sentence` 一致的"不可用要显式报错"约定）。
- `Translator` 接口新增一个方法：`TranslateWordInContext(ctx context.Context, sentence, word string) (string, error)`，`kimi`/`bedrock`/`minimax` 三个现有实现各自补上这个方法，复用各自已有的 HTTP client/超时/错误处理，只是 system prompt 和 user content 不同：
  ```
  system: "You are a professional English-to-Chinese translator. Given an English sentence and a specific word from that sentence, reply with the word's Chinese meaning as used in THIS sentence's context only. Reply with the Chinese meaning only, no explanation, no pinyin, no quotes."
  user: "Sentence: {sentence}\nWord: {word}"
  ```
  （具体措辞实现时可调整，但"按句子上下文而非通用释义翻译"这个约束必须保留在 prompt 里）。
- `Handler` 新增 `TranslateWordInContext` 方法，注册路由，实现方式对照 `handler.go` 现有 `TranslateSentence` 的结构（校验 `translator == nil` → 502 "sentence translation is not configured"；调用失败 → 502 "translation service unavailable"；成功 → 200）。
- **必须新增测试**：`kimi`/`bedrock`/`minimax` 各自补一个 `TranslateWordInContext` 单测（mock HTTP，验证 prompt 里带上了 sentence 和 word）；`handler_test.go` 补新端点的成功/502 路径测试。

### 3.9 Side Panel 单词卡片改版（2026-08-04 新增，Implemented）

**触发原因**：§3.7 的现状是点击单词后在译文下方追加一条纯文本单行（词 + 音标 + AI 上下文中文含义）。用户希望再补充展示词典原始中文释义（`getOneWord` 响应里的 `ecp.Chinese` 字段——这个字段其实一直在查，只是 §3.7 的 2026-08-03 变更里被明确丢弃未展示，见 §3.7 倒数第二段）。单行文字已经放不下"词 + 音标 + 上下文义 + 词典释义"这么多信息，因此改为卡片布局。

**数据来源（不新增/不调用任何新后端接口）**：

- `getOneWord`（§3.7 已有的并行请求之一）响应 `ecp: WordData` 里的 `Pronunciation`（音标）、`Chinese`（词典原始中文释义）、`LoadCount`（Query Count）三个字段本来就存在，本次改动只是把此前被丢弃的 `Chinese`/`LoadCount` 也消费展示出来。
- `translateWordInContext`（§3.7/§3.8 已有）响应的 `chinese` 字段不变，继续作为"上下文中文含义"。

**卡片内容与展示顺序**（对齐网页正文查词弹窗 `WordPopup.tsx` 的信息颗粒度，用户明确要求"跟现有的页面查词逻辑一致"）：

1. 英文词 + 音标 + AI 上下文中文含义 + Query Count——**同一行**（2026-08-04 二次修订，用户要求："这样可以节省 y 轴的空间"；此前版本这四项分四行堆叠，`flex flex-wrap` 单行容器改为一行内展示，空间不够时才自动折行，不再固定占四行）。上下文含义样式仍突出/高亮（蓝色加粗），与词、音标、Query Count 的灰色系区分开
2. 词典原始中文释义（`ecp.Chinese`，独立一行，样式弱于第 1 行的上下文含义；文本按 `\n` 换行渲染，避免多词性/多释义的原始字符串挤成一行）

**明确不包含**（用户澄清确认）：

- 「🔤 整句翻译」按钮——侧边栏本身就是整句翻译的展示位，不需要
- 「已认识」状态与「✓ Know It」标记按钮——用户明确排除，Side Panel 卡片不做单词掌握状态管理
- 有道词典外链（2026-08-04 三次修订，废弃第一版决策）——最初 §3.9 要求对齐 `WordPopup.tsx` 保留该外链，但用户后续要求"删掉,节省纵向的空间"，卡片不再渲染 Youdao 链接，`SidePanel.tsx` 里的 `getYoudaoUrl()` 辅助函数一并移除（`WordPopup.tsx` 网页正文查词弹窗不受影响，继续保留 Youdao 外链）

**Query Count 改图标（2026-08-04 四次修订）**：用户反馈"Query Count"文字太长，侧边栏卡片多起来时重复出现、观感啰嗦，要求换成图标。原计划沿用仓库现有的纯 emoji 图标惯例（`WordPopup.tsx`/`SidePanel.tsx` 已有的 📚/🔤/✓/⏳ 都是 emoji，无图标库依赖），但用户明确选择引入专业 SVG 图标库而非 emoji。选型 `@heroicons/react`（MIT 许可，Tailwind Labs 官方图标库，与仓库已用的 Tailwind 生态一致，`20/solid`「mini」子集专为小尺寸内联场景设计）——`MagnifyingGlassIcon`（放大镜，语义对应"查询/搜索次数"）替换原来的 `Query Count: {N}` 文字，改为「图标 + 数字」（如 🔍 12，实际渲染为内联 SVG + 数字），原文字保留在 `title` 属性里作为悬浮提示，不完全丢失可读性。`WordPopup.tsx`（网页正文查词弹窗）与 `SidePanel.tsx`（侧边栏卡片）两处同步修改，保持两者展示一致。

**布局：卡片直接渲染在侧边栏内部，不是浮层/弹出层**。这一点与网页正文 `WordPopup.tsx` 用 Popover API + Shadow DOM 悬浮显示的原因不同——页面内浮层是为了不遮挡网页正文，而侧边栏本身整个区域都是 ENX 生成的辅助内容，不存在"遮挡什么"的顾虑，因此卡片就是 `definitions` 列表里的普通 DOM 节点，不需要 anchor positioning / Popover API。

**加载体验：分阶段渲染**（用户确认，覆盖 §3.7 旧描述"两个请求都返回后再一起追加"的行为）：

- 点击单词的瞬间即在列表最前插入一张"骨架"卡片（标题已知，音标/上下文义/词典释义均为各自独立的 loading 占位）。
- `getOneWord` 与 `translateWordInContext` 仍按 §3.7 并行发起，但各自 resolve 后只更新自己负责的字段（用 `word` 定位到列表里对应那一条），不再互相等待。`getOneWord` 通常更快返回，音标/Query Count/词典释义会先于 AI 上下文义显示出来。
- 任一请求失败：该部分显示错误态（如"翻译失败"/词典部分为空），不阻塞另一部分正常显示，沿用 §3.7 已有的"互不阻塞"原则。

**卡片列表排序与去重**（用户确认）：

- 列表按点击时间倒序排列，最近点击的词卡片在最上面（此前是简单 append 到末尾）。
- 若点击的词已存在于当前列表中（同一句子内重复点击同一个词），**不重新发起请求、不新增卡片**，只把已存在的那张卡片挪到列表最前面。

**数据结构调整**（`enx-chrome/src/sidepanel/SidePanel.tsx`）：

```ts
type FetchStatus = 'loading' | 'loaded' | 'error'

interface WordCardData {
  word: string
  pronunciation?: string
  loadCount?: number
  dictionaryChinese?: string
  dictionaryStatus: FetchStatus
  contextChinese?: string
  contextStatus: FetchStatus
}
```

`handleWordClick` 改为：

1. 若 `word`（小写）已存在于 `definitions`：仅将该条记录移到数组最前，`return`，不发起任何请求。
2. 否则：以 `{ word, dictionaryStatus: 'loading', contextStatus: 'loading' }` 插入 `definitions` 最前，然后并行发起 `getOneWord`、`translateWordInContext`；各自 `.then()` 里用 `word` 作为 key，`setDefinitions(prev => prev.map(...))` 只更新对应字段与其 `*Status`，不再用 `Promise.allSettled` 等两者都完成后一次性 append 一整条记录。

**必须新增/更新测试**（`SidePanel.test.tsx`）：卡片分阶段渲染（`getOneWord` 先返回时词典部分先出现、上下文义仍是 loading 态，反之亦然）；重复点击已存在的词只重排不重新发请求（mock 的 `sendMessageToBackground` 调用次数不因重复点击而增加）；新点击的词卡片出现在列表最前而非末尾；词典释义为空（`ecp.Chinese` 为空）时该部分不渲染或显示空态，不报错。

---

## 4. 验收标准

> **图例**（2026-07-31 实现后标注）：`[x]` = 已通过自动化验证（`go test`/`jest`/`tsc`/`pnpm build`）；`[ ]` 前标 ⏳ = 代码已实现，但只有真人在 unpacked 模式加载后于真实 Chrome 里点击才能确认（Side Panel 打开/关闭、用户手势限制等 Chrome 原生行为，脚本无法模拟）。

### 4.1 触发路径①②（工具栏图标：左键 popup 按钮 / 右键菜单）

- [ ] ⏳ 左键点击工具栏图标，行为不变（打开 `popup.html`，登录/登出流程不受影响）——代码未改动 `default_popup`，理论上不变，需真机确认
- [ ] ⏳ `popup.html` 内新增按钮，点击后直接打开 Side Panel（不依赖 pending context 也能打开，展示空状态）——按钮已实现（`Popup.tsx`），`chrome.sidePanel.open()` 的真实弹出效果需真机确认
- [ ] ⏳ 右键点击工具栏图标，出现"打开整句翻译面板"菜单项，点击后直接打开 Side Panel——`contextMenus.create`/`onClicked` 已实现，菜单渲染与点击效果需真机确认
- [x] Side Panel 打开时若无 pending context，显示空状态提示文案（而非空白/报错）——`SidePanel.test.tsx` 覆盖

### 4.2 触发路径③（查词弹窗按钮）

- [x] 查词弹窗新增「🔤 整句翻译」按钮（`WordPopup.tsx` 内，与现有 Youdao/Know It 按钮同一区域），不影响原有单词释义/发音/Mark Known 展示——已实现，`jest`/`tsc` 通过（无既有 WordPopup 组件测试可跑，但类型与既有 86+6 项测试均未回归）
- [ ] ⏳ 点击按钮后，无论 `sidePanel.open()` 是否成功，`chrome.storage.session` 里都能读到最新 `enx-pending-sentence`——`handleOpenSentencePanel` 已实现（先写 storage 后 try open），真实手势失败路径需真机确认
- [ ] ⏳ 若 `sidePanel.open()` 因用户手势限制失败，弹窗内出现"请点击/右键工具栏图标查看"提示，不报未捕获异常（控制台无红色 Error）——`sentencePanelHintAtom` 已接好，需真机确认真实失败路径
- [ ] ⏳ 若 `sidePanel.open()` 成功，Side Panel 直接弹出并展示对应句子——需真机确认

### 4.3 句子提取

- [x] 单测覆盖：多句段落按点击词定位到正确句子；单词在段落中重复出现两次时不误定位到第一次出现的句子；容器内只有一句时返回整句；含缩写（"Dr." / "e.g."）不被误切成多句；容器文本超过长度上限时退化为截取前后文本再切句（§3.4 补强 2）——`extractSentenceContext.test.ts`，6 项全过

### 4.4 整句 AI 翻译（enx-api）

- [x] （2026-08-03 新增，见 §3.8）`POST /api/translate/word-in-context` 对合法 `{sentence, word}` 返回 `{success:true, chinese:"..."}`，三种 provider 配置下均验证通过；provider 未配置/调用失败时返回 502，与 `/api/translate/sentence` 同一套约定——`kimi_test.go`/`bedrock_test.go`/`minimax_test.go` 各新增 `TranslateWordInContext` 成功/非 200 测试；`handler_test.go` 新增 `TestWordInContextHandlerSuccess`/`TranslatorError`/`NotConfigured`/`MissingFields` 四项，`go test ./...` 全绿

- [x] `POST /api/translate/sentence` 对合法句子返回 `{success:true, chinese:"..."}`，`provider = "kimi"`、`"bedrock"`、`"minimax"` 三种配置下均验证通过——`kimi_test.go`/`bedrock_test.go`/`minimax_test.go`/`handler_test.go` 覆盖（mock HTTP/mock Bedrock client，非真实调用第三方 API；真实 API Key/IAM 权限下的端到端联调仍建议部署前手工 curl 一次）
- [x] Provider 超时/非 200 时返回 HTTP 502 + `success:false`，不返回 200 空译文（三个 provider 均覆盖）——同上测试文件覆盖
- [x] `KIMI_API_KEY` 未设置且 `provider = "kimi"` 时，启动阶段立即报错退出，不静默失败——`factory_test.go` 覆盖 `New()` 报错路径；`enx-api.go` 里 `os.Exit(1)` 分支未被测试直接执行（会终止测试进程),按代码走查确认逻辑正确
- [x] `MINIMAX_API_KEY`（及所需的 `group_id`，如适用）未设置且 `provider = "minimax"` 时，启动阶段立即报错退出，不静默失败——同上
- [x] `provider = "bedrock"` 时若 EC2 实例角色未挂载/权限不足（或本地调试场景下 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` 未设置），启动阶段或首次调用时有明确日志/报错，不静默失败——`factory_test.go`/`bedrock_test.go` 覆盖配置缺失路径；真实 IAM 权限不足的报错文案需部署到 EC2 后确认
- [x] `aitranslate/kimi`、`aitranslate/bedrock`、`aitranslate/minimax` 包单测、`New()` 工厂函数测试、handler 集成测试均通过——`go test ./...` 全绿

### 4.5 Side Panel 内单词点击

- [x] 原句内每个单词可点击，点击后在译文下方追加该词释义——`SidePanel.test.tsx` 覆盖
- [ ] （2026-08-03 变更，废弃旧标准）~~该释义内容与查词弹窗里的释义一致（同一 `getOneWord` 数据源，非另起一套）~~——**已不再适用**，见下方新标准
- [x] 「在这句话中」上下文含义来自 `/api/translate/word-in-context`，按当前句子上下文翻译，**不等于**查词弹窗里那个词的通用 ECDICT 释义——`SidePanel.tsx` 的 `handleWordClick` 里 `contextChinese` 只取 `translateWordInContext` 响应的 `chinese` 字段；（2026-08-04 变更）`getOneWord` 响应的 `ecp.Chinese` 字段不再是"丢弃不用"，而是作为卡片里单独一段「词典原始释义」展示，两者是卡片里两个不同区块，不会互相覆盖或混淆，见 §3.9/§4.5.1；`SidePanel.test.tsx`「appends word cards on click」用例断言两个数据源返回不同文案时二者都各自展示在对应区块
- [x] 音标字段仍来自 `getOneWord`/ECDICT，与网页正文查词弹窗显示的音标一致——同上用例断言 `ecp.Pronunciation` 正常展示
- [x] 上下文翻译请求与词典查询并行发起、互不阻塞；任一方失败不影响另一方展示（如上下文翻译 502 时音标/词典释义仍正常显示）——两个请求各自独立 `.then()/.catch()`，用 `word` 定位更新对应卡片字段（2026-08-04 变更前是 `Promise.allSettled` 等两者都完成，见 §3.9 分阶段渲染）；`SidePanel.test.tsx`「still shows dictionary info when the contextual translation fails, and vice versa」用例覆盖
- [x] 连续点击多个不同单词，释义追加显示（不互相覆盖，2026-07-31 Review 已确认）——`SidePanel.test.tsx` 覆盖（追加机制本身不变，仅单条记录内容来源变化，测试断言已更新）
- [ ] （2026-08-03 描述，2026-08-04 起废弃）~~两个请求都返回后再一起追加一条记录~~——**已不再适用**，见下方 §3.9 新标准（改为分阶段渲染）

### 4.5.1 Side Panel 单词卡片改版（2026-08-04 新增，见 §3.9，Implemented）

- [x] 点击单词后立即在列表最前插入卡片骨架，音标/Query Count/词典释义与上下文中文含义各自独立 loading，互不等待——`handleWordClick` 先 `setDefinitions` 插入 `{ dictionaryStatus: 'loading', contextStatus: 'loading' }` 骨架，再各自发起请求；`SidePanel.test.tsx`「renders the card progressively」用例覆盖
- [x] `getOneWord` 先于 `translateWordInContext` 返回时，音标/Query Count/词典释义先展示，上下文含义区仍显示 loading；反之亦然——同上用例用手动控制的 pending Promise 断言中间态
- [x] 卡片展示顺序为：英文词 + 音标 + AI 上下文中文含义（突出显示）+ Query Count 同一行 → 词典原始中文释义——`SidePanel.tsx` JSX 结构与 §3.9 一致（2026-08-04 二次修订：前四项从四行合并为一行 `flex flex-wrap`；三次修订：移除 Youdao 外链行）
- [x] 卡片不包含「整句翻译」按钮、「已认识」状态、「✓ Know It」按钮、有道词典外链——`SidePanel.tsx` 卡片 JSX 未渲染这四者（Youdao 外链 2026-08-04 三次修订移除）
- [x] 卡片直接渲染在侧边栏内部，不使用 Popover API / anchor positioning / 悬浮层——卡片是 `definitions` 列表里的普通 `<div>`，无 Shadow DOM/Popover
- [x] 词典释义为空（`ecp.Chinese` 为空）时该区域不渲染或显示空态，不报错、不显示 `undefined`——`def.dictionaryChinese &&` 短路渲染；`SidePanel.test.tsx`「does not render a dictionary section ... "undefined"」用例覆盖
- [x] 新点击的词卡片出现在列表**最前**，而非追加到末尾——`setDefinitions(prev => [骨架, ...prev])`；「appends word cards on click」用例断言卡片顺序
- [x] 重复点击列表中已存在的词：仅将其卡片移到最前，不重新发起 `getOneWord`/`translateWordInContext` 请求（mock 调用次数不增加）——「re-clicking a word already in the list」用例覆盖

### 4.6 已开面板的实时更新

- [x] Side Panel 已打开时，在网页里点另一个词的"整句翻译"，面板内容原地刷新为新句子，不需要重新触发打开——`SidePanel.test.tsx` 用 `chrome.storage.onChanged` 模拟覆盖

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| 查词弹窗按钮（路径③）在当前/未来 Chrome 版本上是否真的会因用户手势限制失败，行为不确定 | 按"四条路径叠加，互为兜底"设计（见 §3.2），无论③是否失败，①/②两条可靠路径都能打开面板 |
| Side Panel 没有编程关闭接口 | 不做"关闭"按钮，明确交给 Chrome 面板自带关闭控件，写入 §3.2/§4 验收标准，避免误以为是遗漏 |
| `Intl.Segmenter` 句子切分对口语化/无标点文本效果有限 | 兜底返回整个容器文本，不因切句失败导致功能不可用 |
| AI Provider（Kimi/Bedrock）响应慢，Side Panel 长时间 loading | 需设置合理超时（建议 10s）+ loading 态明确提示，超时按 502 处理 |
| API Key / AWS 凭证若误写入 `config.toml` 或提交到仓库 | 严格遵循 `resend.api-key` 先例，仅走环境变量；提交前 review 确认 `config.toml` 无明文 key/AWS access key |
| Bedrock 对应 `model-id` 在目标 AWS 账号/region 未开通 model access，`provider = "bedrock"` 时调用直接失败 | 部署前手动在 Bedrock 控制台申请该模型的 access；`New()` 工厂函数 fail-fast 检查能及早暴露配置问题，但模型访问权限需人工确认，非代码可自动检测 |
| EC2 实例角色权限范围过大（例如给了整个 Bedrock 的权限而非单一 model） | 给 EC2 实例挂的 IAM Role 限定 `bedrock:InvokeModel` 到具体 `model-id` 对应 ARN，遵循最小权限原则 |
| （2026-08-03 变更，原风险已不适用）~~Side Panel 与查词弹窗分别维护单词点击逻辑，未来可能出现重复实现~~ | **已按需求变更为有意分叉**：Side Panel 中文含义走 AI 按句子上下文翻译，查词弹窗中文释义走 ECDICT 通用释义——两者数据源不同是设计使然（前者要上下文义、后者要通用义），不是重复实现；音标字段两边仍共用 `getOneWord`/ECDICT，避免真正的重复 |
| （2026-08-03 新增）Side Panel 单词点击从"本地查表，<50ms"变为"每次点击一次 AI 调用"，延迟从毫秒级升到秒级，且每次点击消耗一次第三方 API 调用/token 费用 | 与整句翻译同一套 loading/超时（10s）+ 明确提示的处理方式；上下文翻译与音标查询并行发起，音标先返回可先展示，不必等 AI 结果 |
| （2026-08-03 新增）连续快速点击多个词会产生多个并发 AI 请求，可能触发 provider 侧限流 | v1 不做防抖/排队，出现限流问题时再按 502 错误路径提示用户重试；不属于本次变更的验收范围 |
| （2026-08-04 新增）分阶段渲染引入了"两个请求各自独立更新同一条记录"的状态管理，若用 index 定位记录容易在列表重排（置顶）后错位更新 | §3.9 明确用 `word` 而非数组下标作为 `setDefinitions` 更新时的 key；新增测试覆盖"点击 A → 点击 B（A 移到最前）→ A 的请求才 resolve"这类交错时序，确保更新落到正确的卡片上 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/manifest.json` | 新增 `sidePanel`、`contextMenus` permission、`side_panel.default_path` |
| `enx-chrome/sidepanel.html` | 新增，Side Panel 入口 HTML |
| `enx-chrome/src/sidepanel/SidePanel.tsx` | 新增，Side Panel React 组件（英文原句 + AI 译文 + 单词点击释义）；**2026-08-03 变更**：`handleWordClick` 改为并行发起 `translateWordInContext` + `getOneWord`，前者取中文含义、后者只取音标；**2026-08-04 变更**：`WordDefinition` → `WordCardData`（新增 `loadCount`/`dictionaryChinese`/`dictionaryStatus`/`contextStatus` 字段），单行文字列表改为卡片列表，`handleWordClick` 改为「已存在则置顶不重新请求；否则插入列表最前 + 两个请求分别独立更新对应字段」，见 §3.9 |
| `enx-chrome/src/sidepanel/__tests__/SidePanel.test.tsx` | 新增，覆盖空状态/加载译文/追加释义/`storage.onChanged` 实时刷新；**2026-08-03 变更**：单词点击相关断言改为验证「上下文中文含义来自 word-in-context 响应、音标来自 getOneWord 响应、任一方失败不阻塞另一方」；**2026-08-04 变更**：新增卡片分阶段渲染、置顶去重、词典释义空态的测试用例，见 §3.9 末尾「必须新增/更新测试」 |
| `enx-chrome/src/lib/wordProcessor.ts` | 新增 `extractSentenceContext()` |
| `enx-chrome/src/components/WordPopup.tsx` | 新增「🔤 整句翻译」按钮（与现有 Youdao/Know It 按钮同区域），新增 `onOpenSentencePanel` 之类的 prop |
| `enx-chrome/src/content/content.tsx` | `showWordPopup()` 里实现整句翻译按钮回调：`WordProcessor.extractSentenceContext()` 取句 → `sendToBackground({type:'openSentencePanel', ...})`（触发路径③） |
| `enx-chrome/src/content/__tests__/` | 新增句子提取单测 |
| `enx-chrome/src/background/background.ts` | 新增 `openSentencePanel` / `translateSentence` message handler；新增 `chrome.contextMenus` 注册与 `onClicked` 处理（触发路径②）；**2026-08-03 变更**：新增 `translateWordInContext` message handler（`handleTranslateWordInContext`），调用新端点，与既有 `handleGetOneWord` 并存、互不修改 |
| `enx-chrome/src/popup/Popup.tsx` / `popup.html` | 新增"打开整句翻译面板"按钮，直接调用 `chrome.sidePanel.open()`（触发路径①） |
| `enx-chrome/src/types/index.ts` | 新增 `PendingSentenceContext`/`PENDING_SENTENCE_STORAGE_KEY`；`ContentMessage`/`BackgroundResponse` 新增 `openSentencePanel`/`translateSentence` 相关字段；**2026-08-03 变更**：新增 `translateWordInContext` 相关 `ContentMessage`/`BackgroundResponse` 字段 |
| `enx-chrome/src/store/atoms.ts` | 新增 `sentencePanelHintAtom`（触发路径③失败时的弹窗内提示） |
| `enx-chrome/src/test/setup.ts` / `jest.config.js` / `src/test/styleMock.js` | 补充 `chrome.contextMenus`/`chrome.sidePanel`/`chrome.windows` mock；新增 CSS 模块 mock 以支持 `SidePanel.tsx` 的组件测试 |
| `enx-chrome/tsconfig.json` | `lib` 新增 `ES2022.Intl`，让 TS 认识 `Intl.Segmenter` 类型 |
| `enx-api/aitranslate/` | 新增，`Translator` 接口 + `New()` 工厂函数 + `kimi/`、`bedrock/`、`minimax/` 三个具体实现；**2026-08-03 变更**：`Translator` 接口新增 `TranslateWordInContext` 方法，三个实现各自补充；`handler.go` 新增 `TranslateWordInContext` handler（见 §3.8） |
| `enx-api/aitranslate/kimi|bedrock|minimax/*_test.go` | **2026-08-03 新增**，各补一个 `TranslateWordInContext` 单测（mock HTTP，断言 prompt 携带 sentence + word） |
| `enx-api/aitranslate/handler_test.go` | **2026-08-03 新增**，覆盖 `/api/translate/word-in-context` 成功/502 路径 |
| `enx-api/translate/service.go` / `helpers.go` | 视最终路由挂载位置决定是否调整；`respondSentenceUnavailable` 的占位文案不再是唯一出路 |
| `enx-api.go` | 注册 `POST /api/translate/sentence`；**2026-08-03 变更**：新增注册 `POST /api/translate/word-in-context`（同一 `authGroup`） |
| `enx-api/config.toml` | 新增 `[sentence-translate]` 非密钥配置段 |
| `docs/adr/0001-integrate-ecdict-dictionary.md` | 背景引用，句子翻译缺口的原始记录 |

---

## 7. 实施顺序（建议）

```text
1. [x] enx-api: 新增 aitranslate 包（Kimi + Bedrock + MiniMax 三个实现 + provider 工厂函数）+ /api/translate/sentence 端点 + 单测/集成测试
       （先把后端能力做完并可用 curl 分别验证三个 provider，不依赖前端）—— go test ./... 全绿；curl 联调真实 provider 未做（无真实 API Key/IAM 环境）
2. [x] enx-chrome: WordProcessor.extractSentenceContext() + 单测
       （纯逻辑，先用现有测试基础设施验证，不依赖 UI）—— 6 项单测全过
3. [x] enx-chrome: WordPopup.tsx 新增「整句翻译」按钮 + content.tsx 里的回调实现
       （取句 + storage.session 写入 + 触发路径③）—— tsc/jest 通过，真实手势失败路径待真机验证
4. [x] enx-chrome: Side Panel 页面（读取 pending context → 调整句翻译 → 单词点击释义，追加显示）—— SidePanel.test.tsx 6 项全过，pnpm build 产出 dist/sidepanel.html
5. [x] enx-chrome: 触发路径①（popup.html 按钮直连 sidePanel.open()）+ 路径②（右键 contextMenus）—— 代码已实现且编译/构建通过，Chrome 原生弹出效果待真机验证
6. [ ] 本地 unpacked 加载，手工验证 §4 全部验收项（尤其①②③三条触发路径的真实 Chrome 行为，无法用单测替代）—— **待用户执行**，自动化 Agent 无法操作真实 Chrome 浏览器
7. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD —— 待第 6 步完成后

（2026-08-03 需求变更新增步骤，插在原 6/7 之前执行，完成后再走原 6/7）：

8. [x] enx-api: `Translator` 接口新增 `TranslateWordInContext`，kimi/bedrock/minimax 三个实现补齐 + 各自单测；`Handler` 新增方法 + 路由注册（`authGroup` 与 `apiGroup` 两处，同 `/translate/sentence` 先例）+ handler 测试（见 §3.8）—— `go test ./aitranslate/...` 全绿；顶层 `enx-api` 包一个 `TestE2E_UnauthenticatedAccessRejected` 失败与本次改动无关（stash 掉本次改动后同样失败，是本地未配置 Cognito 环境导致的既有问题）
9. [x] enx-chrome: `types/index.ts` 新增消息类型 → `background.ts` 新增 `translateWordInContext` handler → `SidePanel.tsx` 的 `handleWordClick` 改为并行调用 `translateWordInContext` + `getOneWord`（后者只取音标）→ 更新 `SidePanel.test.tsx` 断言（见 §3.7）—— `tsc --noEmit`、`jest`（93 项全过）、`pnpm build`（产出 `dist/sidepanel.html`）均通过
10. [x] 勾选 §4.4/§4.5 新增验收项；`WordPopup.tsx`/网页正文查词弹窗未改动代码，回归测试（既有 jest 套件）全过，行为未受影响（该场景仍走 ECDICT）

（2026-08-04 需求变更新增步骤，不涉及后端，纯 `enx-chrome` 改动）：

11. [x] enx-chrome: `SidePanel.tsx` 的 `WordDefinition` → `WordCardData`（新增字段）；`handleWordClick` 改为「已存在则置顶不重新请求，否则插入列表最前 + 两请求各自独立更新对应字段」；`definitions` 渲染从单行文字列表改为卡片列表（内容/顺序/样式见 §3.9）
12. [x] enx-chrome: 补充/更新 `SidePanel.test.tsx`（分阶段渲染、置顶去重、词典释义空态，见 §3.9 末尾清单）；`tsc --noEmit`、`jest`（96 项全过，SidePanel 10 项）、`vite build`（产出 `dist/sidepanel.html`，本地用 fnm 切到 Node 24 跑通，仓库默认 Node 16 不满足 Vite 7 的 Node ≥20 要求）均通过
13. [x] 勾选 §4.5.1 全部验收项，文首状态更新为 `Implemented`；真实 Chrome 手工验证卡片视觉效果——尚待用户执行

（2026-08-04 四次修订，Query Count 改图标，不涉及后端）：

14. [x] enx-chrome: `pnpm add @heroicons/react`；`WordPopup.tsx`/`SidePanel.tsx` 引入 `MagnifyingGlassIcon`（`@heroicons/react/20/solid`）替换 `Query Count: {N}` 文字为「图标 + 数字」，原文字保留为 `title` 属性；更新 `SidePanel.test.tsx` 里断言 `Query Count` 可见文本的用例，改为断言 `title` 属性；`tsc --noEmit`、`jest`（96 项全过）、`vite build` 均通过
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；§3.2/§3.6/§4.5 原"待 Review 确认"项已于 2026-07-31 拿到明确答复（见各小节），按更新后的内容实现，不要参照已废弃的 Draft 版描述（如 A1 方案、`content.ts` 手写 HTML）。
2. **实现中**：严格按 §7 分步提交，每步跑一次对应测试；enx-api 与 enx-chrome 改动建议分开提交，便于 review。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 整句翻译结果本地缓存/历史记录
- Side Panel 内支持划词（选中多个词）触发整句翻译，而不仅限于点击已高亮单词
