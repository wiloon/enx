# TASK-SPEC: Stripe 订阅 + AI 积分 + 免费查词配额

| 字段 | 值 |
| --- | --- |
| **状态** | Draft — 2026-08-12 |
| **类型** | SDD Task Spec（未来功能；实现前需 review） |
| **关联 ADR** | [`adr-009-billing-stripe-subscription-and-ai-credits.md`](../architecture/adr-009-billing-stripe-subscription-and-ai-credits.md)（架构决策与理由，本 Spec 只写落地细节） |
| **前置** | Cognito 登录已就绪（`enx-api/middleware/cognito_auth.go`）；`users` 表已有 `id`/`cognito_sub` 映射 |
| **目标** | 落地订阅收款、AI 调用积分扣费、免费查词每日配额三块机制 |
| **非目标** | 不确定最终定价/配额数值（占位符，产品侧定稿后回填）；不做反滥用/反刷单检测（见 ADR Revisit Trigger）；不做多档位订阅（先单一 "enx Pro"） |
| **触发原因** | enx 从免费产品转为订阅+AI 增值付费模式，需要接入 Stripe 并控制 AI/免费查词的成本敞口 |

---

## 1. 数据模型

新增 GORM 模型，加进 `enx-api/utils/sqlitex/sqlitex.go`（与现有 `User`/`Word`/`UserDict` 同一文件，`AutoMigrate` 统一管理），或拆到新文件 `enx-api/utils/sqlitex/billing_models.go`（实现阶段二选一，保持和现有文件组织习惯一致即可）。

### 1.1 `subscriptions`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | TEXT, PK | 对应 `users.id`（不是 cognito_sub） |
| `stripe_customer_id` | TEXT, unique index | |
| `stripe_subscription_id` | TEXT, unique index, nullable | 未订阅时为空 |
| `status` | TEXT | `active` / `past_due` / `canceled` / `none`，与 Stripe `subscription.status` 对齐 |
| `current_period_end` | INTEGER | Unix 秒，来自 Stripe，用于本地快速判断是否过期（不需要每次都调 Stripe API） |
| `created_at` / `updated_at` | INTEGER | Unix 毫秒，与现有 `words`/`user_dicts` 惯例一致 |

### 1.2 `credit_accounts`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | TEXT, PK | |
| `subscription_balance` | INTEGER, default 0 | 当月订阅发放的积分，月末作废不结转 |
| `topup_balance` | INTEGER, default 0 | 充值积分，长期有效 |
| `period_end` | INTEGER | 当前订阅积分对应的周期结束时间（Unix 秒），到点由续费 webhook 重置 |
| `updated_at` | INTEGER | Unix 毫秒 |

### 1.3 `credit_transactions`（只增不改的流水表，对账用）

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `id` | TEXT, PK | UUID，与 `words.id` 同惯例 |
| `user_id` | TEXT, index | |
| `type` | TEXT | `GRANT_SUBSCRIPTION` / `GRANT_TOPUP` / `CONSUME` / `EXPIRE` |
| `amount` | INTEGER | 正数为发放，负数为消耗 |
| `balance_after` | INTEGER | 记录该池子（订阅或充值，看 `type`）扣减/发放后的余额，便于排查纠纷时不用重算 |
| `stripe_event_id` | TEXT, nullable | 由 webhook 触发的记录填 Stripe event id，用于幂等去重（见 §3.3） |
| `feature` | TEXT, nullable | `CONSUME` 类型记录消耗来源，如 `translate_sentence` / `translate_word_in_context` |
| `created_at` | INTEGER | Unix 毫秒 |

### 1.4 `dictionary_lookup_quota`

| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `user_id` | TEXT | 联合主键 |
| `date` | TEXT | 联合主键，`YYYY-MM-DD`（UTC），每天一行 |
| `count` | INTEGER, default 0 | |

订阅用户（`subscriptions.status == active`）跳过这张表的检查，直接放行。

---

## 2. 新增 package：`enx-api/billing`

