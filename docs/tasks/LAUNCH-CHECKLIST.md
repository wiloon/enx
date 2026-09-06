# LAUNCH-CHECKLIST：enx / Catseye 公开上线清单

| 字段 | 值 |
| --- | --- |
| **状态** | Active — 2026-09-06 建立。汇总当前距离「公开上线」还差的工作，取代已过时的 `w10n-config/enx/monetization-tasks.md`（那份停在 2026-08-26，Cognito 时代，未含 Clerk 迁移与 ADR-014 token 计费） |
| **类型** | 上线门槛清单（跨 `enx` 公开仓库 + `w10n-config` 私有仓库） |
| **关联 ADR** | [`adr-009`](../architecture/adr-009-billing-stripe-subscription-and-ai-credits.md)（计费）、[`adr-013`](../architecture/adr-013-catseye-marketing-site.md)（官网）、[`adr-014`](../architecture/adr-014-sidepanel-clicked-word-and-token-billing.md)（token 计费）、[`adr-015`](../architecture/adr-015-cognito-to-clerk-auth-migration.md)（Clerk 认证） |
| **关联 Spec** | [`TASK-SPEC-enx-billing-stripe-subscription.md`](./TASK-SPEC-enx-billing-stripe-subscription.md)、[`TASK-SPEC-enx-clerk-production-cutover.md`](./TASK-SPEC-enx-clerk-production-cutover.md) |
| **关联配置** | `w10n-config`：`enx/monetization.md`（定价策略）、`enx/monetization-tasks.md`（历史，已被本文取代）、`infra/stripe/opentofu/enx/`、`infra/homelab/k8s/enx/`、`infra/aws/opentofu/enx/` |

---

## 「上线」的定义

在一个**公网可达的生产域名**上，真实用户可以：注册 → 用 Google / GitHub / 邮箱登录 → 订阅或购买积分 → 使用 AI 翻译并按 token 扣积分 → 退订 / 权限收回 —— 这条链路端到端跑通，Chrome 扩展在 Web Store 上架，官网能让访客在不安装不注册的前提下看懂产品。达到这个状态才能开始 YouTube / X 推广。

当前 homelab（`enx.wiloon.lab` / `enx-api.wiloon.lab`，局域网）已跑着 Clerk dev 实例 + Stripe Sandbox + 三档订阅代码结构 + token 计费代码，但**付费链路的关键数值全是 0，从未真实联调过**。

---

## 0. 需要先拍板的决策（阻塞后续所有工作）

- [ ] **0.1 生产域名**。文档之间不一致，必须定一个：
  - `w10n-config/enx/monetization-tasks.md` → 「继续用 `enx.wiloon.com`，迁 AWS EC2」
  - `adr-013` / `adr-015` / `TASK-SPEC-clerk-cutover` → 用 `catseye.*` 品牌域名，且「已有生产公网域名」是 Clerk 切换与官网上线的**前提**
  - `enx-chrome/src/config/env.ts` 的 `production` 环境已硬编码 `clerkSyncHost = https://enx.wiloon.com`
  - `w10n-config/enx/monetization.md` → 「等订阅跑出付费信号再买独立品牌域名」
  - ⚠️ 冲突点：Clerk prod 实例要配 `clerk.<域名>` 子域，Stripe live webhook 要固定公网 URL，Chrome 扩展 `host_permissions` 要写死域名 —— 这些都得等域名定了才能做。
- [ ] **0.2 生产部署环境**：AWS EC2（monetization-tasks 的方案）还是留在别处？`enx-api-java` 已随 ADR-015 从 homelab 下线，不再是双栈。
- [ ] **0.3 上线档位范围**：只上 Pro 单档，还是 Pro / Pro+ / Max 三档一起上？年付是否上线即支持（年付积分发放机制未实现，见 §2.3）。
- [ ] **0.4 Pro 最终定价**。`$4.99/mo` 是 2026-08-26 暂定值，用户明确说过「之后整体 review」；Pro+ / Max 完全未定价（OpenTofu 里占位 `$3 / $10 / $20`）。

---

## 1. 计费 —— 定价与积分数值定稿（阻塞）

> 现状：`enx-api/config.toml` 的 `[stripe.credits]` 六个值全是 `0`，homelab `deployment.yaml` 也没有 `STRIPE_CREDITS_*` env。账本代码遇到 0 会**拒绝发放**（防止「忘配置」被静默当成「免费」）→ 订阅成功也拿不到积分，`aitranslate` 所有请求返回 502。

