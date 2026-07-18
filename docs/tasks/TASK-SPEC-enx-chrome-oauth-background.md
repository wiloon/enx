# TASK-SPEC: enx-chrome Cognito OAuth 改由 Background 完成

| 字段 | 值 |
| --- | --- |
| **状态** | In Progress — 2026-07-18 |
| **类型** | SDD Task Spec（Spec 驱动实现） |
| **关联 ADR** | [`docs/architecture/adr-001-chrome-oauth-in-background.md`](../architecture/adr-001-chrome-oauth-in-background.md)（Accepted） |
| **目标** | 1) 把 Cognito Hosted UI OAuth（`launchWebAuthFlow` + PKCE token 交换 + user/token 落盘）从 popup 迁到 background service worker，使**第一次** Google / email 登录完成后扩展本地状态即为已登录；2) 登录成功后用 `chrome.notifications` 通知用户 |
| **非目标** | 不改 Cognito User Pool / App Client / redirect URI；不改 enx-api / enx-ui；不换成 Tab/options 登录页；不重做 refresh token 策略；不改 Enable Learning Mode 业务逻辑；不要求登录成功后**必定**自动弹出 popup（`openPopup` 尽力而为） |
| **触发原因** | 用户选 Google 登录并完成 Cognito 流程后，再点扩展图标仍显示未登录；再点 Sign in 时不再出现 Google 选择窗，过一会儿才变成已登录。根因见 ADR-001：popup 失焦销毁导致 token 未落盘 |

---

## 1. 背景与动机

`task-001-cognito-auth.md` 规定 enx-chrome 用 `chrome.identity.launchWebAuthFlow` + Cognito Hosted UI。实现落在 popup 的 `Login.tsx` → `signInWithCognito()`（`src/lib/cognito.ts`）。

Chrome action popup **失焦即销毁**。打开 Hosted UI / Google 窗口后 popup JS 中断，常见结果：

| 侧 | 第一次「成功」登录后 |
| --- | --- |
| Cognito / Google | SSO cookie 已有 → 再次授权可跳过账号选择 |
| `chrome.storage.local` | 往往仍无 `accessToken` / `enx-user.isLoggedIn` |
| Popup UI | 重新打开 → 仍显示 Sign in |

用户感知「第一次其实已登录，扩展状态没更新」正确；第二次点击只是在 SSO 下把原先失败的落盘补上。

即使落盘修复后，popup 在认证期间通常已关闭，用户缺少「已成功」的即时反馈 → 用系统通知补齐。

---

## 2. 现状调查

### 2.1 调用链（有问题）

```text
Popup Login.tsx
  → signInWithCognito()          // cognito.ts，在 popup 上下文执行
      → chrome.storage.session 存 PKCE verifier
      → chrome.identity.launchWebAuthFlow  // 打开窗口 → popup 销毁
      → exchangeCodeForTokens
  → apiService.getMe()
  → setUser / setSession + chrome.storage.local.set
```

### 2.2 相关文件

| 文件 | 角色 |
| --- | --- |
| `src/components/Login.tsx` | 登录 UI；直接调用 `signInWithCognito` |
| `src/lib/cognito.ts` | PKCE、authorize URL、`launchWebAuthFlow`、token 交换 |
| `src/background/background.ts` | API 代理、读 `accessToken`；**无** OAuth handler |
| `src/hooks/useInitializeStorage.ts` | 从 storage 恢复 user/session；监听 `storage.onChanged` |
| `src/popup/Popup.tsx` | 挂载 Login + 会话校验 |
| `manifest.json` | 已有 `identity`、`notifications` 权限 |
| `src/lib/__tests__/cognito.test.ts` | cognito 纯逻辑单测（可保留） |
| `e2e/helpers.ts` | E2E 用 `seedLoggedInState`，不跑真实 Hosted UI |

### 2.3 已有可复用能力

- `useInitializeStorage` 已监听 `enx-user` / `user` / `accessToken` 变更 → background 写 storage 后，**仍打开着的** popup 可自动变已登录。
- Background 已有 `chrome.runtime.onMessage` 异步模式（`return true` + `sendResponse`）。
- `cognito.ts` 不依赖 React，可在 SW 中 import。
- `notifications` 权限已在 manifest，无需新增权限申请。

### 2.4 为何不能「只把换 token 挪到 background」

若 popup 仍调用 `launchWebAuthFlow`，在 callback 返回前上下文已销毁，**拿不到** authorization code。必须把 **`launchWebAuthFlow` 整段**放进 SW。

---

## 3. 目标设计

### 3.1 目标调用链

