# ADR-036：国内版身份认证 —— 自托管 Logto，第一版只做微信扫码登录；身份认证抽成按部署配置的 seam

| 字段 | 值 |
|---|---|
| **状态** | Accepted（2026-11-19） |
| **日期** | 2026-09-24 起草；2026-11-19 修订并接受 |
| **决策者** | wiloon |
| **前提** | [`adr-035`](./adr-035-global-and-china-editions-dual-deployment.md)（海外版 / 国内版双部署，版本差异只允许以部署配置存在） |
| **修订** | [`adr-015`](./adr-015-cognito-to-clerk-auth-migration.md) **Rationale 第 7 点**（`users.clerk_user_id` 用 provider 命名的单列）—— 见 Decision 5；ADR-015 **2026-10-20 补充第 3 点**（新用户开通要求邮箱）—— 只对国内版，见 Decision 6；[`adr-062`](./adr-062-account-deletion-and-disable.md) **Decision 3**（试用发放记录只按邮箱）—— 只对国内版，见 Decision 7；ADR-062 **Decision 2 的自助注销确认方式**（输入邮箱）—— **两个版本**都改为输入 `DELETE`，见 Decision 8。两份 ADR 的其余内容不变 |
| **相关** | [`adr-020`](./adr-020-extension-sign-in-return-flow.md)（扩展登录回跳）、[`adr-048`](./adr-048-free-trial-ai-credits.md)（试用积分）、[`adr-051`](./adr-051-referral-credits.md)（邀请积分）、#1023（可选绑定手机号） |

---

## Context

ADR-035 决定国内版独立部署、数据只在境内，版本之间的差异只能是部署配置，不 fork 代码。国内版要解决「用户怎么登录」：

- 大陆用户的主力身份是微信。Google 打不开，GitHub 不稳定，海外版的 Clerk（Google / GitHub）用不了。
- 身份数据不能出境 → **Clerk 出局**：它是美国 SaaS；它也没有微信登录，自定义 OAuth 要求 OIDC 兼容，而微信 OAuth 不是标准 OIDC（用 `appid` 而不是 `client_id`，返回 `openid` / `unionid`）。
- 扩展是核心使用场景（ADR-015 Rationale 2），国内版扩展发到 Edge 商店，Edge 支持 `chrome.identity.launchWebAuthFlow`。
- 独立开发者，运维时间有限。
- 海外版继续用 Clerk，enx-api / enx-ui / enx-chrome 必须**同时支持两种 IdP**，按部署选择。

2026-09-24 的初稿计划「微信扫码 + 手机号短信」，后来又加了「微信登录后强制绑定手机号」。2026-11-19 重新调研后改为**第一版只做微信扫码，不收集手机号**，理由见 Decision 2。

### 微信扫码登录的四种做法（2026-11 调研）

| 做法 | 主体 | 费用 | 体验 | 谁在用 |
|---|---|---|---|---|
| **开放平台「网站应用」** | 企业（开发者资质认证 + 已 ICP 备案的域名） | 认证约 300 元/年 | 网页直接出二维码，扫码确认，最顺 | 有公司的产品 |
| 公众号扫码关注登录 | 企业（已认证服务号） | 约 300 元/年 | 要先关注公众号 | 想顺便涨粉的产品 |
| 小程序扫码登录 | 个人也可以 | 免费 | 扫小程序码，网页轮询结果 | 个人开发者，为了省认证费 |
| 第三方桥接服务 | 无 | 免费或低价 | 依赖别人的服务，停服难迁移 | 个人小站 |

国内版有企业主体、要正式收费 → 用**开放平台网站应用**。小程序和桥接方案主要是给拿不到企业资质的个人用的，有资料明确说不适合合规要求高的商业场景。

## Options Considered

### IdP