- [ ] **1.1** 定稿并回填 `[stripe.credits]`（`enx-api/config.toml` + homelab `deployment.yaml` env + AWS 部署环境）：
  - `subscription-pro` / `subscription-pro-plus` / `subscription-max`（月度发放，当月不结转）
  - `topup-small` / `topup-medium` / `topup-large`（一次性充值积分，长期有效）
- [ ] **1.2** 用真实 `aitranslate: usage ... cost=` 日志校准 token 权重（现在 `weight-in=1 / weight-out=3 / divisor=3000` 是占位，`[stripe.costs.translate]` 与 `[stripe.costs.rephrase]` 各一组）。需要先有真实 AI 调用产生日志（依赖 §3 联调）。
- [ ] **1.3** Stripe 目录里的占位价格改成定稿值：`w10n-config/infra/stripe/opentofu/enx/terraform.tfvars`（`price_pro_monthly_cents` 等），`tofu apply`。
- [ ] **1.4** `enx-ui` 定价页文案同步真实数字：`enx-ui/src/app/(app)/billing/plans.ts`。
- [ ] **1.5** 免费查词每日配额：决策是「上线前不设、上线后按真实用量再定」，保持 `[stripe.quota] dictionary-lookup-daily = 0`（= 无限制）。**确认一下这个决策仍然成立**即可，无需改代码。

---

## 2. 计费 —— 代码遗留待办

- [ ] **2.1** 移除 `CheckoutTopup` 的「必须有 active 订阅否则 403」校验（`enx-api/billing/handler.go`）。2026-08-26 决策已改为「有积分余额即可用 AI，不限来源」，这条校验现在与决策矛盾。
- [ ] **2.2** 核对三档订阅链路端到端一致：`config.toml [stripe.price]`（`pro` / `pro-plus` / `max` → lookup_key）、`billing/handler.go` 的 plan 参数校验、`billing/stripe/checkout.go` 按 lookup_key 解析 Price、`enx-ui` `plans.ts`。代码结构已是三档，需一次通读确认没有遗留的「monthly/annual」两档假设。
- [ ] **2.3**（仅当 §0.3 决定上线支持年付）实现独立于 Stripe 账单周期的月度积分发放：定时任务扫 `status=active` 的订阅，`credit_accounts.period_end` 过期就发下月额度。`invoice.paid` 对年付一年只触发一次，与账本「每月发、不结转」对不上。设计已在 `w10n-config/enx/HANDOFF-stripe-billing-integration.md` §4.4 讨论，未编码。
- [ ] **2.4** `ManagedPayments` 假设未验证：`billing/stripe/checkout.go` 建 Checkout Session 时没显式设置该字段，赌 Stripe 账号级配置自动生效，从未用真实请求验证。§3 联调时确认。

---

## 3. Stripe webhook 打通 + 端到端联调（从未真实跑过）

- [ ] **3.1** homelab webhook 转发恢复：`enx-stripe-cli` pod（`w10n-config/infra/homelab/k8s/enx/deployment-stripe-cli.yaml`）此前卡在 Nexus 镜像封锁（冷却到 2026-08-27）。确认 pod 已 Running，并把 stripe-cli 日志里的真实 `whsec_...` 回填进 `enx-stripe` Secret 的 `webhook_secret`（当前是占位 `whsec_placeholder`），`kubectl rollout restart deployment/enx-api -n enx`。命令见 `w10n-config/infra/homelab/k8s/enx/README.md`「stripe-cli 转发部署」。
  - ⚠️ 该密钥每次 pod 重启都会变（stripe-cli 限制），切到生产固定 endpoint 后无此问题。
- [ ] **3.2** homelab 完整闭环冒烟：注册 → Clerk 登录（Google / GitHub / 邮箱各一遍）→ 订阅某档 → 积分到账（webhook `invoice.paid` → `GrantSubscription`）→ 用 AI 翻译，确认按 token 扣积分（查 `credit_transactions`）→ 积分耗尽返回 402 → 充值 → 余额增加 → Customer Portal 退订 → `status` 变更、权限收回。
- [ ] **3.3** 建 Live（生产）Stripe workspace：目前只有 Sandbox。用 OpenTofu workspace 区分（`infra/stripe/opentofu/enx/` 已按此设计），Live 那份配置在切换收费时建。

