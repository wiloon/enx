# ADR-002: enx-chrome 查词弹窗改用 React + Shadow DOM 渲染

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-07-30（Spike 与实施均已验证方案 C 可行，见关联 Spec §4.3/§7；实施本身尚有少量验收项待补，见 Spec 状态）。**2026-09-01 [`adr-011`](adr-011-word-highlight-css-highlight-api-and-feature-split.md) 起弹窗定位机制从 CSS Anchor Positioning 改为 Floating UI 吃 `Range`；Shadow DOM + Popover（top-layer）渲染方式不变，本 ADR 其余部分仍有效。** |
| **日期** | 2026-07-30 |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-chrome-word-popup-react.md`](../tasks/TASK-SPEC-enx-chrome-word-popup-react.md) |
| **修订关系** | 无（首次针对 content script UI 渲染方式的架构决策） |

---

## Context

`enx-chrome` 的查词弹窗（点击网页正文中高亮的单词后弹出释义）目前在 `src/content/content.ts` 的 `showWordPopup()`（约 L41-L173）里手写实现：

- 用 `document.createElement('div')` 创建弹窗节点，通过原生 **Popover API**（`popup.popover = 'manual'` + `showPopover()`/`hidePopover()`）控制显隐。
- 用 **CSS Anchor Positioning**（`position-anchor` / `position-area` / `position-try-fallbacks`）把弹窗锚定在被点击的单词元素上，由浏览器自动处理视口边缘的翻转，不需要手写定位算法。
- 弹窗内容通过拼接 `innerHTML` 模板字符串生成（约 L94-L145），状态变化（loading → 成功/失败）靠重新赋值整段 `innerHTML` 实现。
- 样式通过内联 `cssText` 与全局注入的 `<style>` 标签（`document.head.appendChild`，约 L62-L70、L324、L569、L701）完成，**没有任何隔离**——这些样式直接作用于宿主页面的全局样式表。

仓库里已经存在一份用 React + Jotai 写好的等价组件 `src/components/WordPopup.tsx`，但从未被引用（`grep -rn "WordPopup" src` 确认是死代码），且它采用的定位方式是 `position: fixed` + 传入的 `{x, y}` 坐标，与 `content.ts` 现用的 CSS Anchor Positioning 是两套不同的定位模型。

**触发原因**：[`TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md`](../tasks/TASK-SPEC-enx-chrome-sentence-translation-sidepanel.md) 计划给这个弹窗新增「整句翻译」按钮，该按钮有自己的 loading/成功/失败状态。继续在现有 `innerHTML` 字符串拼接上叠加一层状态机会让弹窗代码进一步劣化。项目已具备 React + Vite + `@crxjs/vite-plugin` + Tailwind + Jotai 全套基础设施（`popup.html`/`options.html` 已在用），但从未在 content script（即注入到任意第三方网页的 DOM）里挂载过 React root，仓库里也没有 Shadow DOM 的先例（`grep -rn "attachShadow" src` 为空）。

**约束**

- 保持现有触发路径与信息结构不变（点击高亮单词 → 弹窗展示释义/发音/Youdao 链接/Mark Known 按钮），但**不要求视觉像素级还原**——现有手写实现的视觉效果本身比较粗糙（例如 loading 态用 ⏳ emoji），本次改造顺带允许用 Tailwind 重新设计视觉样式，只要信息结构和交互路径不变。
- 弹窗仍必须能锚定在被点击单词上，并在视口边缘自动翻转，不能倒退成需要手写定位算法。
- 不能让弹窗的 Tailwind 类名污染宿主页面样式，也不能被宿主页面样式覆盖（这是当前方案已经存在但尚未在生产环境实际爆出来的隐患）。
- `@crxjs/vite-plugin` 已确认支持 content script 使用 `.tsx`，构建工具链无需替换。

---

## Options Considered

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. 维持现状** | 继续在 `showWordPopup()` 里用 `innerHTML` 字符串拼接，「整句翻译」按钮也用同样方式加 | 零改动、零新增风险 | 可维护性持续下降；新按钮的 loading/error 状态只能靠更多字符串拼接和手动 DOM 操作表达，`WordPopup.tsx` 继续闲置 |
| **B. React 渲染，但不做 Shadow DOM 隔离** | 直接把 React root 挂到 `document.body` 下的一个 `<div>` 上，复用 `WordPopup.tsx` | 改动量小，能较快接入已有组件 | Tailwind 全局类名（如 `.flex`、`.text-sm`）可能与宿主页面已有的同名 class 冲突；这个风险在当前手写方案里已经存在但被"内联 style 覆盖优先级高"意外掩盖了，换成 Tailwind class 后会更容易暴露 |
| **C. React + Shadow DOM 隔离（推荐）** | React root 挂载到一个 `attachShadow({mode:'open'})` 的容器内，Tailwind 编译后的 CSS 以 `<style>` 注入 shadow root 内部，不泄漏到宿主页面 | 彻底解决样式隔离问题；后续任何 content-script 内的 UI 需求都能复用这个挂载模式；`WordPopup.tsx` 已经写好，改动集中在"怎么挂载"而不是"重写组件" | 本仓库首次引入 Shadow DOM，需要一次性验证 Popover API + CSS Anchor Positioning 在 Shadow DOM 场景下的行为（见 Decision 中的具体方案）；Tailwind 样式需要显式注入 shadow root，不能依赖 `document.head` 里的全局 `<style>` |
| **D. 换用更轻量的框架（Preact/Lit）单独给 content script 用** | 不用 React，用体积更小的框架重写弹窗 | bundle 更小 | 引入新技术栈，与项目其余部分（React + Jotai）不一致；`WordPopup.tsx` 已经用 React/Jotai 写好，改用别的框架等于推倒重写，收益不成比例 |

---

## Decision

**选择方案 C：查词弹窗改用 React 渲染，并用 Shadow DOM 隔离样式。**

关键设计点——**如何在保留 CSS Anchor Positioning 的前提下引入 Shadow DOM**：

`position-anchor` / `showPopover()` 这些能力作用在弹窗**宿主元素本身**（即 `popup` 这个 `<div>`），与该元素内部渲染的是 `innerHTML` 字符串还是一棵 React 树无关。因此：

1. 仍然用 `document.createElement('div')` 创建 `popup`，仍然设置 `popup.popover = 'manual'`、`popup.style.cssText`（`position-anchor` 等定位属性）、仍然 `document.body.appendChild(popup)` + `popup.showPopover()`——这一层与现在完全一致，不动。
2. 区别在于：不再对 `popup.innerHTML` 赋值字符串，而是 `const shadowRoot = popup.attachShadow({ mode: 'open' })`，往 `shadowRoot` 里注入一个 `<style>`（Tailwind 编译产物）+ 一个挂载容器，再用 `createRoot(container).render(<WordPopup .../>)`。
3. 锚定关系（`anchor-name` 在被点击单词元素上、`position-anchor` 在 `popup` 上）两者都是**光域（light DOM）元素**，中间不跨 Shadow 边界，因此不依赖"跨 shadow root 的 anchor 引用"这类还在草案阶段、兼容性不确定的新特性。

`WordPopup.tsx` 需要调整定位方式：去掉现有的 `position: fixed` + `{x, y}` props（这是它当初按"简单弹窗"设计的定位模型，与 anchor positioning 冲突），改为不关心定位（定位完全交给外层 `popup` 元素的 CSS），组件本身只负责内容渲染。

**弹窗状态（loading/成功/失败/整句翻译按钮状态）改为通过 Jotai atom 驱动**，而不是重新赋值 `innerHTML`。Content script 是独立的 JS 执行上下文，无法与 `popup.html`/`options.html` 共享 React context，需要在 content script 内建立**自己的一份** `<Provider>`；`userAtom` 等已经是 `chrome.storage`-backed 的 atom（见 `src/lib/storageAtoms.ts`），可以在 content script 内独立初始化并读到同一份底层数据，但需要显式做一次"启动时读 storage 并 hydrate atom + 监听 `storage.onChanged`"（参照 `useInitializeStorage` 在 popup 侧的用法），细节留给配套 Task Spec。

---

## Rationale

1. **样式隔离解决的是真实存在、尚未爆发的风险**：当前手写方案能"看起来正常"是因为内联 `style.cssText` 优先级高，恰好压制了大部分冲突；一旦改用 Tailwind class（无论方案 B 还是 C）都会失去这层意外保护，所以 Shadow DOM 不是可选项，是换成 class-based 样式后的必需项。
2. **Anchor Positioning 与 Shadow DOM 不冲突，前提是二者作用的元素都在 light DOM**：这是本决策能成立的关键技术判断，避免了"引入 Shadow DOM 导致定位能力倒退，只能手写定位算法"的坏结果。
3. **复用而非重写**：`WordPopup.tsx` 已经是可用的 React 实现，本决策的改动面集中在"挂载方式"和"定位职责边界"，不是从零设计组件。
4. **建立可复用模式**：这是仓库第一次在 content script 里挂载 React，一旦这个模式（light-DOM 定位宿主 + shadow-DOM 内容隔离）跑通并验证过，后续任何 content-script UI 需求都不用重新踩坑。

---

## Consequences

### Positive

- 弹窗状态管理（loading / error / 未来的"整句翻译"按钮状态）用 React state / Jotai atom 表达，取代字符串拼接和手动 DOM 操作。
- 彻底消除 Tailwind 类名与宿主页面样式冲突的风险。
- `WordPopup.tsx` 从死代码变为实际使用的组件。
- 建立 content-script React + Shadow DOM 挂载先例，供未来功能复用。

### Negative

- `content.ts` → `content.tsx`，需要实测确认 `@crxjs/vite-plugin` 对 content script 用 `.tsx` 的构建产物、HMR 行为符合预期（本仓库首次这样用）。
- Tailwind 样式需要显式收集并注入 shadow root（不能依赖宿主页面 `<head>` 里的全局样式表），需要一次性的构建配置工作（例如把编译后的 CSS 以字符串形式 import 进 content script，注入 `shadowRoot` 的 `<style>`）。
- Popover API 的宿主元素（`popup`）本身带 Shadow Root 这一组合方式，虽然理论上不受影响，但仓库内从未验证过，需要在实施阶段先做最小 spike 确认（含 Chrome 稳定版实测），而不是直接假设一定可行。
- `WordPopup.tsx` 需要改动定位相关的 props（去掉 `position: {x,y}`），是一次小的接口变更。

### Mitigation

- 实施第一步先做一个不含业务逻辑的最小 spike：一个 Popover div + `attachShadow` + 挂一个"Hello React"组件 + CSS anchor positioning，在真实 Chrome 里验证显示、定位、显隐、样式隔离四件事都正常，再开始迁移正式弹窗逻辑（见配套 Task Spec §7 步骤 1）。
- 若 spike 发现 Popover + Shadow DOM 组合有 Chrome 版本兼容问题，退回选项 B（不做 Shadow DOM，接受样式冲突风险，后续单独评估 CSS 命名空间前缀等更轻量的隔离手段）。

---

## Revisit Trigger

- Chrome 对 Popover API 或 CSS Anchor Positioning 在 Shadow DOM 场景下的行为发生变化（含新增的跨 shadow root anchor 引用特性转正，届时可以简化当前"宿主元素必须在 light DOM"的约束）。
- 若 spike 阶段发现 Shadow DOM 隔离的构建成本远超预期（例如 Tailwind CSS 注入 shadow root 需要复杂的构建改动），需要重新评估是否降级到方案 B。
- 若未来需要在同一网页里同时显示多个 content-script UI（例如查词弹窗 + 划词工具条），需要重新评估当前"每次弹窗都新建一个 shadow host"的模式是否要改成共享一个常驻 shadow host。
