# ADR-021：enx-ui 加管理员词条维护页 —— `(app)/admin` 子树 + 复用 `ADMIN_CLERK_USER_IDS` env allowlist 做门禁（新 `middleware.RequireAdmin` 读同一份 viper 名单，`GET /api/me` 增补 `isAdmin` 供前端控制导航），两个 admin-only 只读端点分别原样暴露 `words` 表行与 ECDICT `stardict` 行（不合并、不计量、绕过 `MeterLookup`、不复用 `translateWord`），页面比对两源一致性、并提供「用 ECDICT 数据回写 `words` 表条目」这一个写操作；角色系统与泛化的词条增删改查都推迟

| 字段 | 值 |
| --- | --- |
| **状态** | Accepted — 2026-09-08，已实现（见「关联代码」）。已确认的取舍：**当前只有一个管理员（仓库所有者），门禁复用已有的 `ADMIN_CLERK_USER_IDS` env allowlist，不引入 Clerk 角色系统**；`words` 与 ECDICT 各建一个 admin-only 只读 API（现有 `GET /api/word/:word` 合并两源 + 计量 + 带副作用，满足不了），且为独立 handler、不复用 `translateWord`；本期写操作只有一个——「检查 `words` 与 ECDICT 是否一致，可选择用 ECDICT 的数据回写 `words`」；不顺带修 `DELETE /api/word/:word` 的未授权问题、不动 `/lookup` 页、不加 `source` 标记列。**实现期的三个小决定（ADR 正文未定）**：(1) 前端 `isAdmin` 放在**独立 hook** `useIsAdmin`（`useQuery(['me'])`），不塞进 `useAuth`——`useAuth` 也被营销站用，不该在那里发 API 请求；(2) 写端点定为 `POST /api/admin/words/:word/sync-from-ecdict`，`PUT /api/admin/words/:word` 留给未来的通用编辑；(3) sync 到一个**软删的 `words` 行**时顺带清 `deleted_at`（复活它）——否则 sync 对用户查词零效果（查词过滤 `deleted_at IS NULL`），令人困惑。 |
| **日期** | 2026-09-08 |
| **关联 ADR** | [`adr-015-cognito-to-clerk-auth-migration.md`](adr-015-cognito-to-clerk-auth-migration.md)（客户端 Clerk 鉴权、`clerk_auth.go` 只读 `sub`/`email`/`name` 并 `c.Set("clerk_user_id", sub)`。本 ADR **不改** `clerk_auth.go`，也不引入角色概念——沿用 `billing/admin.go` 已落地的 env allowlist，把它抽成一个共享的 `RequireAdmin` 中间件）、[`adr-016-enx-ui-app-shell-navigation.md`](adr-016-enx-ui-app-shell-navigation.md)（`(app)/` route group + `(app)/layout.tsx` 登录门禁 + 配置化导航 `app-nav.ts`。本 ADR 在其下加 `admin/` 子树 + `admin/layout.tsx` 门禁 + 一个只对管理员可见的导航组）、[`adr-018-dictionary-lookup-single-metered-seam.md`](adr-018-dictionary-lookup-single-metered-seam.md)（`dictionary.MeterLookup` 是所有**查词**路径唯一的计量点；其 Out of Scope 写明「以后 enx-ui 要独立查词框就用 `GET /api/word/:word`」。本 ADR 的两个 admin 端点是**维护**而非查词，有意绕过计量、也有意不合并两源——对 ADR-018 是补充不是翻案，见 Decision 3 / Rationale） |
| **关联代码** | enx-api：`middleware/admin.go`（新增 `IsAdminClerkUser` + `RequireAdmin`；`isAdminClerkUser` 从 `billing/admin.go` 迁来，`billing.GrantCredits` 改调它）、`admin_dictionary.go`（新增三个 handler）、`enx-api.go`（`/api/admin` 路由组 + `GetMe` 增补 `isAdmin`）、`ecdict/ecdict.go`（新增 `LookupRaw` + `StardictRow`，`Query` 变薄适配器）、`repo/ecp_admin.go`（`AdminGetWord` / `AdminSyncWordFromEcdict`）。测试：`middleware/admin_test.go`、`admin_dictionary_test.go`、`ecdict/ecdict_test.go`、`repo/ecp_admin_test.go`、`e2e_test.go`。enx-ui：`src/hooks/useIsAdmin.ts`（新）、`src/app/(app)/admin/{layout,dictionary/page}.tsx`（新）、`src/components/app/{app-nav.ts,AppSidebar.tsx}`、`src/services/api.ts`、`src/types/index.ts` |
| **关联清单** | 无新增外部配置。`ADMIN_CLERK_USER_IDS`（viper `admin.clerk-user-ids`）需包含管理员的 Clerk user id —— `GrantCredits` 已经在用同一份，homelab 已配；prod 上线时随 `GrantCredits` 一起确认。 |

