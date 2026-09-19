# TASK-SPEC: Clerk 生产实例切换（上线前）

| 字段 | 值 |
| --- | --- |
| **状态** | **§1–§3 完成（2026-09-18）** — 生产实例 `sz5x08ornsg5` 已建成，`clerk.catglish.com` 证书已签发，Google / GitHub 自建凭证已生效。剩 §4 三端切 key 与 §5 验证，后者阻塞于生产站点尚未起来（RUNBOOK §3.4 未跑）。homelab / dev 继续用 **development 实例**（`rational-deer-4450`），不受影响 |
| **类型** | 上线前配置清单（不改代码；改的是 Clerk 租户 + DNS + 部署环境变量） |
| **关联 ADR** | [`adr-015-cognito-to-clerk-auth-migration.md`](../architecture/adr-015-cognito-to-clerk-auth-migration.md)（实现范围概览表已写明「生产实例填自己的 Google OAuth client、GitHub OAuth app 凭证；配 `clerk.catseye.xxx` 域名」）；[`adr-013-catseye-marketing-site.md`](../architecture/adr-013-catseye-marketing-site.md)（Catseye 品牌 / 域名来源）|
| **前提** | 生产域名 `catglish.com`（Cloudflare）；DNS 与 Origin 证书由 `w10n-config/infra/cloudflare/opentofu/catglish/` 管理 |

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

- [x] 在 Clerk dashboard 从 dev 实例 **clone** 出 production 实例 —— 实例 id `sz5x08ornsg5`
- [x] **核对自定义 session token claim**：`email` = `{{user.primary_email_address}}`、`name` = `{{user.full_name}}` —— 已确认两条都在（enx-api 首次开通用户取邮箱/名依赖这两个，见 ADR-015 Rationale 8）
- [x] 确认 Google + GitHub social connections 在 prod 实例是开的
- [x] 记下 prod 的 `pk_live_...`、`sk_live_...`、Frontend API URL = `https://clerk.catglish.com`
- [x] **Paths** —— Clerk 文档明确 clone **不会**复制 Paths，需手配：`<SignIn />` → `https://catglish.com/sign-in`、`<SignUp />` → `https://catglish.com/sign-up`
  - after sign-in / sign-up URL **在 Dashboard 里已不存在**（Core 2 移除），改由 `NEXT_PUBLIC_CLERK_SIGN_*_FALLBACK_REDIRECT_URL=/app` 控制，enx-ui 已配好

### 2. 自己的 OAuth 凭证（prod 实例必须，不能用 Clerk 共享的）

- [x] **Google**：在**既有的** `enx-oauth-prod` GCP 项目里建 OAuth 2.0 Web client
  - Authorized redirect URI = `https://clerk.catglish.com/v1/oauth_callback`
  - client id `694354922023-gc2tpc4h8ajpr9snsc9lfldciocgal5a.apps.googleusercontent.com`，scope `openid` / `userinfo.email` / `userinfo.profile`（均非敏感，不触发人工审核）
  - ⚠️ 本文此前写「`enx-oauth-prod` 项目已随 Cognito 回收」是**错的**：被回收的只是 Cognito 时代的 OAuth client，项目一直在，且仍用于 Chrome Web Store API（见 `w10n-config/infra/gcp/opentofu/enx/`）
  - ⚠️ consent screen 必须 **Publish 到 "In production"**，停在 Testing 只有白名单用户能登录
  - ⚠️ OAuth client **无法用 OpenTofu 创建**：`google_iap_brand` / `google_iap_client` 需要 organization，个人项目没有（上游 issue #6074 自 2020 年未实现）。这一步注定手工
- [x] **GitHub**：OAuth App 已建，client id `Ov23liagkTBa4JpBpc08`，scope `user:email read:user`，callback 同上

### 3. DNS

- [x] 5 条 CNAME 全部就位：`clerk` / `accounts` / `clkmail` / `clk._domainkey` / `clk2._domainkey`
- [x] 域名验证通过、证书已签发（`clerk.catglish.com` 与 `accounts.catglish.com` 均为 Google Trust Services 签发）
- [x] 记录已由 `w10n-config/infra/cloudflare/opentofu/catglish/` 的 `clerk_dns_records` 接管（原为手工创建，靠 `imports.tf` 收进 state）
- ⚠️ 这 5 条**必须永远灰云**（`proxied = false`）。橙云会让 Clerk 的域名验证与 TLS 终止双双失败，报的是 Cloudflare **Error 1000 "DNS points to prohibited IP"**，错误信息里不会出现 Cloudflare 以外的线索
- ⚠️ 本机 `dig` 查 `clk._domainkey` 这类带下划线的名字会被 mihomo/xray 截成 `REFUSED`，**用 DoH 验证**（`https://cloudflare-dns.com/dns-query`），别误判成记录没生效

### 4. 部署环境变量（w10n-config，都是非代码改动）

**enx-api**（`infra/homelab/k8s/enx/deployment.yaml`，或生产集群对应文件）：
- [ ] `CLERK_ISSUER` → `https://clerk.<域名>`
- [ ] `CLERK_AUTHORIZED_PARTIES` → 生产网站 origin（+ 扩展 id `chrome-extension://<id>`），空格分隔

**enx-ui**（运行期 env：生产 `/opt/enx/enx-ui.env`，homelab `deployment-ui.yaml` + Secret `enx-clerk`）：
- [ ] `CLERK_PUBLISHABLE_KEY` → `pk_live_...`（**不再是 build-arg**，重启容器即生效）
- [ ] `CLERK_SECRET_KEY` → `sk_live_...`（k8s secret `enx-clerk`，`kubectl` 更新）
- [ ] 其余 `NEXT_PUBLIC_CLERK_SIGN_IN_URL` 等不变（`/sign-in` `/sign-up` `/app`，路由常量，每个环境一样）
- [ ] 重启 enx-ui（生产 `systemctl restart enx-ui`；homelab 滚动 Deployment）—— **不需要重新构建镜像**

**enx-chrome**（`enx-chrome/src/config/targets.ts` 的 `production` 目标，或 `.env.production` 的 `VITE_*` 覆盖）：
- [ ] `VITE_CLERK_PUBLISHABLE_KEY` → `pk_live_...`（写进 `.env.production`）
- [ ] `clerkSyncHost` → 生产网站域名
- [ ] Clerk 的 `host_permissions` **无需手改**：由 publishable key 解码得出，换 key 后 manifest 自动跟着变
- [ ] `task package-webstore`（`--mode production`）重新打包上架

### 5. 验证

> **阻塞中**：这一节每一条都要求生产站点可访问，而 `catglish.com` / `api.catglish.com` 目前返回 502 —— origin 证书与 nginx vhost 已就位，但 `enx-deploy.sh`、systemd unit、ECDICT 都还没装（`w10n-config` 的 `RUNBOOK-enx-prod.md` §3.4 未执行），nginx 反代的 `127.0.0.1:3000` / `:8091` 后面没有进程。

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