参照 `enx-api/aitranslate` 的结构（`factory.go` + `handler.go` + provider 子包），新增：

```text
enx-api/billing/
├── stripe/
│   ├── client.go       # 初始化 Stripe SDK client（stripe-go），STRIPE_SECRET_KEY 走 env var
│   ├── checkout.go     # 创建 Checkout Session（订阅 / 充值两种 mode）
│   ├── portal.go       # 创建 Customer Portal Session
│   └── webhook.go      # 验签 + 事件分发
├── credit/
│   ├── ledger.go        # 双池扣费/发放的事务性操作（对应 ADR Decision 第 5 点的条件更新）
│   └── ledger_test.go
├── quota/
│   ├── lookup_quota.go  # 每日查词配额检查与计数
│   └── lookup_quota_test.go
└── handler.go            # gin handler，注册路由
```

`billing/credit/ledger.go` 关键函数签名（示意，实现阶段可调整）：

```go
// Consume 按固定档位扣费，先扣 subscription_balance 再扣 topup_balance。
// cost 由调用方传入（各 AI 接口的固定档位常量，定义在 aitranslate 或 billing 包内，待定）。
// 返回 error 为 ErrInsufficientCredit 时，handler 应返回 402。
func Consume(ctx context.Context, userID string, feature string, cost int) error

// GrantSubscription 在 invoice.paid 时调用：清零上月 subscription_balance，发放本月额度。
func GrantSubscription(ctx context.Context, userID string, amount int, periodEnd time.Time, stripeEventID string) error

// GrantTopup 在充值 checkout.session.completed 时调用：累加 topup_balance。
func GrantTopup(ctx context.Context, userID string, amount int, stripeEventID string) error
```

---

## 3. API 端点

新增一个不需要 `cognitoAuth` 的路由组（webhook）和一组需要鉴权的路由组，注册方式参照 `enx-api.go` 现有的 `authGroup := router.Group("/"); authGroup.Use(cognitoAuth)` 模式（`enx-api.go:188-189`）。

| Method | Path | 鉴权 | 说明 |
| --- | --- | --- | --- |
| `POST` | `/billing/checkout/subscription` | cognitoAuth | 创建订阅 Checkout Session，返回跳转 URL；`client_reference_id` = `users.id` |
| `POST` | `/billing/checkout/topup` | cognitoAuth | 创建充值 Checkout Session（`mode=payment`），metadata 标记 `type=topup` |
| `POST` | `/billing/portal` | cognitoAuth | 创建 Stripe Customer Portal Session，返回跳转 URL |
| `GET` | `/billing/me` | cognitoAuth | 返回当前订阅状态 + 积分余额（供前端展示） |
| `POST` | `/billing/webhook` | **无**（Stripe 签名验证代替） | Stripe webhook 接收端点 |

### 3.1 `POST /billing/webhook` 处理的事件

| Stripe Event | 处理 |
| --- | --- |
| `checkout.session.completed` | 若 `metadata.type == topup`：`credit.GrantTopup`；否则视为订阅首次建立，写入/更新 `subscriptions` 表（`stripe_customer_id`、`stripe_subscription_id`） |
| `invoice.paid` | 订阅续费成功：`credit.GrantSubscription`（发放本月额度，清零上月剩余） |
| `customer.subscription.updated` | 更新 `subscriptions.status`、`current_period_end` |
| `customer.subscription.deleted` | `subscriptions.status = canceled` |
| `invoice.payment_failed` | `subscriptions.status = past_due` |

### 3.2 Webhook 路由暴露（w10n-config 侧）

`infra/homelab/k8s/enx/ingress.yaml` 当前 `path: /` 已经转发到 `enx-api:8091`，`/billing/webhook` 无需新增 Ingress 规则，自然可达。签名密钥 `STRIPE_WEBHOOK_SECRET` 比照 `enx-cognito` secret 的方式存成新的 k8s Secret（如 `enx-stripe`），在 `infra/homelab/k8s/enx/deployment.yaml`（Go 服务的 deployment，与 `deployment-java.yaml` 同目录）里通过 `secretKeyRef` 注入环境变量。