---

## Context

### 需求

enx-ui 需要一个**管理员专用**的词条维护页：

1. 输入一个英文单词，页面**同时**显示：
   - 该词在 `words` 表（enx 的全局释义缓存，见 ADR-018）里的记录；
   - 该词在 ECDICT（`stardict` 表）里的记录。
2. 两源**分开原样展示**，并给出一致性判断（`words` 缺失 / ECDICT 缺失 / 一致 / 不一致 + 差异）。
3. 提供一个写操作：**用 ECDICT 的 `translation` / `phonetic` 回写 `words` 表对应条目**（不存在则创建）。

泛化的「`words` 条目增删改查」是最初设想，本期收窄为上面这一个「从 ECDICT 同步」的写操作——见 Out of Scope。

### 现状：enx 没有「管理员」这个前端概念

- 服务端**已有**一套极简 admin 机制：`billing/admin.go` 的 `isAdminClerkUser` 按 `ADMIN_CLERK_USER_IDS`（viper `admin.clerk-user-ids`）env allowlist 判断，唯一用户是 `POST /api/admin/credits/grant`。注释自己写着「Not a roles system … migrate to Clerk publicMetadata if this outgrows an env var」。
- `middleware/clerk_auth.go` 校验 Clerk session JWT 后只取 `sub` / `email` / `name`，`c.Set("clerk_user_id", sub)` + `c.Set("user_id", userID)`。**不读任何角色 / metadata**。
- enx-ui：`(app)/layout.tsx` 只做「登录 / 未登录」门禁（ADR-016）。`app-nav.ts` 是导航唯一事实源，没有任何按身份分叉。`useAuth.ts` 暴露 `{ user, isLoading, isAuthenticated, signIn, logout }`，`user` 不含角色。

### 现状：查词只有一条「带副作用、合并两源」的路径

普通用户查词（`GET /api/word/:word` → `translate.TranslateByWord` → `translateWord`）不是一次「读」——它一路带着**面向用户**的逻辑和副作用：

- 先查 `words` 表；命中就**不查 ECDICT**、直接返回合并后的单一 `enx.Word`；未命中才 `dictionary.Lookup` 查 ECDICT 并把结果**回填**进 `words`。
- 无论命中与否都过 `dictionary.MeterLookup` 记一次每日配额（ADR-018）。
- 本地命中时 `user_dicts.QueryCount++` 记复习进度、必要时翻转 `AlreadyAcquainted`。
- 最后把结果压成精简的单一 `enx.Word`（丢掉 `sw`/`exchange`/`load_count`/时间戳/`deleted_at`）。

ADR-018 刚**删掉**了独立的 `GET /ecdict`（无客户端的死接口），并在 Out of Scope 写明「以后要独立查词框，用 `GET /api/word/:word`，不要单独端点」。

