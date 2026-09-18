# ADR-031：生产环境部署拓扑

| 字段 | 值 |
|---|---|
| **状态** | Accepted |
| **日期** | 2026-09-17 |
| **决策者** | wiloon |
| **取代** | 无。补上 `LAUNCH-CHECKLIST` §0.2 一直悬着的决策 |
| **相关** | [`adr-013`](./adr-013-catseye-marketing-site.md)（官网）、[`adr-015`](./adr-015-cognito-to-clerk-auth-migration.md)（Clerk）、[`adr-009`](./adr-009-billing-stripe-subscription-and-ai-credits.md) / [`adr-014`](./adr-014-sidepanel-clicked-word-and-token-billing.md)（计费）、[`adr-029`](./adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（配额） |
| **配置** | `w10n-config`：`infra/aws/opentofu/ec2-tokyo/`、`infra/aws/ansible/ec2-tokyo/`、`infra/cloudflare/opentofu/catglish/` |

---

## 修订记录

- **2026-09-18（上线前）**：enx-ui 改为**运行期配置**，镜像从此环境无关。原先 `NEXT_PUBLIC_*`（Clerk publishable key、API 地址、站点域名、扩展 id）在 `next build` 时被内联，生产镜像与 homelab 镜像是两个产物。现在：
  - `ClerkProvider` 接收 `publishableKey` prop，root layout 每次请求读 `process.env`
  - 浏览器只打同源 `/api/*`，由 `next.config.ts` 的 `rewrites()`（服务启动时求值）按 `API_BASE_URL` 反代 —— API 地址不再进 bundle，且没有 CORS
  - 浏览器需要的少量值（扩展 id）由 root layout 注入 `window.__ENX_ENV__`（`src/lib/runtimeEnv.ts`）
  - root layout 标 `force-dynamic`，避免静态预渲染把构建机的 env 冻进 HTML
  - 两条流水线（Tekton / GitHub Actions）因此都不再传任何部署相关 build-arg，`deploy-prod.yml` 的 fail-fast 检查随之删除

  Decision 6 的双流水线结构**不变**（理由仍成立：家里断网不能影响发版），但两边构建的现在是可互换的产物。

---

homelab（`enx.wiloon.lab` / `enx-api.wiloon.lab`）跑在局域网里，只有作者能访问。要让真实用户注册、订阅、使用，需要一个公网可达的生产环境。

手上的候选资源：AWS 账号（已有 `ec2-tokyo` 实例、S3 备份链路、Bedrock 可用）、4 台 VPS（racknerd / DMIT / BWG / vpsjp）、homelab k8s 集群。

约束：

- **`enx-api` 是 SQLite 单写者**。homelab 的 PVC 是 `ReadWriteOnce`，多副本会互相锁死。`LAUNCH-CHECKLIST` §5.3 已决定上线继续用 SQLite，Postgres 推到上线后。
- **`enx-ui` 是 SSR，不是静态站**。`next.config.ts` 是 `output: "standalone"`，且 `clerkMiddleware()` 在每个请求上跑服务端逻辑。
- **AI provider 目前指向中国 host**（`api.deepseek.com`、`api.minimaxi.com`），网络位置直接影响响应延迟。
- 那 4 台 VPS 全部在跑 Xray 翻墙节点（`w10n-config/infra/xray/xray-inventory.ini`）。
- 作者是独立开发者，运维时间有限；初期收入目标只是「追平服务器成本」。

## Decision

### 1. 单机，不分布式

生产 = **一台 EC2（`ec2-tokyo`，ap-northeast-1）** 上的两个容器：`enx-api`（:8091）和 `enx-ui`（:3000），都只绑 `127.0.0.1`，由 nginx 统一对外。

不拆多机。生产只有 2 个进程、各 request 128Mi，而 `enx-api` 的 SQLite 单写者特性意味着**没有可分的东西**——拆开只会增加一跳跨公网延迟和一套 TLS。

### 2. 不用那 4 台 VPS

两个理由，任一条单独成立：

- **网络位置**：3 台在美国，到 DeepSeek / MiniMax 的中国 host 路由明显差于东京。
- **共置风险**：它们是翻墙节点。节点 IP 被封会顺手带走付费用户的服务，反向也会污染节点画像。

### 3. AWS 而非其它 VPS 供应商

- AI provider 之外，**Bedrock 可以用实例角色（instance role）调用，不需要任何长期 access key**。这是 EC2 相对外部 VM 最实际的优势：off-AWS 就得自己保管和轮换一串永久密钥。
- S3 备份链路（EventBridge → Lambda → SSM → `enx-api-backup.sh`）本来就是照着这台 EC2 写的。
- 以后要接 RDS / ElastiCache 时零迁移成本。**ElastiCache 没有公网 endpoint**，「服务在外、缓存在 AWS」这个组合根本不成立——计算必须跟着数据走。

机型 `t3.small`（2GB）+ 30GB gp3。`t2.nano` 的 512MB 装不下 Next.js SSR。

### 4. Cloudflare 做 CDN，且 origin 用 Origin CA 证书

```
浏览器 --TLS--> Cloudflare 边缘 --TLS--> nginx (EC2) --> 容器
                (proxied=true)          (Origin CA 证书, 15 年)
```

选 Cloudflare 而非 CloudFront：`catglish.com` 本来就注册在 Cloudflare，Clerk 要求的那几个 CNAME 也在同一个 DNS 面板；免费档够用。

**关键细节：origin 证书不能用 Let's Encrypt。** certbot 的 HTTP-01 challenge 要求域名直接解析到源站 80 端口，而 Cloudflare 的代理会自己终止 TLS、永远不会把 challenge 透传过去。结果是 certbot **签发能成功一次**（代理关着时）、然后**每 60 天静默续期失败**，直到某天证书过期、站点挂掉。

Cloudflare Origin CA 证书没有这个问题：15 年有效、由 Cloudflare 代理信任。它**不被浏览器信任**——这是正确且预期的，因为没有浏览器会直连源站。Cloudflare 的 SSL/TLS 模式必须设成 **Full (strict)**。

缓存策略：只有 `/_next/static/`（Next.js 内容哈希过）被缓存；站点其余部分是 SSR（Clerk 决定登录用户看到什么），`api.catglish.com` **全部不缓存**——缓存任何一个都会把一个用户的页面发给另一个用户。

### 5. Clerk 的几个子域永远保持 DNS-only

`clerk.` / `accounts.` / `clkmail.` / `clk._domainkey.` / `clk2._domainkey.` 一律 `proxied = false`。Clerk 的域名验证和 TLS 终止都会在代理后面失败，且报错信息不会提到 Cloudflare——这是 Clerk 生产切换最常见的失败方式。

### 6. 发布走 tag，不走分支

| 触发 | 流水线 | 目标 |
|---|---|---|
| push `main` | Tekton + ArgoCD | homelab = staging |
| push tag `v*` | `.github/workflows/deploy-prod.yml` | GHCR → SSH → EC2 = 生产 |

homelab 那套不能管生产：Tekton 推的是集群内 Nexus（外网拉不到），ArgoCD selfHeal 只对着 homelab 集群，而且**家里断网就发不了 hotfix**。生产发布链路不能依赖作者家的电和宽带。

一个 tag **同时发 api 和 ui**：两者共享 Clerk 实例、CORS 白名单、extension id，版本漂移的表现是难查的 401。

主机侧逻辑在 `enx-deploy.sh`（Ansible 分发）而不是 workflow 里：**回滚是 SSH 上去跑 `sudo enx-deploy.sh <旧 tag>`，不依赖 GitHub 可用。**

### 7. 生产从空库起

不从 homelab 迁 `enx.db`（那里只有作者自测数据）。ECDICT `stardict.db`（~850MB）由部署脚本**从上游 release 直接下载**、版本固定在 `1.0.28`——不从 homelab 拷，也不打进镜像（打进去等于每次 pull 多背 850MB，换一个一年变一次的文件）。

## Consequences

**好的**

- 运维面小：两个 systemd unit + 一个 nginx + 一个脚本。没有为一台机器引入 k8s。
- 回滚快且不依赖外部服务。
- Bedrock / S3 全程零长期密钥。
- 成本可控：t3.small + EBS ≈ $20/月量级。

**要接受的**

- **单点**。没有冗余，机器挂了站就挂了。当前阶段（无真实用户、当 pre-production）可以接受，这是刻意的取舍而不是疏忽。
- **`enx-ui` 必须跑在一台机器上**，不能放 S3 / Pages。它是 SSR + Clerk 中间件，静态托管跑不了。
- ~~**生产镜像 ≠ homelab 镜像**~~ —— 见「修订记录 2026-09-18」：改成运行期配置后两者可互换，改配置只需重启容器。代价是 root layout `force-dynamic`，marketing / legal 页不再静态预渲染（由 Cloudflare 缓存兜住）。
- **Clerk 两个实例的用户库互相隔离**。homelab 的测试账号在生产上不存在；`ADMIN_CLERK_USER_IDS` 必须换成生产实例里的新 id，否则管理端点静默失效。

**已知待办（不阻塞本 ADR）**

- 这台 EC2 同时跑着 vaultwarden（个人密码库）。**在 Stripe 切 live / 真实用户进来之前**要把 enx 拆到独立实例，别让公网产品和密码库共享爆炸半径。
- 单点 + SQLite 的组合在有真实用户后需要重新评估（备份 RPO 目前是「每周一次」）。

## Alternatives considered

| 方案 | 否决理由 |
|---|---|
| 4 台 VPS 各部一部分 | 没有可分的东西（SQLite 单写者）；且它们是翻墙节点，共置风险 |
| 留在 homelab + 端口转发 | 家庭宽带的可用性和上行带宽不适合对外服务；家里断网 = 生产挂 |
| 单机上 k3s | 把「两个容器」的运维换成「一个集群」的运维，纯负债 |
| `enx-ui` 放 S3 + CloudFront | 它是 SSR，不是静态站（见 Consequences） |
| CloudFront 而非 Cloudflare | 域名和 Clerk 的 CNAME 都在 Cloudflare；CloudFront 要多一套控制平面 + ACM，且按流量计费 |
| certbot + Cloudflare 代理 | HTTP-01 续期在代理后面必然失败（见 Decision 4） |
| 继续用 homelab Tekton 发布生产 | 集群内 Nexus 外网拉不到；且发布依赖家里的网 |