### 3.3 Webhook 幂等

`credit_transactions.stripe_event_id` 唯一索引；写入前检查该 event id 是否已处理过（已处理直接返回 200，不重复发放）。Stripe 官方会重试未返回 2xx 的 webhook，必须保证重放安全。

---

## 4. 计费/配额拦截点（改动现有代码）

### 4.1 AI 调用积分检查

`enx-api/aitranslate/handler.go` 的 `TranslateSentence` / `TranslateWordInContext` 在调用 `h.translator.XXX(...)` **之前**插入：

```go
if err := credit.Consume(c.Request.Context(), userID, "translate_sentence", costTranslateSentence); err != nil {
    if errors.Is(err, credit.ErrInsufficientCredit) {
        c.JSON(http.StatusPaymentRequired, gin.H{"success": false, "message": "积分不足，请充值或订阅"})
        return
    }
    // 其他错误按现有 502 惯例处理
}
```

`userID` 从 `cognitoAuth` 中间件注入的 context 取（参照 `GetMe`，`enx-api.go:388`，现有代码已有从 context 取当前用户的模式）。

**注意扣费时机**：先扣积分再调用 AI provider，避免"AI 调用成功但扣费失败"导致的免费薅取；但如果 AI provider 调用失败（网络错误/超时），需要把已扣的积分退回（`credit.Refund`，本 Spec 未展开，实现阶段一并设计），否则用户会因为服务故障被冤枉扣费。

### 4.2 免费查词配额检查

`enx-api/dictionary/`（统一查词入口，ADR-0001 提到的 `dictionary.Lookup`）在返回结果前插入配额检查：订阅用户跳过；免费用户检查 `dictionary_lookup_quota` 当日计数，超限返回 429（区别于查词失败的 503，语义上是"配额用尽"不是"服务不可用"）。

---

## 5. 配置

`enx-api/config.toml` 新增 `[stripe]` 段（比照 `[sentence-translate]` 的写法，密钥不进这个文件）：

```toml
[stripe]
# Publishable key 可以进配置文件（本身设计为公开），price id 也不敏感
publishable-key = ""
price-id-subscription = ""
price-id-topup = ""
# STRIPE_SECRET_KEY / STRIPE_WEBHOOK_SECRET 走环境变量，绝不进此文件
# （与 KIMI_API_KEY / RESEND_API_KEY 同惯例）
```

---

## 6. 分阶段实施计划

### Phase 0 — 数据模型与配置基线
- [ ] `sqlitex.go`（或新文件）新增 §1 四张表的 GORM 模型，`AutoMigrate` 覆盖
- [ ] `config.toml` 新增 `[stripe]` 段；`enx-stripe` k8s Secret（w10n-config 侧）
- [ ] 引入 `stripe-go` 依赖

### Phase 1 — 订阅与 Checkout
- [ ] `billing/stripe/checkout.go`：订阅 + 充值两种 Checkout Session
- [ ] `POST /billing/checkout/subscription`、`POST /billing/checkout/topup`、`POST /billing/portal`
- [ ] `GET /billing/me`

### Phase 2 — Webhook 与积分账本
- [ ] `billing/stripe/webhook.go`：签名验证 + 事件分发
- [ ] `billing/credit/ledger.go`：`Consume` / `GrantSubscription` / `GrantTopup`，含幂等
- [ ] 单元测试：并发扣费不超扣（模拟多个 goroutine 同时调用 `Consume`）

### Phase 3 — 接入现有功能
- [ ] `aitranslate/handler.go` 接入积分检查（§4.1）
- [ ] `dictionary` 查词路径接入配额检查（§4.2）
- [ ] `billing/quota/lookup_quota.go` 实现与测试