结论：现有端点**看不到**「`words` 有一条、ECDICT 另有一条、两者不一样」这个状态——它要么给你 `words` 的、要么给你 ECDICT 回填后的，永远是一条。管理员要的恰恰相反——**两张表各自的原始行、不触发任何写、不受配额约束**。所以 admin 端点必须是独立 handler，不能在用户查词路径上加参数。

### 现状：`words` 表与回填的关系

- `words` 是**全局共享**的释义缓存（不是 per-user），键在 `english` 上，有 `deleted_at` 软删列。
- 回填只发生在 `fillFromEcdict`（`translate/helpers.go`）里、且**只在 `word.Id == ""`（本地无此行）时** `word.Save()`。一旦 `words` 里有行，翻译路径永远不再覆盖它。
- 所以「管理员手工回写的值会不会被自动回填冲掉」这个担心**不成立**：自动回填只创建、不更新。管理员的写操作是唯一的 `UPDATE` 来源。

### 为什么值得写 ADR

- **enx 第一个受保护的管理界面**：`RequireAdmin` 中间件 + `(app)/admin/` 子树 + 按身份分叉的导航，是之后所有 admin 功能的模板；「现在用 env allowlist、什么时候该升级成角色系统」这条线要写下来。
- **和已生效的 ADR 直接交互**：两个 admin 端点有意绕过 ADR-018 的计量 seam、有意不走「合并两源」、有意不复用 `translateWord`——需要把「维护 ≠ 查词」这条边界写下来，否则后人会以为 ADR-018「查词只有一个 seam」被破坏了。
- **人成为 `words` 的写入源**：即使本期只是「从 ECDICT 同步」，`words` 从「纯派生缓存」变成「可被人订正的缓存」，影响所有用户的查词结果。
- **真实取舍**：门禁机制（env allowlist / Clerk 角色系统）、两源端点合一还是分开、写操作的边界、软删 vs 硬删，都有多个合理选项。

---

## Options Considered

### A. 门禁机制：env allowlist vs Clerk 角色系统

前提：**当前只有一个管理员**（仓库所有者），可预见的未来也不会多。

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| **A1.（采用）复用 `ADMIN_CLERK_USER_IDS` env allowlist** | `billing/admin.go` 已有的 `isAdminClerkUser(sub)`（读 viper `admin.clerk-user-ids`）抽成共享函数，包一个 `middleware.RequireAdmin` gin 中间件挂在 admin 路由组上（`clerkAuth` 之后，比较 `c.GetString("clerk_user_id")`）。enx-ui：`GET /api/me` 增补一个 `isAdmin` 字段（服务端用同一个 `isAdminClerkUser` 算），`useAuth` / `AppSidebar` / `admin/layout.tsx` 据此控制导航与门禁 | 零新依赖、零外部配置、`clerk_auth.go` 不动；和 `GrantCredits` **同一套**机制（不产生「两套 admin 判断」）。名单在 env / viper，改管理员要改配置 + 重启——**N=1 且几乎不变**，这个成本可忽略。`/api/me` 已存在，加一个布尔字段即可，不需要新探针端点 |
| A2. Clerk `publicMetadata.role` 角色系统 | 管理员在 Clerk 设 `publicMetadata.role = "admin"`；客户端 `useUser()` 读；服务端要 Clerk Dashboard 把 `role` 注入 session token（homelab + prod 两个实例）→ `clerk_auth.go` 读 claim → `RequireAdmin` | 角色是身份服务里的用户属性、运行时可改不用重启——但这些好处**在有第二个管理员或第二种角色之前一分钱不值**。代价是实打实的：两个 Clerk 实例的 session-token 定制（ADR-020 已经吃过「跨环境 Clerk 配置」的亏），漏配则 `RequireAdmin` 静默全 403。**N=1 下是过度设计**，推迟到 Revisit |
| A3. 服务端每请求查 Clerk Backend API 拿 `publicMetadata` | `RequireAdmin` 里调 Clerk API | 免 session-token 定制，但每个 admin 请求一次外部往返 + 依赖 Clerk API 可用性。只有在选了 A2 又不想动 session token 时才考虑 |

