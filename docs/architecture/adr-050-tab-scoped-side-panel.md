---
status: accepted
date: 2026-10-08
related: TASK-SPEC-enx-chrome-sentence-translation-sidepanel（§3.2 触发路径、§3.3 待处理上下文，本 ADR 修订）、adr-006（页面查词镜像进侧边栏，存储 key 一并按标签页拆分）、adr-023（侧边栏统一卡片列表）
---

# ADR-050：侧边栏改为标签页级别，不再使用全局侧边栏

`chrome.sidePanel` 有两种面板：

- **全局面板**：manifest 的 `side_panel.default_path`，或不带 `tabId` 的 `setOptions({ path })`。它属于窗口，打开后在该窗口所有（没有自己面板的）标签页里都显示。
- **标签页面板**：`setOptions({ tabId, path, enabled: true })` 给某个标签页登记的专属面板。它跟着这个标签页走：切到别的标签页时隐藏，切回来恢复，**标签页关闭时随之销毁**。

`open()` 本身没有「打开哪一种」的参数：调用时该标签页登记过专属面板就打开它，否则打开全局面板。ENX 至今只配了 `default_path`、从未调用 `setOptions({ tabId })`，所以三条打开路径（TASK-SPEC §3.2 ①②③）打开的都是全局面板，即使路径③传的是 `open({ tabId })`。结果是：关闭阅读的标签页后，侧边栏仍挂在窗口上，跟到下一个标签页里，显示的却是上一页的句子。

侧边栏的内容（整句翻译、页面查词镜像）天然属于某一页文章。

我们决定：**ENX 侧边栏一律以标签页面板打开，不再存在全局面板**；关闭标签页即关闭它的侧边栏，不需要额外代码。

## Considered Options

- **保留全局面板，监听 `tabs.onRemoved` 后调 `sidePanel.close({ windowId })`**：要记住是哪个标签页打开的面板；切换标签页时面板仍跟着走、显示别页内容，只解决了「关闭」一种情形。否决。
- **标签页面板，但存储 key 仍全局共享**：A 页点「整句翻译」会写同一个 `enx-pending-sentence`，所有已打开的标签页面板都会经 `storage.onChanged` 刷新成 A 页的句子。否决；存储 key 必须按标签页拆分（Decision 3）。
- **面板通过 `chrome.tabs.query({ active: true })` 自己判断所属标签页**：面板挂载时用户可能已经切走，竞态。否决；标签页 ID 由打开方写进面板 URL（Decision 2），面板只读不猜。

## Decision

1. **打开前先登记，二者同步发出。** 所有打开路径都按顺序调用

   ```ts
   chrome.sidePanel.setOptions({ tabId, path: sidePanelPath(tabId), enabled: true })
   chrome.sidePanel.open({ tabId })
   ```

   `open()` 必须在用户手势内调用，任何 `await` 都会耗掉手势，所以 `setOptions` **不 await**，两次调用在同一个同步块里发出（Chrome 按调用顺序处理扩展 API 请求）。封装为 `openTabSidePanel(tabId)`，三条路径共用。

2. **面板 URL 带上所属标签页：`sidepanel.html?tabId=<id>`。** `SidePanel.tsx` 挂载时从 `location.search` 读出 `tabId`，只读写该标签页的存储 key。读不到 `tabId`（旧版本残留的全局面板）时显示空状态，不读写任何 key。

3. **存储 key 按标签页拆分**：`enx-pending-sentence:<tabId>`、`enx-latest-page-word:<tabId>`，由 `pendingSentenceKey(tabId)` / `latestPageWordKey(tabId)` 生成，写方（background，取 `sender.tab.id`）与读方（面板）共用。`tabs.onRemoved` 时 background 删掉该标签页的两个 key，`storage.session` 不随关闭的标签页累积。

4. **禁用全局面板。** manifest 删掉 `side_panel.default_path`（保留 `sidePanel` 权限）；Service Worker 启动时再调一次 `setOptions({ enabled: false })`（不带 `tabId`），保证 Chrome 侧边栏下拉菜单里也打不开一个没有所属标签页的 ENX 面板。

5. **打开路径**（修订 TASK-SPEC §3.2）：
   - ① popup 按钮：先 `tabs.query({ active: true, currentWindow: true })` 取当前标签页，再 `openTabSidePanel(tab.id)`。
   - ② 工具栏图标右键菜单：保留，`onClicked` 回调拿到的 `tab.id` 传给 `openTabSidePanel`。回调不再是 `async`，`open()` 在任何 `await` 之前发出。
   - ③ 查词弹窗「整句翻译」：`openTabSidePanel(sender.tab.id)`，仍在 `onMessage` 监听器里同步调用。手势转发失败时仍提示用户点击或右键工具栏图标。

6. **「面板是否已打开」按标签页判断。** `isSidePanelOpen(tabId)` 在 `chrome.runtime.getContexts()` 返回的 `SIDE_PANEL` 上下文里，比对 `documentUrl` 的 `tabId` 参数，不再是「窗口里有任意面板就算」。

## Consequences

- 关闭标签页 → 它的侧边栏消失；切换标签页 → 各自的侧边栏各自显示或隐藏，互不串内容。
- 同一标签页内导航到别的页面，标签页面板不会自动关闭（Chrome 行为），仍显示旧页的内容，与改动前一致；不在本 ADR 范围内。
- 用户在一个标签页打开面板后切到另一页，新页面上没有面板，需要重新打开。这是有意的：面板内容属于原来那一页。
- `chrome.sidePanel.open()` / 手势限制的不确定性（TASK-SPEC §5 风险表）不变，路径③仍是「尽力而为」，失败回退到路径①②。
