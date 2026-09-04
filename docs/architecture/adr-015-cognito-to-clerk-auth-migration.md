# ADR-015：身份认证从 AWS Cognito 切换到 Clerk（Google + GitHub 登录、网页/扩展会话同步、下线两端手写 OAuth 客户端与 Cognito OpenTofu 模块）

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-03（对话中收敛，待编码；产品未上线、真实用户 ≈ 0，**硬切**，无数据迁移、无过渡期双验签） |
| **日期** | 2026-09-03 |
| **关联 Spec** | 编码走 MATT domain-modeling/TDD，未单写编码期 TASK-SPEC；[`docs/tasks/TASK-SPEC-enx-clerk-production-cutover.md`](../tasks/TASK-SPEC-enx-clerk-production-cutover.md)（**上线前**切生产 Clerk 实例 + 域名 + 自建 OAuth 凭证的清单，不改代码）。本 ADR 定 provider 选型、改动边界、各组件改动形状 |
| **关联 ADR** | [`adr-004-no-aws-amplify-hand-rolled-cognito.md`](adr-004-no-aws-amplify-hand-rolled-cognito.md)（**其 Revisit Trigger #3 触发**：需要更多联邦 IdP + 网页/扩展会话同步，手写方案边际成本超过引入 SDK——本 ADR 是那条 trigger 的兑现，且这次引入的是 Clerk 而非 Amplify）、[`adr-001-chrome-oauth-in-background.md`](adr-001-chrome-oauth-in-background.md)（`launchWebAuthFlow` + background PKCE 交换流程被 `@clerk/chrome-extension` 取代）、[`adr-009-billing-stripe-subscription-and-ai-credits.md`](adr-009-billing-stripe-subscription-and-ai-credits.md)（计费/Stripe/积分全部键在本地 `users.Id`(UUID)，**不受本次切换影响**——见 Rationale 第 3 点）、[`adr-012`](adr-012-enx-ui-idiomatic-rephrasing.md) / [`adr-014`](adr-014-sidepanel-clicked-word-and-token-billing.md)（token 计费 handler 用 `GetUserIDFromContext`，取的是本地 UUID，不受影响） |
| **关联背景** | [`docs/tasks/task-001-cognito-auth.md`](../tasks/task-001-cognito-auth.md)、[`docs/tasks/task-001-cognito-infra.md`](../tasks/task-001-cognito-infra.md)（最初的 Cognito 集成与 OpenTofu 模块） |
| **关联配置** | `w10n-config`：`infra/aws/opentofu/enx/` 里的 Cognito 资源（User Pool、Hosted UI domain、Google IdP、两个 App Client）下线；k8s Secret `enx-cognito` 换成 `enx-clerk`（Clerk secret key + JWKS/issuer）。`w10n-config/enx/monetization*.md` 里的「Cognito 登录」相关描述同步。 |

---

## Context

### 触发原因

1. **Cognito Hosted UI 的 Google 登录体验差**。点「登录」后要先加载 Cognito Hosted UI 那个页面，再在上面点 Google，然后经 Cognito → Google → Cognito `/oauth2/idpresponse` → `redirect_uri` 一串纯服务端跳转，**这期间客户端完全没有反馈**（扩展里 popup 已失焦销毁、`isLoadingAtom` 只在内存里；网页是整页跳走）。首次登录感知延迟 2–4 秒的「死窗口」。已排查：**没有 Lambda 触发器**（task-001-cognito-infra 明确 out of scope），scope 已是最小 `openid email profile`，延迟主要来自 Hosted UI 页面 + 跳转链 + 缺客户端反馈——即使做满优化（`identity_provider=Google` 跳过 Hosted UI 页、客户端加 spinner、切 Managed Login），首次联邦登录仍有 ~1.5–2.5s 的不可消除地板。
2. **GitHub 登录是硬需求，Cognito 给不了**。Cognito 内置社交 IdP 只有 Google / Facebook / Amazon / Apple。GitHub 的 OAuth 是纯 OAuth2、不是 OIDC（无 `.well-known/openid-configuration`、无 ID token），无法直接作为 Cognito 的 generic OIDC provider，只能再写一个把 GitHub 包装成 OIDC 的 Lambda shim——别扭且是新的维护负担。
3. **ADR-004 的成本预支到期**。ADR-004（2026-07-31）当时选择「继续手写、暂不引入 SDK」，并在 Revisit Trigger #3 写明：「需要接入更多联邦身份提供商，或需要更复杂的会话管理能力（如多标签页/多设备会话同步），手写方案的边际成本显著超过引入 SDK 的成本时」——此刻两条都成立。

