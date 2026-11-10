---
status: proposed
date: 2026-11-10
related: AGENTS.md §enx-api（「SQL lives in `repo/`」）、docs/agents/enx-api-design.md §Layer Separation
---

# ADR-078：enx-api 的包布局——领域包自带 HTTP 与适配器，技术层包逐步退场

enx-api 根目录下现在有 42 个目录，其中 34 个是 Go 包。这些包有两种组织方式并存：

- **按领域分包**（多数）：`account`、`billing`、`dictionary`、`referral`、`preferences`、`entitlement`、`feedback` 的核心不引用 gin / gorm，SQL 和外部 API 放在各自的 `adapters/` 子包里，通过接口注入；`reader`、`savedpage`、`wordlist`、`stats`、`userstats`、`adminuser` 这些简单的 CRUD 包把 `handler.go` 和存储放在同一个包里。
- **按技术分层**（遗留）：
  - `handlers/`：11 个文件，横跨账户、邀请、偏好、查词、额度流水、版本、健康检查，是「领域核心不碰 gin」之后 HTTP 代码没地方放的产物。
  - `repo/`：25 个非测试文件，装着几乎所有领域的 SQL。它 import 24 个领域包（`account`、`adminuser`、`referral`、`userstats`、`creditledger`、`reader/saving` 和 18 个 `billing/*` 子包），返回领域类型——依赖方向是对的，只是所有领域的适配器挤在同一个包里。AGENTS.md 规定「SQL lives in `repo/`」，与 `account/adapters` 等子包的做法形成两套规则。
  - `enx/`：名字不是领域概念。里面是 `Dictionary`（只有 `ecdict` 用）、`Word` / `AIFallback`（查词，active-record 风格直接读写全局 DB）、`User` / `GetOrCreateClerkUser` / `SetNewUserHook`（本地用户身份）、`TextWords`（段落取词状态）。还有一个提交进 git 的 0 字节 `enx/enx.db`。
  - `utils/`：`logger`、`password`、`sqlitex`。`sqlitex` 除了 DB 连接，还放着全部 gorm 表模型（`billing_models.go`、`referral_models.go` 等）、集中的 `AutoMigrate` 列表和跨表的启动迁移（`users_rebuild.go` 559 行、`billing_cutover.go`、`deletion_gates.go`）。

后果是：新代码该放哪里要看「这个领域当初是谁写的」；读一个领域要在 `handlers/`、`repo/`、`enx/`、`utils/sqlitex/` 和领域包之间来回跳；根目录同一层既有领域，也有技术层，还有一次性脚手架（`dictsample`）和只服务一个调用方的小工具包（`urlnorm`）。

我们决定：**以领域包为组织单位。领域核心保持纯净，它的 HTTP 边缘和 I/O 适配器作为子包挂在领域下面；`handlers/`、`repo/`、`enx/` 逐步拆空后删除；`utils/` 改名为 `platform/`，只放与领域无关的基础设施。表模型和启动迁移暂留在 `platform/sqlitex`。不引入 `internal/`。**

## Decision

1. **一个领域一个顶层包，按复杂度选两种形态。**
   - **有领域核心的**（`account`、`billing`、`dictionary`、`referral`、`preferences`、`entitlement`、`feedback`……）：核心包不 import gin、gorm、`database/sql`、`net/http` 客户端；`<领域>/adapters` 放 SQL 和外部 API 的实现；`<领域>/httpapi` 放 gin handler。依赖方向只能是 `httpapi → 核心 ← adapters`，由 `server/` 组装。
   - **简单 CRUD**（`reader`、`savedpage`、`wordlist`、`stats`、`userstats`、`adminuser` 等）：维持现状，handler、存储、规则同包。不为了对称而拆子包（AGENTS.md「Plain stays plain」）。一个 CRUD 包长出了真正的规则，再升级成第一种形态。

2. **`handlers/` 拆进各领域的 `httpapi` 子包，然后删除。** 归属如下：

   | 现文件 | 去向 |
   |---|---|
   | `account.go`、`me.go` | `account/httpapi` |
   | `referral.go` | `referral/httpapi` |
   | `preferences.go` | `preferences/httpapi` |
   | `word_lookup.go`、`known_word.go`、`review_words.go`、`admin_dictionary.go` | `dictionary/httpapi` |
   | `credit_history.go` | 随 `creditledger` 进 `billing/creditledger`（见第 6 条） |
   | `ping.go`、`version.go` | `server/`（属于进程而不是领域） |

