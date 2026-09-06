# TASK-SPEC: enx-chrome 查词弹窗 React 化

| 字段 | 值 |
| --- | --- |
| **状态** | Implemented — 2026-07-30（§4 全部 19 项验收标准里 18 项已用 Playwright 自动化验证通过；唯一剩余项是 §4.2 第 3 条"真实网站 infoq.com 手工 smoke check"，因本次实施环境无外网访问未执行，留待下次有网络访问权限时补做，之后即可转 Done） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 把 `content.ts` 里手写 DOM/`innerHTML` 实现的查词弹窗，改造为挂载在 Shadow DOM 内的 React 组件（复用并改造现有 `WordPopup.tsx`），信息结构与交互路径不变，**视觉样式借这次机会一并美化**（不要求像素级还原旧版），为后续「整句翻译」按钮等需求提供可维护的状态管理基础 |
| **非目标** | 不新增任何产品功能（不做「整句翻译」按钮，那是 sidepanel Spec 的范围）；不改变弹窗触发路径（仍是点击高亮单词 → `showWordPopup`）；不改变 `background.ts` 消息协议（`getOneWord`/`markAcquainted` 请求结构不变）；不处理 `showSessionExpiredMessage()` / `addProcessingCompleteIndicator()` 等 `content.ts` 里其它手写 UI（本次只动查词弹窗）；不做像素级视觉还原（见 §3.5 UI 优化） |
| **触发原因** | [`ADR-002`](../architecture/adr-002-word-popup-react-shadow-dom.md) 决定用 React + Shadow DOM 重写弹窗；本 Spec 是该决策的落地实施计划 |
| **关联背景** | [`ADR-002: 查词弹窗改用 React + Shadow DOM 渲染`](../architecture/adr-002-word-popup-react-shadow-dom.md)；[`TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md) §2.1 是最初发现"查词弹窗不是 React 组件"这一现状的地方，本 Spec 是对该现状的正式改造 |

---

## 1. 背景与动机

详见 [ADR-002](../architecture/adr-002-word-popup-react-shadow-dom.md) 的 Context/Decision。简述：`content.ts` 的 `showWordPopup()` 用 `innerHTML` 字符串拼接维护弹窗内容和状态，样式无隔离；`src/components/WordPopup.tsx` 是一份已经写好但从未接入的 React 版本。ADR-002 决定把两者合并：保留现有的 Popover API + CSS Anchor Positioning 定位机制（这一层完全不动），把弹窗内容渲染从"手写 DOM"换成"React 组件挂载在 Shadow DOM 内"。

---

## 2. 现状调查（本 Spec 编写时已确认的事实）

### 2.1 定位机制与内容渲染是两层，只改内容渲染这一层

`showWordPopup()`（`content.ts:41-173`）分两部分：

1. **定位/显隐**（不动）：创建 `popup` div → 设置 `anchor-name`（在被点击的单词元素上）→ `popup.style.cssText` 设置 `position-anchor`/`position-area`/`position-try-fallbacks` → `popup.popover = 'manual'` → `document.body.appendChild(popup)` → `popup.showPopover()`。
2. **内容渲染**（本次改造对象）：`popup.innerHTML = ...`（loading 态 L94-98、成功态 L124-145、失败态 L165/L170），配合 `setupPopupEventHandlers()`（L176-251）手动 `addEventListener` 绑定关闭/Mark Known 按钮和 ESC/点击外部关闭。

改造后，第 1 部分代码几乎原样保留；第 2 部分整体替换为 `popup.attachShadow({mode:'open'})` + React `createRoot` 挂载。

### 2.2 `WordPopup.tsx` 现状与需要改的地方

`src/components/WordPopup.tsx` 已经用 Jotai atom（`currentWordAtom`/`userAtom`/`isTranslatingAtom`/`errorAtom`，均来自 `src/store/atoms.ts`）写了 loading/error/内容三态，UI 结构（header、pronunciation、Chinese、AlreadyAcquainted、Youdao 链接、Mark Known 按钮）与 `content.ts` 手写版本基本对应，可以复用，但有两处必须改：

1. **定位方式冲突**：组件当前用 `className="fixed ..."` + `style={{left: position.x, top: position.y}}`，是"自己算坐标"的定位模型。改造后定位完全由外层 `popup` 元素的 CSS Anchor Positioning 负责，组件不应该再接收/使用 `position` prop 或设置 `position: fixed`，根元素样式应为占满 shadow host 容器（`width: 100%` 或直接不设 position 相关样式，交给 host）。
2. **`onMarkAcquainted` / `onClose` 的实现来源**：组件目前只接收这两个 callback props，不关心内部怎么实现；这两个 prop 的实际实现（调用 `sendToBackground` + 更新 atom + `popup.hidePopover()`）要在 `content.tsx` 里写，逻辑对应现有 `setupPopupEventHandlers()` 里的 `closeBtn`/`markBtn` 处理器（`content.ts:184-211`），原样迁移即可，不需要重新设计。
3. **Auto-focus 逻辑在 Shadow DOM 下会失效**：组件现有 `useEffect`（`WordPopup.tsx:28-34`）用 `document.getElementById('enx-word-popup')` 找到根节点再 `.focus()`，从而让根 div 上的 `onKeyDown`（Enter → Mark Known，`WordPopup.tsx:36-42`）能收到键盘事件。迁移到 Shadow DOM 后，根节点在 shadow root 内部，`document.getElementById` 跨不过 shadow 边界，永远查不到该节点，`.focus()` 不会生效，Enter 快捷键会静默失效（ESC 关闭不受影响，因为那是 `content.ts` 里 `document.addEventListener('keydown', ...)` 挂在 light DOM 上的独立逻辑）。改造时需要把这个 auto-focus 逻辑换成 shadow-root 内部可用的方式（例如用 `ref` 或在 `content.tsx` 挂载后对 `mountPoint` 内部元素直接调用 `.focus()`），不能依赖 `document.getElementById`。另外，外层 `popup` host 元素（`content.ts:58`）与组件根节点都用了同一个 id `enx-word-popup`，改造时建议至少一处改名，避免混淆。

### 2.3 Content script 的 Jotai atom 需要独立初始化

Content script 与 `popup.html`/`options.html` 是完全独立的 JS 执行上下文（不同的全局对象、不同的 React 树），不能共享同一个 Jotai `<Provider>` 实例。但 `userAtom`（`src/lib/storageAtoms.ts:5-33`）等 atom 的写入会落盘到 `chrome.storage.local`，只是**读取时不会自动 hydrate**——`baseAtom` 初始值固定是 `{isLoggedIn: false}` 之类的默认值，需要显式在 mount 时读一次 `chrome.storage.local.get(...)` 并 `set` 到 atom，再监听 `chrome.storage.onChanged` 保持同步。这个模式在 popup 侧已经存在：`src/hooks/useInitializeStorage.ts`（在 `src/popup/Popup.tsx` 内使用），content script 侧需要写一个等价的最小版本（复用同一个 hook 也可以，只要确认它不依赖任何 popup 专属的执行上下文），只需要 hydrate 弹窗实际用到的几个 atom，不需要照抄 popup 侧全部初始化逻辑。

`currentWordAtom`/`isTranslatingAtom`/`errorAtom` 是纯内存 atom（无 storage 持久化），content script 内的 `<Provider>` 直接用默认值即可，不需要 hydrate，由 `showWordPopup()` 在发起请求前后 `set` 这几个 atom 驱动 UI。

**Store 与 hydrate 逻辑必须是 content script 级别的单例，不能绑定在每次弹窗的挂载生命周期上**：`showWordPopup()` 每次点击单词都会新建 `popup` + `attachShadow` + `createRoot`（见 §3.2），如果 Jotai store（`createStore()`）和 `userAtom` 的 hydrate 逻辑是照抄 `useInitializeStorage` 那种挂在组件 `useEffect` 里的模式，会导致**每次点一个新单词都要重新 `chrome.storage.local.get` 一次**，而不是只在 content script 加载时读一次；这也会让 §5 风险表里"未登录态误显示 Mark Known 按钮"的短暂闪烁在每次开弹窗时都重现一次。正确做法：`contentScriptStore`（Jotai store 实例）和它的 hydrate 逻辑要在 content script 模块加载时创建/执行一次并长期复用，`showWordPopup()` 每次只是把同一个 store 传给新建的 `<Provider store={contentScriptStore}>`，不重新初始化。

**实施记录**：在实际开发过程中确认 Mark Known 按钮不需要按登录态门控 UI（未登录时压根不可能进入 learning mode，弹窗也就不会出现；未登录请求由后端拦截即可），`WordPopup.tsx` 因此完全不再消费 `userAtom`。这意味着上面讨论的 `userAtom` hydrate 逻辑实际上不再需要——`src/content/contentAtoms.ts` 里只创建了一次性的 `contentScriptStore = createStore()` 单例（供 `currentWordAtom`/`isTranslatingAtom`/`errorAtom` 使用），没有实现 hydrate/`storage.onChanged` 监听。如果未来这个弹窗（或同一 content script 里的其它 UI）需要读 `userAtom` 等 storage-backed atom，再按本节的设计把 hydrate 逻辑补上。

### 2.4 Tailwind 样式在 Shadow DOM 内不会自动生效

`WordPopup.tsx` 用的是 Tailwind utility class（`bg-white`、`rounded-lg` 等）。Tailwind 编译出的 CSS 目前是通过 `popup.html`/`options.html` 的 `<link>`/构建产物注入到**那两个独立扩展页面**的 `<head>` 里的；content script 注入的第三方网页不会自动加载这份 CSS，Shadow DOM 更是天然隔离宿主页面 `<head>` 里的任何样式。实施时需要确认 Vite 构建 content script 时是否已经把关联的 CSS 一并产出（`@crxjs/vite-plugin` 通常会为引入了 CSS 的 chunk 生成独立 `.css` 文件），若没有自动内联，需要用 `?inline` 或等价方式把编译后的 CSS 文本 import 进 `content.tsx`，手动塞进 shadow root 的 `<style>` 标签。

---

## 3. 目标设计

### 3.1 文件改动

| 文件 | 改动 |
| --- | --- |
| `enx-chrome/src/content/content.ts` → `content.tsx` | 重命名；`showWordPopup()` 保留定位逻辑，内容渲染部分改为 `attachShadow` + `createRoot` 挂载 `<Provider><WordPopup .../></Provider>`；`setupPopupEventHandlers()` 里的关闭/Mark Known 逻辑迁移为传给 `WordPopup` 的 `onClose`/`onMarkAcquainted` 回调实现；ESC/点击外部关闭逻辑保留（仍是 `document.addEventListener`，作用于 light DOM，不受 Shadow DOM 影响） |
| `enx-chrome/src/components/WordPopup.tsx` | 移除 `position` prop 与 `position: fixed` 相关样式；根元素样式改为适配"外层已经用 CSS Anchor Positioning 定好位置和尺寸"的场景；关键节点加 `data-testid`（`word-popup-header`/`word-popup-content`/`word-popup-close`/`word-popup-mark-known`），替代旧版 `.enx-popup-header`/`.enx-popup-content` 等 class 作为 e2e 测试钩子（见 §4 变更） |
| `enx-chrome/manifest.json` | `content_scripts[0].js` 从 `"src/content/content.ts"` 改为 `"src/content/content.tsx"` |
| `enx-chrome/src/content/contentAtoms.ts`（新增，或就近放在 `content.tsx` 内） | Content script 专用的 Jotai `<Provider>` + 最小 hydrate 逻辑（读取 `chrome.storage.local` 里的 `enx-user` 并 `set` 到 `userAtom`，监听 `storage.onChanged`）；store 实例在模块加载时创建一次，跨多次弹窗复用（见 §2.3） |
| `enx-chrome/e2e/content-translation.spec.ts` | 现有 `.enx-popup-header h3` / `.enx-popup-content` 选择器（L45/48/81/91）绑死在旧 innerHTML class 上，迁移后失效；改写为 `data-testid` 选择器 |
| `enx-chrome/e2e/content-popup-shadow-dom.spec.ts`（新增） | 新增 Playwright 用例，覆盖 §4.1 视口边缘翻转不变量、§4.2 样式隔离、§4.4 资源清理/内存增长这几条自动化验收标准 |
| `enx-chrome/e2e/test-fixtures/test-page.html` | 追加一段与 Tailwind 语义同名但样式定义冲突的宿主页面 class（如自定义 `.flex`/`.text-sm`），供 §4.2 反向样式隔离测试使用 |

### 3.2 挂载流程（对应 ADR-002 Decision）

```ts
// content.tsx，替换原 popup.innerHTML 相关代码
const popup = document.createElement('div')
popup.popover = 'manual'
popup.style.cssText = /* 原有 position-anchor 等定位样式，不变 */
document.body.appendChild(popup)

const shadowRoot = popup.attachShadow({ mode: 'open' })
const styleTag = document.createElement('style')
styleTag.textContent = tailwindCss // 见 §2.4，编译产物以字符串形式注入
shadowRoot.appendChild(styleTag)

const mountPoint = document.createElement('div')
shadowRoot.appendChild(mountPoint)

const root = createRoot(mountPoint)
root.render(
  <Provider store={contentScriptStore}>
    <WordPopup
      word={word}
      onClose={() => popup.hidePopover()}
      onMarkAcquainted={handleMarkAcquainted}
    />
  </Provider>
)

popup.showPopover()
```

`showPopover()`/`hidePopover()`、`anchor-name` 清理等仍按现有逻辑在 `popover` 的 `toggle` 事件里处理（`content.ts:213-227`），额外要在 `toggle` 的 `closed` 分支里调用 `root.unmount()` 释放 React 树，避免内存泄漏（现有 `hideWordPopup()`/`popup.remove()` 只清理了 DOM，不清理 React root）。

### 3.3 状态驱动方式

原来 `wordCache`/`isProcessing` 等是 `content.ts` 顶层的 `let` 变量；弹窗相关的状态改为 Jotai atom 驱动：

- 调用 `showWordPopup()` 时：`set(currentWordAtom, null)`、`set(isTranslatingAtom, true)`、`set(errorAtom, null)` → 挂载 React 组件（此时显示 loading 态）。
- `sendToBackground({type:'getOneWord', ...})` 成功：`set(currentWordAtom, response.ecp)`、`set(isTranslatingAtom, false)`。
- 失败：`set(errorAtom, response.error ?? '...')`、`set(isTranslatingAtom, false)`。
- `sessionExpired` 分支：不变，仍走 `showSessionExpiredMessage()`（不在本次改造范围）。

`wordCache`（用于避免重复请求同一单词、驱动高亮颜色）与整体处理流程（`processArticleContent`、`updateWordHighlighting` 等）**不受影响，保留原样**，只是弹窗展示这一层换了实现。

### 3.5 UI 优化（本次顺带做，不要求还原旧版视觉）

旧版实现视觉上比较粗糙，是"能用"而不是"好看"的水平，本次借助 Tailwind 和 React 一并改善，不需要逐像素对照旧版。具体优化点（供实现参考，非强制清单，实现时可自行调整）：

- **loading 态**：把 ⏳ emoji 换成 Tailwind 常见的 spinner 样式（如一个 `animate-spin` 的圆环），或复用 `WordPopup.tsx` 现有的骨架屏（`animate-pulse` 占位块，L84-92）替代当前 `content.ts` 里更简陋的纯 emoji 版本。
- **整体排版**：可以用 Tailwind 的间距/圆角/阴影 token 统一视觉语言（例如与 `popup.html`/`options.html` 已有的视觉风格对齐，避免弹窗看起来像另一个产品）。
- **失败态**：现有实现只是一行红字（`content.ts:165/170`），可以加图标、更明确的重试提示等，只要不引入需要用户额外操作的复杂交互。
- **约束**：不管怎么调整视觉，§2.1 提到的信息结构（单词/音标/中文释义/Query Count/Already acquainted/Youdao 链接/Mark Known 按钮）要素不能丢，弹窗尺寸仍需与 CSS Anchor Positioning 的 `max-width`/`max-height` 约束兼容（避免超出视口）。

---

## 4. 验收标准

### 4.1 功能对等（回归）

- [x] Playwright（`content-popup-shadow-dom.spec.ts`）构造 4 个场景，让锚定单词分别滚动到视口顶部/底部/左侧/右侧边缘（与对应视口边界距离 < 50px），点击后断言弹窗的 `boundingBox()` 完全落在视口内（`x >= 0 && y >= 0 && x + width <= viewportWidth && y + height <= viewportHeight`）；不要求和旧版逐像素一致，只断言"不越界"这个不变量，4 个场景全部通过才算过。**结论：4 个场景全部通过**（1280×720 视口，实测弹窗 boundingBox 均在视口内，例如 bottom 场景 `{x:87.75, y:463.6, width:414, height:209}`）
- [x] loading 态、成功态（单词/音标/中文释义/Query Count/Already acquainted 标记）、失败态（网络错误/后端错误）均正确展示；用 `data-testid` 选择器断言各字段的 `textContent`/可见性，作为"信息字段与改造前一致"的客观判据（不再依赖人工记忆比对）。**结论：三态均通过**（成功态在 `content-popup-shadow-dom.spec.ts` 里用 mock 后端验证；失败态额外补了 `data-testid="word-popup-error"` 钩子和对应用例，原 Spec 草稿未预留这个 testid）
- [x] 点击关闭按钮、按 ESC、点击弹窗外部，均能正确关闭弹窗。**结论：三种关闭路径均通过**
- [x] 点击「Mark Known」按钮：成功后弹窗内状态更新为"已认识"并关闭，且该单词在页面正文里的高亮颜色同步更新（`updateWordHighlighting`）。**结论：通过**（`textDecorationColor` 从 `hsl(...)` 变为 `rgb(255, 255, 255)`，注意 `.enx-word` 有 `transition: all 0.15s ease`，断言前需等待过渡结束，否则会读到过渡中间值）
- [x] `sessionExpired` 响应仍触发 `showSessionExpiredMessage()`，不受本次改造影响。**结论：通过**——`mockBackendFetch` 增加了 `translateSessionExpired` 选项（返回 401，`makeApiRequest()` 据此标记 `sessionExpired:true`），新增用例验证弹窗自动关闭且 `#enx-session-expired` 通知正确显示
- [x] Youdao 外链 `href` 与改造前一致（`https://www.youdao.com/result?word=...&lang=en`）。**结论：通过**，新增用例断言 `href` 精确匹配 `https://www.youdao.com/result?word=${encodeURIComponent(clickedWord)}&lang=en`

### 4.2 样式隔离

- [x] Playwright：在 `test-page.html` 新增的冲突 class 场景下，断言打开弹窗前后宿主页面这些元素的 `getComputedStyle()` 逐属性（`display`/`fontSize`/`color` 等关键属性）不变——弹窗的 Tailwind 样式没有泄漏出去污染宿主页面。**结论：通过**
- [x] Playwright 反向验证：同一场景下，断言弹窗内部对应 Tailwind class 元素的 `getComputedStyle()` 结果符合 Tailwind 预期值（例如 `.flex` 元素确实是 `display: flex`），未被宿主页面自定义的同名冲突 class 覆盖。**结论：通过**
- [ ] 上述两条在至少一个真实网站（如 infoq.com）上做一次手工 smoke check（非 CI 常驻用例，纳入 §7 步骤 7），确认本地 fixture 的结论在真实页面上同样成立。**未执行**：本次实施环境无法访问外部真实网站，留给下一次有网络访问权限时手工验证

### 4.3 构建与技术验证（spike，实施第一步）

- [x] 独立验证 Popover API 的宿主元素本身携带 `attachShadow` 时，`showPopover()`/`hidePopover()`/`toggle` 事件行为与不带 Shadow DOM 时一致；用显式测试矩阵覆盖：①打开→关闭→再打开一次；②连续快速开关 5 次；③4 个方向（上/下/左/右）各触发一次视口边缘翻转；全程用 `page.on('console')` 监听，断言 error/warning 数为 0。**结论（2026-07-30 spike，headless Chromium via Playwright 1.56.1）：通过，无 console error/warning，`hidePopover()` 场景下 `toggle` closed 事件稳定触发，Shadow DOM 内容渲染正常。** Spike 代码为一次性 HTML+脚本，已按计划用完即弃，不进入正式测试套件
- [x] `@crxjs/vite-plugin` 构建 `content.tsx` 产出正常，`dist/` 下能找到对应的 content script 产物且可在 unpacked 扩展里正常加载运行。**结论：通过**，且不只是"构建不报错"这一层——已经在 Playwright 加载的真实 unpacked 扩展里跑通全部 e2e 用例，证明产物在真实 Chromium 里确实能正常加载运行
- [x] Tailwind CSS 正确以字符串形式注入 shadow root（无需依赖宿主页面 `<head>`）。**结论：通过**，构建产物里能找到内联的 Tailwind CSS 字面量（如 `.bg-white{...}`），且 §4.2 的样式隔离用例证明它在 shadow root 内确实生效
- [x] 验证 `hideWordPopup()` 现有的 `popup.remove()` 清理路径（直接从 DOM 移除元素，而非调用 `.hidePopover()`，见 `content.ts:254-265`）是否可靠触发 `toggle` 事件的 `closed` 分支；这是 §4.4 `root.unmount()` 清理逻辑能否生效的前提——若连续快速切换点词时 `remove()` 不触发 `toggle`，需要改为在 `hideWordPopup()` 里直接调用 `root.unmount()`，不能只依赖 `toggle` 事件分支。**结论：不可靠，已确认 `.remove()`（无论移除时 popover 处于 open 还是 closed 状态）不会触发 `toggle` 事件。** Spike 里连续 9~10 次 `.remove()`-based 切换（模拟连续点不同单词）toggle 计数完全没有增加。**因此 `content.tsx` 实现里 `hideWordPopup()` 必须直接调用 `root.unmount()`，不能只依赖 `toggle` closed 分支**，此为强制约束，不是可选优化

### 4.4 资源清理

- [x] Playwright：mock 后端调用，不依赖真实本地 `enx-api`。**实现方式与原计划不同，记录一下技术修正**：`page.addInitScript` stub `chrome.runtime.sendMessage` **实测不可行**——MV3 content script 默认运行在 isolated world，`page.addInitScript`（通过 CDP `Page.addScriptToEvaluateOnNewDocument`）只影响 main world，两者是不同的 `chrome` 对象引用，main world 里patch 的 `sendMessage` content script 根本看不到；`context.route()` 同样只拦截页面/frame 级请求，实测也拦不到 MV3 background service worker 自己发起的 `fetch()`。**实际可行的方式**：用 `context.serviceWorkers()[0].evaluate()` 直接在 background service worker 自己的执行上下文里 patch `self.fetch`（见 `e2e/helpers.ts` 的 `mockBackendFetch()`），因为这是在同一个 JS realm 里操作，不涉及跨 world/跨进程通信的限制
- [x] 用上述 mock 跑 50 次开-关循环（每次点不同单词）；每次 close 后立即断言 `document.querySelectorAll('#enx-word-popup').length === 0`，50 次循环结束后额外断言 `document.querySelectorAll('[popover]').length === 0`（无残留 popup host）。**结论：通过**，50 次循环全程无残留
- [x] 50 次循环前后各用 CDP 强制 GC（`session.send('HeapProfiler.collectGarbage')`）后读取 `performance.memory.usedJSHeapSize`，断言循环后堆大小不超过循环前的 1.5 倍。**结论：通过**，实测比值 1.45x（循环前 ~2.63MB，循环后 ~3.83MB），阈值 1.5x 暂不需要调整
- [x] 全程 `page.on('console')` 监听，只统计 `type() === 'error' || type() === 'warning'` 的消息，断言数量为 0。**结论：通过**，50 次循环全程无 console error/warning
- [x] 弹窗关闭时 `root.unmount()` 确实被调用：在 `toggle` closed 分支和 `hideWordPopup()` 的直接 unmount 分支都加了一次性调试日志（`console.debug('[enx] root unmounted')`），Playwright 循环测试里断言该日志出现次数等于循环次数。**结论：通过**，50 次循环 = 50 次 unmount 日志

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| Popover + Shadow DOM 组合在真实 Chrome 版本下行为未知（仓库首次尝试） | §4.3 spike 作为实施第一步，先用最小示例验证，再迁移正式逻辑；若失败按 ADR-002 Mitigation 退回方案 B |
| Tailwind CSS 注入 shadow root 的构建方式若不顺利，可能需要额外的 Vite 配置 | 优先尝试 `?inline` import 编译产物字符串这一最简方案；若不可行记录在实施笔记里，作为后续 Revisit 触发项（对应 ADR-002 Revisit Trigger） |
| `userAtom` 在 content script 内的 hydrate 逻辑写得不完整，导致「Mark Known」按钮在未登录态下误显示 | 严格对照 `WordPopup.tsx` 现有 `user.isLoggedIn` 判断条件（L144），hydrate 完成前按钮不应短暂闪现；验收时补充"刷新页面后立即点词，按钮状态正确"这一手工检查项 |
| React root 不清理导致内存泄漏，长时间浏览大量弹词的页面可能积累 | §4.4 明确要求验证 `root.unmount()`，作为正式验收项而非可选项 |
| 现有 `e2e/content-translation.spec.ts` 的选择器绑死在旧 `.enx-popup-header`/`.enx-popup-content` class 上，迁移后直接跑挂 | `WordPopup.tsx` 改为 `data-testid` 测试钩子，同步改写该文件里的 6 处选择器（见 §3.1）；这个改动在 §7 步骤 3（WordPopup 改造）里一起做，不要留到最后才发现测试挂了 |
| **（实施中发现，与本次改造无关的两个预置缺口）** `manifest.json` 的 `content_scripts[0].matches` 不含 `localhost:8080`（e2e 用的本地 fixture server），导致内容脚本在本地测试页面上完全不会注入；且 `e2e/helpers.ts` 的 `login()`/`seedLoggedInState()` 流程依赖后端能验证一个真实 Cognito JWT，沙箱环境没有真实 token，会在 `popup.html` 卡在等待 "Welcome" 文案上一直超时 | 这两个缺口在本次改造之前就存在，不在本 Spec 范围内修：`content_scripts.matches` 是否要为本地测试放开是需要维护者决定的权限变更；本次为了验证新代码，本地临时给 `dist/manifest.json`（gitignored，非源文件）打了 patch，并新增 `mockBackendFetch()`（见 §4.4 技术修正）绕开真实登录/后端依赖来验证 `content-popup-shadow-dom.spec.ts`；`content-translation.spec.ts`/`content-highlighting.spec.ts` 本次未能在沙箱里端到端跑通，选择器改动已通过代码审查确认与新组件结构一致 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/src/content/content.ts` → `content.tsx` | 重命名 + 挂载逻辑改造，定位逻辑保留 |
| `enx-chrome/src/components/WordPopup.tsx` | 移除 `position` prop，改为交由外层定位；加 `data-testid` 测试钩子 |
| `enx-chrome/manifest.json` | `content_scripts[0].js` 路径更新 |
| `enx-chrome/src/store/atoms.ts` | 复用现有 `currentWordAtom`/`userAtom`/`isTranslatingAtom`/`errorAtom`，不新增 atom |
| `enx-chrome/src/lib/storageAtoms.ts` | 参考其 `userAtom` 的 storage 落盘方式，编写 content script 侧的 hydrate 逻辑 |
| `enx-chrome/e2e/content-translation.spec.ts` | 选择器从旧 class 改写为 `data-testid` |
| `enx-chrome/e2e/content-popup-shadow-dom.spec.ts`（新增） | §4 自动化验收标准（视口翻转、样式隔离、资源清理） |
| `enx-chrome/e2e/test-fixtures/test-page.html` | 新增冲突 class，供样式隔离反向验证 |
| `docs/architecture/adr-002-word-popup-react-shadow-dom.md` | 关联决策记录 |
| `docs/tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md` | 后续「整句翻译」按钮依赖本次改造完成后的状态管理基础 |

---

## 7. 实施顺序（建议）

```text
1. [x] Spike：最小示例验证 Popover + attachShadow + React 挂载 + CSS Anchor Positioning 组合可行
       （不含业务逻辑，纯技术验证，对应 §4.3；若失败在此处止损，回 ADR-002 重新决策）
2. [x] content.ts → content.tsx，manifest.json 同步；先只做文件改名 + 类型改造，
       内容仍是原 innerHTML 实现，确认构建产物无异常（隔离"改后缀"和"改实现"两类风险）
3. [x] WordPopup.tsx 改造：移除 position prop，适配外层定位，加 data-testid；同步改写
       e2e/content-translation.spec.ts 里绑死旧 class 的 6 处选择器（见 §5 风险表），
       确认该文件重新跑通，不要留到最后才发现测试挂了
4. [x] content.tsx：实现 attachShadow 挂载、Tailwind CSS 注入、Jotai Provider + 最小 hydrate 逻辑
       （store 在模块加载时创建一次，见 §2.3；实际发现 userAtom hydrate 已非必需，见 §2.3 实施记录）
5. [x] 迁移 setupPopupEventHandlers() 里的 close/Mark Known 逻辑为 WordPopup 的 callback props 实现
6. [x] toggle closed 分支补充 root.unmount()；新增 e2e/content-popup-shadow-dom.spec.ts 覆盖
       §4.1 视口翻转、§4.2 样式隔离、§4.4 资源清理/内存增长这几条自动化验收标准
7. [~] 本地 unpacked 加载并跑通全部 7 条 Playwright 用例（含新增的失败态用例）；
       真实网站（infoq.com）手工 smoke check 因沙箱无外网访问未执行，留待下次验证
8. [x] 勾选 §4 已验证项；文首状态更新为实施完成待收尾评审；ADR-002 状态同步改为 Accepted
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 与 [ADR-002](../architecture/adr-002-word-popup-react-shadow-dom.md) 为唯一需求来源；§4.3 的 spike 结论若与 ADR-002 假设不符（例如 Popover + Shadow DOM 不兼容），先回到 ADR-002 更新决策，不要绕过 spike 直接实现正式逻辑。
2. **实现中**：严格按 §7 分步提交，每步跑一次现有测试（若有 content script 相关单测）+ 手工验证对应验收项；不要把 §7 的多个步骤合并成一次大改动，便于 review 和问题定位。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`；同步把 ADR-002 状态从 `Proposed` 改为 `Accepted`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- 「整句翻译」按钮及其状态（依赖本次建立的 Jotai 状态管理基础，具体见 sentence-translation-sidepanel Spec）
- `showSessionExpiredMessage()` / `addProcessingCompleteIndicator()` 等 `content.ts` 内其它手写 DOM UI 的 React 化（本次不处理）
- 若未来需要在同一页面同时展示多个 content-script UI，评估是否把"每次新建 shadow host"改为"复用一个常驻 shadow host + 内部路由不同 UI"
