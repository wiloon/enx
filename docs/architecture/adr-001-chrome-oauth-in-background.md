# ADR-001: enx-chrome Cognito OAuth 在 Background Service Worker 中完成

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-07-18 |
| **日期** | 2026-07-18 |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-chrome-oauth-background.md`](../tasks/TASK-SPEC-enx-chrome-oauth-background.md) |
| **修订关系** | 修正 [`docs/tasks/task-001-cognito-auth.md`](../tasks/task-001-cognito-auth.md) 中 enx-chrome 登录步骤的隐含假设（OAuth 可在 popup 内跑完全程） |

---

## Context

enx-chrome 通过 `chrome.identity.launchWebAuthFlow` + Cognito Hosted UI（PKCE）完成 Google / email 登录。当前实现把整段流程（打开 Hosted UI → 等 redirect → 换 token → 写 `chrome.storage.local` → 更新 Jotai）写在 **popup**（`Login.tsx` → `signInWithCognito()`）里。

Chrome 扩展 **action popup 在失焦时会被销毁**。`launchWebAuthFlow` 会打开独立认证窗口，popup 立刻关闭，JS 上下文随之消失。结果是：

1. Cognito / Google 侧登录已成功（SSO cookie 已写入）。
2. 扩展侧 token 交换与落盘未完成 → storage 仍是未登录。
3. 用户再次点扩展图标看到登录页；再点 Sign in 时因 Cognito SSO 不再弹出 Google 选择窗，流程很快完成并落盘，才出现「Enable Learning Mode」。

这与「第一次其实已登录成功，只是扩展状态没更新」的用户感知一致。

**约束**

- 继续使用 Cognito Hosted UI + `chrome.identity.launchWebAuthFlow` + PKCE（与 task-001 / 现有 App Client / redirect URI 一致）。
- Manifest V3 service worker；不引入新的 IdP 或新的 Cognito App Client。
- 登录成功后 popup 若已关闭，用户重新打开图标即应看到已登录态，无需再点一次 Sign in。
- 登录成功后用 `chrome.notifications` 主动提示（manifest 已有 `notifications` 权限）。

---

## Options Considered

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. OAuth 全程在 background SW** | popup 发消息；SW 执行 `launchWebAuthFlow` + token 交换 + 写 storage；成功后发系统通知；popup 靠 storage / 消息刷新 UI | 与 popup 生命周期解耦；一次 Google 登录即可落盘；改动面可控；popup 已关仍可知登录成功 | SW 可能休眠（需用消息唤醒并保持异步通道）；通知依赖 OS/用户通知权限，不能替代落盘 |
| **B. 用 `chrome.tabs` 打开完整登录页** | 独立 extension 页面或 options 跑 OAuth | 页面不会因失焦销毁 | UX 更重；需额外页面与路由；与现有 `launchWebAuthFlow` 模式偏离 |
| **C. 保持 popup 发起，仅把 token 交换挪到 SW** | popup 调 `launchWebAuthFlow`，把 code 交给 SW | 看似折中 | **无效**：popup 在 flow 返回前就已销毁，连 code 都接不到 |
| **D. 不改架构，文档提示「登录后请再点一次」** | 无代码改动 | 零成本 | 不修复根因；第一次登录后扩展仍未落盘，体验差 |

---

## Decision

**选择方案 A：Cognito OAuth 的 `launchWebAuthFlow`、PKCE verifier、token 交换、以及 user/token 写入 `chrome.storage.local`，全部在 background service worker 中完成。**

Popup 只负责：

1. 触发：`chrome.runtime.sendMessage({ action: 'cognitoSignIn' })`。
2. 展示 loading / error。
3. 通过既有 `useInitializeStorage`（含 `storage.onChanged`）或消息回包更新已登录 UI。

`src/lib/cognito.ts` 保持为可复用的纯逻辑 / API 封装，由 background 调用；popup **不再**直接调用 `signInWithCognito()`。

**登录成功通知**：storage 写入成功后调用 `chrome.notifications.create`；点击通知时尽量 `chrome.action.openPopup()`（平台不支持则忽略）。通知是体验增强，**不能**代替落盘。

---

## Rationale

1. **根因是生命周期，不是 Cognito 配置**：Google 登录成功但扩展未登录，说明 IdP 与 redirect URI 基本正常；缺的是可靠的落盘上下文。
2. **方案 C 不能解决问题**：必须把 `launchWebAuthFlow` 本身也放进 SW。
3. **方案 B 过重**：当前问题用 MV3 常规「popup 委托 background」即可，无需换交互形态。
4. **与 task-001 协议兼容**：redirect URI、PKCE、Bearer token、storage key 不变；只改「谁执行」这一层。

---

## Consequences

### Positive

- 第一次完成 Google / Hosted UI 登录后，token 与 user 会写入 storage。
- 用户关闭认证窗后再次打开扩展图标，应直接看到已登录态（含 Enable Learning Mode），无需第二次 Sign in。
- 第二次因 SSO 快速完成的「怪现象」消失（或仅表现为正常的可选重新登录）。

### Negative

- popup 关闭后仍需用户点扩展图标才能操作（通知不能可靠自动打开 popup）。
- Background 异步消息通道需正确 `return true` + `sendResponse`；SW 空闲回收时依赖用户再次点击触发，属 MV3 常态。
- 系统可能折叠通知，或用户关闭了 Chrome/OS 通知权限。

### Mitigation

- 落盘成功后再 `sendResponse` 与通知；即便 popup 已销毁导致回包失败，storage 仍有效。
- 验收以「第一次 OAuth 完成后重新打开 popup = 已登录」+「出现登录成功通知」为准（见关联 Task Spec §4）。

---

## Revisit Trigger

- Chrome 对 action popup + `launchWebAuthFlow` 的生命周期行为发生破坏性变更。
- 需要支持无 `identity` 权限的发布渠道，或改用自定义 Tab 登录页。
- 通知体验不足时，再评估 badge / `enx-auth-pending` 等补充手段。