**为什么不担心「名单散在 env」**：`GrantCredits` 已经这么用了一年，homelab 早配好了；这个 ADR 复用同一份，没有新增运维面。真正的运维负担是 A2 引入的。

### B. 两源读接口：合一 vs 分开

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| B1. 一个 `GET /api/admin/dictionary/:word` 返 `{words, ecdict}` | 一次请求拿两源 | 少一个端点、少一次往返。但把两个不相干的数据源塞进一个响应形状，测试也得一起搭 |
| **B2.（采用）`words` 与 ECDICT 各一个 admin-only 端点** | `GET /api/admin/words/:word` → `words` 表原始行（或 404/`null`）；`GET /api/admin/ecdict/:word` → ECDICT `stardict` 原始行 + 命中策略（或 `null`）。页面并发调两个 | 用户明确要「两个都新建 api」。两个端点各自单一职责、各自好测；`words` 端点纯 SQLite 单行读，`ecdict` 端点复用 `ecdict` 包。响应就是各自表的原样字段，不发明中间结构 |
| B3. 给 `GET /api/word/:word` 加 `?debug=1` 返双源、跳过计量 | 现有端点加分支 | 把 admin 维护逻辑塞进用户查词主路径，和 ADR-018「一个 seam」相悖，且要在主路径上判断「这个请求方是不是 admin」。**否决** |

### C. 两个 admin 端点要不要计量 / 要不要走 `MeterLookup`

| 方案 | 结论 |
| --- | --- |
| 走 `MeterLookup` | 管理员做一致性排查要连查几十个词，凭什么烧他的每日配额；且 `MeterLookup` 的语义是「把一个词解析成给用户看的释义」，维护页两个原样端点不是这个动作 |
| **（采用）不计量、不走 `MeterLookup`** | admin 端点是运维工具，不是查词。ADR-018 的计量点收敛针对的是「用户查词」的所有路径，维护端点显式声明在这个范围外（Out of Scope 补一条指回本 ADR）。`RequireAdmin` 已经把它挡在普通用户之外，不存在「绕过配额」的滥用面 |

### D. ECDICT 端点：精确匹配 vs 复刻查词回退链

| 方案 | 做法 | 结论 |
| --- | --- | --- |
| D1. 只 `word = ?` 精确匹配 | 最简单 | 看不到「用户点 `running` 时翻译路径实际命中的是 `run` 的 exchange 行」这种情况，一致性判断会误报 |
| **D2.（采用）复刻 `ecdict.lookupEntry` 的回退链**（exact → lower → sw → exchange），并在响应里报告**哪一步命中**、命中行的 `word` 是什么 | 管理员看到的就是翻译路径会用的那条 ECDICT 记录，一致性判断才有意义。需要 `ecdict` 包导出一个返回原始 `stardict`（`word/sw/phonetic/translation/exchange` 全字段）+ 命中策略的查询函数（现有 `Query` 返回的是精简过的 `*enx.Dictionary`，丢了 `sw`/`exchange`，且不报命中策略） |

### E. 本期写操作的边界

| 方案 | 结论 |
| --- | --- |
| 完整 CRUD（任意新建 / 自由编辑 `chinese`·`pronunciation` / 删除） | 每一项都带自己的语义问题（删除的软硬 + `user_dicts` 级联、自由编辑与回填的优先级、审计），范围过大 |
| **（采用）只做「用 ECDICT 回写 `words`」** | 一个动作：`words.chinese ← ecdict.translation`、`words.pronunciation ← ecdict.phonetic`（按端点 D2 命中的那条 ECDICT 行）；`words` 无此行则新建（新 UUID、`load_count = 0`、时间戳 now）。幂等。不删除、不接受自由文本。覆盖了「维护」的主要现实用途：`words` 里存了个坏/旧释义、ECDICT 里是对的，一键订正 |

