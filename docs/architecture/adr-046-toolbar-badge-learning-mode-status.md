---
status: proposed
date: 2026-10-03
related: adr-039（按站点自动启用，本 ADR 给它补上状态反馈）、adr-010 / adr-011 / adr-019（`showProcessingIndicator`，本 ADR 将其删除）、adr-047（Onboarding，负责教用户认识角标）
---

# ADR-046：Learning Mode 状态改用扩展图标角标表达，正文里不再插入「Article processed」提示条

学习模式处理完一篇文章后，`addProcessingCompleteIndicator`（`content.tsx`）会在正文第一个节点前 `insertBefore` 一条品牌色胶囊「Article processed • Click words for translation」。它没有点击事件，只是状态提示，却是学习模式对正文唯一一处**结构性** DOM 插入（adr-010 已因此在 X、enx-ui reader 上关掉它）。adr-039 的「在此站点总是启用」让这条提示出现得更频繁：在 InfoQ 上每打开一篇文章都会插一次。ENX 的原则是尽量不改动原网页、不打扰用户；而自动启用失败时又是完全静默的（adr-039 Decision 4），用户分不清「没生效」和「还在处理」。

我们决定：**学习模式的状态只通过 Chrome 扩展图标的角标（badge）按标签页表达**，正文里不再插入任何状态提示；扩展图标未固定在工具栏上时，用一个短暂的、页面顶层的、不进入正文的提示请用户固定图标，最多出现两次。

## 角标的原始用途

Chrome 文档（`chrome.action`）：角标是叠在图标上的一小段文字，用来「显示一点关于扩展状态的信息，比如计数器」；建议不超过 4 个字符；`setBadgeText` 可带 `tabId`，只在该标签页被选中时生效，**标签页关闭时自动清除**（文档没有承诺导航时清除）。官方入门教程 Focus Mode 正是用按标签页的 `ON` / `OFF` 角标表示扩展在该页是否生效。本 ADR 的用法与此一致。

## Considered Options

- **保留正文提示条，只加角标**：两处表达同一件事，正文仍被改动。否决。
- **正文提示条改为再提醒用户「去看扩展图标」**：等于承认角标不够用，且每篇文章都在正文里出现。否决；唯一真实的盲区是「图标没固定、角标看不到」，那个情况可以检测（Decision 6），只在那时提示。
- **只用颜色区分状态**：色盲用户无法分辨，且灰色/品牌色在深浅工具栏上对比度不稳。否决；**每个状态同时有不同字符和不同颜色**。
- **用 `setIcon` 换整个图标**：要为每个状态准备多套尺寸的图标，可读性不比角标好，且图标是品牌识别物，不宜随状态变色。否决。

## Decision

1. **四个状态**，按标签页设置（所有 `setBadgeText` / `setBadgeBackgroundColor` / `setTitle` 都带 `tabId`）：

   | 状态 | 何时 | 角标字符 | 背景色 | 悬停提示（`setTitle`，英文 UI） |
   | --- | --- | --- | --- | --- |
   | `off` | 未启用、非文章页、学习模式已关闭 | 无（空串） | — | 默认标题 |
   | `processing` | 已找到正文节点，正在取词、上色 | `…` | 琥珀 `#D97706` | `Catglish: preparing this article…` |
   | `ready` | 处理完成，可以点词查词 | `✓` | 品牌色（hex，见实现要点） | `Catglish: learning mode is on. Click any word to look it up.` |
   | `error` | 需要用户处理的失败 | `!` | 红 `#DC2626` | 按原因给出，复用 `failureMessage(reason)` |

   文字颜色不设，由 Chrome 自动取与背景对比的颜色。

   **为什么「正在处理」不用灰色**：灰色在界面里的通常含义是「禁用 / 不可用」，用户会把灰色角标读成「Catglish 在这页关掉了」。琥珀色是常见的「进行中、请稍候」颜色（交通灯的黄灯），与就绪的品牌青蓝、出错的红色三者色相差得很远；加上字符也各不相同，色盲用户靠字符就能区分。琥珀偶尔也被用作「警告」色，但 `…` 这个字符和它只持续一两秒的特点，足以把它与警告区分开。

2. **状态由 content script 上报，background 落到角标。** content script 发 `{ type: 'learningModeStatus', status }`；background 只认 `sender.tab.id` 与 `sender.frameId === 0`，不信任消息体里的 tab。状态到角标属性的映射是纯函数 `badgeFor(status)`，与 Chrome API 调用分开，便于单测。

3. **上报时机**（都在 `content.tsx` 现有启用路径上，手动启用与自动启用共用 `runLearningMode()`）：
   - `processing`：`processArticleContent` 找到非空的 article nodes 之后。在这之前就失败的页面（`unsupported-page`、`no-article-node`）**从不出现 `processing`**，首页、列表页不会闪角标。
   - `ready`：outcome 为 `ok`。
   - `error`：outcome 失败且原因是 `lookup-failed`、`session-expired`、`error` 之一——这些是用户能处理（重新登录、检查网络、重试）的失败。
   - `off`：其余失败原因（`unsupported-page`、`no-article-node`、`no-words`）、`disableEnx()`、自动启用回滚。手动启用的这些失败仍由 popup 现有的错误行说明，角标不重复。
   - SPA 重建（adr-011 Decision 6，X 上切推文）每次都重新走 `processing` → `ready`；被新一轮取代的旧任务不上报。

