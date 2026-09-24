# ADR-036：国内版身份认证 —— 自托管 Logto（微信扫码 + 手机号），身份认证抽成可配置 seam

| 字段 | 值 |
|---|---|
| **状态** | Proposed |
| **日期** | 2026-09-24 |
| **决策者** | wiloon |
| **前提** | [`adr-035`](./adr-035-global-and-china-editions-dual-deployment.md)（海外版 / 国内版双部署）。本 ADR 只在 ADR-035 被接受后才有意义 |
| **修订** | [`adr-015`](./adr-015-cognito-to-clerk-auth-migration.md) **Rationale 第 7 点**（`users.clerk_user_id` 用 provider 命名的单列）—— 见本 ADR Decision 4。ADR-015 其余内容（海外版用 Clerk）不变 |
| **相关** | [`adr-020`](./adr-020-extension-sign-in-return-flow.md)（扩展登录回跳）、[`adr-019`](./adr-019-enx-ui-paste-text-reader-web-to-extension-enable.md)（网页 → 扩展通道） |

---

## Context

ADR-035 决定国内版独立部署、数据只在境内。国内版的登录需求：

- **微信扫码登录**（PC 网站）—— 大陆用户的主力身份。
- **手机号 + 短信验证码** —— 不用微信的用户需要一条退路，而且未来可能需要实名相关能力。
- 支付宝登录：可选。
- **不需要** Google / GitHub。

约束：

- 身份数据不能出境 → **Clerk 出局**（美国 SaaS；且 Clerk 没有微信登录，它的自定义 OAuth 要求 OIDC 兼容，而微信 OAuth 不是标准 OIDC —— 用 `appid` 而不是 `client_id`，返回 `openid` / `unionid`，要接只能自己写代理）。
- 扩展是核心使用场景（ADR-015 Rationale 2），国内版扩展要发到 Edge 商店，Edge 支持 `chrome.identity.launchWebAuthFlow`。
- 独立开发者，运维时间有限。
- 海外版继续用 Clerk，所以 enx-api / enx-ui / enx-chrome 必须**同时支持两种 IdP**，按部署选择。

## Options Considered

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| **A. Clerk + 自建微信桥** | enx-api 自己走微信 OAuth，再调 Clerk `sign_in_tokens` 签一次性 ticket | 不改前端、不改验签 | 数据出境（直接违反 ADR-035 Decision 2）；Clerk 在大陆的可访问性无保证；手机号短信也走 Clerk（境外） |
| **B. 自托管 Logto** | 部署在国内版服务器上；官方的微信（网站）/ 支付宝（网站）/ 阿里云短信等 connector | MPL-2.0 开源，自托管**无用户数上限、无功能开关、无 license key**；数据在自己的 Postgres；标准 OIDC / OAuth 2.1；有官方 `@logto/chrome-extension` SDK；本来就是 ADR-015 预留的迁出目标 | 要多运维一个服务 + 一个 PostgreSQL；登录走托管页跳转（不是内嵌组件）；没有 Clerk `syncHost` 那样现成的「网站登录 → 扩展自动登录」 |
| **C. Authing（国内 IDaaS SaaS）** | 用 Authing 公有云用户池 | 国内厂商，微信生态支持最全（PC 扫码、服务号、小程序扫码可拿手机号等）；免运维 | **免费版只能接 1 个社交登录**（B2C 8,000 MAU），要微信 + 短信得上基础版 ¥139/月起；又一次闭源供应商锁定；私有化部署只在企业版作为加购项；没有扩展 SDK（走通用 OIDC）；小厂商的长期存续风险 |
| **D. enx-api 自己当 IdP** | 自己接微信 OAuth + 短信 + 签发 session JWT | 零第三方依赖 | 就是 ADR-015 否决过的方案 B：session 签发 / 轮换 / 吊销 / JWKS / 短信防刷全部自己写，而且涉及安全 |

## Decision

### 1. 国内版用自托管 Logto

Logto 与国内版的 enx-api / enx-ui 部署在同一环境（境内），使用独立的 PostgreSQL。开启的登录方式：

- **微信（网站）connector** —— PC 扫码。需要微信开放平台企业资质认证 + 已备案域名（ADR-035 Decision 5）。
- **手机号 + 短信验证码** —— 阿里云短信或腾讯云短信 connector（需要短信签名和模板审核，同样挂企业主体）。
- 支付宝（网站）connector —— 暂不开启，按需再开。

### 2. 为什么选 Logto 而不是 Authing

1. **数据归属**：自托管意味着身份数据在自己的库里，隐私政策里不需要再加一个身份 sub-processor；Authing 是第三方处理者。
2. **成本曲线**：Logto 自托管没有 MAU 上限、不按用户数收费；Authing 免费版只能接 1 个社交登录，我们至少要微信 + 短信。
3. **不重复锁定**：ADR-015 已经把 Logto 定为「Clerk 变贵 / MAU 到量」时的迁出目标。国内版先用 Logto，等于**提前验证了那条退路**；将来海外版如果要迁，接口和运维经验都是现成的。
4. **扩展**：ADR-015 当时记录「Logto 无专用扩展 SDK」，**已经过时** —— 现在有官方的 `@logto/chrome-extension`（后台 service worker + `chrome.identity`）。
5. Authing 的独有优势（小程序扫码拿手机号、服务号生态）对一个 PC 阅读工具不是必需的。