### F. 写操作走不走 ECDICT 计量 / 影响谁

| 事项 | 决定 |
| --- | --- |
| 计量 | 不计量（同 C，是运维写操作） |
| 影响面 | `words` 全局共享，回写**立即影响所有用户**下次查该词的结果。enx-chrome 客户端 `wordCache` 里已缓存的旧值不会即时刷新（等它自己过期 / 用户清缓存）——可接受，记为已知限制 |
| 审计 | handler `logger.Infof` 记录 `clerk_user_id`（操作者）+ 词 + 前后值，跟 `GrantCredits` 一致。本期不做结构化审计表 |

---

## Decision

1. **enx-ui：`(app)/admin/` 子树 + 门禁 + 条件导航**
   - `useAuth.ts` 增补 `isAdmin`：调 `GET /api/me`（React Query）取其中的 `isAdmin` 布尔字段。加载中当作 `false`。
   - 新增 `src/app/(app)/admin/layout.tsx`（`'use client'`）：在 `(app)/layout.tsx` 的登录门禁**之上**再加一层——`isAdmin` 加载完成且为假 → `notFound()`（渲染 404，不暴露 admin 路由存在）；为真 → `{children}`；加载中 → spinner。这只是「不给入口」，真正的防护在服务端 `RequireAdmin`。
   - 新增 `src/app/(app)/admin/dictionary/page.tsx`：搜索框 + 两张结果卡（`words` / ECDICT）+ 一致性条 + 「Sync from ECDICT」按钮。形态同 ADR-012（`'use client'` + shadcn Card + React Query）。
   - `src/components/app/app-nav.ts` 加 `NAV_ADMIN: NavItem[]`（`{ label: 'Dictionary', href: '/admin/dictionary', icon: … }`）。`AppSidebar` 在 `isAdmin` 时渲染一个独立的「Admin」导航组（视觉上与普通用户项分隔）。非管理员完全看不到这组。

2. **enx-api：`RequireAdmin` 中间件（复用 env allowlist）+ `GetMe` 增补 `isAdmin`**
   - 把 `billing/admin.go` 的 `isAdminClerkUser(clerkUserID string) bool`（读 viper `admin.clerk-user-ids`）抽到一个可共享的位置（`middleware` 包，或新建 `admin` 包）。`billing.GrantCredits` 改为调这个共享函数（消除重复，仍是同一份名单）。
   - 新增 `middleware.RequireAdmin`（gin 中间件）：`isAdminClerkUser(c.GetString("clerk_user_id"))` 为假 → `403 {"success": false, "message": "admin access required"}` + `c.Abort()`。挂在 `clerkAuth` **之后**。`clerk_auth.go` **不改**（`clerk_user_id` 它已经 set 了）。
   - `GetMe`（`GET /api/me`）响应加 `"isAdmin": isAdminClerkUser(c.GetString("clerk_user_id"))`。这是 enx-ui 判断「是否渲染 admin 导航」的唯一信号，名单事实源仍在 enx-api viper 一处。
   - 空名单 = admin 端点全 403、`isAdmin` 恒 `false`（fail-closed，与 `admin.go` 现有语义一致）。

