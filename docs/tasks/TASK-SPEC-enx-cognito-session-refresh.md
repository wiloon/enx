# TASK-SPEC: enx Cognito Access Token 静默续期（消除误报的 "Session expired"）

| 字段 | 值 |
| --- | --- |
| **状态** | In Progress — 2026-07-31（自动化实现 + 单测已完成，手工真机验证待作者补充） |
| **类型** | SDD Task Spec（Spec 驱动实现；实现前以本文为准，实现后同步更新状态与验收清单） |
| **目标** | 用户已用 Google（或 email）登录 Cognito 后，`access_token` 过期（1 小时）不应强制用户重新登录：在 `enx-chrome` 与 `enx-ui` 的统一 API 请求出口处，收到 401 时先用已持有的 `refresh_token` 静默换新 `access_token` 并重试一次原请求，只有 refresh 本身也失败时才走现有"Session expired"流程 |
| **非目标** | 不引入 `aws-amplify` / `amazon-cognito-identity-js`，继续沿用仓库现有的手写 `fetch` 风格（见 [ADR-004](../architecture/adr-004-no-aws-amplify-hand-rolled-cognito.md)）；不做基于 `expires_in`/JWT 过期时间的**主动**预刷新（仅做 401 触发的**被动**刷新，见 §3.1 决策）；不改 Cognito App Client 的 `refresh_token` 有效期等 Cognito 控制台/基础设施配置；不改 `content.tsx` 里 `sessionExpired` 的展示逻辑（该逻辑保留作为 refresh 也失败时的最终兜底，本身没有 bug）；不清理 `enx-chrome/src/services/api.ts` 里未被引用的死代码 `ApiService`（见 §2.4，另起 Spec 处理） |
| **触发原因** | 用户反馈：Google 登录后正常查词一段时间，再次点词查词时突然报 "session expired"，被要求重新登录——但此时用户会话本不应过期。根因见 §2.3：`refreshCognitoTokens()` 早已实现且有单测，但从未在 `enx-chrome` / `enx-ui` 的实际请求路径里被调用过 |
| **关联背景** | [`docs/tasks/task-001-cognito-auth.md`](task-001-cognito-auth.md) 在 "In Scope — Client Changes / enx-chrome" 中列了 "Add token refresh logic"，从未实现；[`docs/tasks/TASK-SPEC-enx-chrome-oauth-background.md`](TASK-SPEC-enx-chrome-oauth-background.md) §8 后续扩展里记了"Token refresh 统一收口到 background"，本 Spec 是该扩展项的落地 |
| **关联 ADR** | [`docs/architecture/adr-004-no-aws-amplify-hand-rolled-cognito.md`](../architecture/adr-004-no-aws-amplify-hand-rolled-cognito.md)（评估并否决了引入 aws-amplify 的替代方案） |

---

## 1. 背景与动机

`enx` 用 **Cognito User Pool + Hosted UI**（OAuth2 授权码 + PKCE）做登录，Google 只是 Hosted UI 里的一个联邦登录选项。登录成功后，`enx-chrome` 把 `access_token` / `refresh_token` 存进 `chrome.storage.local`，`enx-ui` 存进 `localStorage`（经 jotai `atomWithStorage`）。

Cognito 签发的 `access_token`/`id_token` 默认 1 小时过期，但 `refresh_token` 有效期长得多（App Client 默认配置，通常以天/月计）。标准做法是：`access_token` 过期后，用尚未过期的 `refresh_token` 换一个新的 `access_token`，全程不需要用户重新走 Google 登录，也不依赖 Google 那边的登录态是否还在——因为面向 `enx-api` 的会话完全由 Cognito 自己的 token 体系管理。

当前代码里这条"续期"路径完全缺失：`access_token` 一过期，后端 `enx-api` 返回 401，`enx-chrome`/`enx-ui` 直接判定为"会话过期"，清空本地登录态并要求用户重新登录——即使 `refresh_token` 还完全有效。这就是用户遇到的误报。

---

## 2. 现状调查

### 2.1 `enx-chrome`：refresh 相关代码已存在但从未被调用

