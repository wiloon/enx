# ADR-004: 暂不引入 aws-amplify，继续手写 Cognito OAuth / Token 客户端逻辑

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-07-31 |
| **日期** | 2026-07-31 |
| **关联 Spec** | [`docs/tasks/TASK-SPEC-enx-cognito-session-refresh.md`](../tasks/TASK-SPEC-enx-cognito-session-refresh.md) |
| **关联 ADR** | [`adr-001-chrome-oauth-in-background.md`](adr-001-chrome-oauth-in-background.md)（enx-chrome 的 `launchWebAuthFlow` + PKCE 流程现状） |
| **关联背景** | [`docs/tasks/task-001-cognito-auth.md`](../tasks/task-001-cognito-auth.md)（最初的 Cognito 集成决策，全程手写 `fetch`，未引入任何 Cognito SDK） |

---

## Context

在设计 "Cognito access token 静默续期"（修复用户已登录后查词仍误报 "session expired"）的方案时，评估了是否借这次机会把 `enx-chrome` / `enx-ui` 手写的 Cognito OAuth 客户端代码（PKCE、`/oauth2/authorize`、`/oauth2/token`、刷新、登出）替换成官方 `aws-amplify`（Auth 模块）或更底层的 `amazon-cognito-identity-js`，以减少自行维护这部分逻辑的长期成本。

**现状**：

- `enx-ui`（Next.js 网页）与 `enx-chrome`（MV3 浏览器扩展）都是 **Cognito User Pool + Hosted UI**（OAuth2 授权码 + PKCE），Google 只是 Hosted UI 里的一个联邦登录选项；`enx-api` 只是资源服务器，验证 JWT，不关心客户端怎么拿到的 token。
- 两端都是手写 `fetch` 直连 Cognito 端点（`src/lib/cognito.ts`），没有任何 Cognito/AWS SDK 依赖（`package.json` 里没有 `aws-amplify`/`amazon-cognito-identity-js`/`aws-sdk`）。
- `enx-chrome` 的登录流程是 `chrome.identity.launchWebAuthFlow`（打开独立认证窗口，拿到最终 redirect URL 字符串）+ background service worker 里手动做 PKCE 校验与 token 交换（详见 ADR-001）。
- Token 刷新逻辑（`refreshCognitoTokens`）在 `enx-chrome` 里已实现但从未接入请求路径，在 `enx-ui` 里完全缺失——这正是触发本次评估的 Spec 要修的问题。

**约束**：

- `enx-api` 不受影响，改动只发生在客户端。
- `enx-chrome` 是 Manifest V3 service worker：没有 `window`、没有 `localStorage`，登录必须走 `chrome.identity.launchWebAuthFlow`，且 SW 会被 Chrome 频繁回收重启。
- 两个 App Client（`enx-ui-client` / `enx-chrome-client`）已在同一 User Pool 下配置好，均为 PKCE、无 client secret（见 `task-001-cognito-auth.md`）。

---

## Options Considered

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. 两端都引入 `aws-amplify`（Auth 模块）** | 用 `signInWithRedirect()` / `fetchAuthSession()` / `signOut()` 接管登录、token 存储、自动刷新 | 官方维护，续期/多 tab 同步等能力开箱即用，减少自维护代码 | `enx-chrome` 存在架构性冲突（见 Rationale）；两端改动量大且不对称；新增依赖与 bundle 体积 |
| **B. 仅 `enx-ui` 引入 Amplify，`enx-chrome` 保持手写** | 网页端换成 Amplify，扩展端不动 | `enx-ui` 是标准浏览器环境，与 Amplify 的 `signInWithRedirect` 模型天然契合，改动可控 | 两端 Cognito 客户端实现方式彻底分裂（一套官方 SDK + 一套手写），维护心智负担不降反升；仍要保留、并新写 `enx-chrome` 的刷新逻辑，Amplify 带来的收益只覆盖一半代码 |
| **C. 两端都保持手写，仅补齐缺失的刷新逻辑** | 按当前 Spec，在 `enx-chrome`/`enx-ui` 现有请求出口加 401→refresh→重试一次，不引入新依赖 | 改动集中、可单测、风险低、两端实现方式保持一致；不引入依赖 | 需要继续手工维护这部分 OAuth/Token 逻辑（PKCE、刷新、登出全部手写） |
| **D. 引入更底层的 `amazon-cognito-identity-js`** | 只用其 `CognitoUserSession.refreshSession()` 等能力做 token 管理，登录流程仍自己写 | 比全量 Amplify 轻 | 该库面向 Cognito 原生 SRP 用户名密码认证设计，对 Hosted UI + OAuth 授权码 + Google 联邦这条路径没有直接支持，仍需自己实现 code 交换，收益有限 |