---

## 4. Clerk 生产实例切换

> 完整清单见 [`TASK-SPEC-enx-clerk-production-cutover.md`](./TASK-SPEC-enx-clerk-production-cutover.md)（状态：Not started）。当前三端全部指向 Clerk **development 实例** `rational-deer-4450`（共享 OAuth 凭证、非品牌化同意页、宽松安全策略），不适合公网真实流量。要点：

- [ ] **4.1** Clerk dashboard 从 dev 实例 clone 出 production 实例；核对自定义 session token claim（`email` = `{{user.primary_email_address}}`、`name` = `{{user.full_name}}`，enx-api 首次开通用户依赖）。
- [ ] **4.2** 自建 OAuth 凭证（prod 实例不能用 Clerk 共享的）：Google Cloud Console 新建 OAuth 2.0 Web client + 品牌化同意页；GitHub OAuth App。回调地址填 Clerk prod 给出的。
- [ ] **4.3** DNS：加 `clerk.<域名>` CNAME 指向 Clerk，等域名验证 + 证书签发；其它 Clerk 要求的子域（`accounts.` / `clkmail.` 等）一并加。
- [ ] **4.4** 部署环境变量切换（`w10n-config`）：
  - enx-api：`CLERK_ISSUER` → `https://clerk.<域名>`（当前硬编码 `rational-deer-4450.clerk.accounts.dev`）、`CLERK_AUTHORIZED_PARTIES` → 生产 origin + `chrome-extension://<id>`
  - enx-ui：`NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` → `pk_live_...`（build-arg，须**重新构建镜像** bake 进 bundle）、`CLERK_SECRET_KEY` → `sk_live_...`（Secret `enx-clerk`）
  - enx-chrome：`VITE_CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_SYNC_HOST`（或改 `enx-chrome/src/config/env.ts` 的 `production` 默认值）、`manifest.json` `host_permissions` 加 `https://clerk.<域名>/*`、CSP 同步 → **用 production 环境重新 build 并重新打包上架**
- [ ] **4.5** 验证：三种登录均落回登录态、`/api/me` 200；扩展在网站登录态下打开应免登（`syncHost`）；enx-api 日志确认验签用的是 prod issuer。
- [ ] **4.6** dev 实例 `rational-deer-4450` 保留给 homelab / 本地开发，不删。

---

## 5. 部署环境 / 域名基础设施

> 依赖 §0.1、§0.2 的决策。以下按「迁 AWS」路径写，若决定别的方案需相应调整。

- [ ] **5.1** `enx-ui` 生产部署流程：目前只有 homelab Tekton pipeline（`w10n-config/infra/homelab/k8s/tekton/pipeline-build-enx-ui.yaml`）和 `enx-ui` 仓库内无专属 CI（只有 `.github/workflows/deploy-enx-api.yml`）。参照 `deploy-enx-api.yml` 补一份 AWS 部署 workflow，注意 `NEXT_PUBLIC_*`（含 Clerk pk）是 build-time 注入。
- [ ] **5.2** 生产 DNS / TLS / CORS：确认 `<生产域名>` 与 `<api 域名>` 的解析、证书、`enx-api` CORS 白名单、`enx-chrome` `host_permissions` 全部指向新构建，无 Cognito 时代遗留配置。
- [ ] **5.3** 生产数据库：决策是「上线继续用 SQLite + S3 备份」，Postgres 迁移明确排到上线后。确认生产环境的 SQLite 持久卷 + 备份链路就绪。
- [ ] **5.4** Stripe Live webhook endpoint 指向 `<api 域名>/billing/webhook`，重新验证签名与公网可达性（`infra/stripe/opentofu/enx/` 加第二个 `stripe_webhook_endpoint`）。
- [ ] **5.5** 生产环境完整端到端冒烟（§3.2 的全流程，在生产域名 + Clerk prod + Stripe live 上重跑一遍）—— **最终发布门禁**。
- [ ] **5.6** 确认 `enx-api` 的 AI provider 生产配置（MiniMax `MiniMax-Text-01`，当前指向 `api.minimaxi.com` 国内 host）在生产网络环境可达。
- [ ] **5.7** 观测：`enx-ui` 已接 Sentry（`sentry.*.config.ts`），确认生产 DSN 配好；`enx-api` 日志采集到位（billing / auth 关键路径）。

