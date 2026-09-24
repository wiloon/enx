# LAUNCH-CHECKLIST：enx / Catglish 公开上线清单

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

- [x] **0.1 生产域名** —— 2026-09-12 拍板：**`catglish.com`**（独立品牌域名，已在 Cloudflare 注册），不走 `<name>.starlibraries.com` 二级域名方案。产品正式命名同期定为 **Catglish**，取代本文档标题及各处仍在用的 "Catseye"（见 `adr-010`，已 Superseded）。
  - 遗留待更新：`adr-013` / `adr-015` / `TASK-SPEC-clerk-cutover` 里的 `catseye.*` 品牌域名引用、`enx-chrome/src/config/env.ts` 硬编码的 `clerkSyncHost = https://enx.wiloon.com` —— 仍待逐一改成 `catglish.com`（`w10n-config/enx/monetization-tasks.md` 里的 `enx.wiloon.com` 方案同理）
  - ✅ **API 子域名已拍板（2026-09-16）：`api.catglish.com`**。`catglish.com` 给营销站 / Web UI，`api.catglish.com` 给 enx-api。已先停在 `w10n-config/infra/stripe/opentofu/enx/variables.tf` 的 `webhook_url_prod`（**暂未接任何资源**）。这一个决策同时解锁下面三个冲突点
  - ⚠️ 冲突点（域名定了之后才能做）：Clerk prod 实例配 `clerk.catglish.com` 子域，Stripe live webhook 固定公网 URL（→ `https://api.catglish.com/billing/webhook`，**live mode 是另一套 endpoint + 另一个 `whsec_`**，需等服务真的公网可达后再建，提前建只会累积投递失败直到被 Stripe 自动禁用），Chrome 扩展 `host_permissions` 写死 `catglish.com`
- [x] **0.2 生产部署环境** —— 2026-09-17 拍板：**AWS EC2 东京（`ec2-tokyo`，ap-northeast-1）单机**，不用手上那 4 台 VPS。
  - **为什么是单机而不是「4 台 VPS 各部一部分」**：生产只有 2 个进程（`enx-api` + `enx-ui`），各自 request 128Mi；`enx-api` 是 **SQLite 单写者**（PVC `ReadWriteOnce`），多副本会互相锁死，**没有可分的东西**。拆成多机只增加一跳跨公网延迟和一套 TLS。
  - **为什么不用那 4 台 VPS**：它们全是 Xray 翻墙节点（`w10n-config/infra/xray/xray-inventory.ini`）。把付费用户的服务和翻墙节点放同一个 IP 上，节点被封会顺手带走业务。
  - **为什么是 AWS**：① AI provider 是中国 host（`api.deepseek.com` / `api.minimaxi.com`），东京路由明显优于手上那几台美国 VPS；② S3 备份链路（EventBridge → Lambda → SSM → `enx-api-backup.sh`）本来就是照着这台 EC2 写的；③ 以后要接 RDS / ElastiCache / Bedrock 时零迁移成本 —— 注意 **ElastiCache 没有公网 endpoint**，「服务在 VPS、缓存在 AWS」这种组合不成立，计算必须跟着数据走。
  - **机型**：`t2.nano`（0.5GB）扛不住，已改为 **`t3.small` + 30GB gp3**（`infra/aws/opentofu/ec2-tokyo/`，`var.instance_type` / `var.root_volume_size`）。EIP 不变，apply 会停机重启几分钟；扩盘后要在机器上跑 `growpart` + `xfs_growfs`。
  - ⚠️ **遗留**：这台机器同时跑着 vaultwarden（个人密码库）。当前生产**没有真实用户、当 pre-production 用**，可以接受；**在 Stripe 切 live / 真实用户进来之前**要把 enx 拆到独立实例，别让公网产品和密码库共享爆炸半径。
- [x] **0.3 上线档位范围** —— 2026-09-17：**三档（Pro / Pro+ / Max）一起上，只上月付**。年付**不上线**（发放机制未实现，见 §2.3；第一个年付用户就会是一张事故工单）。竞品调研在**私有仓库** `w10n-config/enx/pricing-decision-2026-09.md`（本仓库 public，定价推算不落这里）。
- [x] **0.4 定价（暂定，会调）** —— 2026-09-17：生产虽当 pre-production 用，但**公网可达、陌生人可能真的点订阅**，所以数值必须是「能跑通的真值」而非占位。

  | 档位 | 价格 | 月度积分 | 积分/美元 |
  | --- | --- | --- | --- |
  | Pro | **$3.99/mo** | 500 | 125 |
  | Pro+ | **$9.99/mo** | 1,500 | 150 |
  | Max | **$19.99/mo** | 4,000 | 200 |
  | 充值 小 | **$2.99** | 300 | 100 |
  | 充值 中 | **$6.99** | 750 | 107 |
  | 充值 大 | **$12.99** | 1,500 | 115 |

  - 形状：**积分/美元随档位递增**（125→150→200），所以升档永远比堆充值划算；充值不过期，所以单价略差于最便宜的订阅。
  - 对标：Pro $3.99 明显低于沉浸式翻译 Pro / LingQ Premium（都是 $14.99），略低于 Trancy（$3.49–4.99）。Max $19.99 远低于沉浸式翻译 Max（$39.99）。
  - ⚠️ **积分数值未经校准**：`[stripe.costs.*]` 还是占位权重（`weight-in=1 / weight-out=3 / divisor=3000`），所以「1 积分」目前不对应任何实测成本。**§1.2 校准后必须把价格和积分一起重算**。
  - **三处必须同步改，否则页面标一个价、卡上扣另一个价**：`enx-ui/src/app/(app)/billing/plans.ts`（展示）、`w10n-config/infra/stripe/opentofu/enx/variables.tf`（实收）、`enx-api/config.toml [stripe.credits]`（发放）。

