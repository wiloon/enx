# TASK-SPEC: enx-chrome 整句 AI 翻译侧边栏（Side Panel）

| 字段 | 值 |
| --- | --- |
| **状态** | Implemented — 2026-07-31（§7 步骤 1-5 代码已完成；`go test ./...`、`tsc --noEmit`、`jest`、`pnpm build` 均通过；步骤 6 的真实 Chrome 手工验证尚待用户执行，见 §4 验收清单标注） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 在现有单词查词弹窗基础上新增「整句翻译」入口：点击后在 Chrome 扩展的 Side Panel 中显示当前单词所在句子的英文原文 + 调用 AI 模型（Kimi / AWS Bedrock / MiniMax，按配置切换）翻译出的中文整句译文；用户还可在侧边栏内点击原文中任意单词，在整句译文下方追加显示该词的释义（复用现有查词逻辑） |
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
      3. 用户点击原句中任意单词 → 复用现有 getOneWord 逻辑 → 在译文下方追加该词释义
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
- 组件状态机：`idle`（无 pending context）→ `loading`（正在请求整句翻译）→ `loaded`（展示英文原句 + 中文译文，原句内每个 token 可点击）→ 点击 token 后在下方追加一条 `{英文词: 中文释义}`（复用 `getOneWord` background action，与现有查词弹窗数据源一致，不新增查词逻辑）。
- `vite.config.ts` 目前没有手写 `rollupOptions.input`，`@crxjs/vite-plugin` 是通过读 `manifest.json` 里的 HTML 入口（`default_popup`、`options_page`）自动接入构建的；`side_panel.default_path` 是该插件明确支持的 MV3 字段，预期无需额外改 `vite.config.ts`，但实施时需要用 `pnpm build` 实测确认 `dist/sidepanel.html` 确实产出。

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

- [x] `POST /api/translate/sentence` 对合法句子返回 `{success:true, chinese:"..."}`，`provider = "kimi"`、`"bedrock"`、`"minimax"` 三种配置下均验证通过——`kimi_test.go`/`bedrock_test.go`/`minimax_test.go`/`handler_test.go` 覆盖（mock HTTP/mock Bedrock client，非真实调用第三方 API；真实 API Key/IAM 权限下的端到端联调仍建议部署前手工 curl 一次）
- [x] Provider 超时/非 200 时返回 HTTP 502 + `success:false`，不返回 200 空译文（三个 provider 均覆盖）——同上测试文件覆盖
- [x] `KIMI_API_KEY` 未设置且 `provider = "kimi"` 时，启动阶段立即报错退出，不静默失败——`factory_test.go` 覆盖 `New()` 报错路径；`enx-api.go` 里 `os.Exit(1)` 分支未被测试直接执行（会终止测试进程),按代码走查确认逻辑正确
- [x] `MINIMAX_API_KEY`（及所需的 `group_id`，如适用）未设置且 `provider = "minimax"` 时，启动阶段立即报错退出，不静默失败——同上
- [x] `provider = "bedrock"` 时若 EC2 实例角色未挂载/权限不足（或本地调试场景下 `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` 未设置），启动阶段或首次调用时有明确日志/报错，不静默失败——`factory_test.go`/`bedrock_test.go` 覆盖配置缺失路径；真实 IAM 权限不足的报错文案需部署到 EC2 后确认
- [x] `aitranslate/kimi`、`aitranslate/bedrock`、`aitranslate/minimax` 包单测、`New()` 工厂函数测试、handler 集成测试均通过——`go test ./...` 全绿

### 4.5 Side Panel 内单词点击

- [x] 原句内每个单词可点击，点击后在译文下方追加该词释义——`SidePanel.test.tsx` 覆盖
- [x] 该释义内容与查词弹窗里的释义一致（同一 `getOneWord` 数据源，非另起一套）——`SidePanel.tsx` 复用 `sendMessageToBackground({type:'getOneWord'})`，未新写查词逻辑
- [x] 连续点击多个不同单词，释义追加显示（不互相覆盖，2026-07-31 Review 已确认）——`SidePanel.test.tsx` 覆盖

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
| Side Panel 与查词弹窗分别维护单词点击逻辑，未来可能出现重复实现（与 claude-blog Spec §2.2 类似的教训） | Side Panel 内单词点击复用 `sendToBackground({type:'getOneWord'})`，不新写查词逻辑；仅展示层各自实现 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/manifest.json` | 新增 `sidePanel`、`contextMenus` permission、`side_panel.default_path` |
| `enx-chrome/sidepanel.html` | 新增，Side Panel 入口 HTML |
| `enx-chrome/src/sidepanel/SidePanel.tsx` | 新增，Side Panel React 组件（英文原句 + AI 译文 + 单词点击释义） |
| `enx-chrome/src/sidepanel/__tests__/SidePanel.test.tsx` | 新增，覆盖空状态/加载译文/追加释义/`storage.onChanged` 实时刷新 |
| `enx-chrome/src/lib/wordProcessor.ts` | 新增 `extractSentenceContext()` |
| `enx-chrome/src/components/WordPopup.tsx` | 新增「🔤 整句翻译」按钮（与现有 Youdao/Know It 按钮同区域），新增 `onOpenSentencePanel` 之类的 prop |
| `enx-chrome/src/content/content.tsx` | `showWordPopup()` 里实现整句翻译按钮回调：`WordProcessor.extractSentenceContext()` 取句 → `sendToBackground({type:'openSentencePanel', ...})`（触发路径③） |
| `enx-chrome/src/content/__tests__/` | 新增句子提取单测 |
| `enx-chrome/src/background/background.ts` | 新增 `openSentencePanel` / `translateSentence` message handler；新增 `chrome.contextMenus` 注册与 `onClicked` 处理（触发路径②） |
| `enx-chrome/src/popup/Popup.tsx` / `popup.html` | 新增"打开整句翻译面板"按钮，直接调用 `chrome.sidePanel.open()`（触发路径①） |
| `enx-chrome/src/types/index.ts` | 新增 `PendingSentenceContext`/`PENDING_SENTENCE_STORAGE_KEY`；`ContentMessage`/`BackgroundResponse` 新增 `openSentencePanel`/`translateSentence` 相关字段 |
| `enx-chrome/src/store/atoms.ts` | 新增 `sentencePanelHintAtom`（触发路径③失败时的弹窗内提示） |
| `enx-chrome/src/test/setup.ts` / `jest.config.js` / `src/test/styleMock.js` | 补充 `chrome.contextMenus`/`chrome.sidePanel`/`chrome.windows` mock；新增 CSS 模块 mock 以支持 `SidePanel.tsx` 的组件测试 |
| `enx-chrome/tsconfig.json` | `lib` 新增 `ES2022.Intl`，让 TS 认识 `Intl.Segmenter` 类型 |
| `enx-api/aitranslate/` | 新增，`Translator` 接口 + `New()` 工厂函数 + `kimi/`、`bedrock/`、`minimax/` 三个具体实现 |
| `enx-api/translate/service.go` / `helpers.go` | 视最终路由挂载位置决定是否调整；`respondSentenceUnavailable` 的占位文案不再是唯一出路 |
| `enx-api.go` | 注册 `POST /api/translate/sentence` |
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
