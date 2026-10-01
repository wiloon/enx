# ADR-044：用户偏好存在服务端（`user_preferences` 键值表 + 白名单注册表），按套餐算默认值与可编辑性；enx-ui 与扩展是同一份数据的两个界面

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-10-01（维护者审阅全文通过；维护者在讨论中确认了方向：偏好存服务端、Web 与扩展都能改、订阅用户默认开、仅充值用户默认关但可开、两者都没有则不可开、浮层里就地关闭；本文是据此起草的设计，待维护者审阅） |
| **日期** | 2026-09-30 |
| **关联** | [`adr-045-ai-word-fallback-for-paid-users.md`](adr-045-ai-word-fallback-for-paid-users.md)（第一个使用者）、[`adr-029-lookup-quota-tiered-limits-and-count-gate-split.md`](adr-029-lookup-quota-tiered-limits-and-count-gate-split.md)（`isActiveSubscriber` 的订阅判断）、[`adr-011-word-highlight-css-highlight-api-and-feature-split.md`](adr-011-word-highlight-css-highlight-api-and-feature-split.md)（现有的本地偏好） |

---

## Context

### 现状：偏好只存在浏览器里，服务端没有

- 扩展的偏好（目前只有「阅读时高亮词汇」，键 `enx-word-highlight-enabled`）存在 `chrome.storage.local`（`enx-chrome/src/config/preferences.ts`），Options 页与 popup 共用。
- 服务端没有任何偏好的表或接口。`GET /api/me`（`handlers/me.go`）只返回 `id / name / email / status / isAdmin`。
- enx-ui 没有设置页。

### 为什么现在要动

ADR-045 的 AI 兜底需要一个**随套餐变默认值、服务端也要读**的开关：

1. **服务端必须能读它。** 是否调用 AI 是服务端的决定（要扣积分、要限流），不能信任客户端自报。
2. **要跨界面一致。** 用户在 enx-ui 改了，扩展刷新后要看到；在扩展浮层里就地关了，网页端也要是关的。`chrome.storage.local` 做不到。
3. **默认值和可编辑性取决于用户的付费状态。** 订阅用户默认开；仅充值用户默认关但可以自己打开；没有订阅也没有余额的用户不可开。这是服务端才有的信息。

## Options Considered

### A. 存哪里

| 方案 | 结论 |
| --- | --- |
| A1. 继续用 `chrome.storage.local`，服务端靠请求参数带过来 | 服务端无法信任；enx-ui 看不到；换浏览器丢失。**否决** |
| A2. `users` 表加列，一个偏好一列 | 每加一个偏好就要迁移；`users` 表会越长越宽 |
| **（采用）A3. 独立 `user_preferences(user_id, key, value)` 键值表，服务端有白名单注册表** | 加偏好不用迁移；注册表（Go 里的一张 map）管类型、默认值、是否可编辑，未知 key 一律拒绝，所以不是「随便存」 |
| A4. 一个 JSON 大字段 | 并发更新要整体读改写；不能按 key 查询 |

### B. 「默认」怎么表达

**采用三态**：没有这一行 = 未设置，用默认值；有这一行 = 用户显式选择。把默认值存成行会出问题——用户从免费升级到付费时，默认值要从关变成开，但用户从未做过选择，不该被一条旧数据拦住。

## Decisions

1. **表与注册表。**

   ```sql
   CREATE TABLE user_preferences (
       user_id    TEXT    NOT NULL,   -- users.Id（本地用户身份，UUID）
       key        TEXT    NOT NULL,   -- 注册表里的 key
       value      TEXT    NOT NULL,   -- JSON 编码的值
       updated_at INTEGER NOT NULL,   -- Unix 毫秒，与其他表一致
       PRIMARY KEY (user_id, key)
   );
   ```

   Go 里的注册表对每个 key 定义：值类型、`Default(plan) value`、`Editable(plan) bool`。**v1 有两个 key：`aiWordFallback`（bool，AI 兜底开关）与 `aiWordFallbackNoticeAck`（bool，是否已看过首次提示，默认 false，不随套餐变，存服务端所以换设备不重复提示）**。仓库约定的分层照旧：注册表与规则在领域包里，SQL 在 `repo/`，handler 只做 HTTP。