| 方案 | 做法 | 优点 | 缺点 |
|---|---|---|---|
| A. Clerk + 自建微信桥 | enx-api 自己走微信 OAuth，再调 Clerk `sign_in_tokens` 签一次性 ticket | 不改前端、不改验签 | 数据出境（违反 ADR-035）；Clerk 在大陆的可访问性无保证 |
| **B. 自托管 Logto** | 部署在国内版服务器上，用官方微信（网站）connector | MPL-2.0 开源，自托管无用户数上限；数据在自己的 PostgreSQL；标准 OIDC / OAuth 2.1；官方 `@logto/chrome-extension` SDK；本来就是 ADR-015 预留的迁出目标 | 多运维一个服务 + 一个 PostgreSQL；登录走托管页跳转；没有 Clerk `syncHost` 那样现成的「网站登录 → 扩展自动登录」；**没有 headless API**，做不了小程序一键登录 |
| C. 自托管 Casdoor | Casbin 团队的开源 IdP，Go，Apache-2.0 | 和 enx-api 同为 Go；数据库可选 SQLite / MySQL / PostgreSQL，运维更轻；内置微信和国内短信 | 没有扩展 SDK，要自己写 OIDC + PKCE；国内资料多是**企业微信**而不是个人微信扫码；有过微信接口改版后没跟上、用户名变成随机串的反馈；OIDC 细节和文档弱于 Logto |
| D. Logto Cloud / Casdoor Cloud | 厂商托管 | 免运维 | Logto Cloud 只有欧、美、澳、日机房，**没有大陆**；数据出境；备案域名不能 CNAME 到境外服务；大陆访问不稳 |
| E. Authing（国内 IDaaS SaaS） | 用 Authing 公有云用户池 | 数据在境内；微信生态支持最全（含小程序扫码拿手机号）；免运维 | 免费版只能接 1 个社交登录，多种登录方式要上基础版（约 ¥139/月起）；闭源，又一次供应商锁定；没有扩展 SDK |
| F. enx-api 自己当 IdP | 自己接微信 OAuth + 签发 session JWT | 零第三方依赖 | 就是 ADR-015 否决过的方案 B：session 签发 / 轮换 / 吊销 / JWKS 全部自己写，涉及安全 |

### 要不要手机号

| 方案 | 说明 |
|---|---|
| a. 微信登录后强制绑定手机号（短信） | 2026-09 的计划。要短信签名和模板审核、短信费，还要防短信轰炸和刷试用（国内可用的验证码方案和 Logto 的集成未知） |
| b. 小程序授权手机号 | 不发短信，但要认证小程序、每次约 0.03 元，而且 Logto 没有 headless API，对接不顺 |
| **c. 不收集手机号** | 只要微信登录。见 Decision 2 |

网站应用的微信登录**拿不到手机号**，只有小程序能拿，所以「要手机号」只能走 a 或 b。

## Decision

### 1. 国内版用自托管 Logto

Logto 与国内版的 enx-api / enx-ui 部署在同一个境内环境，使用独立的 PostgreSQL。登录方式只开**微信（网站）connector**（PC 扫码）。它需要微信开放平台的企业开发者资质认证，以及已 ICP 备案的域名（ADR-035）。

选 Logto 而不选其他方案：

1. **数据归属**：自托管，身份数据在自己的库里，隐私政策不用再加一个身份 sub-processor。D、E 都是第三方处理者，D 还出境。
2. **扩展**：扩展是核心场景，Logto 有官方 `@logto/chrome-extension`（后台 service worker + `chrome.identity`）；Casdoor 和 Authing 都要自己写。
3. **不重复锁定**：ADR-015 已经把 Logto 定为「Clerk 变贵 / MAU 到量」时海外版的迁出目标。国内版先用，等于提前验证这条退路。
4. **成本曲线**：自托管不按用户数收费。Authing 要多种登录方式就得付费。
5. Casdoor 运维更轻（SQLite、Go），但它的个人微信扫码缺少实际使用反馈，扩展登录要自己写；这两项的风险比多维护一个 PostgreSQL 大。

### 2. 第一版只做微信扫码登录，不收集手机号、不发短信

- **实名条款大概率不适用**：《网络安全法》第 24 条和网信办《互联网用户账号信息管理规定》（2022）第 9 条要求实名的，是提供「信息发布、即时通讯等服务」的平台。ENX 是阅读、查词和 AI 释义工具，用户不能公开发布内容，也没有即时通讯；反馈只发给管理员。
- **强制收集反而有风险**：工信部和网信办要求个人信息收集遵循「必要」原则，用户拒绝提供非必需信息时不能影响基本功能。网信办 2026-04 的通报里有 App 因为「收集与服务无关的个人信息」被点名。
- 其他 App 在微信登录后要求绑定手机号，多数出于业务原因：有发布功能要实名、怕第三方登录断掉、合并多种第三方登录的账号、营销。对 ENX 只有「怕微信登录断掉」成立，由 #1023 的**可选**绑定手机号解决。
- 不发短信，省掉了短信签名和模板审核、短信费，以及最难的一项：短信防刷。