---

## 6. Chrome Web Store 上架

- [ ] **6.1** 创建 Web Store 开发者账号，提交扩展，拿到**正式 extension id**。
  - ⚠️ id 是 `manifest.json` `host_permissions`、Clerk `authorized_parties`、`syncHost` 回跳的依赖 —— 先拿 id 再定 §4.4 的 `CLERK_AUTHORIZED_PARTIES`。
- [ ] **6.2** 隐私政策页 + 服务条款页（Web Store 上架要求；`adr-013` v1 明确未做）。可作为官网新增静态页。
- [ ] **6.3** Web Store listing 素材：图标、截图、宣传图、简介。
- [ ] **6.4** `adr-013` 里官网的 Chrome Web Store 链接 / id 占位替换成真实值。

---

## 7. 官网 / 上线物料（`adr-013` 遗留占位）

- [ ] **7.1** 演示视频（当前是 16:9 占位容器，通过常量开关接入，不阻塞但推广前需要）。
- [ ] **7.2** 产品截图、OG 图（社交分享卡片）。
- [ ] **7.3** `/pricing` 公开页（`adr-013` v1 未做，`/billing` 是登录后的页）。上线收费时需要一个免登录可见的定价页。
- [ ] **7.4** 品牌统一：官网对外用 `Catseye`，确认 title / logo / 文案一致。

---

## 8. 上线后（不阻塞发布）

### P1 —— 推广前建议补

- [ ] 免费查词每日配额定具体数值（机制 `billing/quota` 已实现，订阅用户跳过）。
- [ ] 积分档位、配额数值按真实使用数据微调。
- [ ] `aitranslate` token 权重按累积的真实 `cost=` 日志再校准一轮。

### P2 —— 明确延后

- [ ] SQLite → PostgreSQL 迁移（自托管优先，RDS 视免费额度）。
- [ ] Redis / ElastiCache / DynamoDB 缓存评估（含用 DynamoDB 做查词配额计数器）。
- [ ] WeChat 登录 + 国内推广。
- [ ] 反滥用 / 反刷单检测（等真被刷再设计）。
- [ ] 独立品牌域名购买（若 §0.1 决定先不用品牌域名）。
- [ ] Clerk → Logto 二次迁移评估（`adr-015` 的 Revisit Trigger，MAU 接近 10k 免费线时再做）。

---

## 已完成（供参考，勿重复做）

- Clerk 认证迁移代码：enx-api（`middleware` 验 Clerk JWT）、enx-ui（`@clerk/nextjs`）、enx-chrome（`@clerk/chrome-extension` + `syncHost`）—— homelab dev 实例已跑（ADR-015）。
- Cognito 资源下线：OpenTofu 模块已删、`enx-api-java` 已从 homelab 移除、k8s Secret `enx-cognito` → `enx-clerk`。
- Token 精确计费（ADR-014）：`aitranslate` 三个翻译端点 + rephrase 全部走 `Balance` 预检 + `Settle` 实扣。
- 三档订阅：Stripe OpenTofu 目录（`enx_pro` / `enx_pro_plus` / `enx_max` + 各一个月度 Price、`enx_credits_topup` + 三档一次性 Price）、`config.toml [stripe.price]` 三档 lookup_key、后端 checkout / webhook / portal / 账本 + 单测、`enx-ui` `/billing` 页 + e2e、`enx-chrome` 402/429 提示 UI。
- 并发正确性：SQLite DSN 加 `_txlock=immediate`（修了账本并发下的 `SQLITE_BUSY`）。
- 管理端点：`POST /api/admin/credits/grant`（`ADMIN_CLERK_USER_IDS` 白名单，homelab 测试 / 客服补偿用）。
- 官网 v1（ADR-013）：`/` 营销页 + `/app` dashboard，`enx.wiloon.lab` 已部署（物料占位）。
- ADR-009 / TASK-SPEC-billing / ADR-014 / ADR-015 已入库。

---

## 与 `w10n-config/enx/monetization-tasks.md` 的关系

那份文档的「已决策事项」表仍有参考价值（计算平台、数据库、缓存、域名的取舍理由），但「上线前必须完成」的任务清单已过时（Cognito 时代、固定积分计费、`$3/$10/$20` 占位）。**以本文为准**，`monetization-tasks.md` 只作历史决策记录。定价策略仍看 `w10n-config/enx/monetization.md`。