### 现状

- **enx-ui**（Next.js）+ **enx-chrome**（MV3）：Cognito User Pool + Hosted UI，OAuth2 授权码 + PKCE，两端各一份手写 `src/lib/cognito.ts`（`/oauth2/authorize`、`/oauth2/token`、刷新、登出），无任何 Cognito/AWS SDK 依赖。enx-chrome 走 `chrome.identity.launchWebAuthFlow` + background service worker 手动 PKCE 校验与 token 交换（ADR-001）。
- **enx-ui / enx-chrome 都没有自建邮箱/密码 UI**：`LoginForm.tsx` / 扩展 `Login.tsx` 只有一个「Sign in」按钮跳 Hosted UI；`forgot-password` / `verify-email` / `reset-password` 三个页面都是「handled by AWS Cognito」占位页。实践中用户只用 Google（`monetization.md`：「目前只有 Google 登录」）。
- **enx-api**：`middleware/CognitoAuth` 用 JWKS 验签（issuer / `token_use` / audience-`client_id` 白名单），从 claims 取 `sub` / `email` / `username`，`enx.GetOrCreateByCognitoSub(sub, email, username)` 自动开通本地用户并返回 **本地 `users.Id`（UUID）**，`c.Set("user_id", userID)`。`users` 表有唯一列 `cognito_sub`。
- **计费**：`stripe_customer` / `credit_accounts` / `subscriptions` / Stripe `client_reference_id` 全部键在 `user_id` = 本地 `users.Id`（UUID），**不直接引用 Cognito sub**。
- 部署：Cognito us-east-1，OpenTofu 管理（`w10n-config`），Hosted UI 用 `amazoncognito.com` 子域。**上线前，真实用户数 ≈ 0**。

---

## Options Considered

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| **A. 留在 Cognito，只做 UX 优化** | `identity_provider=Google` 跳过 Hosted UI 页 + 客户端持久化「登录中」spinner + 切 Managed Login 品牌化 + 弹窗式 OAuth（网页） | 改动小、无迁移、无供应商切换 | 首次联邦登录 ~1.5–2.5s 地板消不掉；**GitHub 仍然无解**（要写 OIDC shim Lambda） |
| **B. 甩掉 Cognito，自己直连 Google + enx-api 签 session** | 扩展 `chrome.identity.getAuthToken`（原生账号、零点击）/ 网页 Google Identity Services；enx-api 验 Google ID token 后签发自己的 session JWT | 扩展体验上限最高（零点击复用浏览器 Google 账号）；无供应商依赖，最贴合「手搓」 | enx-api 变成 IdP：要自己管 session 签发/轮换/吊销/JWKS；**GitHub 要再接一遍 OAuth**；邮箱密码要么放弃要么自建（哈希/验证/找回/限流）；`getAuthToken` 只 Chrome 系；会话安全责任 |
| **C. 切到 Clerk** | `@clerk/nextjs` + `@clerk/chrome-extension`，Google / GitHub 作为 social connection 开关；enx-api 改验 Clerk JWT | Google + GitHub 都是开关；**唯一有一等 MV3 扩展 SDK**；`syncHost` 让「网站登过→扩展免登」开箱即用；组件不跳慢页面；邮箱/密码/验证/找回免费版都有；10k MAU 免费 | 闭源 + 供应商依赖；MAU 计费天花板；免费版组件有「Secured by Clerk」小字；新增前端依赖 |
| **D. 切到 Logto（可自托管）** | Logto Cloud 或自托管到 homelab k8s；Google / GitHub 社交连接；标准 OIDC | 50k MAU 免费 / 自托管永久免费；MPL-2.0 全开源，OIDC 标准零锁定；契合 ADR-004「避免锁定」 | 无专用扩展 SDK（`launchWebAuthFlow` DIY）；登录仍是托管页跳转（快 + 可换主题，但非内嵌）；比 Clerk 多几天集成活 |