```text
Popup Login.tsx
  → chrome.runtime.sendMessage({ action: 'cognitoSignIn' })
Background
  → signInWithCognito()           // 同 cognito.ts，在 SW 执行
  → 用 access_token 调 GET /api/me（或等价 fetch）
  → chrome.storage.local 写入 user / enx-user / accessToken / refreshToken / enx-session
  → 更新 SW 内存中的 accessToken
  → chrome.notifications.create（登录成功）
  → sendResponse({ success: true, user })  // popup 已关则忽略失败
Popup（若仍存活）
  → 回包或 storage.onChanged → 显示已登录 UI
Popup（若已关闭后用户再点图标 / 点通知）
  → useInitializeStorage 读到 isLoggedIn → 直接显示 Enable Learning Mode
```

### 3.2 Message 约定

**请求**（popup → background）：

```ts
{ action: 'cognitoSignIn' }
// 兼容现有 listener：也可同时支持 type: 'cognitoSignIn'
```

**成功响应**：

```ts
{
  success: true,
  user: {
    id: number
    username: string
    email: string
    status?: string
    isLoggedIn: true
  }
}
```

**失败响应**：

```ts
{ success: false, error: string }
```

错误文案与现有一致即可（取消登录、Cognito error_description、token exchange 失败、redirect URI 未注册等）。用户取消（`Sign-in cancelled`）视为失败，不写 storage、不发成功通知。

### 3.3 Storage 写入（必须与现网 key 兼容）

Background 在 OAuth 成功后一次性写入（字段名与 `Login.tsx` / `storageAtoms` / `useInitializeStorage` 对齐）：

| Key | 内容 |
| --- | --- |
| `user` / `enx-user` | 含 `isLoggedIn: true` 的用户对象 |
| `accessToken` / `refreshToken` | Cognito tokens |
| `enx-session` | `{ accessToken, refreshToken }` |

`getMe` 失败时：仍可按现有 Login 回退逻辑写入占位 user（`username: 'user'`, `isLoggedIn: true`）+ tokens，避免「有 token 却显示未登录」；不在本次引入更复杂的重试。

### 3.4 登录成功通知

- **时机**：storage 写入成功之后（落盘优先于通知）。
- **API**：`chrome.notifications.create`，`type: 'basic'`，使用扩展已有图标（如 `icons/icon-128.png`）。
- **文案**（英文，与扩展 UI 一致）：title `ENX`，message 提示已登录、可点击扩展图标继续（例如 `Signed in successfully. Click the ENX icon to continue.`）。
- **点击通知**：注册 `chrome.notifications.onClicked`；若 notificationId 匹配，则尝试 `chrome.action.openPopup()`，失败则忽略（部分 Chrome 版本 / 无用户手势时可能不可用）。随后 `chrome.notifications.clear`。
- **失败**：通知创建失败只打 log，**不**回滚已写入的登录态。
- **取消登录**：不发通知。

### 3.5 Popup `Login.tsx` 变更

- **删除**对 `signInWithCognito` 的直接调用。
- `handleCognitoSignIn`：`sendMessage` → 回包成功时显式 `setUser`/`setSession`；**storage 唯一落盘在 background**（popup 的 atom setter 可能二次写相同值，可接受）。
- `handleLogout`：`sendMessage({ action: 'cognitoSignOut' })`；本地 atom 在 finally 中清空（background 已先清 storage）。

### 3.5.1 Cognito Sign out（Hosted UI session）

仅清 `chrome.storage` **不够**：Cognito Hosted UI cookie 仍在，再次 Sign in 会 SSO 跳过 Google 选择页。

| 步骤 | 行为 |
| --- | --- |
| 1 | Background 先清本地 auth keys + 内存 `accessToken` + session PKCE verifier |
| 2 | `launchWebAuthFlow` 打开 `{cognitoDomain}/logout?client_id=…&logout_uri={callback}` |
| 3 | `logout_uri` = `https://<ext-id>.chromiumapp.org/callback`（与 OpenTofu `logout_urls = chrome_callback_urls` **精确一致**，**不加**尾斜杠） |
| 4 | Cognito logout 失败或用户关窗：本地仍视为已登出；打 log / warning |

### 3.6 `cognito.ts`

- 保持导出 `signInWithCognito` / `signOutWithCognito` / PKCE / exchange 等；**不**在模块内写 React 或 popup 假设。
- `chrome.storage.session` 存 verifier：从 SW 读写即可。
- 单测覆盖 `buildLogoutUrl` 与 `signOutWithCognito`。

### 3.7 `background.ts`

- 在 `onMessage` 的 `switch` 中增加 `cognitoSignIn` 与 `cognitoSignOut`。
- Sign-in handler：`signInWithCognito` → 设内存 `accessToken` → `getMe` → 写 storage → 发通知 → `sendResponse`。
- Sign-out handler：先清本地 → `signOutWithCognito`。
- 顶层注册 `chrome.notifications.onClicked`（MV3：listener 须同步注册在 SW 顶层）。
- **禁止**把「只返回 redirect URL / code、留给 popup 换 token」当成完成态。