---

## Decision

**选择方案 C：暂不引入 `aws-amplify` 或任何 Cognito/AWS SDK，两端继续手写 OAuth / Token 客户端逻辑，仅在现有代码基础上补齐 401 触发的静默刷新（见关联 Spec）。**

---

## Rationale

1. **`enx-chrome` 与 Amplify 的 OAuth 模型存在架构性冲突，不是简单的工作量问题**：
   - Amplify 的 `signInWithRedirect()` 设计成接管整页 `window.location` 跳转，靠自己的内部监听器解析回调 URL；而 `enx-chrome` 用 `chrome.identity.launchWebAuthFlow` 打开隔离窗口、手动拿到 redirect URL 字符串，从未真正加载过回调页面。要用 Amplify 就得绕开它内置的重定向监听逻辑，自己截获 `code` 后设法注入给 Amplify 做 token 交换，但 Amplify 没有干净暴露这种"外部拿到 code，帮我换 token"的独立公共 API。
   - Amplify 默认 token 存储基于 `localStorage`/`window`，MV3 service worker 里两者都不存在，需要自己实现 `KeyValueStorageInterface` 适配器桥接 `chrome.storage`。
   - MV3 service worker 会被 Chrome 频繁回收重启，Amplify 内部依赖的自动刷新/事件监听机制能否在这种非常驻环境里可靠存活，目前没有把握——这恰恰是本次要解决的"续期可靠性"问题的核心场景，引入一个在此环境下未经验证的重量级依赖，风险与收益不成比例。

2. **方案 B（只做 `enx-ui`）不解决问题，反而增加割裂**：两端目前用的是同一套心智模型（PKCE + 手写 fetch），出了问题时可以对照着看、对照着改（本次 Spec 就是两端并行修的）。只迁移一端会让两个客户端的 Cognito 集成方式变成两套完全不同的实现，日后任何一端出问题，另一端的经验都不能直接复用，长期认知成本更高。

3. **方案 D 收益有限**：`amazon-cognito-identity-js` 主要面向 Cognito 原生 SRP 认证，Hosted UI + OAuth 授权码这条路径它并不直接覆盖，仍然需要自己写 code 交换，只是把"刷新"这一小块外包出去，性价比不高。

4. **本次要修的问题范围很小**：根因是"已经写好的 `refreshCognitoTokens()` 从未被调用"，是纯粹的实现缺口（见关联 Spec §2），补齐它只需要在两个请求出口各加几十行代码，不需要为此替换掉整套已经跑得好好的 OAuth 客户端实现。

---

## Consequences

### Positive

- 消除本次误报 "session expired" 的问题，改动面小、风险可控、当天可验证。
- 两端 Cognito 客户端实现方式保持一致，后续维护心智负担不上升。
- 不引入新依赖，`enx-chrome` 的 bundle 体积、`@crxjs/vite-plugin` 构建行为均不受影响。

### Negative

- 继续手工维护 PKCE、token 交换、刷新、登出这部分 OAuth 逻辑，未来 Cognito/OAuth 规范变化（如 PKCE 参数调整）需要自己跟进，而不是等 SDK 升级。
- 若未来需要支持更多联邦身份提供商，或需要更复杂的多标签页 token 同步等能力，手写方案的边际实现成本会比用现成 SDK 高。

### Mitigation

- 手写逻辑集中在 `src/lib/cognito.ts`（两端各一份），改动面清楚、已有单测覆盖，后续新增能力按同一模式扩展即可。
- 如果未来出现新的认证需求（如 §Revisit Trigger），届时可重新评估，不必现在预支这个成本。

---

## Revisit Trigger

- Chrome 对 `chrome.identity.launchWebAuthFlow` 或 MV3 service worker 生命周期发生影响现有登录流程的破坏性变更。
- Amplify（或其他官方 SDK）发布明确支持"外部拿到 authorization code 后接入其 token 管理"的公共 API，或推出官方的浏览器扩展适配方案，届时方案 A/B 的 Cons 中架构冲突部分不再成立。
- 需要接入更多联邦身份提供商，或需要更复杂的会话管理能力（如多标签页/多设备会话同步），手写方案的边际成本显著超过引入 SDK 的成本时。