- `src/lib/cognito.ts:201-215` `refreshCognitoTokens(refreshToken)`：POST `${domain}/oauth2/token`（`grant_type=refresh_token`），实现完整，`src/lib/__tests__/cognito.test.ts` 对它和 `buildRefreshTokenBody()` 都有单测覆盖。
- 但 `grep -rn "refreshCognitoTokens" enx-chrome/src` 只命中定义和测试文件——**应用代码里没有任何调用点**。
- `src/background/background.ts:62-138` `makeApiRequest()` 是所有查词/标记生词请求的唯一出口（`handleGetOneWord`/`handleGetWords`/`handleMarkAcquainted` 都经它），401 时直接调用 `handleSessionExpiry()`（L26-59：清空 `chrome.storage.local` 里 `user`/`enx-user`/`accessToken`/`refreshToken`/`enx-session`，并向 content script 广播 `sessionExpired`）。
- **额外发现**：`loadSession()`（L13-23）只把 `accessToken` 读进 service worker 内存变量，**没有读 `refreshToken`**。即使只是想在 `makeApiRequest` 里"顺手"加一次 refresh 调用，当前也拿不到内存里的 refresh token（每次都得现读 `chrome.storage.local`），这个遗漏必须一并修（见 §3.2）。

### 2.2 `enx-ui`：连 refresh 函数本身都没有

- `src/lib/cognito.ts` 只有 `buildAuthorizeUrl` / `buildLogoutUrl` / `exchangeCodeForTokens` 等，**没有 `refreshCognitoTokens` 或等价函数**，需要新增（与 `enx-chrome` 版本逻辑一致，仅 config 来源不同：`process.env.NEXT_PUBLIC_COGNITO_*` vs `@/config/env`）。
- `src/services/api.ts` 的 `ApiService.makeRequest()`（L22-65）是所有 API 调用（`getMe`/`lookupWord`/`deleteWord`）的唯一出口，401 时直接 `throw new Error('Session expired')`。
- `refreshToken` 已经存在 `refreshTokenAtom`（`src/store/authAtoms.ts:9`，`localStorage` key `enx-refresh-token`），登录时由 `useAuth.ts` 的 `completeCognitoLogin()`（L32-56）写入——**token 本身已经在手边，只是没人用它去续期**。
- `useAuth.ts:82-100` `initializeSession()`：一旦 `apiService.getMe()` 抛错（含 401），直接 `clearAuth()`，同样是"一次失败即判死刑"。

### 2.3 根因总结

两端的 `refresh_token` 都已正确持久化，`enx-chrome` 甚至连 Cognito 侧的刷新函数都写好并测过了——**唯独在真正发起请求、拿到 401 的那个环节，没有人把两者接起来**。这不是"Cognito/Google 不支持续期"，而是纯粹的实现缺口。

### 2.4 顺带发现，明确不在本次范围内

`enx-chrome/src/services/api.ts` 里还有一个 `ApiService` class（含 `getMe`/`lookupWord`/`deleteWord`），`grep -rn "services/api" enx-chrome/src` 显示它**没有被任何地方 import**——真正生效的请求出口是 `background.ts` 里的 `makeApiRequest`（同 §2.1）。这份死代码本次不处理，避免在修 bug 的同时扩大改动面；如需清理请另开 Spec。

---

## 3. 目标设计

### 3.1 策略：401 触发的被动刷新 + 单次重试（不做主动过期预测）

| 选项 | 说明 | 结论 |
| --- | --- | --- |
| **B1. 被动刷新**：请求拿到 401 → 用 `refresh_token` 换新 token → 用新 token 重试原请求一次 → 仍失败才判会话过期 | 实现简单，不需要解析 JWT 或维护过期时间戳，两端逻辑一致；代价是过期后的**第一次**请求会多一次到 `enx-api` 的往返（拿 401）再加一次到 Cognito 的往返 | **本 Spec 采用** |
| B2. 主动预测：登录/刷新时记录 `Date.now() + expires_in*1000`，每次请求前检查是否临近过期，提前刷新 | 能省掉"先打一次 401"的往返，体验略好 | 需要额外维护过期时间戳字段、处理时钟偏移，超出"修 bug"所需的最小改动；列入 §9 后续扩展，不在本次做 |

两种策略互不冲突，B1 是 B2 的必要前提（B2 最终也要复用 B1 的"刷新+重试"逻辑和并发去重机制），先做 B1 已经能完全消除用户报告的问题。

### 3.2 `enx-chrome`：`background.ts` + `lib/cognito.ts`