2. **生效值由服务端算，客户端不重复实现规则。**

   ```
   aiWordFallback:
     default   = 订阅有效 ? true : false          // 仅充值用户默认关
     editable  = 有资格                            // 订阅有效 或 充值余额 > 0（ADR-045 Decision 14）
     effective = editable && (显式值 ?? default)
   ```

   「订阅有效」沿用 ADR-029 的 `isActiveSubscriber`；「有资格」由 ADR-045 的 `Entitlements.CanUseAI` 统一判断，这里不另写一份。**资格失效后（订阅过期且余额为 0），显式值保留但 `effective` 变 false**；重新订阅或充值，之前的选择还在。没有资格的用户的 `effective` 恒为 false，不管库里有什么。

3. **接口。** 与 `/api/me` 分开，避免把 `/me` 变成什么都往里塞的口袋。

   ```
   GET /api/me/preferences
     -> { "aiWordFallback": { "value": null | true | false,   // 显式值；null = 未设置
                              "effective": true | false,       // 服务端算好的生效值
                              "editable": true | false } }
   PUT /api/me/preferences
     <- { "aiWordFallback": true | false | null }             // null = 删行，回到默认
     -> 同 GET；不可编辑的 key 返回 403 {code: "not_entitled"}（资格是「订阅或充值余额」，不只是订阅）
   ```

   未知 key 返回 400。部分更新：body 里没出现的 key 不动。

4. **两个界面，同一份数据，没有第二份真相。**

   | 界面 | 做什么 |
   | --- | --- |
   | **enx-ui 设置页**（新增） | 完整的偏好列表；没有资格的用户看到置灰的开关，标「订阅或充值后可用」，这是转化点 |
   | **扩展 Options 页** | 同一个开关，经 background 调接口（登录 token 在 background 里） |
   | **扩展查词浮层** | AI 工作状态上的「不再自动使用 AI」，就地 `PUT` 为 false，不跳转（ADR-045 Decision 10） |

   **不跳转到 enx-ui 去改。** 读到一半被带去另一个网站太重，也满足不了「在 AI 工作状态上直接关」。

5. **刷新可见靠「读时拉取」，不做推送。** 扩展把上次拿到的值缓存在 `chrome.storage.local`，**只当显示加速**，真相在服务端。Options 页、popup 每次打开时重新 `GET`；查词响应里本来就带着 `aiFallback`（`canUse` 与 `auto`，ADR-045），那一刻的生效状态以它为准。在 enx-ui 改完，扩展下一次打开或下一次查词就能看到。

6. **设备本地的偏好留在本地，不迁移。** 「高亮词汇」是按浏览器/设备的显示偏好，不是账户属性，继续用 `chrome.storage.local`。判断标准：**服务端需要读、或者要跨设备一致的，才进 `user_preferences`**。

7. **服务端每次读偏好都查库，v1 不做进程内缓存。** 一次主键读，成本可以忽略；缓存会让「刚在 UI 关掉、下一次查词还调了 AI」成为可能，而这类事故用户感知最强。

## Consequences

**正面**

- 一个机制承接以后所有「服务端要读」的偏好，不再为每个偏好各开一个字段。
- 默认值随套餐变化，升级自动生效，不会被旧数据挡住。
- 开关的资格判断只在服务端一处。

**负面 / 风险**

- 多了一次读库：每次 AI 兜底资格判断读一行。可接受。
- 扩展多了一个对服务端的依赖：离线或接口失败时 Options 页显示缓存值，并标注「未同步」，**服务端判断照常**——所以最坏情况只是显示滞后，不会越权。
- 键值表的类型安全靠注册表，不靠数据库。注册表必须有测试：未知 key、类型不符、不可编辑、资格失效（含「仅充值用户默认关」）这几类。

## Out of Scope

- 迁移「高亮词汇」到服务端（Decision 6）。
- 偏好变更的审计历史。
- 管理员代用户改偏好。
- 推送式同步（WebSocket 等）。

## Revisit Triggers

- 出现第二个、第三个服务端偏好，且需要分组或批量接口时，再考虑接口形状。
- 「读时拉取」被用户反馈为滞后（例如在 UI 关了、扩展仍显示开）时，再评估推送或更短的缓存。