### Phase 4 — 前端（enx-chrome / enx-ui，另开 Spec 或在本 Spec 后续补充）
- [ ] 订阅/充值入口 UI，积分余额展示
- [ ] 402/429 响应的前端提示文案

---

## 7. 验收标准

- [ ] 完整走一遍 Stripe 测试模式：订阅成功 → `subscriptions.status = active` → AI 调用扣积分成功
- [ ] 取消订阅 → webhook 更新状态 → 下个周期不再发放积分
- [ ] 充值成功 → `topup_balance` 增加 → 积分不足时能用充值池继续消耗
- [ ] 并发调用 AI 接口时积分不超扣（§Phase 2 单元测试覆盖）
- [ ] webhook 重放同一个 event 不会重复发放积分
- [ ] 免费用户超过每日查词配额后返回 429，订阅用户不受限
- [ ] AI provider 调用失败时，已扣积分被退回（§4.1 注意事项）

---

## 8. 风险与决策记录

| 风险 | 缓解 |
| --- | --- |
| Webhook 伪造请求 | Stripe 签名验证（`STRIPE_WEBHOOK_SECRET`），拒绝验证失败的请求 |
| Webhook 重放导致重复发放积分 | `credit_transactions.stripe_event_id` 唯一索引 + 处理前查重 |
| 并发扣费超扣 | 条件更新 `WHERE balance >= cost`，SQLite 写操作本身单写者串行（见 ADR-009 Decision 第 5 点） |
| AI 调用失败但已扣积分 | 扣费失败路径需要退回逻辑（§4.1），Phase 3 实现时一并测试 |
| SQLite 高并发写瓶颈 | 早期流量下可接受，记入 ADR-009 Revisit Trigger，AWS 迁移时重新评估 |

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 订阅收款方式 | Stripe Checkout（非自建表单） | 见 ADR-009 Options A |
| AI 计费粒度 | 固定档位，非 token 计费 | 见 ADR-009 Options B |
| 免费查词限制机制 | 独立每日配额，不进积分系统 | 见 ADR-009 Options C |
| 积分池结构 | 双池（订阅/充值），先扣订阅池 | 见 ADR-009 Options D |
| 计费代码开源范围 | 全部开源在 `enx-api` 内 | 见 ADR-009 Options E |

---

## 9. 相关文件

| 仓库 | 路径 |
| --- | --- |
| enx | `enx-api/aitranslate/handler.go` — 接入积分检查的位置 |
| enx | `enx-api/dictionary/` — 接入配额检查的位置 |
| enx | `enx-api/utils/sqlitex/sqlitex.go` — 新增 GORM 模型 |
| enx | `enx-api/config.toml` — 新增 `[stripe]` 段 |
| enx | `enx-api/enx-api.go` — 路由注册（`authGroup`/`apiGroup` 现有模式） |
| w10n-config | `infra/homelab/k8s/enx/deployment.yaml` — 注入 `enx-stripe` Secret |
| w10n-config | `infra/homelab/k8s/enx/ingress.yaml` — 确认 `/billing/webhook` 走现有 `path: /` 规则，无需新增 |
| w10n-config | `enx-monetization.md`（私有）— 定价数字草案，定稿后回填本 Spec 的占位符 |

---

## 10. SDD 工作方式

1. **ADR 先行**：架构决策（要不要 token 计费、要不要拆私有服务等）已经在 [`adr-009`](../architecture/adr-009-billing-stripe-subscription-and-ai-credits.md) 定下来，本 Spec 只负责落地，不重新讨论已决策的问题。
2. **占位符不代表定稿**：本 Spec 里出现的具体数值（积分档位、免费配额）都是待定占位符，实现前需要产品侧（即用户本人）在 `enx-monetization.md` 里定稿后回填，PR 不应该带着占位符合并。
3. **先 Phase 0-2（后端骨架+账本），再 Phase 3（接入现有功能），最后 Phase 4（前端）**：账本正确性（尤其并发扣费不超扣、webhook 幂等）是后续一切的基础，必须先有测试覆盖再接入真实调用路径。