法规里的「等」字让边界不算绝对清楚，上线前向备案初审员或通管局口头确认一次。

### 3. 身份认证是一个 seam，IdP 由部署配置选择

遵循 ADR-035 第 1、3、4 条：两个版本跑同一份代码，差异只在部署配置。**业务规则不知道用户是用哪个 IdP 登录的**：生词本、配额、积分、试用、注销都只认本地用户身份，IdP 的差异只在 adapter 里。

- **enx-api 验证 JWT**：`middleware/clerk_auth.go` 泛化为「验 OIDC / JWT」的 middleware，按部署配置 issuer、JWKS URL、受众、authorized party 及其 claim，以及 subject 和资料的 claim 映射。Clerk 和 Logto 都发签名 JWT + 公开 JWKS，沿用 `keyfunc` + `golang-jwt` 验签。允许的签名算法由配置通过 `jwt.WithValidMethods` 限定：海外版 RS256，国内版 ES384（#1026 原型实测）。Logto 沿用原有密钥类型（所有者 2026-11-19 决定）。Logto 用 API resource 签发的 access token，校验 `aud` = 该 resource indicator。
- **enx-api 管理外部认证身份**：沿用 ADR-062 的账号管理接口并去掉接口名中的 provider。注销时删除外部认证身份，禁用和解除禁用时同步外部账号状态，撤销会话时让该用户的外部会话下线（ADR-062 Decision 5）。海外版沿用 Clerk Backend API。接入 Logto 时，adapter 用 Logto Management API 提供对应的删除、暂停、恢复和退出会话能力。
- **enx-ui**：`useAuth`、`ApiAuthBridge`、登录和注册页、`proxy.ts` 的认证处理以及 root layout 的 provider 统一通过 `src/auth/` 中的 auth adapter。服务端按运行期的 `AUTH_PROVIDER=clerk|logto` 选择 adapter（ADR-031），由 root layout 渲染所选 provider，客户端通过统一的 auth context 使用它。每个部署只配置一个 IdP，两个 SDK 可以同时打进包里。
  - `AUTH_PROVIDER` 未设置时默认选 Clerk。显式设置时必须精确匹配已实现的 provider，包括大小写。空值、纯空白、未知值以及尚未实现的 provider（#1028 阶段的 `logto`）使 standalone 进程在启动 Next.js 前以非零状态退出，错误信息指出 `AUTH_PROVIDER`。
- **enx-chrome**：同样收拢到一个 adapter，但按**构建期 target** 选择（`targets.ts` 里的 `clerkPublishableKey` / `clerkSyncHost` 改为按 provider 区分的 auth 配置），国内版 target 只打包 Logto SDK。
- **改造顺序**：先抽接口、海外版行为不变，单独合并上线；再加 Logto 实现。每一步都由测试护住。

### 4. 用 `unionid` 识别微信用户

Logto 的微信 connector 有 `unionid` 时用它作为社交身份 ID，没有才退回 `openid`（connector 源码）。网站应用本来就挂在开放平台账号下，正常都会返回 `unionid`。以后接公众号或小程序时，同一个人还是同一个 `unionid`，不会变成多个账号。上线前用真实 AppID 确认一次。

### 5. `users` 表：一列、不带 provider 名

`clerk_user_id` 改名为 **`auth_subject`**（IdP 的 `sub`），仍然是单列唯一索引，**不加 `auth_provider` 列**。

这是对 ADR-015 Rationale 7 的修订，但保留了它的核心判断：**每个部署只有一个 IdP**，所以 `(issuer, sub)` 里的 issuer 由部署决定，不用存进每一行，加 `auth_provider` 仍然是死列。改的只是名字：同一份 schema 要在 Clerk 和 Logto 两种部署下运行，provider 命名的列名在国内版里是错的。