3. **enx-api：两个 admin-only 只读端点**（`apiGroup` 下，`clerkAuth` + `RequireAdmin`）——**独立 handler，完全不复用 `translateWord` / `TranslateByWord` 的任何部分**。普通查词路径里的下列逻辑在 admin 端点上一个都不发生：
   - `MeterLookup`（每日配额计量）；
   - 「`words` 命中即短路、不查 ECDICT」的择一 / 合并；
   - ECDICT 结果**回填**进 `words` 表（admin 读 ECDICT 不产生任何写）；
   - `user_dicts.QueryCount++` 复习计数、`AlreadyAcquainted` 翻转；
   - 把结果压成精简的单一 `enx.Word`（admin 要的是两张表各自的**原始行、全字段**）。

   端点：
   - `GET /api/admin/words/:word` → 直接查 `words` 表（`english` 精确 + 大小写不敏感，包含 `deleted_at IS NOT NULL` 的软删行也返回并标记），返回原始行全字段（`id, english, chinese, pronunciation, load_count, created_at, updated_at, deleted_at`）或 `{ found: false }`。
   - `GET /api/admin/ecdict/:word` → 复刻 `ecdict.lookupEntry` 回退链（exact → lower → sw → exchange），返回命中的 `stardict` 全字段（`word, sw, phonetic, translation, exchange`）+ `matchedBy`（哪一步命中）或 `{ found: false }`；ECDICT 未配置 → 503（复用 `dictionary.RespondUnavailable`）。
   - 需要 `ecdict` 包导出一个 `LookupRaw(ctx, word) (StardictRow, matchedBy string, found bool)`（当前 `stardict` 类型未导出、`Query` 有损）。

4. **enx-api：一个写端点**
   - `PUT /api/admin/words/:word`（或 `POST /api/admin/words/:word/sync-from-ecdict`，命名编码阶段定）→ `clerkAuth` + `RequireAdmin`，不计量。
   - 行为：对该 `english` 跑端点 3 的 ECDICT 回退查询；命中 → `words` 表 upsert（`chinese ← translation`、`pronunciation ← phonetic`、`updated_at = now`；无行则 `INSERT` 带新 UUID、`load_count = 0`、`created_at = now`、`deleted_at = NULL`）。ECDICT 未命中 → `409 {"success": false, "message": "no ECDICT entry to sync from"}`，不写。
   - 幂等：同 `english` 重复调结果一致。
   - `logger.Infof` 记 `clerk_user_id` + `english` + 前值 → 后值。

5. **enx-ui service + 页面逻辑**
   - `api.ts` 加 `adminGetWord(word)` / `adminGetEcdict(word)` / `adminSyncWordFromEcdict(word)`。
   - 页面并发 `adminGetWord` + `adminGetEcdict`；一致性判断在前端：两者都 found 时逐字段比 `words.chinese` vs `ecdict.translation`、`words.pronunciation` vs `ecdict.phonetic`，展示「一致 / 不一致（高亮差异）/ words 缺失 / ECDICT 缺失」。
   - 「Sync from ECDICT」按钮：ECDICT found 时可用；点击 → `adminSyncWordFromEcdict` → 成功后 invalidate 两个 query 重新拉取。

6. **测试**
   - enx-api：`RequireAdmin`（`clerk_user_id` 不在名单 → 403；在名单 → 放行；空名单 → 403）；`isAdminClerkUser` 抽出后 `GrantCredits` 现有测试仍绿；`GetMe` 返回 `isAdmin`（在/不在名单两种）；`GET /api/admin/words/:word`（命中 / 未命中 / 软删行）；`GET /api/admin/ecdict/:word`（exact / exchange 回退命中 + `matchedBy` / 未命中 / ECDICT 未配置 503）；写端点（新建 / 覆盖 / ECDICT 未命中 409 / 幂等 / 审计日志）；三个新端点用非管理员 token → 403。
   - enx-ui：`admin/layout` 非管理员 → 404、管理员 → children、加载中 → spinner；`AppSidebar` 在 `isAdmin` 下渲染 Admin 组、否则不渲染；页面一致性判断四种状态；Sync 按钮禁用/启用条件与成功后刷新。
   - `src/__tests__/clerk-routing.test.ts` 不变量继续成立。

---

## Rationale