3. **`repo/` 按领域拆进 `<领域>/adapters`，然后删除。** `repo/` 已经依赖领域包而不是反过来，所以按文件搬迁不会产生循环依赖。搬迁时按「这个文件实现的是哪个领域的接口」归属：`account*.go` → `account/adapters`，`referral.go` → `referral/adapters`，计费相关（`billing_*`、`subscription_*`、`invoice_paid`、`checkout_completed`、`charge_refunds`、`webhook_*`、`portal_session_owners`、`accepted_subscriptions`、`alerts`）→ `billing` 下对应子域的 `adapters`，`ecp*.go`、`review_words.go`、`lookup_events.go` → `dictionary/adapters`，`credit_ledger.go` → `billing/creditledger/adapters`，`reader_documents.go` → `reader`，`user_stats.go` → `userstats`，`admin_*.go` → `adminuser`。
   **这条推翻了 AGENTS.md 的「SQL lives in `repo/`」**，改为「SQL lives in the domain's `adapters/`（or in the package itself for plain CRUD）」。

4. **`enx/` 拆散后删除。** `Dictionary` → `ecdict`；`Word`、`AIFallback`、`TextWords` → `dictionary`（其中直接读写 DB 的 `Save` / `FindId` / `FindQueryCount` 移到 `dictionary/adapters`，核心只留实体和规则）；`User`、`GetOrCreateClerkUser`、`SetNewUserHook`、`ClerkProfile` 属于 GLOSSARY「本地用户身份 / 外部认证身份」，→ `account`（DB 部分进 `account/adapters`）。删除 `enx/enx.db`，在 `enx-api/.gitignore` 加 `*.db`。

5. **`utils/` 改名为 `platform/`。** 内容为 `platform/logger`、`platform/password`、`platform/sqlitex`、`platform/signal`（原 `utils/signal.go`）。`clerktest`（只有测试用）移入 `platform/clerktest`。`platform/` 下的包不得 import 任何领域包。`sqlitex` 现在 import `ecdict`（`cleanCachedEcdictPhonetics`），这是唯一的例外，记为待清理。

6. **小包合并：**
   - `urlnorm` → 并入 `savedpage`（唯一调用方；ADR-032 当初为与 `pagereport` 共享而抽出，`pagereport` 后来并入 `feedback`，`feedback` 用自己的 `url.go`）。
   - `creditledger` → `billing/creditledger`（ADR-063 的额度流水，属于计费）。
   - `dictsample` → 不搬。ADR-030 说它「设计上就是用完整包删除的」；测量结束后连同 `scripts/dictsample-report.sh` 一起删除。是否已经结束由 owner 确认。

7. **以下包看似重叠，保持分开：**
   - `ailimit`（AI 花费上限，ADR-045/048）和 `ratelimit`（全站请求限流，ADR-060）。
   - `stats`（用户自己的阅读统计，ADR-028）、`userstats`（运营看的用户数，ADR-058）和 `metrics`（Prometheus，ADR-040）。`stats` / `userstats` 的命名容易混淆，改名先走 `domain-modeling` 在 GLOSSARY 里定术语，不在本 ADR 范围。
   - `translate`（查词翻译流程）和 `aitranslate`（AI 供应商适配）。`translate` 是否并入 `dictionary` 另行评估。

8. **表模型和启动迁移暂留 `platform/sqlitex`。** 它们是 gorm 持久化模型，不是领域实体；一个 SQLite 文件、一份 `AutoMigrate` 列表、`users_rebuild` 这类跨表迁移放在一处，顺序可以一眼看清。真正违反分层的是领域核心直接 import `sqlitex`（目前 `billing`、`billing/credit`、`feedback`、`translate`、`middleware` 等），按 AGENTS.md「Legacy files shrink as you touch them」逐个改成通过接口注入，不做一次性搬迁。

9. **非代码目录：**
   - `build/` 不动：`deploy-prod.yml` 和 homelab Tekton（仓库外）引用了 `enx-api/build/*.sh`、`build.conf`。
   - `migrations/`、根目录 `testdata/`（被 `billing/app`、`repo`、`utils/sqlitex` 三个包的测试共用）不动。
   - `examples/`（1 个 JSON）、`test/`（4 个 `.http` 手工请求文件，名字容易误认为是测试代码）、根目录的 `TESTING.md`、`TASKFILE_README.md`、`VERSION_API.md`、`enx.puml` 移入 `enx-api/docs/`，同时修好引用它们的链接。
   - `deploy/`（Jenkins 脚本、systemd unit）：仓库内没有任何地方引用，homelab 和 prod 都已改用 GitHub Actions 部署。由 owner 确认是否已废弃，废弃就删除。