**改动点 1 — `loadSession()` 补读 `refreshToken`**（修 §2.1 发现的遗漏）：

```ts
let accessToken = ''
let refreshToken = ''  // 新增

const loadSession = async () => {
  const result = await chrome.storage.local.get(['accessToken', 'refreshToken'])
  if (result.accessToken) accessToken = result.accessToken as string
  if (result.refreshToken) refreshToken = result.refreshToken as string
}
```

同时 `handleCognitoSignIn()`（L253-296）成功后、以及 `chrome.storage.onChanged` 监听器（L523-539）里，`refreshToken` 内存变量要和 `accessToken` 一样同步更新，避免两者不一致。

**改动点 2 — `makeApiRequest()` 401 时先尝试刷新、重试一次**：

```ts
let refreshInFlight: Promise<CognitoTokens> | null = null  // 并发请求去重，见 §3.4

const makeApiRequest = async (
  endpoint: string,
  options: RequestInit = {},
  isRetry = false  // 防止刷新后仍 401 造成无限重试
) => {
  // ...现有 fetch 逻辑不变...

  if (!response.ok) {
    if (response.status === 401) {
      if (!isRetry && refreshToken) {
        const refreshed = await tryRefreshTokens()  // 见 §3.4，失败返回 null
        if (refreshed) {
          return makeApiRequest(endpoint, options, true)  // 用新 accessToken 重试一次
        }
      }
      await handleSessionExpiry()
      throw new Error('Session expired')
    }
    // ...其余错误处理不变...
  }
}
```

`handleSessionExpiry()` 的调用时机不变（仍是"最终兜底"），只是现在只在**刷新也失败**（无 refresh token，或 Cognito 拒绝了 refresh token）时才会触发。

### 3.3 `enx-ui`：新增 `refreshCognitoTokens` + `ApiService` 接入

**`src/lib/cognito.ts` 新增**（与 `enx-chrome` 版本逻辑一致）：