- **A1（复用 env allowlist）而非 A2（角色系统）**：当前 N=1 管理员且几乎不变。`admin.go` 的注释把 allowlist 叫「过渡方案」，但「过渡到什么」的触发条件是「outgrows an env var」——一个人、一个功能，没有 outgrow。A2 的收益（运行时改名单、身份服务里维护）在第二个管理员出现前是零，成本（两个 Clerk 实例的 session-token 定制、漏配即静默 403）是实打实的。复用 allowlist 还顺带把 `GrantCredits` 和新端点统一到**一套**判断上。升级路径清晰（见 Revisit），真到那天再迁不迟。
- **B2（两端点分开、独立 handler）而非 B1/B3**：用户明确要两个。更根本的是——普通查词路径 `translateWord` 带着一串面向用户的副作用（计量、`words`/ECDICT 择一、ECDICT 回填、`user_dicts` 复习计数、结果精简成单一 `enx.Word`），admin 要的是「两张表各自的原始行、零副作用、不受配额约束」，这**只能靠独立 handler**，在用户路径上加 `?debug=1`（B3）既污染主路径、又要在主路径里判断请求方身份。两个数据源本就无关（`words` 可写的 SQLite 缓存 / ECDICT 只读第三方词库），分开的端点各自单一职责、各自可独立测试，不用发明耦合的响应结构。
- **不计量（C/F）**：ADR-018 收敛的是「用户把词解析成释义」的所有路径。维护页两个原样端点 + 一个同步写不是那个动作，是运维。`RequireAdmin` 已经排除了普通用户，没有「绕过配额刷词」的滥用面。这是对 ADR-018 的**补充**（明确「维护端点在计量范围外」），不是翻案。
- **D2（复刻回退链）而非 D1**：一致性判断要有意义，管理员必须看到翻译路径**实际**会用的那条 ECDICT 记录（可能是 `sw` 或 `exchange` 命中的另一个词），而不只是精确匹配。
- **E（只做 ECDICT→words 同步）**：这是用户对本期范围的明确收窄，也确实覆盖了维护的主要现实用途。泛化 CRUD 的每一项都带独立的语义决策（删除的软硬、自由编辑与回填优先级、审计粒度），不该在一个 ADR 里囫囵吞。
- **回写不怕被回填覆盖**：`fillFromEcdict` 只在本地无行时 `Save()`，有行后翻译路径永不更新。所以不需要 `source` / `manual` 标记列（用户也选了不加）。

---

## Consequences

### Positive

- enx 有了第一个受保护的管理界面（`RequireAdmin` + `(app)/admin/` + 按身份分叉导航），后续 admin 功能都能挂上去。
- **零新增外部配置、`clerk_auth.go` 不动**；`GrantCredits` 与新端点收敛到**一套** admin 判断（`isAdminClerkUser` 抽出共享后重复也消掉了）。
- 维护页让「`words` 与 ECDICT 不一致」这个此前不可见的状态可见、可一键订正。
- 两个 admin 端点为独立 handler，各自单一职责、原样字段、易测；不触碰用户查词主路径和 ADR-018 的计量 seam。
- enx-ui 导航按身份分叉的模式建立（`NAV_ADMIN` + `isAdmin` 条件渲染），仍然是 `app-nav.ts` 单一事实源。

### Negative

- **管理员名单在 env / viper，改名单要改配置 + 重启 enx-api**。当前 N=1 且不变，可忽略；一旦需要频繁增减管理员，就是迁 A2（角色系统）的信号（见 Revisit）。
- **`isAdmin` 靠 `/api/me` 一次请求**：enx-ui 在拿到响应前不渲染 admin 导航（加载态按非管理员处理）。可接受——admin 入口晚半秒出现无所谓，且 `/api/me` 本来就该在应用启动时拉。
- **`words` 从纯派生缓存变成可被人订正的缓存**：即使只是 ECDICT 同步，回写立即影响所有用户；enx-chrome 已缓存的旧值不即时刷新。
- **ECDICT 端点新增一个导出查询函数**（`ecdict.LookupRaw`），`stardict` 类型或其字段需要导出——`ecdict` 包的表面积变大一点。
- `admin/layout.tsx` 用 `notFound()` 隐藏路由存在，但 `/admin/dictionary` 这个路径本身会出现在 JS bundle 里；真正的防护在服务端 `RequireAdmin`，前端只是不给入口。