10. **不引入 `internal/`。** enx-api 是一个应用，不是被别人 import 的库，`internal/` 唯一的好处（禁止外部 import）在这里用不上，代价却是改动全部 import 路径。完成第 2–6 条后，根目录的 Go 包从 34 个降到 27 个左右，非代码目录从 8 个降到 4–6 个（取决于 `deploy/`、`scripts/` 是否删除），已经足够清楚。

## Considered Options

- **保留 `handlers/` / `repo/` 这种技术分层（现状）。** 改动为零，但两套规则继续并存。每个新领域都要在「放进 `repo/`」和「自带 `adapters/`」之间选一次，而最近的领域（account、referral、preferences、feedback）都已经选了后者。
- **把 handler 直接放回领域核心包（`account/handler.go`）。** 简单 CRUD 包就是这么做的，但对有核心的领域会把 gin 带进核心，违反 AGENTS.md「A domain core free of frameworks and I/O」。所以只对 CRUD 包保留这种形态。
- **表模型随领域搬进各自的 `adapters/`，`sqlitex.Init` 由 `server` 传入模型列表。** 更「纯」，但 `users_rebuild.go`、`billing_cutover.go`、`deletion_gates.go` 这类跨表迁移会失去落脚点，`AutoMigrate` 的顺序也会分散到组装代码里。收益只有「模型和 SQL 挨在一起」，风险落在启动迁移上，不值得。以后某个领域的表真的独立了，可以单独搬。
- **全部收进 `internal/`，按 `internal/domain/…`、`internal/platform/…` 分层。** 根目录最干净，但会改动每一个 import，和本 ADR 的其他迁移叠在一起 review 不动；收益又如第 10 条所述。
- **一次性大搬迁。** 一个 PR 完成全部移动。diff 巨大，和并行开发冲突，出问题难以定位。改为下面的分阶段。

## Consequences

- AGENTS.md §enx-api 的「SQL lives in `repo/`」改为「SQL lives in the domain's `adapters/`」，`docs/agents/enx-api-design.md` 的 Layer Separation 目录图、`enx/` 作为「Domain layer」的描述以及示例同步更新。两处与本 ADR 在同一个 PR 里修改。
- 已接受的 ADR 里出现的旧路径（如 ADR-029、ADR-048 的 `utils/sqlitex/billing_models.go`、ADR-061 的 `handlers/word_lookup.go`）不改，它们是历史记录。
- 搬迁 PR 只移动代码、改 import，不改行为。现有测试必须原样通过；被搬动的代码如果没有测试覆盖，先补特征测试再搬（AGENTS.md「Coverage before refactoring」）。
- depguard 增加两条规则：`platform/**` 不得 import 领域包；有核心的领域包不得 import `github.com/gin-gonic/gin` 和 `gorm.io/gorm`。后一条在对应领域的搬迁完成之后才开启。

### 实施分阶段（接受后转为 GitHub issue 的任务列表）

按风险从低到高，每一步一个 PR，都可以单独回滚：

1. **清理**：删除 `enx/enx.db`，`.gitignore` 加 `*.db`；`examples/`、`test/` 和根目录的 md 文档移入 `docs/`；确认后删除 `deploy/`。
2. **小包合并**：`urlnorm` → `savedpage`；`creditledger` → `billing/creditledger`；`clerktest` → `platform/clerktest`。
3. **`utils/` → `platform/`**：纯改名加改 import。
4. **拆 `handlers/`**：按第 2 条，一个领域一个 commit。
5. **拆 `enx/`**：先 `Dictionary` → `ecdict`，再 `User` 系列 → `account`，最后 `Word` 系列 → `dictionary`。每一步先补测试。
6. **拆 `repo/`**：按领域分批，计费最大，单独成一个或多个 PR。拆空后删除 `repo/`，同时更新 AGENTS.md 和 enx-api-design.md。
7. **开启 depguard 规则**。

## 待 owner 确认

- `deploy/` 是否已经废弃，可以删除？
- `dictsample`（ADR-030 的测量）是否已经结束，可以删除？
- HTTP 子包的名字：`httpapi`、`http`（会遮住标准库，不建议）还是 `web`？
- `User` / `GetOrCreateClerkUser` 放 `account` 是否合适，还是单独建一个 `identity` 包？`account` 现在只管注销和禁用。