---

## 1. 计费 —— 定价与积分数值定稿（阻塞）

> 现状：`enx-api/config.toml` 的 `[stripe.credits]` 六个值全是 `0`，homelab `deployment.yaml` 也没有 `STRIPE_CREDITS_*` env。账本代码遇到 0 会**拒绝发放**（防止「忘配置」被静默当成「免费」）→ 订阅成功也拿不到积分，`aitranslate` 所有请求返回 502。

- [x] **1.1** ~~定稿并回填 `[stripe.credits]`~~ —— 2026-09-17 已填暂定值（见 §0.4）。
  - ⚠️ **同时修了一个会让整件事做不成的 bug**：`utils/viper.go` 里 `stripe.credits.*` 六个键只有 `SetDefault`、**没有 `BindEnv`**，而 `AutomaticEnv()` 是刻意不开的。容器镜像里没有 `config.toml`，所以**容器化部署根本无法通过环境变量配置积分**——永远是 0。原计划「homelab deployment.yaml env 里填」这条路在代码里不存在。已补上六个 `BindEnv`。
  - 原文：定稿并回填 `[stripe.credits]`（`enx-api/config.toml` + homelab `deployment.yaml` env + AWS 部署环境）：
  - `subscription-pro` / `subscription-pro-plus` / `subscription-max`（月度发放，当月不结转）
  - `topup-small` / `topup-medium` / `topup-large`（一次性充值积分，长期有效）
- [ ] **1.2** 用真实 `aitranslate: usage ... cost=` 日志校准 token 权重（现在 `weight-in=1 / weight-out=3 / divisor=3000` 是占位，`[stripe.costs.translate]` 与 `[stripe.costs.rephrase]` 各一组）。需要先有真实 AI 调用产生日志（依赖 §3 联调）。
- [ ] **1.3** Stripe 目录里的占位价格改成定稿值：`w10n-config/infra/stripe/opentofu/enx/terraform.tfvars`（`price_pro_monthly_cents` 等），`tofu apply`。
- [x] **1.4** ~~`enx-ui` 定价页文案同步真实数字~~ —— 2026-09-17 已同步（此前页面写的是 `$3 / $10 / $20`、积分 `TBD`，与实收价不符）。`e2e/billing.spec.ts` 里过时的 `'enx Max'` / `$10/mo` 断言一并修正。
- [x] **1.5** 免费查词每日配额：决策是「上线前不设、上线后按真实用量再定」。**⚠️ 2026-09-16 更正：这个计划按当时的实现无法执行，需要改代码**——`limit <= 0` 时 `quota.CheckAndIncrementLookup` 直接返回、**一行都不写**，所以带着 `dictionary-lookup-daily = 0` 上线等于**不积累任何用量数据**。根因是「计数」和「拦截」共用同一个开关。**→ 2026-09-16 已按 [`adr-029`](../architecture/adr-029-lookup-quota-tiered-limits-and-count-gate-split.md) 改完并上线就绪**：配额改成人人有额度的**分档模型**，**计数与拦截已解耦**（`limit <= 0` = 照常计数、不拦截）。配置项现为 `stripe.quota.dictionary-lookup-daily-free` / `-subscribed`，**两者保持 0 上线**，2–4 周后拿真实分布定数字（→ §8）。

---

## 2. 计费 —— 代码遗留待办

- [ ] **2.1** 移除 `CheckoutTopup` 的「必须有 active 订阅否则 403」校验（`enx-api/billing/handler.go`）。2026-08-26 决策已改为「有积分余额即可用 AI，不限来源」，这条校验现在与决策矛盾。
- [ ] **2.2** 核对三档订阅链路端到端一致：`config.toml [stripe.price]`（`pro` / `pro-plus` / `max` → lookup_key）、`billing/handler.go` 的 plan 参数校验、`billing/stripe/checkout.go` 按 lookup_key 解析 Price、`enx-ui` `plans.ts`。代码结构已是三档，需一次通读确认没有遗留的「monthly/annual」两档假设。
- [ ] **2.3**（仅当 §0.3 决定上线支持年付）实现独立于 Stripe 账单周期的月度积分发放：定时任务扫 `status=active` 的订阅，`credit_accounts.period_end` 过期就发下月额度。`invoice.paid` 对年付一年只触发一次，与账本「每月发、不结转」对不上。设计已在 `w10n-config/enx/HANDOFF-stripe-billing-integration.md` §4.4 讨论，未编码。
- [ ] **2.4** `ManagedPayments` 假设未验证：`billing/stripe/checkout.go` 建 Checkout Session 时没显式设置该字段，赌 Stripe 账号级配置自动生效，从未用真实请求验证。§3 联调时确认。
- [x] **2.5** **清理 ADR-015 遗留的自建认证死代码；保留 Resend 给管理员通知**（2026-09-16 查证；**2026-09-21 修订并落地**，见 [adr-010](../architecture/adr-010-x-tweet-page-support.md) Decision 13）：
  - **已删除**：`Register` / `Login` / `VerifyEmail` / `ForgotPassword` / `ResetPassword` handler、认证邮件模板、`cmd/send-test-email`、`register_test.go` 与相关 e2e Skip 用例。认证全部走 Clerk（`adr-015`）。
  - **已保留并改用途**：`email/` 的 Resend 发送能力 → `NotifyAdminPageReport`（页面上报成功写入后通知管理员）。配置：`RESEND_API_KEY`、`RESEND_FROM`、`RESEND_ADMIN_TO`。

