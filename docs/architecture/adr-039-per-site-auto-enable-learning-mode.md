---
status: proposed
date: 2026-09-28
related: adr-034（按需注入，本 ADR 兑现其 Revisit Trigger 第 3 条）
---

# ADR-039：按站点「总是启用 Learning Mode」用可选 host 权限 + 动态注册 content script 实现，以权限授予本身作为唯一事实来源

用户希望在某个站点（例：`www.infoq.com`）上开过一次 Learning Mode 后，勾选「在此站点总是启用」，以后打开该站点任何页面都自动进入 Learning Mode。adr-034 之后扩展只有 `activeTab` + `scripting`、`host_permissions` 为空，`activeTab` 的授权随用户手势产生、随 tab 导航失效，**没有持久 host 权限就不可能在页面加载时自动注入**——这是 Chrome 安全模型决定的，不是存储问题。我们决定：在 manifest 声明 `optional_host_permissions`，用户勾选时按**精确 origin** 运行时申请权限，授权后用 `chrome.scripting.registerContentScripts` 注册常驻脚本；**「这个站点是否总是启用」只看该 origin 的可选 host 权限是否已授予**，不另存一份站点列表。

## Considered Options

- **安装时声明 `<all_urls>` host 权限，content script 全站常驻、读 storage 决定是否启用**（沉浸式翻译等的做法）：实现最简单，但安装即出现「读取和更改您在所有网站上的数据」警告、CWS 审核更严，且正是 adr-034 刚否掉的方案 B（全站常驻注入面）。否决。
- **`chrome.storage` 里存站点列表 + 可选权限**：两份状态会漂移——用户在 Chrome 扩展菜单里直接收回站点权限时，storage 仍说「启用」，脚本却注入不了。以权限为唯一事实来源就不存在这种不一致。否决。
- **申请 `*.infoq.com` 这类子域通配**：覆盖更顺手，但授权对话框显示范围更大、语义更难向用户解释。v1 只做精确 origin（`https://www.infoq.com/*`），`infoq.com` 与 `www.infoq.com` 分别授权。

## Decision

1. `manifest.json` 增加 `"optional_host_permissions": ["https://*/*", "http://*/*"]`。可选权限不进入安装警告。
2. **授权**：popup 在 Learning Mode 已启用的页面上显示「在此站点总是启用」开关；打开时在点击回调里直接调 `chrome.permissions.request({ origins: [\`${origin}/*\`] })`（必须是用户手势内调用）。关闭时调 `chrome.permissions.remove`。开关状态读 `chrome.permissions.contains`。
3. **注册与收敛（seam）**：background 提供一个 `reconcileAutoEnableScripts()`——期望集合 = 已授予的 host origins − manifest 必需 `host_permissions`（api/ui/Clerk）− 静态 `content_scripts[0].matches` 已覆盖的 origin；实际集合 = `chrome.scripting.getRegisteredContentScripts()` 中 id 前缀为 `auto-enable:` 的条目；多注册、少注销。脚本 `files` 取 `content_scripts[0].js`（与 `enableLearningMode.ts` 同一来源），`runAt: 'document_end'`，`persistAcrossSessions: true`。在 `permissions.onAdded` / `permissions.onRemoved` / `runtime.onInstalled` / `runtime.onStartup` 时调用。**不依赖 popup 里 `request()` 的 Promise 结果去注册**：Chrome 弹出授权框时 popup 可能失焦关闭，Promise 回调未必能执行；`onAdded` 在 background 里总会触发。
4. **自动启用**：content script 加载后向 background 发 `shouldAutoEnable`，background 用 `chrome.permissions.contains({ origins: [\`${origin}/*\`] })`（且 origin 不属于必需 `host_permissions`）作答；为真则走与 `enxRun` 相同的启用路径。这使静态注入的站点（X、RSSX）也能统一支持「总是启用」，且不会重复注入。
5. 重复注入由 content script 已有的 `enxRun` 幂等守卫兜底（`content.tsx:643`）。

## Consequences

- 首次勾选时 Chrome 会弹「读取和更改您在 www.infoq.com 上的数据」——这是用户主动选择的、范围最小的提示。CWS 上架时隐私说明需补一句可选 host 权限的用途。
- 权限按 origin 粒度，无法只对某路径授权；如需「只在文章页自动启用」，在 content script 里按路径过滤，不影响本决策。
- 自动启用发生在 `document_end` 之后，对 SPA 内路由切换不重新触发——与现有按需启用行为一致，SPA 站点仍走专属 `SiteAdapter`（adr-010）。
- 授权对话框无法被 Playwright 驱动，e2e 只能覆盖「权限已授予 → 页面自动启用」这一段（可在测试 profile 里预授权）；「点开关 → 授权框」这一步需要人工验证一次。