同理：`ADMIN_CLERK_USER_IDS` → `ADMIN_AUTH_SUBJECTS`，`GetOrCreateByClerkUserID` → `GetOrCreateByAuthSubject`。海外版已有数据只改列名和对应的唯一索引名，值不变。应用启动时在 AutoMigrate 前完成事务迁移，失败则停止启动。

### 6. 国内版用户没有邮箱

微信登录**没有邮箱，也没有手机号**。

- 首次开通：海外版沿用 ADR-015 2026-10-20 补充第 3 点。新用户缺少邮箱时返回 `403 email_required`，已有用户可继续登录。#1027 保留这一规则。接入 Logto 时，国内版才允许空邮箱开通，名字取配置指定的昵称 claim，缺省时用 `user-<sub 前 8 位>`，并覆盖这两条开通路径的测试。Decision 7 实现前，现有新用户钩子遇到空邮箱时不发试用积分。
- 凡是假设「用户一定有邮箱」的地方（通知、账单收据、退款通知、法律页联系方式）在国内版改为站内消息，或者不发。具体随国内版收款 ADR 一起定。

### 7. 国内版的试用发放记录按微信 `unionid` 记

ADR-062 Decision 3 按邮箱 HMAC 记录试用发放，保证一个邮箱只领一次试用；邮箱为空时不发试用（fail closed）。国内版没有邮箱，照搬就是**国内版用户永远领不到试用**。

- 国内版改用 **`unionid` 的 HMAC** 作为试用发放记录的键，HMAC 方法和密钥规则与 ADR-062 相同。
- enx-api 从 access token 里取 `unionid`：用 Logto 的自定义 JWT claim 把微信社交身份的 ID 带出来（开源版支持自定义 JWT，2025 年起）。不额外调用 Logto API。
- 场景：用户注销后用同一个微信重新登录。Logto 里是一个新用户（新的 `sub`），但 `unionid` 不变 → 命中记录，不发试用；认领邀请码时双方都不发奖励（ADR-051 / ADR-062 的规则照旧）。
- 记录的键在代码里叫「试用身份键」，按版本取：海外版 = 邮箱，国内版 = `unionid`。表的列名在实现时去掉 `email` 字样。
- 刷试用的成本从「换一个邮箱」变为「换一个微信号」。

### 8. 自助注销统一输入 `DELETE` 确认（两个版本）

ADR-062 要求用户在 `/settings` 输入自己的邮箱来确认注销，enx-api 的 `account.Service.DeleteOwn` 在服务端比对邮箱。国内版没有邮箱，这一步做不了。

所有者 2026-11-19 决定**两个版本统一**：用户输入大写英文 **`DELETE`** 来确认，不再输入邮箱。

- 确认词由 enx-api 在服务端校验，大小写敏感、去掉首尾空格后必须等于 `DELETE`；不匹配（含请求体读不出）时返回 400、不删任何数据，和现在邮箱不匹配时一样，但错误码改为 `confirmation_mismatch`，提示语不再提邮箱。只在前端校验不够，接口可能被直接调用。enx-ui 的按钮按同一规则（去掉首尾空格后严格等于 `DELETE`）启用。
- `DELETE /api/me` 的请求体从 `{"email": …}` 改为 `{"confirmation": "DELETE"}`，不再接受 `email` 字段；enx-ui `/settings` 同步改。
- 确认文案的其余要求不变：作废积分、注销本身不退款、重新注册不再有试用和邀请奖励。其中「同一邮箱」在国内版写成「同一微信」。
- 这一条对海外版也是改动，不依赖国内版的其他工作，可以先做。

### 9. 扩展登录

国内版扩展用 `@logto/chrome-extension`：由后台 service worker 调 `launchWebAuthFlow` 打开 Logto 托管登录页。如果用户已经在国内版网站登录过、Logto 的会话 cookie 还在，这次授权会自动完成、不用再扫码：#1026 原型在 Chrome 和 Edge 上实测，`interactive: false` + `prompt=none` 的静默登录都直接拿到了 token，接近海外版「会话同步」的体验。用户从没在网站登录过时，扩展打开 Logto 登录页让用户扫码；ADR-020「网页登录后回跳扩展」的流程作为备选。

Logto 里给扩展用的应用要同时配置回调地址 `https://<扩展 id>.chromiumapp.org/` 和 CORS 允许来源 `chrome-extension://<扩展 id>`，否则用 code 换 token 时会被拒。所以国内版扩展要用 manifest `key` 固定扩展 id。