---

## 3. Stripe webhook 打通 + 端到端联调（从未真实跑过）

- [ ] **3.1** homelab webhook 转发恢复：`enx-stripe-cli` pod（`w10n-config/infra/homelab/k8s/enx/deployment-stripe-cli.yaml`）此前卡在 Nexus 镜像封锁（冷却到 2026-08-27）。确认 pod 已 Running，并把 stripe-cli 日志里的真实 `whsec_...` 回填进 `enx-stripe` Secret 的 `webhook_secret`（当前是占位 `whsec_placeholder`），`kubectl rollout restart deployment/enx-api -n enx`。命令见 `w10n-config/infra/homelab/k8s/enx/README.md`「stripe-cli 转发部署」。
  - ⚠️ 该密钥每次 pod 重启都会变（stripe-cli 限制），切到生产固定 endpoint 后无此问题。
- [ ] **3.2** homelab 完整闭环冒烟：注册 → Clerk 登录（Google / GitHub / 邮箱各一遍）→ 订阅某档 → 积分到账（webhook `invoice.paid` → `GrantSubscription`）→ 用 AI 翻译，确认按 token 扣积分（查 `credit_transactions`）→ 积分耗尽返回 402 → 充值 → 余额增加 → Customer Portal 退订 → `status` 变更、权限收回。
- [ ] **3.3** 建 Live（生产）Stripe workspace：目前只有 Sandbox。用 OpenTofu workspace 区分（`infra/stripe/opentofu/enx/` 已按此设计），Live 那份配置在切换收费时建。

---

## 4. Clerk 生产实例切换

> 完整清单见 [`TASK-SPEC-enx-clerk-production-cutover.md`](./TASK-SPEC-enx-clerk-production-cutover.md)（状态：**§1–§3 完成 2026-09-18**）。生产实例 `sz5x08ornsg5` 已建成，`clerk.catglish.com` 可用。**三端仍指向 development 实例** `rational-deer-4450` —— 切换就是下面 4.4。要点：

- [x] **4.1** ~~Clerk dashboard 从 dev 实例 clone 出 production 实例~~ —— 2026-09-18 完成，实例 id `sz5x08ornsg5`。session token claim `email` / `name` 已核对存在。**Paths 不会被 clone**，已手配为 `catglish.com/sign-in` 与 `/sign-up`。
- [x] **4.2** ~~自建 OAuth 凭证~~ —— 2026-09-18 完成。Google client `694354922023-gc2tpc4h8...`（建在**既有的** `enx-oauth-prod` 项目里，不是新项目）、GitHub client `Ov23liagkTBa4JpBpc08`，回调均为 `https://clerk.catglish.com/v1/oauth_callback`，已实测 Clerk 确实在用这两套凭证。
  - ⚠️ Google consent screen 必须 Publish 到 **In production**，停在 Testing 只有白名单用户能登录。
  - ⚠️ OAuth client **无法用 OpenTofu 建**（`google_iap_brand` 需要 organization，个人项目没有），这步永远手工。
- [x] **4.3** ~~DNS~~ —— 2026-09-18 完成，5 条 CNAME 全部生效并由 `infra/cloudflare/opentofu/catglish/` 接管。**必须永远灰云**：橙云会导致 Cloudflare Error 1000，错误信息里看不出跟 Clerk 有关。
- [ ] **4.4** 部署环境变量切换（`w10n-config`）：
  - ✅ `<id>` 部分已提前填好（2026-09-18，不等 §4.1–4.3）：`infra/aws/ansible/ec2-tokyo/templates/enx-api-prod.env.j2` 的 `CLERK_AUTHORIZED_PARTIES` 与 `enx-ui-prod.env.j2` 的 `ENX_EXTENSION_ID` 都已换成正式 extension id `combdcldlodkikjfhjbdbogjlfmnbjkf`（不是 §6.1 完成就能定的——两个模板此前各留了 `REPLACE_WITH_WEB_STORE_ID` 占位符）。`ENX_EXTENSION_WEB_STORE_URL` 仍留空：item 还是草稿，公开 listing URL 会 404，等 §6.1 真正提审通过后再填。
  - enx-api：`CLERK_ISSUER` → `https://clerk.<域名>`（当前硬编码 `rational-deer-4450.clerk.accounts.dev`）、`CLERK_AUTHORIZED_PARTIES` 的 origin 部分（`https://{{ catglish_site_domain }}`）仍是模板变量，等 §0.1 的域名落地 DNS 才能渲染出真实值
  - enx-ui：`CLERK_PUBLISHABLE_KEY` → `pk_live_...`、`CLERK_SECRET_KEY` → `sk_live_...`（生产为 `/opt/enx/enx-ui.env`，homelab 为 Secret `enx-clerk`）。**都是运行期读取，改完重启即可，不用重新构建镜像**（ADR-031 修订记录 2026-09-18）
  - enx-chrome：`VITE_CLERK_PUBLISHABLE_KEY` / `VITE_CLERK_SYNC_HOST` 等写进 `enx-chrome/.env.production`（Vite 按 mode 自动加载），或直接改 `src/config/targets.ts` 的 `production` 目标 —— 后者是 single source of truth，留着 `enx.wiloon.com` 的旧值迟早会打出错包。**`host_permissions` 不用手改**：`clerkFrontendApiHost()` 从 publishable key 里 base64 解出 Clerk 域名，换 key 后 manifest 自动跟着变 → `pnpm package:webstore` 重新打包上架
  - **Clerk `allowed_origins`**：用 `sk_live_` 调 `PATCH https://api.clerk.com/v1/instance`，把 `chrome-extension://combdcldlodkikjfhjbdbogjlfmnbjkf` 加进去，否则扩展 syncHost 免登不工作。**dev 实例上做过不算**，生产实例要用生产 secret key 重做一遍。