### 3.8 显式不做

- 不改 `manifest.json` 的 `identity` / `key` / redirect 相关配置（`notifications` 已存在，无需新增）。
- 不改 E2E 为真实 Google 登录（继续 `seedLoggedInState`）。
- 不实现 badge / `enx-auth-pending`（列 §8）。

---

## 4. 验收标准

### 4.1 自动化

- [x] `pnpm test`（enx-chrome）通过，含 `cognito.test.ts`
- [x] `pnpm build` 成功

### 4.2 手工（必须，真实 Cognito + Google）

前置：unpacked 加载当前 `dist/`，扩展 ID 仍为 `omcdpipnjffmblbhiphddcmoldceapam`，且处于**未登录**（可先 Sign out 或清扩展 storage）。系统通知权限允许 Chrome。

| # | 步骤 | 期望 |
| --- | --- | --- |
| 1 | 打开 popup → Sign in → 在 Hosted UI 选 Google 并完成授权 | 认证窗口关闭；popup 可能已关；**出现「登录成功」系统通知** |
| 2 | **不要**再点 Sign in；直接再点扩展图标打开 popup | **已登录** UI：可见 Welcome / **Enable Learning Mode**，不是 Sign in 表单 |
| 3 | （可选）点击登录成功通知 | 尽量打开 popup；若平台不支持则至少步骤 2 仍成立 |
| 4 | （可选）Sign out 后再 Sign in，账号已有 Cognito SSO | **应再次出现** Hosted UI / Google 选择（Cognito 会话已清）；完成后仍为已登录 + 再次通知 |
| 5 | 登录中点 Hosted UI 取消 / 关闭 | 无成功通知；storage 无登录态；再次打开 popup 可 Sign in |

**失败判定（回归旧 bug）**：步骤 1 完成后步骤 2 仍显示 Sign in，必须再点一次 Sign in 才出现 Enable Learning → **本次未完成**。

### 4.3 回归

- [ ] 已登录下 Enable Learning Mode 仍可向 content script 发 `enxRun`
- [ ] Sign out 后 storage 清除，再次打开为未登录
- [ ] 翻译 / mark 等仍带 `Authorization: Bearer`（background 内存 token 与 storage 一致）

---

## 5. 相关文件索引（实现时改动）

| 文件 | 预期改动 |
| --- | --- |
| `src/background/background.ts` | 新增 `cognitoSignIn` handler；OAuth + getMe + 落盘 + 通知；`onClicked` |
| `src/components/Login.tsx` | 改为 `sendMessage`；去掉直接 `signInWithCognito` |
| `src/lib/cognito.ts` | 原则上不改行为；若 SW 需小调整可改 |
| `src/hooks/useInitializeStorage.ts` | 预期不改 |
| `src/lib/__tests__/cognito.test.ts` | 按需更新 mock |
| `README.md` | Sign-in 一节补：OAuth 在 background 完成；登录成功通知 |
| `docs/tasks/task-001-cognito-auth.md` | 可选：chrome 步骤表注明由 background 执行 |

---

## 6. 实施顺序（推荐）

```text
1. [x] 确认 ADR-001 采纳（状态 → Accepted）；本 Spec 纳入通知
2. [x] background 实现 cognitoSignIn（落盘 + 内存 token + 通知 + onClicked）
3. [x] Login.tsx 改为 sendMessage；去掉 popup 内 OAuth
4. [x] pnpm test && pnpm build；README 简短更新
5. [ ] 按 §4.2 手工验收（第一次 Google 后通知 + 重开 popup = 已登录）——需真实 Chrome + Cognito
6. [ ] 勾选 §4；文首状态 → Done — YYYY-MM-DD
```

### 实施笔记

- `pnpm test`：11 suites / 70 tests 通过（含 `cognito.test.ts`）。
- `pnpm build`：成功；`dist/assets/background.ts-*.js` 含 `cognitoSignIn` 与登录成功通知文案。
- 手工 §4.2 待作者在 unpacked `dist/` 上验证。

---

## 7. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 + ADR-001 为唯一需求来源；若发现必须改 Cognito 控制台 / redirect URI，先停下来更新 Spec，勿静默扩大范围。
2. **实现中**：先 background 落盘与通知，再改 popup；避免中间态「两边都能换 token」。
3. **实现后**：§4.2 手测通过前不得标 Done；将复现旧 bug 的步骤写进 PR / 提交说明的 Test plan。

---

## 8. 后续扩展（Out of Scope）

- Badge 提示登录成功。
- 登录进行中再次打开 popup 时显示「Signing in…」（`enx-auth-pending` flag）。
- Token refresh 统一收口到 background。