## 已确认（2026-11-19 调研）

- [x] **自定义 claim**：Logto 开源版支持自定义 access token claim（Console > Custom JWT，`getCustomJwtClaims` 脚本），这功能以前只有 Logto Cloud 有。注意自托管下脚本以 Logto 进程的权限运行。
- [x] **`unionid`**：微信 connector 有 `unionid` 时优先用它（Decision 4）。
- [x] **微信开放平台资质**：网站应用的微信登录要求开发者资质认证（企业，约 300 元/年），创建网站应用要填 ICP 备案号。
- [x] **拿不到手机号**：网站应用和公众号网页授权都不返回手机号，只有小程序能拿。

## 原型验证结果（#1026，2026-11-19）

- [x] 扩展在 **Chrome 和 Edge** 上登录，并复用网站的 Logto 会话（Decision 9）：都可以。测的是 `launchWebAuthFlow` + PKCE，也就是 `@logto/chrome-extension` 底下用的机制。
- [x] 登录页的外部资源：只有默认 logo 从 `logto.io` 加载，改用我们自己域名上的 logo。图形验证码脚本只在开启验证码时加载，我们不开。
- [x] 容器部署和数据库初始化：官方启动命令 `npm run cli db seed -- --swe && npm start` 首次启动时自动初始化，之后跳过，不用手动操作。
- [x] 自定义 JWT 脚本读微信社交身份（Decision 7）：`context.user.identities.wechat.userId` 能读到并写进 access token。测试用的是通过管理 API 加的假微信身份。
- [ ] 拿到真实 AppID 后确认：微信 connector 的身份 target 名，以及它的 `userId` 就是 `unionid`。

## Consequences

**好的**

- 国内版的身份数据完全在境内、在自己手里。
- 第一版没有短信：不用短信签名和模板审核，没有短信费，也没有短信轰炸的风险。
- 身份认证变成可配置的 seam 以后，海外版将来要从 Clerk 迁走的成本也下降了。

**要接受的**

- **只依赖微信**：开放平台账号被封、或资质认证过期忘了年审，所有国内版用户都登录不了。认证年审要做提醒；#1023 的可选手机号是用户自己的退路。
- **没有微信的人用不了国内版**。在大陆用户里这类人很少。
- **多一个有状态服务**：Logto + PostgreSQL（enx-api 仍然是 SQLite）。升级、备份、安全补丁都归自己。
- 国内版的登录是托管页跳转，没有 Clerk 内嵌组件那么顺滑；可以用 Logto 的品牌定制缓解。
- seam 改造会动三端约 40 个文件，而且同时影响海外版，要按 Decision 3 的顺序两步走。
- #1027 的改名对旧镜像是单向的。旧镜像启动时会重新添加空的 `clerk_user_id` 列，之后的 Clerk 登录可能另建本地账号。迁移后使用兼容 `auth_subject` 的镜像恢复服务。迁移前备份对应的是旧 schema 和当时的数据。

## Revisit Triggers

- **ENX 加了公开发布内容的功能**（评论、分享笔记、社区）：实名条款开始适用，必须补手机号绑定或其他实名方式，Decision 2 作废。
- **要做微信小程序**：Logto 没有 headless API，做不了小程序一键登录。到时重新评估 Authing，或者自己写桥接。
- 主管部门要求国内版收集手机号。
- Logto 停止维护自托管版，或改变开源许可。
- 运维 Logto + PostgreSQL 的负担明显超出预期 → 重新评估 Casdoor（自托管）或 Authing（SaaS）。

## 修订记录

- #1031：Decision 8 写明 `DELETE /api/me` 的请求体字段 `confirmation`、不匹配时的错误码 `confirmation_mismatch`，以及 enx-ui 按钮与服务端同样去掉首尾空格再比较，让接口、界面和测试对齐。

- #1028：明确 enx-ui 在服务端选择 adapter 并通过 auth context 提供客户端会话，补齐 `AUTH_PROVIDER` 的默认值和启动校验规则，避免配置错误后继续运行。
- #1027：补充第一步上线的迁移失败与回退约束，明确账号管理接口的职责，并纠正空邮箱开通的现状及其适用版本。