4. **清除**：background 监听 `tabs.onUpdated`，`changeInfo.status === 'loading'` 时把该 tab 的角标和标题恢复默认。整页导航后，新页面的状态由新注入的 content script 重新上报。

5. **删除正文提示条**：删掉 `addProcessingCompleteIndicator`、它注入的 `slideInFromTop` 动画样式、`disableEnx()` 里的清理代码，以及 `SiteAdapter.showProcessingIndicator` 字段（三个适配器都改为不再声明）。这部分修订了 adr-010、adr-011、adr-019 里关于该字段的描述；adr-028 A1 提到的「完成指示器 UI 位」随之消失，将来要做「完成一篇」的仪式感时另行设计，不再借用正文插入。

6. **图标未固定时的提示**：
   - 触发：上报 `ready` 时，background 调 `chrome.action.getUserSettings()`；`isOnToolbar === false`，且提示已显示次数 < 2、用户没点过「不再提示」时，回复 content script 显示提示。`getUserSettings` 只能在扩展页面 / service worker 里调用，所以判断必须在 background。
   - 形态：页面顶层（popover / top layer，Shadow DOM 隔离，复用现有浮层机制），**不插入正文**；靠视口右上角（工具栏那一侧）；约 8 秒后自动消失，可手动关闭。文案（英文 UI）：`Pin Catglish to your toolbar to see when learning mode is ready.`，附一个 `Don't show again` 按钮。
   - 计数与「不再提示」存 `chrome.storage.local`：固定与否是这一个浏览器的设置，不上传 enx-api、不进 adr-044 的服务端偏好。
   - 用户在 Onboarding（adr-047）里可以跳过「固定图标」这一步；跳过的人之后最多再看到两次这个提示，这里的计数是唯一的机制，Onboarding 不另做一套。

7. **未登录的自动启用站点**：adr-039 Decision 4 在未登录时让 `shouldAutoEnable` 答 false，页面上什么都没有。本 ADR 改为：background 发现该 origin 已授权自动启用、但用户未登录时，把该 tab 设为 `error`，悬停提示 `Sign in to Catglish to use learning mode on this site.`。仍然不在页面里弹任何东西。这会让该站点的每个页面（包括首页）都显示 `!`；用户收回站点授权或登录后即消失，作为可接受的代价。

## 实现要点（给实现者 / AFK agent）

- 新模块 `enx-chrome/src/lib/learningModeStatus.ts`：`LearningModeStatus` 类型（`off` / `processing` / `ready` / `error` + 可选 `reason`）、纯函数 `badgeFor(status)` → `{ text, color?, title }`。品牌色写成 hex 常量，取值对齐 `--color-brand`（`oklch(0.55 0.13 200)`）；不要假设 `setBadgeBackgroundColor` 接受 `oklch()`。
- 新 background 模块 `enx-chrome/src/background/badge.ts`：`applyStatus(tabId, status)`、`resetTab(tabId)`、`maybeAskToPin()`（读 `getUserSettings` 与 `storage.local`，返回是否显示提示并自增计数）。`background.ts` 只挂 `tabs.onUpdated` 监听和路由 `learningModeStatus` 消息。
- `content.tsx`：在 Decision 3 的四个点上报；收到「显示固定提示」时渲染顶层提示。
- 单测（Jest，`src/test/setup.ts` 补 `chrome.action.setBadgeText` / `setBadgeBackgroundColor` / `setTitle` / `getUserSettings` 与 `tabs.onUpdated` 的 mock）：
  - `badgeFor`：四个状态各自的字符、颜色、标题互不相同；`error` 的标题来自 `failureMessage`。
  - 消息路由：带 `sender.tab.id` 设置该 tab；`frameId !== 0` 或无 tab 时忽略。
  - `tabs.onUpdated` 的 `loading` 清除该 tab。
  - content：`no-article-node` / `unsupported-page` 从不上报 `processing`；成功路径依次上报 `processing`、`ready`；`session-expired` 上报 `error`；`disableEnx()` 上报 `off`；页面里不存在 `#enx-processing-complete`。
  - 固定提示：`isOnToolbar: true` 不显示；`false` 时前两次显示、第三次不显示；`Don't show again` 之后不再显示。
  - 未登录的已授权站点：tab 为 `error`，`shouldAutoEnable` 仍答 false。
  - `siteAdapters.test.ts` 去掉 `showProcessingIndicator` 的断言。
- 验收：`cd enx-chrome && pnpm test && pnpm lint && pnpm build && pnpm build:prod` 全绿。
- **人工验证项（PR 描述里列出）**：真实 Chrome 中，InfoQ 自动启用 → 角标 `…` → `✓`；同标签页跳到另一篇文章，角标先清除再重新出现；首页不出现角标；取消固定图标后打开文章，看到固定提示，第三次不再出现；退出登录后在 InfoQ 看到 `!`。

## Consequences

- 正文里再没有任何结构性插入，学习模式只留下 CSS Highlight 与委托点击监听（adr-011）。
- 没固定图标、又点了「不再提示」的用户，将完全看不到学习模式状态，只能靠单词下划线判断——这是用户自己的选择。
- 新用户不再从正文里读到「点击单词查词」这句教学；这件事交给 adr-047 的 Onboarding 和 `ready` 状态的悬停提示。两者随第一版一起上线（目前生产环境没有其他用户），不存在引导变弱的过渡期。
- 角标与 popup 里的状态是两个表达面，但 popup 只在用户点开时显示，二者不会同时打扰用户。
