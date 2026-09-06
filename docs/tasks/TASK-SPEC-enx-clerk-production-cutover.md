# TASK-SPEC: Clerk 生产实例切换（上线前）

| 字段 | 值 |
| --- | --- |
| **状态** | Not started — 前置于公开上线（面向公网真实用户）。homelab / dev 用当前的 Clerk **development 实例**（`rational-deer-4450`）即可，不阻塞 |
| **类型** | 上线前配置清单（不改代码；改的是 Clerk 租户 + DNS + 部署环境变量） |
| **关联 ADR** | [`adr-015-cognito-to-clerk-auth-migration.md`](../architecture/adr-015-cognito-to-clerk-auth-migration.md)（实现范围概览表已写明「生产实例填自己的 Google OAuth client、GitHub OAuth app 凭证；配 `clerk.catseye.xxx` 域名」）；[`adr-013-catseye-marketing-site.md`](../architecture/adr-013-catseye-marketing-site.md)（Catseye 品牌 / 域名来源）|
| **前提** | 已有生产域名（`catseye.*` 或最终定的域名）；Catseye 网站已部署到该域名 |

---

## 背景

ADR-015 把认证从 Cognito 迁到 Clerk，**代码已完成并上了 homelab**。当前用的是 Clerk 的 **development 实例**：

- Google / GitHub 登录用的是 **Clerk 共享的 OAuth 凭证**（同意页非品牌化、有限流、标注 development-only）
- Frontend API 域名是 Clerk 给的 `rational-deer-4450.clerk.accounts.dev`
- 安全策略宽松（permissive origins、dev-browser 机制），不适合真实流量

对公网开放前必须切到 **production 实例**。这是 Clerk 的机制（dev 实例 ≠ prod 实例），类比 Stripe 的 test mode → live mode。**不涉及代码改动**，全是控制台 + DNS + 部署环境变量。

---

## Checklist

### 1. Clerk 控制台 — 建 production 实例

- [ ] 在 Clerk dashboard 从 dev 实例 **clone** 出 production 实例（Clerk 的 "clone settings" 会带走大部分配置）
- [ ] **核对自定义 session token claim**：`email` = `{{user.primary_email_address}}`、`name` = `{{user.full_name}}` —— 确认 clone 过去了（enx-api 首次开通用户取邮箱/名依赖这两个，见 ADR-015 Rationale 8）
- [ ] 确认 Google + GitHub social connections 在 prod 实例是开的
- [ ] 记下 prod 的 `pk_live_...`、`sk_live_...`、Frontend API URL（形如 `https://clerk.<域名>`）

### 2. 自己的 OAuth 凭证（prod 实例必须，不能用 Clerk 共享的）

- [ ] **Google**：Google Cloud Console 建一个 OAuth 2.0 Web client
  - Authorized redirect URI 填 Clerk prod 实例 SSO connection 页面给出的回调地址
  - 同意页配 app 名 / logo / 域名（面向真实用户）
  - client id + secret 贴进 Clerk → Configure → SSO connections → Google
  - （旧的 `enx-cognito` GCP OAuth client 和 `enx-oauth-prod` 项目已随 Cognito 回收，这是全新的）
- [ ] **GitHub**：GitHub → Settings → Developer settings → OAuth Apps 建一个
  - Authorization callback URL 填 Clerk prod 给出的地址
  - client id + secret 贴进 Clerk → Configure → SSO connections → GitHub

### 3. DNS

- [ ] 加 `clerk.<域名>` 的 CNAME 记录，指向 Clerk（值在 Clerk dashboard → Configure → Domains）
- [ ] 等 Clerk 验证域名 + 签发证书（可能要几分钟到几小时）
- [ ] 如果还有 `accounts.<域名>`、`clkmail.<域名>` 等 Clerk 要求的子域名，一并加

### 4. 部署环境变量（w10n-config，都是非代码改动）

**enx-api**（`infra/homelab/k8s/enx/deployment.yaml`，或生产集群对应文件）：
- [ ] `CLERK_ISSUER` → `https://clerk.<域名>`
- [ ] `CLERK_AUTHORIZED_PARTIES` → 生产网站 origin（+ 扩展 id `chrome-extension://<id>`），空格分隔

**enx-ui**（`deployment-ui.yaml` + `pipeline-build-enx-ui.yaml` build-args）：
- [ ] `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → `pk_live_...`（build-arg，会 bake 进 bundle，必须重新构建镜像）
- [ ] `CLERK_SECRET_KEY` → `sk_live_...`（k8s secret `enx-clerk`，`kubectl` 更新）
- [ ] 其余 `NEXT_PUBLIC_CLERK_SIGN_IN_URL` 等不变（`/sign-in` `/sign-up` `/app`）
- [ ] 重新触发 enx-ui pipeline（新 `pk_live` 才能 bake 进去）

**enx-chrome**（`enx-chrome/src/config/env.ts` 的 `production` 环境默认值，或 `VITE_*` 覆盖）：
- [ ] `clerkPublishableKey` → `pk_live_...`
- [ ] `clerkSyncHost` → 生产网站域名
- [ ] `manifest.json` 的 `host_permissions` 加 `https://clerk.<域名>/*`（保留或替换 dev 的 `rational-deer-4450.clerk.accounts.dev`）
- [ ] `manifest.json` CSP 里如有硬编码 Clerk 域名，同步
- [ ] 用 `production` 环境重新 `pnpm build`，重新打包上架

### 5. 验证

- [ ] 生产网站 `/app` → Google 登录 → 落回登录态，`/api/me` 200
- [ ] 生产网站 `/app` → GitHub 登录 → 同上
- [ ] 邮箱 + 密码注册 / 登录 → 同上
- [ ] 扩展：网站登录态下打开扩展应免登（`syncHost`）
- [ ] enx-api 日志：`ClerkAuth` 验签用的是 prod issuer

### 6. 收尾

- [ ] 确认 Clerk MAU 计入上线后要盯的成本指标（`w10n-config/enx/monetization*.md`，10k MAU 免费线）
- [ ] dev 实例（`rational-deer-4450`）保留给 homelab / 本地开发，不删

---

## 非目标

- 不改任何应用代码（迁移代码已在 ADR-015 完成）
- 不动 dev 实例（homelab 继续用）
- 不在这个任务里做 Clerk → Logto 的二次迁移评估（那是 ADR-015 的 Revisit Trigger，MAU 到量时才做）