- [ ] **4.5** 验证：三种登录均落回登录态、`/api/me` 200；扩展在网站登录态下打开应免登（`syncHost`）；enx-api 日志确认验签用的是 prod issuer。
  - **阻塞**：需要生产站点可访问，而 `catglish.com` 目前 502 —— origin 证书与 nginx vhost 已就位，但 `RUNBOOK-enx-prod.md` §3.4（`enx-deploy.sh`、systemd unit、ECDICT）还没跑。
- [ ] **4.6** dev 实例 `rational-deer-4450` 保留给 homelab / 本地开发，不删。

---

## 5. 部署环境 / 域名基础设施

> §0.1（`catglish.com` / `api.catglish.com`）与 §0.2（AWS EC2 东京单机）均已拍板，以下按该路径执行。

- [x] **5.1 生产 CI/CD** —— 2026-09-17 建好。**打 tag 部署，两套流水线各司其职**：

  | 触发 | 流水线 | 目标 |
  | --- | --- | --- |
  | push `main` | Tekton + ArgoCD（`task deploy:homelab`） | homelab = staging，**不动** |
  | push tag `v*` | `.github/workflows/deploy-prod.yml` | GHCR → SSH → EC2 东京 = 生产 |

  homelab 那套**不能**管生产：Tekton 推的是集群内 Nexus（`nexus.nexus.svc.cluster.local:8086`，外网拉不到），ArgoCD selfHeal 也只对着 homelab 集群 —— 而且家里断网就发不了 hotfix。
  - `deploy-prod.yml` 一个 tag **同时发 api 和 ui**（两者共享 Clerk 实例、CORS 白名单、extension id，版本漂移会变成难查的 401）。
  - ~~`NEXT_PUBLIC_*`（含 Clerk pk）是 **build-time 注入**~~ —— 2026-09-18 起 enx-ui 全部改为**运行期**读取（ADR-031 修订记录），生产镜像与 homelab 镜像可互换；两条流水线都不再传部署相关 build-arg，fail-fast 检查已删除。
  - 主机侧逻辑在 `w10n-config/infra/aws/ansible/ec2-tokyo/files/enx-deploy.sh`（Ansible 分发）：先 pull 两个镜像再重启，健康检查失败会提示回滚命令。**回滚 = SSH 上去 `sudo enx-deploy.sh <旧 tag>`，不依赖 GitHub。**
  - 待办：在 GitHub 配 Secrets `PROD_HOST` / `PROD_SSH_USER` / `PROD_SSH_KEY`，Variables `PROD_API_BASE_URL` / `PROD_SITE_BASE_URL` / `PROD_CLERK_PUBLISHABLE_KEY` / `PROD_EXTENSION_ID`；GHCR 包**保持 private**，改为在主机上 `sudo nerdctl login ghcr.io`（classic PAT，仅 `read:packages`，须带 `sudo`，因为 `enx-deploy.sh` 以 root 拉取）—— 步骤见 w10n-config `RUNBOOK-enx-prod.md` §3.5。不设 public 的原因：包可见性无法用 OpenTofu 或 API 管理，且包要等首次构建后才存在，「先设 public」在顺序上走不通。
- [ ] **5.2** 生产 DNS / TLS / CORS：确认 `<生产域名>` 与 `<api 域名>` 的解析、证书、`enx-api` CORS 白名单、`enx-chrome` `host_permissions` 全部指向新构建，无 Cognito 时代遗留配置。
- [ ] **5.3** 生产数据库：决策是「上线继续用 SQLite + S3 备份」，Postgres 迁移明确排到上线后。确认生产环境的 SQLite 持久卷 + 备份链路就绪。
  - ✅ 2026-09-17 决定：**生产从空库起**，不从 homelab 带数据（homelab 的 `enx.db` 只有作者自测数据）。
  - ✅ ECDICT `stardict.db`（~850MB）由 **部署脚本从上游 release 直接下载到机器**（`install-enx-prod.yml`，版本**固定**在 `1.0.28`），不从 homelab 拷、也不打进镜像（打进去等于每次 pull 多背 850MB）。
- [ ] **5.4** Stripe Live webhook endpoint 指向 `<api 域名>/billing/webhook`，重新验证签名与公网可达性（`infra/stripe/opentofu/enx/` 加第二个 `stripe_webhook_endpoint`）。
- [ ] **5.5** 生产环境完整端到端冒烟（§3.2 的全流程，在生产域名 + Clerk prod + Stripe live 上重跑一遍）—— **最终发布门禁**。
- [ ] **5.6** 确认 `enx-api` 的 AI provider 生产配置（MiniMax `MiniMax-Text-01`，当前指向 `api.minimaxi.com` 国内 host）在生产网络环境可达。
- [ ] **5.7** 观测：`enx-ui` 已接 Sentry（`sentry.*.config.ts`），确认生产 DSN 配好；`enx-api` 日志采集到位（billing / auth 关键路径）。

---

## 6. Chrome Web Store 上架

