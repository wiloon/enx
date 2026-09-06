# ADR-009：Stripe 订阅 + AI 积分 + 免费查词配额的整体计费架构

| 字段 | 值 |
| --- | --- |
| **状态** | Proposed — 2026-08-12 |
| **日期** | 2026-08-12 |
| **关联 Spec** | [`TASK-SPEC-enx-billing-stripe-subscription.md`](../tasks/TASK-SPEC-enx-billing-stripe-subscription.md)（本 ADR 的实现细节：表结构、API 端点、分阶段计划） |
| **关联 ADR** | [`adr-004-no-aws-amplify-hand-rolled-cognito.md`](adr-004-no-aws-amplify-hand-rolled-cognito.md)（本决策复用 Cognito `sub` 作为用户身份，与现有 `users.cognito_sub` 映射一致） |

---

## Context

enx 目前完全免费：`words`/ECDICT 词典查询和 `aitranslate` 包下的两个 AI 接口（`TranslateSentence`、`TranslateWordInContext`，见 `enx-api/aitranslate/handler.go`）都不限量、不收费。AI 调用走 kimi/bedrock/minimax 三个可插拔 provider（`enx-api/aitranslate/factory.go`），每次调用都有真实的第三方费用。

现在要把 enx 发展成付费产品：加订阅（Stripe）、AI 功能按积分消耗、同时要控制免费用户规模对服务器成本的影响。需要确定：

1. 订阅怎么接入 Stripe，状态怎么和本地数据同步
2. AI 调用（有真实边际成本）怎么计费——按 token 精确计费还是固定档位
3. 词典查询（本地 DB 查询，边际成本接近 0）要不要也计费，还是用别的机制控制免费用户规模
4. 计费相关的代码和设计要不要开源（enx 是公开仓库，AGPL-3.0）

## Options Considered

**A. 订阅收款方式**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| A1.（采用）Stripe Checkout（托管付款页） | 后端创建 Checkout Session，跳转到 Stripe 托管页面完成支付 | 不用处理信用卡信息，免 PCI 合规负担；几行后端代码 + 一个跳转链接 | 付款页样式定制有限（可接受，早期不是重点） |
| A2. Stripe Elements（自建表单） | 前端用 Stripe Elements 组件自己搭付款表单 | UI 完全可控 | 要处理更多边界情况（3D Secure、SCA），对单人开发团队工作量不必要 |

**B. AI 调用计费粒度**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| B1.（采用）固定档位：每次 `TranslateSentence` / `TranslateWordInContext` 调用扣固定积分 | 按接口定价，不看实际 token 用量 | 两个接口输入天然有界（一句话/一词+上下文），不是开放输入框，token 波动本来就小；现有 `kimi.go` 的 `chatResponse` 未解析 `usage` 字段，token 计费要为 kimi/bedrock/minimax 三个 provider 分别适配不同的用量格式和单价体系 | 长句子和短句子成本一样，早期有一点点不精确 |
| B2. 按 token 精确计费 | 解析每个 provider 返回的 usage，按实际 token 数扣费 | 单价精确 | 三个 provider 用量格式不同（尤其 Bedrock），维护成本高；MVP 阶段验证付费意愿优先于压榨单价精度 |

**C. 免费词典查询的限制机制**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| C1. 完全免费不限量 | 不做任何限制 | 实现最简单，最有利于获客 | 免费用户规模上来后（尤其迁到 AWS 按量计费后）没有成本上限 |
| C2. 挂积分系统，和 AI 调用用同一套积分池 | 查一次词也扣积分 | 统一计费模型 | 词典查询边际成本接近 0，用一个"变动成本"设计的积分系统去管理一个"近乎零成本"的功能，是过度设计；也会把免费查词这个获客钩子变成体验有阉割感的功能 |
| C3.（采用）独立的每日配额（简单计数器），不进积分系统 | 免费用户每日查词次数有一个较宽松上限；订阅用户不限量 | 实现比积分系统轻量得多（一个计数器表/Redis TTL，不需要流水账本）；免费查词维持"完整体验但有用量上限"的定位，不是"功能阉割版" | 需要额外一张表/一个 Redis key，不能完全零实现成本 |

**D. 积分怎么建模（针对 AI 调用）**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| D1. 单一积分池 | 订阅积分和充值积分混在一个余额字段里 | 实现最简单 | 订阅积分理应到期作废（避免无限累积成本），充值积分应该长期有效；混在一起没法分别处理过期逻辑 |
| D2.（采用）双积分池：`subscription_balance`（月度发放，当月作废不结转）+ `topup_balance`（一次性购买，长期有效） | 消耗顺序：先扣 `subscription_balance`，扣完再扣 `topup_balance` | 定价模型简单；订阅积分到期作废的语义清晰；先扣订阅积分对用户更划算（反正月底作废），减少"囤积后投诉"的客诉 | 扣费逻辑要处理两次条件更新（两个池子分别试一次） |