### Mitigation

- 实施顺序建议：
  1. `isAdminClerkUser` 抽共享 + `middleware.RequireAdmin` + `GetMe` 加 `isAdmin` + 测试（`GrantCredits` 改调共享函数，现有测试回归）。纯基建，不挂新路由。
  2. `ecdict.LookupRaw` + `GET /api/admin/ecdict/:word` + 测试。
  3. `GET /api/admin/words/:word` + 测试。
  4. 写端点 + 测试。
  5. enx-ui：`useAuth.isAdmin`（`/api/me`）→ `admin/layout` → `AppSidebar` 条件组 → 页面。
  6. 每步独立可验证、可回滚；前 4 步纯 enx-api，第 5 步纯 enx-ui。
- 在 ADR-018 的 Out of Scope 补一条：「admin 词条维护端点（ADR-021）有意在计量范围外」。

---

## Out of Scope（本次不做）

- **泛化的 `words` 增删改查**：任意新建、自由编辑 `chinese`/`pronunciation`、删除条目。本期只有「从 ECDICT 同步」这一个写操作。
- **修 `DELETE /api/word/:word` 的未授权问题**：现在任意登录用户可调用它硬删全局 `words` 行 + 级联硬删该词所有用户的 `user_dicts`（复习进度）。这是一个独立的安全 / 数据完整性问题，单独立 issue，不在本 ADR。
- **动 `/lookup` 页**：它的 "Clear" 按钮正是在调上面那个未授权 delete。本 ADR 不改它。
- **`words` 加 `source` / `manual` 标记列**：回填只创建不更新，当前不需要。
- **Clerk 角色系统（`publicMetadata.role`）**：本期不引入。`RequireAdmin` 后续换成读角色只需改中间件一处（见 Revisit）。
- **结构化审计表**：本期审计靠 `logger.Infof`，同 `GrantCredits`。
- **运行时可变的管理员名单 / 管理员自助管理**：名单在 env，改动要重启。
- **`user_dicts`（per-user 复习数据）的任何维护 / 展示**。
- **软删 vs 硬删的语义决策**：本期没有删除操作。

---

## Revisit Trigger

- **出现第二个管理员，或名单需要频繁增减 / 想让管理员自助管理，或需要非 `admin` 的第二种角色（`support`、`editor`…）**：迁到 A2——Clerk `publicMetadata.role`（session-token claim，或 A3 的 Backend API 查询）。改动集中在 `middleware.RequireAdmin` 一处 + `GetMe` 的 `isAdmin` 计算 + Clerk Dashboard 配置；`RequireAdmin` 可顺势泛化成 `RequireRole(...)`。`GrantCredits` 和本 ADR 的端点因为已经共用一个判断函数，一起切。
- **加第二个 admin 页面 / 端点**：评估要不要把 admin 路由收进独立的 gin 路由组 `adminGroup`（`RequireAdmin` 挂组上而非逐个端点）。
- **需要真正的词条编辑**（自由改释义、删除、批量导入）：那时要正面回答删除的软/硬 + `user_dicts` 级联、手工值与回填的优先级（可能就是那时候加 `source` 列）、审计粒度——单独 ADR。
- **维护页要看的不止 `words` vs ECDICT**（比如还要对比 enx-sync 侧、或某个用户的 `user_dicts`）：两个原样端点的模式可能要重新组织。
- **enx-chrome 缓存的旧释义造成困扰**：给 `words` 回写加一个 `wordCache` 失效信号（版本号 / 时间戳），或缩短客户端缓存 TTL。