### 3. 身份认证抽成一个 seam，IdP 按部署配置选择

- **enx-api**：`middleware/clerk_auth.go` 泛化为「验 OIDC / JWT」的 middleware，配置项是 issuer、JWKS URL、受众 / authorized party，以及「从哪个 claim 取 subject / email / name」。Clerk 和 Logto 都发 RS256 JWT + 公开 JWKS，验签路径（`keyfunc` + `golang-jwt`）不变，差异只在 claim 的校验与映射。Logto 用 API resource 签发的 access token，校验 `aud` = 该 resource indicator。
- **enx-ui**：`useAuth` / `ApiAuthBridge` / 登录页 / `middleware.ts` / root layout 的 provider 收拢到一个 auth adapter 后面，运行期按 `AUTH_PROVIDER=clerk|logto` 选择（和 ADR-031 的运行期配置一致；两个 SDK 同时打进包里，可以接受）。
- **enx-chrome**：同样收拢到一个 adapter，但按**构建期 target** 选择（`targets.ts` 里 `clerkPublishableKey` / `clerkSyncHost` 改为按 provider 区分的 auth 配置），国内版 target 只打包 Logto SDK。

### 4. `users` 表：一列、不带 provider 名

`clerk_user_id` 改名为 **`auth_subject`**（IdP 的 `sub`），依然是单列唯一索引，**不加 `auth_provider` 列**。

这是对 ADR-015 Rationale 7 的修订，但保留了它的核心判断：**每个部署只有一个 IdP**，所以 `(issuer, sub)` 里的 issuer 由部署决定，不需要存进每一行 —— 加 `auth_provider` 仍然是死列。改的只是名字：同一份 schema 现在要在 Clerk 和 Logto 两种部署下运行，provider 命名的列名在国内版里是错的。

同理：`ADMIN_CLERK_USER_IDS` → `ADMIN_AUTH_SUBJECTS`；`GetOrCreateByClerkUserID` → `GetOrCreateByAuthSubject`。海外版已有数据是纯列改名的 migration，值不变。

### 5. 首次开通不依赖邮箱

微信和手机号登录都**没有邮箱**。`GetOrCreateByClerkUserID` 已经允许 email 为空（此时用 `user-<sub 前 8 位>` 作为名字），这个行为要保留并有测试覆盖。凡是假设「用户一定有邮箱」的地方（通知、账单收据、法律页联系方式）在国内版要换成手机号或站内消息。

### 6. 扩展登录

国内版扩展走 `@logto/chrome-extension`：由后台 service worker 调 `launchWebAuthFlow` 打开 Logto 托管登录页。如果用户已经在国内版网站登录过、Logto 的会话 cookie 还在，这次授权**可能**会自动完成、不需要再扫码 —— **需要在 Chrome 和 Edge 上实测**，因为这决定了能否接近 Clerk `syncHost` 的体验。如果不行，退路是沿用 ADR-020 的「网页登录后回跳扩展」流程。

## Consequences

**好的**

- 国内版的身份数据完全在境内、在自己手里。
- 微信、手机号、支付宝都是 Logto 后台的 connector 开关，不用自己写 OAuth 代码。
- 身份认证变成可配置的 seam 以后，海外版将来要从 Clerk 迁走的成本也下降了。

**要接受的**

- **多一个有状态服务**：Logto + PostgreSQL（enx-api 仍然是 SQLite）。升级、备份、安全补丁都归自己。
- 国内版的登录是托管页跳转，没有 Clerk 内嵌组件那么顺滑；可以用 Logto 的品牌定制缓解。
- **短信有成本，也有被刷的风险**：短信轰炸、刷量会直接花钱。上线前必须有防刷手段（图形验证码 / 频率限制）。注意很多验证码服务（reCAPTCHA、Cloudflare Turnstile）在大陆不可用，要选大陆可用的方案。
- seam 改造会动三端约 40 个文件，而且同时影响海外版 —— 要按「先抽接口、行为不变，再加 Logto 实现」两步走，每一步都有测试护住。

## 需要在编码前验证

- [ ] Logto 自托管版是否支持在 access token 里加自定义 claim（`name` / `phone`）；如果不支持，enx-api 首次开通时改为调 userinfo。
- [ ] `@logto/chrome-extension` 在 **Edge** 上的 `launchWebAuthFlow` 行为，以及能否复用网站的会话（Decision 6）。
- [ ] 微信（网站）connector 取的是 `unionid` 还是 `openid`。只要以后可能接服务号 / 小程序，就必须用 `unionid`，否则同一个人会变成多个账号。
- [ ] Logto 登录页本身是否加载了大陆访问不到的外部资源（字体、CDN）。

## Revisit Triggers

- Logto 停止维护自托管版，或改变开源许可。
- 国内版需要 Authing 独有的微信生态能力（例如小程序扫码直接拿手机号）且这变成核心需求。
- 运维 Logto + PostgreSQL 的负担明显超出预期 → 重新评估 Authing（SaaS）。