**E. 计费相关代码/设计是否开源**

| 方案 | 做法 | Pros | Cons |
| --- | --- | --- | --- |
| E1. 把计费/积分逻辑拆到私有服务，enx-api 只留一个内部调用接口 | 类似 `aitranslate` 的可插拔 provider 模式，换成私有实现 | 感觉上"更安全" | 站不住脚：订阅价格和免费额度阈值用户用产品就能直接观察到（结账页看得到价格，用到配额上限就知道数字），源码可见性对这些数字毫无保护作用；积分账本的双池设计、原子扣费模式也是通用 SaaS 计费模式，不是 enx 独有的秘密，没必要为了藏一个藏不住的东西增加一次服务拆分的复杂度 |
| E2.（采用）计费/积分/配额全部开源在 `enx-api` 内，与其余代码同等对待 | 无额外拆分 | 架构简单；enx 保持全开源（AGPL-3.0）符合作品集定位（见 Rationale）；唯一需要私有的是**未来**的反滥用/反刷单检测规则（规则公开会被刷子直接拿去规避检测，这是"对抗者读规则"场景，跟"竞争对手抄产品"是不同性质的风险）——但那部分现在还没设计，届时单独决策 | 无 |

---

## Decision

1. **订阅支付**（采用 A1）：Stripe Checkout，`mode=subscription`。创建 Checkout Session 时把本地 `users.id`（不是 Cognito sub，走现有 `users` 表的 UUID 主键，与 `cognito_sub` 已经是唯一映射）放进 `client_reference_id`。
2. **充值**（一次性购买积分）：Stripe Checkout，`mode=payment`，metadata 标记为充值订单以区分订阅 Checkout。
3. **订阅/充值状态以 Stripe webhook 为准**，不依赖前端跳转回调：
   - `checkout.session.completed` → 建立/更新 `users.id` ↔ `stripe_customer_id` 映射；如果是充值订单，加充值积分
   - `invoice.paid`（订阅续费）→ 发放当月 `subscription_balance`，同时清零上月剩余（不结转）
   - `customer.subscription.updated` / `customer.subscription.deleted` → 更新订阅状态
   - `invoice.payment_failed` → 标记逾期
   - Webhook endpoint（`POST /billing/webhook`，具体路由见 TASK-SPEC）**不挂 `cognitoAuth` 中间件**，靠 Stripe 签名密钥验证；密钥走环境变量（`STRIPE_WEBHOOK_SECRET`），遵循现有 `KIMI_API_KEY` 之类密钥不进 `config.toml` 的惯例
4. **AI 调用计费**（采用 B1）：`TranslateSentence`、`TranslateWordInContext` 各定一个固定积分成本，具体数值待产品侧定价决策（不在本 ADR 内确定）。未来若加输入量级差异大的功能（比如整段翻译），单独为该功能定更高固定档位，不升级到 token 计费。
5. **积分建模**（采用 D2）：双积分池，扣费用条件更新保证正确性：
   ```sql
   UPDATE credit_accounts SET subscription_balance = subscription_balance - :cost
   WHERE user_id = :id AND subscription_balance >= :cost;
   -- 影响行数为 0 时，对 topup_balance 再试一次同样的条件更新；
   -- 两次都失败则拒绝请求（402 类语义：积分不足）
   ```
   **SQLite 特别说明**：enx-api 用 SQLite + GORM（`enx-api/utils/sqlitex/sqlitex.go`），写操作本身在文件级别是单写者串行的，上面的条件更新不需要额外的显式行锁（`SELECT ... FOR UPDATE` 这类模式在 SQLite 里没有意义），但仍需包在一个事务里保证"检查余额→扣减→记流水"这组操作的原子性。
6. **免费查词配额**（采用 C3）：独立于积分系统，词典查询（`words`/ECDICT）走每日配额计数器，不接入积分。免费用户每日上限值待定；订阅用户不限量。
7. **开源范围**（采用 E2）：本 ADR 描述的全部机制——订阅、积分账本、配额——都实现在公开的 `enx-api` 仓库内，AGPL-3.0，与其余代码同等对待。唯一例外：未来的反滥用/反刷单检测规则设计时单独私有，届时另立 ADR。

---

## Rationale