---

## Decision

**选择方案 C：把身份认证从 AWS Cognito 迁到 Clerk。** Google + GitHub 作为 social connections 开启；enx-ui 用 `@clerk/nextjs`、enx-chrome 用 `@clerk/chrome-extension`（配 `syncHost` 指向 Catseye 网站域名）；enx-api 的 `CognitoAuth` middleware 改为验 Clerk session JWT。下线两端手写的 `src/lib/cognito.ts` 与 `w10n-config` 的 Cognito OpenTofu 模块。

---

## Rationale

1. **一次解决两个问题**：Cognito 的 Google UX（不再跳慢页面）+ GitHub 登录（Cognito 结构上给不了，Clerk 是开关）。方案 A 解决不了第二个。
2. **扩展是核心 surface，Clerk 是唯一一等支持的**。`@clerk/chrome-extension` 原生支持 MV3、后台 service worker，`syncHost` 让「用户在 Catseye 网站登录 → 打开扩展直接是登录态、完全不弹登录」开箱即用。这正好对上「YouTube/X 引流 → 网站落地页 → 装扩展」的转化漏斗——大多数用户到扩展这步不用再登一次。
3. **改动面被 `users.Id`(UUID) 隔离**。计费、Stripe、积分账本、token 计费全部键在本地 UUID，不引用 Cognito sub。要动的只有 `users` 表的一列（`cognito_sub` → `clerk_user_id`）+ enx-api middleware 的验签目标 + `GetOrCreateByCognitoSub` → `GetOrCreateByClerkUserId`。**Stripe/billing 一行不用改。**
4. **现在切换几乎零成本，且是硬切**。产品未上线、真实用户 ≈ 0，没有数据迁移，也没有自建邮箱/密码代码要搬（Cognito 那部分本来就是占位页）。直接换验签、清测试数据即可。等上线后再换就是一场带边界情况（改邮箱、多 Google 账号、过渡期双验签）的真实迁移——ADR-004「届时重新评估，不必现在预支成本」的判断到期兑现，现在正是最便宜的窗口。
5. **比方案 B（自己直连）少写一大块**：session 签发/刷新/吊销/JWKS 管理、邮箱密码体系、GitHub OAuth 第二遍——这些 Clerk 全包。enx-api 回到「只验 JWT 的资源服务器」这个它一直擅长的角色。
6. **比方案 D（Logto）**：扩展体验 + Next.js DX 明显更好，能立刻兑现本次的核心诉求。Logto 的省钱/不锁定优势在用户量小时还用不上；真到那个量级，Clerk 也提供标准 JWT + headless API + 用户导出，二次迁到 Logto/自建不是死路（保留为 Revisit）。
7. **`users` 表用 provider 命名的单列 `clerk_user_id`，不做通用 `external_auth_id` + `auth_provider`**。从 enx-api 看只有一个 IdP——Google / GitHub / 邮箱密码全在 Clerk 内部，enx-api 面对的是单一 issuer、单一 `sub` 命名空间（`user_xxx`）；「支持多种登录方式」是 Clerk 的职责，不该泄漏进库结构。`auth_provider` 会是每行都等于 `'clerk'` 的死列。迁出成本也不因它降低：真到「迁 Logto / 自建」那天是一场带 identity 重映射的迁移，无论有没有这列都要写脚本；届时加一列并把存量行默认 `'clerk'` 是分钟级 migration。形状上也与历史（`cognito_sub`，同为 provider 命名的单列）对称，本次 schema 改动收敛为「列改名 + backfill 逻辑替换」。
8. **enx-api 按 Clerk session token 的 `sub`（= Clerk user id `user_xxx`）键本地用户，每请求 `GetOrCreateByClerkUserId`——不用 `external_id` claim**。这是 Clerk 官方后端 pattern（[manual JWT verification](https://clerk.com/docs/guides/sessions/manual-jwt-verification)：验 RS256 签名 + JWKS、查 `exp`/`nbf`、校 `azp`，用 `sub` 认人）。Clerk 的 `external_id` 是给「从旧系统迁入 Clerk 时携带旧 id 便于对账」用的**反方向**字段；本次是硬切、无旧用户、无旧 id，`external_id` 无用武之地。若走 ADR 初稿设想的「把本地 `users.Id` 塞进 `external_id`」，得先开通本地用户 → 调 Clerk Backend API 回写该用户 `external_id` → 后续 token 才带上，另加一条首次登录（token 还没有 `external_id`）的 fallback 分支——纯成本、在 ≈0 用户规模下零收益。首次开通所需的邮箱/用户名走上面 Clerk 控制台加的两个自定义 claim。JWT 验签沿用现有 `keyfunc` + `golang-jwt` 手写路径（与 `cognito_auth.go` 同构、已有测试覆盖），不引入 `clerk-sdk-go`。

---

## Consequences

### Positive

- Google + GitHub 都是后台开关；首次登录不再跳 Cognito Hosted UI 慢页面。
- 网页 ↔ 扩展 session 自动同步（`syncHost`），用户少登一次。
- 删掉两端手写 `src/lib/cognito.ts`（PKCE、`/oauth2/*`、刷新、登出）+ enx-chrome background 的手动 token 交换逻辑，换成 Clerk SDK。
- 删掉 `w10n-config` 里 Cognito 的 OpenTofu 模块（User Pool、Hosted UI domain、Google IdP、两个 App Client）+ k8s `enx-cognito` secret + Google Cloud Console 那个专给 Cognito 用的 OAuth client。
- 邮箱/密码、邮件验证、找回密码由 Clerk 接管（免费版都有），三个占位页可删或改成 Clerk 的对应路由。
- enx-api `CognitoAuth` middleware 简化为「验 Clerk JWT（JWKS + issuer + `azp` 检查）」。

### Negative

- **供应商依赖 + 闭源**。Clerk 停服或大幅涨价是尾部风险。
- **MAU 计费天花板**：10k MAU 免费，之后 Pro $25/月（含前 10k）+ $0.02/额外 MAU。是这份名单里成本上限最高的。
- 免费版 Clerk 组件带「Secured by Clerk」小字（Pro 去掉）。
- `users` 表：`cognito_sub` 列改成 `clerk_user_id`（provider 命名的单列，不引入通用 `external_auth_id` + `auth_provider`——理由见 Rationale 第 7 点）。因为未上线、无真实用户，不需要迁移已有行——直接改列、清掉测试数据即可。
- 新增前端依赖 + bundle 体积（`@clerk/nextjs`、`@clerk/chrome-extension`）；扩展 CSP / `web_accessible_resources` 可能要调。
- Clerk 的生产实例需要一个 Clerk 用的域名（`clerk.catseye.xxx` 之类，CNAME 到 Clerk）——比 `amazoncognito.com` 子域多一步 DNS 配置。

### Mitigation

- **硬切，不做过渡期双验签**：产品未上线、真实用户 ≈ 0，enx-api middleware 直接从「验 Cognito JWT」换成「验 Clerk JWT」，一次切干净，不需要 feature flag 同时接受两种 token，也不需要用户数据迁移脚本。homelab / 测试账号在 Clerk 里重新登录一次即可（`GetOrCreate` 会自动开通本地用户）。参考 commit `98c884b`（域名硬切）的做法。
- **退出路径**：Clerk 发标准 JWT（可验 JWKS）+ 提供用户导出 API；方案 D（Logto，OIDC 标准）的评估保留，作为「MAU 到量 / Clerk 变贵」时的迁出目标。
- **成本监控**：把 Clerk MAU 计入上线后要盯的指标（同 `monetization-tasks.md` 的成本项）。

---

## 实现范围概览（细节留给编码期 Spec）

| 组件 | 改动 |
| --- | --- |
| **Clerk 控制台** | 建 application；开 Google + GitHub social connections；生产实例填自己的 Google OAuth client、GitHub OAuth app 凭证；**Customize session token 里加 `email`（`{{user.primary_email_address}}`）+ `name`（`{{user.full_name}}`）两个自定义 claim**（供 enx-api 首次开通用户时取邮箱/名，parity 于现在从 Cognito token 读 `email`/`username`）；设 `azp` 允许的 origin 列表（enx-ui 域名 + 扩展 id）；配 `clerk.catseye.xxx` 域名。**不配 `external_id`**——见 Rationale 第 8 点 |
| **enx-ui** | 装 `@clerk/nextjs`；`<ClerkProvider>` 包 layout；`LoginForm` → `<SignIn />`；`useAuth` 改用 Clerk hooks；`ApiService` 的 token 取 `getToken()`；删 `src/lib/cognito.ts`、`/auth/callback`、三个 password 占位页 |
| **enx-chrome** | 装 `@clerk/chrome-extension`；`<ClerkProvider syncHost="https://catseye.xxx">`；`Login.tsx` 用 Clerk 组件/hooks；background 用 Clerk 的 SW 支持取 token；删 `src/lib/cognito.ts` + 手写 PKCE/交换；`manifest.json` 的 `host_permissions` / CSP 按 Clerk 文档调 |
| **enx-api** | `middleware/cognito_auth.go` → `clerk_auth.go`：验 Clerk JWKS + issuer + `azp`（直接替换，不保留 Cognito 分支）；`enx.GetOrCreateByCognitoSub` → `GetOrCreateByClerkUserId`（按 token `sub` 键，邮箱/名取自定义 claim，见 Rationale 第 8 点）；`users` 表把 `cognito_sub` 列改成 `clerk_user_id`（单列，见 Rationale 第 7 点）；`GetUserIDFromContext` 不变（仍返回本地 UUID） |
| **w10n-config** | 下线 Cognito OpenTofu 资源；`enx-cognito` secret → `enx-clerk`（secret key、JWKS URL、issuer、authorized party）；k8s deployment env 同步；`monetization*.md` 描述更新 |
| **数据** | 未上线、无真实用户，**不做数据迁移**——清掉 `users` 表里的测试行，homelab/测试账号在 Clerk 重新登录即可 |

---

## Clerk 免费额度（用户问，以 [clerk.com/pricing](https://clerk.com/pricing) 为准，可能调整）

**Free 计划（永久免费，非试用）**：

- **10,000 月活用户（MAU）**；MAU = 当月至少登录/活跃一次的用户，不回来的月份不计。
- **100 月活组织（MAO）**（用到 B2B/组织功能时；Catseye 目前用不到）。
- 全部核心认证能力：social connections（Google / GitHub / …，数量不限）、邮箱+密码、邮箱 OTP、magic link、MFA（TOTP / SMS / 备份码）、用户资料管理、预制组件（`<SignIn />` / `<UserButton />` 等）、**Chrome Extension SDK**、session 管理、多设备/多标签会话。
- 限制：组件上有「Secured by Clerk」小字；无 SLA；部分企业能力（SAML、企业 SSO、自定义 session token 生命周期等）在付费的 Enhanced Authentication 加购项里。

**超出后**：

- **Pro $25/月**（含前 10,000 MAU）+ **$0.02 / 每个额外 MAU**。去掉「Secured by Clerk」品牌、自定义域名、allowlist/blocklist 等。
- 加购项（按需）：Enhanced Authentication +$100/月（SAML、自定义 session token 等）、Enhanced B2B SaaS +$100/月。

**对 Catseye 的意味**：上线 + 推广初期完全在免费额度内。真正开始付费是 MAU 破 1 万之后——那时候产品已经有付费信号，$25/月 + 按量对已验证的业务不是负担；若不想要这个天花板，届时按 Revisit 切 Logto 自托管。

---

## Revisit Triggers

- **MAU 接近 10,000 / Clerk 账单变得显著** → 评估切 Logto（自托管，50k 免费，OIDC 标准，方案 D 已过一遍）或自建（方案 B）。
- Clerk 的 Chrome Extension SDK 在未来 Chrome MV3 变更下不再可靠，或 Clerk 弃维该 SDK。
- 需要 Clerk 不支持、或只在高价加购项里的能力，且该能力对 Catseye 变成核心（企业 SSO、SCIM 等——消费级阅读工具短期内不太可能）。
- Clerk 出现停服/安全事件/重大定价变动。