- [x] **6.1** 创建 Web Store 开发者账号，**上传草稿**拿到**正式 extension id**（不需要提交审核）—— **2026-09-18 完成**。
  - **正式 extension id：`combdcldlodkikjfhjbdbogjlfmnbjkf`**（取代旧 dev id `omcdpipnjffmblbhiphddcmoldceapam`，两者结构一致，都是 `SHA256(DER(key))` 前 16 字节按 a–p 映射）。
  - Package 页公钥已抄回 `enx-chrome/manifest.json` 的 `key`，本地 unpacked 加载的 id 现在与商店 id 一致。
  - 所有硬编码旧 dev id 的地方（`enx-api/config.toml` 的 Clerk `authorized-parties`、`enx-chrome/scripts/homelab-smoke.mjs`、`enx-chrome/README.md`、`enx-chrome/docs/HOMELAB_LOGIN_E2E.md`、`enx-chrome/scripts/package-webstore.mjs` 注释、`adr-019`、`TASK-SPEC-enx-chrome-oauth-background.md`，以及 `w10n-config/infra/homelab/k8s/enx/deployment.yaml` 的 `authorized-parties`）已同步替换为新 id。§4.4 的 `CLERK_AUTHORIZED_PARTIES` 现在可以定了。
  - ⚠️ `host_permissions` 仍有 `http://*/*` + `https://*/*`。拿 id 不受影响，但**真正提交审核时**会触发 broad-permissions 说明流程，明显拖慢审核 —— 尚未收窄。
  - **账号身份**：$5 注册费已付。按 DSA 声明为 **trader**（理由：§0.4 要卖订阅，DSA 的 trader 定义是「出于贸易/商业/职业目的行事的自然人或法人」，与有没有公司无关）。当前停在 **Publisher Account Verification**（见 §6.1a），审核中不阻塞已完成的上述工作。
- [ ] **6.1a** **Publisher verification（trader 身份的后果，2026-09-18 新增）**
  - trader 要提交并验证：**法定姓名 + 街道地址 + 电话 + 邮箱**。个人主体**不需要 D-U-N-S**（那是组织主体才要的）。
  - ⚠️ **姓名必须与 `legal.ts` 的 `operatorName`（`YUE WANG`，护照拼写）和收款账号一致** —— 三处对不上，验证或 Stripe 入驻会卡。
  - ⚠️⚠️ **这些信息会公开显示在商店 listing 上**，不是私下验证。这直接推翻了 §6.2 里「Web Store 只在私下验证时收取地址」的判断。**要准备一个能收信、可验证的非住宅地址**（家人的公司 / 虚拟办公 / 代收点），Google 会往该地址寄验证或要证明文件。
  - 验证有截止期限，逾期会影响分发；但**通常不阻塞 Add new item**，所以拿 id 可以和验证并行推进。
- [x] **6.2** 隐私政策页 + 服务条款页 + 退款政策页 —— **2026-09-17 起草完成**，作为官网静态页：`/privacy`、`/terms`、`/refund`，页脚新增 Legal 一栏，三条都进了 `sitemap.ts`。
  - **三条独立的硬性要求**，不是只有 Web Store 要：① Web Store 要求处理个人数据的扩展提供隐私政策 URL；② **Stripe 商户要求网站有服务条款 + 退款政策 + 可联系方式**；③ 退款规则写在收费之前才有约束力。
  - **占位符集中在 `enx-ui/src/lib/legal.ts`**（同 `site.ts` 的惯例）。已填实：署名 **YUE WANG**（护照拼写，务必与 Web Store 开发者账号 / 收款账号一致）、管辖 **中华人民共和国**（个人常居地）、托管地 `ap-northeast-1 (Tokyo, Japan)`（§0.2）、邮箱 `support@` / `privacy@catglish.com`（§0.1，**已 apply 并验证可收信**）。**只剩 `effectiveDate` 一个 TODO**（填上线日）。
  - ⚠️ **主体改为「个人」（2026-09-18 用户决定）**。一度按 **星钺（大连）科技有限公司** 写过一版，已全部回退：三页现在明写「由一个人运营、没有公司、没有团队」，`legal.ts` 的 `companyName` / `companyAddress` / `courtVenue` / `incorporatedOn` 都换成了 `operatorName` + `operatorRole`。**官网三页不公布街道地址** —— 个人住址不该上公开页面。⚠️ **2026-09-18 更正**：原文「Web Store 与 Stripe 都只在私下验证时收取」对 Web Store **不成立** —— 账号已声明为 trader，姓名 / 街道地址 / 电话会公开列在商店 listing 上（见 §6.1a）。官网三页仍可不写地址，但商店页面上会有一个，两者必须是同一个地址。测试 `legal.test.tsx` 有一条守着这件事（页面里不得再出现「有限公司 / Xingyue」）。
  - ⚠️ **测试里有一个故意失败的哨兵**：`enx-ui/src/app/__tests__/legal.test.tsx` 的 `it.failing('has no unfilled placeholders…')`。占位符填完后它会由「预期失败」变成「意外通过」而报错，那就是提醒把 `it.failing` 改回 `it`。
  - ⚠️ **退款立场（2026-09-17 拍板）**：订阅首次扣费 **7 天无理由全额退**；未消费积分**随时可退**；已消费积分不退（AI 成本已实际发生）。改这个立场要同步改 `legal.ts` 的 `subscriptionRefundDays` 和 `/refund` 的正文。
  - ⚠️ **政策与代码必须对齐，否则政策是虚假陈述**。隐私政策明写「不存 URL / 标题 / 阅读时刻」（由 `daily_stats` 没有那几个列来保证，见 `adr-028` Decision 10）。
  - **AI provider（2026-09-18 更正）**：生产只用 **AWS Bedrock 上的 Anthropic Claude**，与 EC2 同 region。`aitranslate/` 里的 kimi / minimax / **deepseek** 是给 homelab 和未来可能的大陆境内部署留的，**不在生产启用，因此不写进面向公众的隐私政策**。⚠️ 若生产改用其中之一，`legal.ts` 的 `AI_PROVIDER` 与 sub-processor 列表必须**同一个 commit 改掉** —— 隐私政策写错接收方是虚假陈述，不是文档滞后。