- 选 A1（Checkout）而不是 A2（Elements）：单人开发团队没有余力维护自建支付表单的边界情况（3D Secure、SCA、多种支付方式），Checkout 把这些完全交给 Stripe 托管，几行代码换掉一大块工作量。
- 选 B1（固定档位）而不是 B2（token 计费）：现有两个 AI 接口的输入天然受限（一句话/一词+上下文），不是开放对话场景，token 波动本身就小；且三个 provider 的用量格式和定价体系都不一样，做精确计费的维护成本长期存在（每加一个 provider 都要重新对一遍），MVP 阶段这笔投入的 ROI 低。
- 选 C3（独立配额）而不是 C1（完全免费）或 C2（挂积分）：完全免费在服务器成本上没有上限，尤其计划迁移到 AWS 后是按量计费；但挂积分系统又是为"边际成本近乎 0"的功能引入了为"边际成本会变化"设计的复杂机制，属于过度设计，也会让免费查词从"钩子"变成"阉割版体验"。独立配额（简单计数器）用最小复杂度达到"控制极端重度/脚本滥用场景的成本上限"这个真实目的。
- 选 D2（双积分池）而不是 D1（单池）：订阅积分需要"当月不结转"的语义（防止无限累积成本、简化定价心智），充值积分需要"长期有效"的语义（用户实际花了钱买的），两者生命周期不同，必须分开建模。
- 选 E2（全开源）而不是 E1（私有计费服务）：这是本 ADR 里推翻过一次的决定。最初考虑把计费逻辑隔离出去是出于"防抄"的直觉，但推敲后发现站不住——定价数字和免费额度阈值本来就能被任何用户直接观察到（结账页、用到配额上限），源码可见性对此没有保护作用；积分账本的技术模式（双池、原子扣费）也是 SaaS 计费的常识性设计，不是需要保密的独家实现。而 enx 保持全开源（含测试、ADR、计费逻辑）对应着它同时也是求职作品集这个定位——一个功能阉割、藏了一部分逻辑的"半开源"项目，作品集价值反而打折扣。真正需要私有的只有"公开后会被对抗者直接利用来钻空子"的那一类规则（反滥用检测），这是本 ADR 唯一保留的例外，且现在还不需要设计。

---

## Consequences

### Positive

- Stripe 状态同步靠 webhook 而不是前端回调，避免"用户付款成功但本地状态没更新"这类常见 bug
- 固定档位计费让 AI 计费实现和三个 provider 的耦合降到最低，未来换/加 provider 不影响计费逻辑
- 免费查词配额和 AI 积分完全解耦，两套机制各自简单，不会互相牵制
- 全部开源，`enx-monetization.md`（私有仓库 w10n-config）里记录的定价数字定稿后，可以直接把本 ADR 和 Spec 的占位符替换成正式数字，不需要额外的"公开版/私有版"两份文档

### Negative

- Webhook endpoint 必须公网可达且免鉴权，是新增的公开攻击面（靠签名验证防伪造，但仍需注意幂等处理防止重放导致重复发放积分）
- SQLite 单写者的模式在订阅/积分写入密集时可能成为吞吐瓶颈；早期流量下可接受，迁移 AWS 时需要重新评估是否要换 Postgres/MySQL（`config.toml` 里已经有一个未被当前代码使用的 `[mysql]` 配置段，具体用途需要在实现阶段确认）
- 免费查词配额和 AI 积分定价数字目前都是占位符，需求方（产品侧）定稿前，Spec 里的示例值不能当作最终值使用

### Mitigation

- Webhook 幂等：按 Stripe event id 去重（详见 Spec）
- SQLite 瓶颈：先不处理，记入 Revisit Trigger，AWS 迁移时一并评估

---

## Revisit Trigger

- 如果新增输入量级差异大的 AI 功能（比如整段/长文翻译），需要重新评估固定档位是否还够用，是否要为该功能单独定更高档位（不代表要升级到 token 级计费，见 Decision 第 4 点）
- 迁移到 AWS、流量上升后，需要重新评估 SQLite 单写者模式是否成为瓶颈，是否要把计费相关表迁到独立的 Postgres/MySQL 实例
- 如果观测到免费查词配额被脚本批量刷、或订阅/充值出现明显的欺诈模式，需要设计反滥用检测规则——这部分设计出来后应保持私有（见 Decision 第 7 点），并另立 ADR
- 积分档位、免费查词每日配额的具体数值由产品侧定价决策决定，定稿后应回填本 ADR 和对应 Spec，替换占位符

---

## References

- `enx-monetization.md`（私有仓库 w10n-config 内，不公开链接；本 ADR 之前的完整设计讨论记录，含定价数字草案）
