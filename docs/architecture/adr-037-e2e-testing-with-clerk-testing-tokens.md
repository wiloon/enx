# ADR-037：enx-chrome E2E 改为「本地三件套 + `@clerk/testing` 真登录」——不做测试专用的鉴权旁路，需要登录的用例在缺少凭据时显式 skip

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-25。Decision 1-5 已实现（分支 `feat/e2e-clerk-testing`）。需要登录的用例尚未在真实凭据下跑通过一次：实现时 AI 会话无权读取 Clerk secret key，由维护者本地跑（见「验证」） |
| **日期** | 2026-09-25 |
| **关联** | [`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（Clerk 取代 Cognito；扩展经 `syncHost` 同步网站会话）、[`adr-034-site-support-on-demand-injection-and-generic-content-detection.md`](adr-034-site-support-on-demand-injection-and-generic-content-detection.md)（`content_scripts.matches` 收窄）、`docs/tasks/BACKLOG-2026-09-24-preexisting-issues.md` §2 |

---

## Context

`enx-chrome/e2e/` 的 Playwright 用例在 Clerk 迁移（ADR-015）之后事实上全部失效，失效原因有四层，彼此独立：

1. **登录是假的。** `helpers.ts:seedLoggedInState()` 往 `chrome.storage.local` 写一个假 `accessToken`——这是 Cognito 时代的会话形态。现在后台每次调 API 都用 Clerk 客户端 `session.getToken()` 现铸 JWT（`background.ts:getSyncedClerk`），storage 里的 token 没人读。高亮（`getWords`）、查词、翻译全部需要 token，所以所有 content 用例都失败。
2. **扩展指向 homelab。** `e2e/fixtures.ts` 固定加载 `dist-homelab`，扩展打到 `https://enx-api.wiloon.lab`；而 `playwright.config.ts` 在 :8090 起的本地 enx-api 没有任何用例用到。
3. **内容脚本根本不在测试页上。** ADR-034 之后 `content_scripts.matches` 只剩 X / RSSX / enx-ui 三类站点；测试 fixture 页面由 `http-server` 起在 `localhost:8080`，不在名单里，`helpers.ts:enableLearningMode()` 直接 `chrome.tabs.sendMessage` 给一个不存在的内容脚本。
4. **用例和 UI 脱节。** `popup-login.spec.ts` 断言的还是 "Sign in with email or Google (AWS Cognito)." 文案。

现有的 `enx-api/clerktest` 包（本地 JWKS + 自签 JWT）只服务 Go 单测，扩展这一侧没有对应物：扩展的 token 来自真实的 clerk-js，不是我们能在测试里替换的一个 HTTP 头。

Clerk 官方给 E2E 的方案是 `@clerk/testing`：`clerkSetup()` 在全局 setup 里用 `CLERK_SECRET_KEY` 换一个 Testing Token（绕过 dev 实例的 bot 检测）；`clerk.signIn({ page, emailAddress })` 用 Backend API 给指定用户签发 sign-in token 并走 ticket 策略登录，跳过邮箱验证码和 MFA。只对 **development 实例** 支持（`clerkSetup` 遇到生产 secret key 直接抛错），生产实例开 test mode 官方明确不推荐。

## Options Considered

### A. 测试专用鉴权旁路（扩展或 enx-api 认一个测试 token）

扩展在 `environment === 'test'` 时跳过 Clerk、直接用注入的 token；enx-api 在 dev-mode 下信任 `clerktest` 的 JWKS。

| Pros | Cons |
| --- | --- |
| 不需要任何密钥，CI 里也能跑 | 生产代码里多一条「某个条件下不验签」的分支——扩展和 API 都是鉴权边界，这类分支一旦被错误的构建开关打开就是整条鉴权失效（env.ts 的生产 API URL 守卫就是为同类风险加的）；而且测的不再是真实链路：`syncHost` 会话同步、`getToken()` 重试、`azp` 校验这些真正出过事故的环节（见 `enx-chrome-false-session-expired` 相关记录）全部被绕过 |

### B.（采用）本地三件套 + `@clerk/testing` 真登录

扩展构建成指向本地的变体，Playwright 起本地 enx-api（:8090）和 enx-ui（:3000），在 enx-ui 页面上 `clerk.signIn()`，扩展经 `syncHost` 同步到这个会话。

| Pros | Cons |
| --- | --- |
| 零生产代码改动；测的是用户真实走的链路（网站登录 → 扩展同步 → 后台铸 JWT → enx-api JWKS 验签 + `azp` 校验）；Clerk 官方支持的方式 | 需要 dev 实例的 `CLERK_SECRET_KEY` 和一个测试用户；依赖 Clerk dev 实例在线（网络、限流）；每条用例都要起 enx-ui，本地首次冷启动慢 |

### C. 继续对着 homelab 跑

| Pros | Cons |
| --- | --- |
| 不用起本地服务 | 共享环境、共享数据库，用例之间和用例与人之间互相污染；homelab 部署状态决定测试结果，失败时分不清是代码还是环境；`playwright.homelab.config.ts` 作为人工冒烟保留，不作为回归套件 |

## Decision

1. **扩展的 E2E 构建变体 `dist-e2e`。** `pnpm build:e2e` = `development` target（API `localhost:8090`，`syncHost`/enx-ui `localhost:3000`），外加用 `VITE_ENX_UI_ORIGINS` 把 fixture 服务器 `http://localhost:8765` 并入 UI origins，使内容脚本常驻注入测试页。**这是对 `uiOrigins` 语义的有意借用**：8765 同时拿到了 `externally_connectable` 和 host permission，只在这个测试构建里成立，任何发布构建都不带。`fixtures.ts` 改为加载 `dist-e2e`，缺失时报错提示先构建，而不是悄悄加载别的目录。
2. **Playwright 起本地三件套，永不指向 homelab。** enx-api 用每次运行独立的临时 `DB_PATH`（不复用开发机的 `/var/lib/enx-api/enx.db`），Clerk issuer / `azp` 允许列表沿用 `config.toml` 默认值（已含 `http://localhost:3000` 和扩展 ID `chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf`）。enx-ui 只在提供了登录凭据时才启动（它自己也需要 `CLERK_SECRET_KEY`），`API_BASE_URL` 指向本地 enx-api。
3. **登录走 `@clerk/testing`，按用例登录。** 全局 setup project 调 `clerkSetup()`；需要登录的用例通过 `signedIn` fixture：在 `localhost:3000` 上 `clerk.signIn({ page, emailAddress: E2E_CLERK_USER_EMAIL })`，再轮询扩展后台的 `validateSession`，直到扩展确认已同步到会话。不用 `storageState` 复用登录态：扩展测试用的是 `launchPersistentContext`（加载扩展的唯一方式），每条用例一个全新临时 profile；ticket 登录只需一次 Backend API 调用，按用例登录的代价可以接受，换来用例之间零共享状态。
4. **缺凭据时显式 skip，不假装通过。** 需要登录的用例在 `CLERK_SECRET_KEY` 或 `E2E_CLERK_USER_EMAIL` 缺失时 `test.skip` 并写明原因；不需要登录的用例（options 页、未登录 popup）任何环境都能跑。测试用户用 Clerk 测试邮箱格式（`xxx+clerk_test@...`，验证码固定 `424242`），只建在 dev 实例。密钥只从环境变量读，不进仓库、不进 `.env` 模板以外的任何文件。
5. **删掉 Cognito 时代的假登录。** `seedLoggedInState()` / `login()` 删除；`popup-login.spec.ts` 按现在的 Clerk 登录界面重写。

## Consequences

- 生产 Clerk 切换（`clerk-production-instance`）不影响本 ADR：E2E 永远用 dev 实例。反过来，dev 实例如果被删或换域名，`targets.ts` 的 `DEV_CLERK_PUBLISHABLE_KEY` 和 `config.toml` 的 issuer 要一起改。
- 扩展 ID 变了（`manifest.json` 的 `key` 被换），`config.toml` 的 `authorized-parties` 必须同步，否则所有登录用例在 enx-api 上 401——这是 `azp` 校验在正常工作，不是测试坏了。
- 用例顺序依赖（backlog §2 记录的 `options-page.spec.ts` 单跑过、整跑挂）在这个结构下没有了扩展侧的来源：context fixture 本来就是每用例一个新 profile。若仍复现，来源只能是服务端（fixture 服务器或 enx-api 数据库），届时按服务端排查。

## 验证

- 不需要登录的用例：本地可跑（`pnpm build:e2e && pnpm test:e2e`）。
- 需要登录的用例：`CLERK_SECRET_KEY=sk_test_... E2E_CLERK_USER_EMAIL=e2e+clerk_test@example.com pnpm test:e2e`。首次需在 Clerk dashboard（dev 实例 rational-deer-4450）建这个用户。