- [ ] **6.2a** **Sentry 采样**（2026-09-18 复核后降级，不是上线阻塞项）
  - **先前的判断说重了，已更正**：一度记为「Sentry 里躺着用户在读的页面 URL，政策与实现冲突」。逐条查证后结论是**不冲突**：① content script **没有**初始化 Sentry（`initSentry()` 只在 popup / options / sidepanel 调用），扩展在第三方网页上不往 Sentry 发任何东西；② Session Replay 的 `maskAllText` / `maskAllInputs` / `blockAllMedia` 在 `@sentry/replay@7.120.4` 与 `@sentry-internal/replay@9.46.0` **默认均为 true**，所以侧边栏里渲染的 `sourceUrl`、`/reader` 里粘贴的原文，在录像中都是遮罩的；③ `sourceUrl` 只写 `chrome.storage.session`，**从不发给 API**（`handleOpenSentencePanel`）。
  - **仍值得做，但是成本/整洁问题**：`tracesSampleRate: 1.0` 是 100% 性能采样，会把**我方自己的 API 请求 URL**（如 `/api/word/<word>`，路径里带查询的单词）送进 Sentry。这不是新增数据类别（`user_dicts` 本来就存），但等于在美国多了一份词表副本 —— 已据实写进隐私政策的 sub-processor 表。建议降到 0.1，并在两个 config 里**显式**写出 `maskAllText: true`（本来就是默认值，显式写是为了不被人无意中关掉）。
- [x] **6.2b** **中英双语法律页 —— 2026-09-18 已做**。用户决定同时提供两版，中文版在 `/zh/privacy`、`/zh/terms`、`/zh/refund`。
  - **不是切换而是独立 URL**：每一版都有自己可链接、可收藏、可引用的地址 —— 「你同意的是哪一版条款」必须是个能指出来的东西。每页右上角有语言切换按钮，双向可达；页脚加了一条「中文条款」入口；六条全部进 `sitemap.ts`，并用 `alternates.languages` 声明互为译本。
  - ⚠️ **中文版声明「以中文版为准」**（`LegalPage` 的 `translationNote`）。理由：运营者常居中国大陆、管辖写中国法、用户是中文用户 —— 真出争议时法院看的是用户实际读到的那一版；服务着中文消费者却主张「以英文为准」，恰恰是法院不认的姿态。**这是我替你选的，值得找律师确认一次。**
  - **《民法典》第 496 条**要求提供格式条款一方对免除/减轻自身责任的条款尽到提示说明义务。因此中文版把「7. 关于准确性」和「11. 责任限制」各自单独成节、标题带「请务必读这一条」、正文加粗，而不是埋在段落中间。`legal.test.tsx` 有一条守着第 11 条必须是独立小节。
  - **防漂移**：`legal.test.tsx` 比对两版的小节数量（`h2` 计数必须相等），并检查双向语言链接、`lang="zh-Hans"`、以及「不是一家公司」的表述在中文版同样存在。sub-processor 表的中英文字段在 `legal.ts` 同一个对象里 —— 新增服务商漏了 `*Zh` 字段是**类型错误**，而不是一个悄悄回落成英文的中文页。
- [ ] **6.2c** ⚠️ **PIPL 数据出境**（主体改个人后依然成立：PIPL 管的是「个人信息处理者」，自然人对外提供服务同样落入） —— 大陆主体 + 服务器在东京 = 个人信息出境（PIPL 第 38 条）。2024《促进和规范数据跨境流动规定》给了豁免口子：非关基运营者、一年内向境外提供不满 10 万人非敏感个人信息可免安评 / 标准合同 / 认证。**初期大概率落在豁免内**，但要：① 记录用户量，逼近 10 万时提前启动标准合同备案；② 隐私政策已披露存储地与接收方（已做）；③ 取得用户单独同意（注册流程里的条款勾选要覆盖出境这一项）。**建议找律师确认一次**，我不是律师。
- [ ] **6.2d** ⚠️⚠️ **Stripe 与中国大陆 —— 可能阻塞整条付费链路，请尽早核实**。Stripe 标准商户入驻的支持国家/地区列表**不含中国大陆**（支持香港、新加坡、美国等）。⚠️ **改成个人主体并不能绕开这一条** —— Stripe 卡的是**所在国家/地区**，不是公司还是个人；大陆自然人同样不在支持列表。若开不了户，§2 / §3 的整套订阅 + 积分实现就没有收款通道。可能的出路：Stripe 的跨境商户专项、换用支持大陆的收单（Paddle / LemonSqueezy 这类 MoR，或支付宝 / 微信支付），或用境外关联主体。**这一条我没有把握，需要你直接找 Stripe 确认**，因为它决定 §0.4 定价和 §2 全部工作是否成立。
- [ ] **6.3** Web Store listing 素材：图标、截图、宣传图、简介。
- [ ] **6.4** `adr-013` 里官网的 Chrome Web Store 链接 / id 占位替换成真实值。

---

## 7. 官网 / 上线物料（`adr-013` 遗留占位）