```ts
export function buildRefreshTokenBody(
  config: Pick<CognitoConfig, 'clientId'>,
  refreshToken: string
): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'refresh_token',
    client_id: config.clientId,
    refresh_token: refreshToken,
  })
}

export async function refreshCognitoTokens(refreshToken: string): Promise<CognitoTokens> {
  const cfg = getConfig()
  const res = await fetch(`${cfg.domain}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: buildRefreshTokenBody(cfg, refreshToken),
  })
  if (!res.ok) throw new Error(`Token refresh failed: ${res.status}`)
  return res.json()
}
```

**`src/services/api.ts`**：`ApiService` 新增 `refreshToken` 字段（`setRefreshToken()`）和一个刷新成功后的回调 `onTokensRefreshed?: (tokens: CognitoTokens) => void`（由 `useAuth.ts` 在构造/初始化时注入，用于把新 token 写回 `accessTokenAtom`/`refreshTokenAtom`，保持 UI 状态与 `ApiService` 内部状态一致）。`makeRequest()` 401 分支按 §3.2 同样的"刷新一次、重试一次"模式改写。

**`useAuth.ts`**：`initializeSession()` 里 `apiService.getMe()` 失败不再直接 `clearAuth()`——因为刷新+重试已经内建在 `apiService.makeRequest()` 里，只有刷新也失败时 `getMe()` 才会真正抛错，此时 `clearAuth()` 才是正确行为，**这一层代码可以保持不变**，只是它现在触发的时机变了（真正没救了才触发）。

### 3.4 并发请求去重（两端都要做）

`enx-chrome` 一次查词经常并发发出多个请求（如 `getWords` 按 chunk 分批发送，见 `content.tsx` L390 起的 `sendChunkWithRetry`）。如果 access token 恰好在这个窗口过期，多个请求会**同时**收到 401，若各自独立调用 `refreshCognitoTokens`，会对 Cognito 发起多个并发 refresh 请求——多数 Cognito App Client 配置下这只是浪费一次网络往返，但若该 User Pool 开启了 refresh token 轮换（rotation），旧 refresh token 会在第一次成功刷新后失效，并发的第二个刷新请求会因为用了"已被替换"的 refresh token 而失败，进而误判会话过期。

用一个模块级"进行中的刷新 Promise"做去重：

```ts
const tryRefreshTokens = async (): Promise<boolean> => {
  if (!refreshToken) return false
  if (!refreshInFlight) {
    refreshInFlight = refreshCognitoTokens(refreshToken).finally(() => {
      refreshInFlight = null
    })
  }
  try {
    const tokens = await refreshInFlight
    accessToken = tokens.access_token
    if (tokens.refresh_token) refreshToken = tokens.refresh_token
    await chrome.storage.local.set({
      accessToken: tokens.access_token,
      refreshToken: refreshToken,
      'enx-session': { accessToken: tokens.access_token, refreshToken },
    })
    return true
  } catch {
    return false
  }
}
```

同一次"过期窗口"内的所有并发请求共享同一个 `refreshInFlight`，只真正打一次 Cognito，全部等它 resolve 后再各自重试。`enx-ui` 的 `ApiService` 做同样的单例内 in-flight 去重。

---

## 4. 验收标准

### 4.1 `enx-chrome`

- [x] 单测：`makeApiRequest` 遇到 401 → mock `refreshCognitoTokens` 成功 → 用新 token 重试原请求 → 最终返回成功结果，且**不**触发 `handleSessionExpiry`
- [x] 单测：401 → mock 刷新失败（如 refresh token 也过期）→ 走原有 `handleSessionExpiry` 流程，本地登录态被清空，content script 收到 `sessionExpired`
- [x] 单测：同一时刻两个请求都收到 401 → 只发起一次 `refreshCognitoTokens` 调用（断言 fetch/mock 调用次数）
- [x] `loadSession()` 单测：`chrome.storage.local` 里同时有 `accessToken`/`refreshToken` 时，两者都被读入内存
- [ ] **手工验证（未完成）**：登录后将 Cognito access token 有效期临时调短（或等待自然过期），继续查词，确认查词成功且**不再弹出** "session expired" 提示；仅在手动清空/使 refresh token 失效后才应看到该提示

### 4.2 `enx-ui`

- [x] 单测：`ApiService.makeRequest` 401 → 刷新成功 → 重试成功，`onTokensRefreshed` 回调被调用且携带新 token
- [x] 单测：刷新失败 → 原有"Session expired"报错行为不变，`useAuth.initializeSession()` 走到 `clearAuth()`（覆盖在 `ApiService` 层：刷新失败时 `makeRequest` 仍返回 `{success:false, error:'Session expired'}`，`initializeSession()` 的既有 `clearAuth()` 分支不变）
- [x] `refreshCognitoTokens`/`buildRefreshTokenBody` 新增单测（参照 `enx-chrome/src/lib/__tests__/cognito.test.ts` 的覆盖方式）
- [ ] **手工验证（未完成）**：与 §4.1 相同的场景，在 enx-ui 网页端复现

### 4.3 回归

- [x] `refresh_token` 本身已失效（如撤销授权、超过其最大有效期）时，两端仍应正确要求用户重新登录，不应无限重试或卡死（见"does not retry more than once"用例）
- [x] 现有 `pnpm test` 全量通过（`enx-chrome`：12 suites / 78 tests；`enx-ui`：3 suites / 23 tests），且 `pnpm build`（`tsc + vite build` / `next build`）均成功

---

## 5. 风险与约束

| 风险 | 缓解 |
| --- | --- |
| Cognito User Pool 若开启了 refresh token 轮换，未做并发去重会导致并发 401 场景下误判过期 | §3.4 用模块级 in-flight Promise 强制串行化刷新调用 |
| 刷新后仍 401（如刷新调用本身返回了一个已被后端拒绝的 token，或 `enx-api` JWT 校验有其他问题）导致无限重试 | `isRetry` 标志确保每个原始请求最多重试一次，重试后仍失败直接进入 session-expired 流程 |
| `enx-chrome` service worker 可能在两次请求之间被回收重启，内存里的 `refreshToken` 丢失 | 已由 `loadSession()`（改动点 1）在启动时从 `chrome.storage.local` 恢复；`tryRefreshTokens()` 内如发现内存 `refreshToken` 为空可先 `loadSession()` 兜底一次（参考现有 `handleMarkAcquainted` 里 accessToken 为空时的重载模式，L448-458） |
| 本次只做被动刷新（B1），过期后第一次请求仍有一次多余的 401 往返，极端网络下用户可能感知到轻微延迟 | 可接受；主动预刷新列入 §9，不阻塞本次上线 |

---

## 6. 相关文件索引

| 文件 | 说明 |
| --- | --- |
| `enx-chrome/src/background/background.ts` | `loadSession()` 补读 `refreshToken`；`makeApiRequest()` 新增 401 刷新重试逻辑；新增 `tryRefreshTokens()` + 模块级 `refreshInFlight` |
| `enx-chrome/src/lib/cognito.ts` | `refreshCognitoTokens()` 已存在，无需改动，仅被新增调用点引用 |
| `enx-chrome/src/lib/__tests__/cognito.test.ts` | 参考现有 refresh 相关 mock 写法 |
| `enx-chrome/src/background/__tests__/` | 新增/扩展 `makeApiRequest` 401 场景单测（若目录不存在需新建） |
| `enx-ui/src/lib/cognito.ts` | 新增 `refreshCognitoTokens()` / `buildRefreshTokenBody()` |
| `enx-ui/src/services/api.ts` | `ApiService` 新增 `refreshToken`/`onTokensRefreshed`，`makeRequest()` 接入刷新重试 |
| `enx-ui/src/hooks/useAuth.ts` | 注入 `onTokensRefreshed` 回调，保持 atoms 与 `ApiService` 内部 token 同步 |
| `enx-ui/src/store/authAtoms.ts` | 无需改结构，`refreshTokenAtom` 已存在，仅确认写入路径 |
| `enx-chrome/src/test/setup.ts` | 补充全局 `chrome` mock：`runtime.onInstalled`、`action.onClicked`、`notifications`、`storage.onChanged`（`background.ts` 顶层注册这些 listener，此前无单测 import 过该文件，mock 从未补全过） |
| `enx-chrome/src/background/__tests__/background.test.ts` | 新增，覆盖 §4.1 全部单测项 |
| `enx-ui/jest.config.js` | 新增 `moduleNameMapper`（`@/*` → `src/*`），修复 `@/lib/cognito` 运行时导入在 Jest 下无法解析的问题 |
| `enx-ui/src/services/__tests__/api.test.ts` | 新增，覆盖 §4.2 全部单测项 |

---

## 7. 实施顺序（建议）

```text
1. [x] enx-chrome: 修 loadSession() 遗漏（读 refreshToken），补单测
2. [x] enx-chrome: makeApiRequest() 接入 tryRefreshTokens() + 并发去重 + isRetry 重试一次，补单测
3. [x] enx-ui: cognito.ts 新增 refreshCognitoTokens()，补单测
4. [x] enx-ui: ApiService.makeRequest() 接入同样的刷新重试逻辑，useAuth.ts 接入 onTokensRefreshed，补单测
5. [x] 两端 pnpm test 全量通过（另需修复：`enx-ui/jest.config.js` 补 `@/*` moduleNameMapper——此前只有 `@/types` 这类纯类型导入未触发过运行时解析，`api.ts` 新增的 `refreshCognitoTokens` 运行时导入首次暴露了该配置缺口）
6. [ ] 手工验证 §4.1/§4.2 的真实过期场景（无法用单测完全替代，需要真实等待 token 过期或临时调短 App Client 有效期观察）——**待作者在真实 Chrome + Cognito 环境下完成**
7. [ ] 勾选 §4 全部验收项，文首状态更新为 Done — YYYY-MM-DD
```

---

## 8. SDD 工作方式（给 Agent / 开发者）

1. **实现前**：以本文 Spec 为唯一需求来源；§3.1 的"被动刷新而非主动预测"是明确决策，不要在实现时顺手加上主动过期检测（那是 §9 的范围）。
2. **实现中**：严格按 §7 分步提交，`enx-chrome` 与 `enx-ui` 改动分开提交；每步跑一次对应测试。
3. **实现后**：勾选 §4 验收清单；将文首**状态**更新为 `Done — YYYY-MM-DD`。

---

## 9. 后续扩展（Out of Scope，供未来 Spec 引用）

- §3.1 B2：基于 `expires_in` 的主动预刷新，减少过期后第一次请求的多余往返
- 清理 `enx-chrome/src/services/api.ts` 里未被引用的死代码 `ApiService`（§2.4）
- 若 Cognito 侧后续开启 refresh token 轮换，评估是否需要更细粒度的刷新失败重试/退避策略