- [ ] **7.1** 演示视频（当前是 16:9 占位容器，通过常量开关接入，不阻塞但推广前需要）。
- [ ] **7.2** 产品截图、OG 图（社交分享卡片）。
- [ ] **7.3** `/pricing` 公开页（`adr-013` v1 未做，`/billing` 是登录后的页）。上线收费时需要一个免登录可见的定价页。
- [ ] **7.4** 品牌统一：对外一律用 **`Catglish`**，把 UI 上残留的 `ENX` / `Catseye` / `enx Pro` 全部换掉（命名决策见 `adr-010`（已 Superseded）与 `starlabrys/ops` 的 `docs/product/ADR-0004-enx-product-name.md`；2026-09-16 用户再次确认）。

  **原则（用户 2026-09-16 确认）：`ENX` 是本项目的开发代号，继续保留。** 后端代码、非 UI 代码、内部标识符、日志前缀、代码注释**一律不动**——不为改产品名去动不需要动的代码。**只改用户看得见的那一部分。**

  在此之上还有一条：下面第二组里的标识符**长得像品牌名，实际是协议的一部分**，改了会静默地弄坏功能。

  **产品只有一个英文名 `Catglish`，没有中文名。** 且**不再保留任何「猫眼 / cat's eye」相关表述**（商标冲突风险），包括配色理由里的「猫眼星云」。

  **① 要改的（用户可见）**

  - `enx-ui` —— **2026-09-16 已全部完成**（随 `adr-027` 阶段 1 一起落地）
    - [x] `src/lib/site.ts` — `SITE.name` + `subtitle` 整段文案
    - [x] `src/app/layout.tsx:13` `title`、`src/app/page.tsx:17,19` metadata title/description
    - [x] `src/components/site/{InstallCTA,FeatureSection,HowItWorks}.tsx` 正文里嵌在句子中的 `Catseye`
    - [x] `src/app/(app)/app/page.tsx` — 随 `adr-027` 重写一并处理
    - [x] `src/components/app/app-nav.ts:67` — `navTitleForPath` 的兜底返回值
    - [x] `src/app/(app)/reader/page.tsx:163,166`、`src/app/extension/connected/page.tsx:40` — 面向用户的 "the ENX extension"
    - [x] `src/app/(app)/billing/plans.ts:24,31,38` — `enx Pro` / `enx Pro+` / `enx Max`（2026-09-16 随 `adr-029` 一并改完，同时把三条 description 里不可兑现的 "Unlimited lookups" 改掉）
  - `enx-chrome`
    - [x] `manifest.json`（2026-09-16）— `name` → `Catglish - Learn English as you read the web`（**44 字符，压在 Web Store 标题上限 45 以内**）、`description` 重写（124 字符 / 上限 132）、`action.default_title` → `Catglish`、`commands.description`。`key` 未动，**扩展 ID 不变**
    - [x] `popup.html` / `options.html` / `sidepanel.html` 的 `<title>`（2026-09-16）
    - [x] `src/popup/Popup.tsx`、`src/components/Login.tsx`、`src/options/Options.tsx`（2026-09-16）。**清单原先漏了 `Options.tsx` 的 h1 `Enx Extension Options`**，一并改掉
    - [x] `src/background/background.ts` — 通知标题 `Signed in to Catseye` → `Signed in to Catglish`（2026-09-16）
    - [x] **清单原先漏掉、扫描时新发现的 10 处页面内可见提示**（2026-09-16）：`src/content/content.tsx` 的 8 处（「Saved. Click or right-click the **ENX** toolbar icon…」×6、登录/会话过期提示 ×2，都渲染在浮层里给用户看）、`src/lib/siteAdapters.ts` 的 2 处 `pageSupport` 文案（X 非推文详情页、enx-ui 非 Reader 页时 `enxRun` 中止并把这句话显示给用户）
    - 未动（按「只改用户可见」原则）：代码注释、`console.log` 前缀 `[ENX Config]`、`isEnxEnabled` / `enableEnx` / `ENX_UI_ORIGINS` / `ENX_UI_HOSTS` / `isEnxUiHost` 等内部标识符、调试用的 `'Hello from ENX background!'`、未被引用的 `HelloWorld.tsx`、`test-*.html` / `config-check.html` 等开发页
    - 验证：`tsc --noEmit` 通过，`pnpm test` 18 suites / 186 tests 全绿，`pnpm build` 通过
  - `enx-api`（面向用户的响应文案）—— **2026-09-16 已完成**（随 `adr-029`）
    - [x] `dictionary/lookup.go:95` — 429 文案。`unlimited` 已去掉，改成「a much higher daily limit」；并区分免费用户（引导升级）与订阅用户（账号异常，引导联系支持）
    - [x] `billing/handler.go:109` — `an active Catglish Pro (or higher) subscription is required...`
    - ~~`email/email.go` 的邮件标题~~ —— **不在品牌改名范围内。** 认证邮件是死路径；`email/` 按 §2.5 / adr-010 Decision 13 **收窄为管理员通知**，新文案用 Catglish，不改历史 ENX 认证模板（那些随 handler 删除）。
  - `w10n-config`（Stripe，用户在结账页和收据上看得到）
    - [x] `infra/stripe/opentofu/enx/main.tf` — `stripe_product.*.name`（→ `Catglish Pro` / `Pro+` / `Max` / `AI Credits Top-up`）与 `description`（"unlimited dictionary lookups" 已改成「a much higher daily dictionary lookup limit」）。2026-09-16 **已 `tofu apply`（sandbox / `default` workspace）4 changed**，`lookup_key` 与价格 ID 未变。⚠️ **live mode 目录尚未建立**，上线时要在 `live` workspace 重做一遍
    - [ ] 遗留漂移：`stripe_webhook_endpoint.billing_lab` 的 `url` 在 Stripe 上仍是旧域名 `enx-lab.wiloon.com`，而 `variables.tf` 已随域名迁移改成 `enx-api.wiloon.lab`。本次用 `-target` 跳过了它，**下次任何不带 `-target` 的 `tofu apply` 都会把它一起带上**。两个 URL 公网都不可达（开发期靠 stripe-cli 转发），所以改与不改不影响当前链路
    - [x] **Clerk 应用显示名**（2026-09-17）——`enx` → `Catglish`，Support email 一并填了。已验证 `https://rational-deer-4450.accounts.dev/sign-in` 显示 "Sign in to Catglish"、标签页 "My account | Catglish"。
      - 路径：**Configure 标签 → 左侧菜单拉到最底部 `Application` 分组 → `Settings` → Application details → Application name**。⚠️ 左侧菜单里**有两个 `Settings`**：`Instance` 分组下那个**不含**应用名，`Application` 分组下（菜单最底部，容易滚过去）那个才对。
      - 同页还有未做的：**Logo / Favicon 都没上传**（登录页和 Clerk 邮件会用）；"Remove Secured by Clerk branding" 需要 Pro 计划，Hobby 用不了。
      - 该字段说明原文：*"Customize the name of your application. Used in the dashboard and with Clerk components."* —— 登录页那句 `Sign in to ...` 就来自这里。
      - **建生产实例时直接填 `Catglish`**（§4 Clerk 生产切换）：dev 和 prod 是两个独立实例、各有各的应用名，不要事后才想起来改。
      - 清理记录：2026-09-17 删掉了两个同名 `enx` 的孤儿应用（`relaxing-sunfish-5757`、`credible-chicken-3147`，两个仓库里零引用），只留 `rational-deer-4450`。三个同名应用并存时极易改错实例。
      - 记一个坑：实例 ID 是 `ins_3IqqlDCeP4K55bcIp1Ebadk8LP0`，中间是**大写 I** 不是小写 l，手抄 URL 会打不开。
    - [ ] Chrome Web Store 上架条目的名称 / 简介（§6）

  **② 不要改的（改了会坏）**

  | 标识符 | 在哪 | 为什么不能动 |
  | --- | --- | --- |
  | `data-enx-extension` / `dataset.enxExtension` | `enx-chrome` 内容脚本写、`enx-ui` `useExtensionStatus` 读 | `adr-019` 定的网页↔扩展探测契约，两端必须同时改才不断，收益为零 |
  | `enx-hl-*` / `enx-active-sentence` | `WordProcessor` 的 CSS Highlight API 注册名 | 注册名 + `::highlight()` 选择器必须对得上 |
  | `enx-reader-open-doc` | `/reader` 与 `/reader/history` 之间的 sessionStorage 键 | 改了会让用户已存的会话数据读不出来 |
  | `ENX_UI_ORIGINS`、消息类型（`enxRun` / `getOneWord` / …） | 扩展内部 | 纯内部标识符，改名只增加 diff |
  | Stripe `lookup_key`（`enx_pro_monthly` 等） | `main.tf` | **最危险的一个**：代码按 `lookup_key` 解析价格，改了会直接查不到价。`name` 可改，`lookup_key` 必须保持原样 |
  | 仓库名 / Go module 路径 / 包名 / `enx-*` 目录名 | 全仓 | `enx` 继续作为内部代号，`adr-010` 原本就是这个分工 |

  **③ 顺带确认**

  - [x] `enx-ui/src/app/globals.css` 里 `--brand` 的注释（2026-09-16 完成）——猫眼星云那句已整段删掉，hue 200 避开 239–270 扎堆区间的理由保留。查证：`enx-chrome/src/index.css` 的镜像注释**本来就没有**猫眼表述，无需改动
  - [x] 全仓搜一遍 `猫眼` / `cat's eye` / `Catseye`（2026-09-16）：`enx-ui/src` 已清零；**`enx-chrome` 与 `enx-api` 仍待改**（见上方 ① 的对应小节）
  - [ ] **README 已加命名说明**（2026-09-16 完成）：`ENX` = 开发代号，`Catglish` = 产品名，无中文名
  - [ ] **Git 仓库改名**：用户明确**这次不做**，以后再说。届时要连带处理 Go module 路径、CI、部署清单、`w10n-config` 里的引用
  - [ ] 改完全仓 `grep -rnE "Catseye|ENX -|enx Pro"` 复查一遍，排除 `__tests__` 和 ADR 历史记录（**ADR 正文里的历史表述不要改**，那是决策记录，改了就失真）

---

## 8. 上线后（不阻塞发布）

### P1 —— 推广前建议补

- [ ] 免费查词每日配额定具体数值（依赖 §1.5 的 ADR-029 改造先落地，否则没有数据可依据）。两档都要定：`free` 和 `subscribed`（后者是滥用天花板，不是产品档位）。
- [ ] 积分档位、配额数值按真实使用数据微调。
- [ ] `aitranslate` token 权重按累积的真实 `cost=` 日志再校准一轮。

### P2 —— 明确延后

- [ ] SQLite → PostgreSQL 迁移（自托管优先，RDS 视免费额度）。
- [ ] Redis / ElastiCache / DynamoDB 缓存评估（含用 DynamoDB 做查词配额计数器）。
- [ ] WeChat 登录 + 国内推广 → 国内版独立部署，见 `adr-035`（双部署 + 资质前置条件）、`adr-036`（自托管 Logto）。二者均为 Proposed；资质申请周期以月计，可提前并行。
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
